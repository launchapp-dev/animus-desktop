use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tauri::async_runtime::JoinHandle;
use tokio::sync::Mutex;


const INITIAL_BACKOFF_MS: u64 = 500;
const MAX_BACKOFF_MS: u64 = 30_000;

// Sanity caps on the daemon-stream firehose. Without these, a chatty or
// pathological subprocess can drive Tauri's emit channel and the JS-side
// store into runaway allocation (we've measured 100GB RSS on a stuck
// stream during development).
const BRIDGE_MAX_LINE_BYTES: usize = 64 * 1024;
const BRIDGE_MAX_LINES_PER_SEC: u32 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct DaemonLogEvent {
    pub ts: Option<String>,
    pub level: Option<String>,
    pub cat: Option<String>,
    pub msg: Option<String>,
    #[cfg_attr(test, ts(type = "unknown"))]
    pub meta: Option<Value>,
    pub raw: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct DaemonStatusChanged {
    pub status: String,
    pub project_id: Option<String>,
}

/// Liveness of the per-project `animus daemon stream` bridge, emitted as
/// `bridge-status` so the UI can surface "live stream disconnected" with a
/// retry affordance instead of silently showing stale data.
#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatusEvent {
    pub project_id: Option<String>,
    pub connected: bool,
    pub retry_in_ms: Option<u64>,
}

// The full event envelope we forward to the JS side. Most fields come from
// the top-level keys of the raw daemon JSON. The bridge no longer flattens
// everything into a single "status" — instead it forwards `cat` verbatim
// so the Journal can render workflow → phase → dispatch → LLM hierarchies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct CycleEvent {
    pub project_id: Option<String>,
    pub ts: Option<String>,
    pub level: Option<String>,
    pub cat: String,
    pub msg: Option<String>,
    pub run_id: Option<String>,
    pub workflow_ref: Option<String>,
    pub phase_id: Option<String>,
    pub subject_id: Option<String>,
    pub schedule_id: Option<String>,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub plugin: Option<String>,
    pub agent: Option<String>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,
    pub tool_params: Option<String>,
    pub tool_result: Option<String>,
    pub tool_success: Option<bool>,
    pub verdict: Option<String>,
    pub command_program: Option<String>,
    pub command_args: Vec<String>,
    // Legacy fields kept so existing TS consumers (decay/agentLiveStates)
    // still work. `status` is derived from cat: phase.start=started,
    // phase.complete=completed (or failed if level=error/exit_code!=0),
    // etc.
    pub status: String,
    pub phase: Option<String>,
    pub cycle_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct BridgeManager {
    tasks: Arc<Mutex<HashMap<String, (PathBuf, JoinHandle<()>)>>>,
}

impl BridgeManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn spawn_for_project(&self, app: AppHandle, project_id: String, repo_path: PathBuf) {
        let mut tasks = self.tasks.lock().await;
        if let Some((existing_path, _)) = tasks.get(&project_id) {
            if existing_path == &repo_path {
                return;
            }
            // Re-adopted at a different path: the old loop would stream the
            // stale location forever. Restart it against the new path.
            if let Some((_, old)) = tasks.remove(&project_id) {
                old.abort();
            }
        }
        let pid = project_id.clone();
        let path_for_task = repo_path.clone();
        let handle = tauri::async_runtime::spawn(async move {
            run_loop(app, Some(pid), Some(path_for_task)).await;
        });
        tasks.insert(project_id, (repo_path, handle));
    }

    pub async fn kill_for_project(&self, project_id: &str) {
        let mut tasks = self.tasks.lock().await;
        if let Some((_, handle)) = tasks.remove(project_id) {
            handle.abort();
        }
    }

    pub async fn active_project_ids(&self) -> Vec<String> {
        let tasks = self.tasks.lock().await;
        tasks
            .keys()
            .filter(|k| k.as_str() != "__global__")
            .cloned()
            .collect()
    }
}

pub fn start(app: AppHandle) {
    let manager = BridgeManager::new();
    app.manage(manager.clone());

    // We used to: (1) spawn a global bridge with no --project-root and
    // (2) auto-attach a bridge for every adopted project on app start. Both
    // were free-running `animus daemon stream` subprocesses that respawned on
    // EOF whenever there was no daemon to subscribe to — producing thousands
    // of subprocess starts per minute. Now we lazily attach via
    // `bridge_attach_project` from the frontend when the user actually
    // selects a project. No global bridge.
}

#[tauri::command]
pub async fn bridge_attach_project(
    app: AppHandle,
    manager: tauri::State<'_, BridgeManager>,
    project_id: String,
    repo_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&repo_path);
    if !path.exists() {
        return Err(format!("repo_path does not exist: {repo_path}"));
    }
    manager.spawn_for_project(app, project_id, path).await;
    Ok(())
}

#[tauri::command]
pub async fn bridge_detach_project(
    manager: tauri::State<'_, BridgeManager>,
    project_id: String,
) -> Result<(), String> {
    manager.kill_for_project(&project_id).await;
    Ok(())
}

#[tauri::command]
pub async fn bridge_active_projects(
    manager: tauri::State<'_, BridgeManager>,
) -> Result<Vec<String>, String> {
    Ok(manager.active_project_ids().await)
}

async fn run_loop(app: AppHandle, project_id: Option<String>, project_root: Option<PathBuf>) {
    // Threshold below which we consider the stream "didn't really run" — usually
    // means there's no daemon to stream from and `animus daemon stream` exited
    // with EOF immediately. Without this guard, fast EOF + Ok(()) resets the
    // backoff to 500ms and we respawn forever (the leak that produced a 19GB
    // metrics file in 22 minutes of background runtime).
    const MIN_HEALTHY_STREAM_SECS: u64 = 5;
    let mut backoff_ms = INITIAL_BACKOFF_MS;
    loop {
        let started = std::time::Instant::now();
        match run_once(&app, project_id.as_deref(), project_root.as_deref()).await {
            Ok(()) => {
                let ran = started.elapsed();
                if ran.as_secs() >= MIN_HEALTHY_STREAM_SECS {
                    // Real connection: the stream genuinely served events.
                    backoff_ms = INITIAL_BACKOFF_MS;
                } else {
                    // Fast EOF — no daemon present. Treat as a failure for
                    // backoff purposes so we don't hammer the subprocess
                    // boundary every 500ms.
                    eprintln!(
                        "event_bridge[{}]: stream exited after {:?} without producing a sustained stream; backing off",
                        project_id.as_deref().unwrap_or("__global__"),
                        ran
                    );
                }
            }
            Err(err) => {
                eprintln!(
                    "event_bridge[{}]: stream error: {err}",
                    project_id.as_deref().unwrap_or("__global__")
                );
            }
        }

        // Whatever the exit reason, the live stream is down until the next
        // attempt succeeds — tell the UI so it can offer a retry.
        let _ = app.emit(
            "bridge-status",
            &BridgeStatusEvent {
                project_id: project_id.clone(),
                connected: false,
                retry_in_ms: Some(backoff_ms),
            },
        );
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms.saturating_mul(2)).min(MAX_BACKOFF_MS);
    }
}

fn animus_binary_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let candidate = PathBuf::from(home).join(".local/bin/animus");
    if candidate.exists() {
        return Some(candidate);
    }
    let output = std::process::Command::new("which")
        .arg("animus")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

async fn run_once(
    app: &AppHandle,
    project_id: Option<&str>,
    project_root: Option<&std::path::Path>,
) -> Result<(), String> {
    let bin = animus_binary_path().ok_or_else(|| "animus binary not found".to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.arg("daemon").arg("stream").arg("--json");
    if let Some(root) = project_root {
        cmd.arg("--project-root").arg(root);
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn animus daemon stream: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stream stdout unavailable".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    // Per-bridge token bucket: refill BRIDGE_MAX_LINES_PER_SEC every second.
    let mut window_start = std::time::Instant::now();
    let mut lines_in_window: u32 = 0;
    let mut dropped_in_window: u32 = 0;
    // Announce liveness once, on the first real line of this attempt.
    let mut announced_connected = false;

    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        if !announced_connected {
                            announced_connected = true;
                            let _ = app.emit(
                                "bridge-status",
                                &BridgeStatusEvent {
                                    project_id: project_id.map(|s| s.to_string()),
                                    connected: true,
                                    retry_in_ms: None,
                                },
                            );
                        }
                        let now = std::time::Instant::now();
                        if now.duration_since(window_start) >= std::time::Duration::from_secs(1) {
                            if dropped_in_window > 0 {
                                eprintln!(
                                    "event_bridge[{}]: dropped {} lines in last second (rate cap {})",
                                    project_id.unwrap_or("__global__"),
                                    dropped_in_window,
                                    BRIDGE_MAX_LINES_PER_SEC
                                );
                            }
                            window_start = now;
                            lines_in_window = 0;
                            dropped_in_window = 0;
                        }
                        if lines_in_window >= BRIDGE_MAX_LINES_PER_SEC {
                            dropped_in_window = dropped_in_window.saturating_add(1);
                        } else if text.len() > BRIDGE_MAX_LINE_BYTES {
                            // Don't drop oversized lines wholesale — a huge
                            // `phase.complete`/`workflow.complete` carries the
                            // terminal state the UI needs. Truncate the heavy
                            // fields and forward a stub instead.
                            match stub_oversized_line(&text) {
                                Some(stub) => {
                                    lines_in_window += 1;
                                    dispatch_line(app, project_id, &stub);
                                }
                                None => {
                                    dropped_in_window = dropped_in_window.saturating_add(1);
                                }
                            }
                        } else {
                            lines_in_window += 1;
                            dispatch_line(app, project_id, &text);
                        }
                    }
                    Ok(None) => {
                        let _ = child.wait().await;
                        return Ok(());
                    }
                    Err(e) => {
                        let _ = child.kill().await;
                        return Err(format!("read stream line: {e}"));
                    }
                }
            }
            status = child.wait() => {
                // The child can exit while its final lines (often the
                // terminal `workflow.complete`) are still buffered in the
                // pipe — drain them before reporting the exit, or the UI
                // shows the workflow as running forever.
                drain_remaining_lines(app, project_id, &mut reader).await;
                match status {
                    Ok(s) => {
                        return Err(format!("animus daemon stream exited: {s}"));
                    }
                    Err(e) => {
                        return Err(format!("wait child: {e}"));
                    }
                }
            }
        }
    }
}

/// After child exit, read whatever is left in the pipe (bounded by the OS
/// pipe buffer, so this terminates quickly) and dispatch it.
async fn drain_remaining_lines(
    app: &AppHandle,
    project_id: Option<&str>,
    reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) {
    while let Ok(Some(text)) = reader.next_line().await {
        if text.len() > BRIDGE_MAX_LINE_BYTES {
            if let Some(stub) = stub_oversized_line(&text) {
                dispatch_line(app, project_id, &stub);
            }
        } else {
            dispatch_line(app, project_id, &text);
        }
    }
}

/// Shrink an oversized event line by replacing its heavy payload fields with
/// size markers, preserving the routing/status fields the UI actually needs.
/// Returns None when the line isn't JSON (nothing useful to salvage).
fn stub_oversized_line(text: &str) -> Option<String> {
    let mut v: Value = serde_json::from_str(text.trim()).ok()?;
    fn strip_heavy(value: &mut Value) {
        if let Some(map) = value.as_object_mut() {
            for key in ["meta", "content", "output", "raw", "detail"] {
                if let Some(val) = map.get_mut(key) {
                    let rendered = val.to_string();
                    if rendered.len() > 4096 {
                        *val = Value::String(format!(
                            "[truncated: {} bytes dropped by event bridge]",
                            rendered.len()
                        ));
                    }
                }
            }
        }
    }
    if let Some(data) = v.get_mut("data") {
        strip_heavy(data);
    }
    strip_heavy(&mut v);
    let out = v.to_string();
    // If still oversized after stripping (e.g. thousands of small fields),
    // give up rather than forward a megabyte line.
    if out.len() > BRIDGE_MAX_LINE_BYTES {
        return None;
    }
    Some(out)
}

fn dispatch_line(app: &AppHandle, project_id: Option<&str>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }

    let parsed: Option<Value> = serde_json::from_str(trimmed).ok();
    let pid = project_id.map(|s| s.to_string());

    let inner_value = match parsed.as_ref() {
        Some(Value::Object(map)) => match map.get("data") {
            Some(Value::Object(_)) => map.get("data").cloned().unwrap_or(Value::Null),
            _ => Value::Object(map.clone()),
        },
        _ => {
            // Not JSON — still emit the raw log line for the journal to display.
            let log_event = DaemonLogEvent {
                ts: None,
                level: None,
                cat: None,
                msg: Some(trimmed.to_string()),
                meta: None,
                raw: trimmed.to_string(),
                project_id: pid.clone(),
            };
            let _ = app.emit("daemon-log", &log_event);
            return;
        }
    };

    let env = extract_envelope(&inner_value);

    let log_event = DaemonLogEvent {
        ts: env.ts.clone(),
        level: env.level.clone(),
        cat: env.cat.clone(),
        msg: env.msg.clone(),
        meta: env.meta.clone(),
        raw: trimmed.to_string(),
        project_id: pid.clone(),
    };
    let _ = app.emit("daemon-log", &log_event);

    let cat_str = env.cat.as_deref().unwrap_or("");
    let msg_str = env.msg.as_deref().unwrap_or("");
    let level_str = env.level.as_deref().unwrap_or("");

    // Daemon lifecycle → status-changed
    if cat_str == "daemon" {
        if let Some(status) = daemon_status_from_msg(msg_str) {
            let _ = app.emit(
                "daemon-status-changed",
                &DaemonStatusChanged {
                    status: status.to_string(),
                    project_id: pid.clone(),
                },
            );
        }
    }

    // Forward the full set of cats we care about as cycle-events. The JS
    // side decides how to group / render based on `cat`.
    let forward = matches!(
        cat_str,
        "workflow.start"
            | "workflow.complete"
            | "phase.start"
            | "phase.complete"
            | "phase.decision"
            | "plugin.dispatch.start"
            | "plugin.dispatch.complete"
            | "plugin.dispatch.timeout"
            | "plugin.cancel"
            | "schedule"
            | "triggers"
            | "command.complete"
            | "llm.thinking"
            | "llm.output"
            | "llm.complete"
            | "llm.tool_result"
            | "llm.tool_call"
    );
    if !forward {
        return;
    }

    let derived_status = match cat_str {
        "workflow.start" | "phase.start" | "plugin.dispatch.start" => "started",
        "workflow.complete" | "phase.complete" | "plugin.dispatch.complete" | "command.complete" => {
            if level_str == "error" {
                "failed"
            } else {
                "completed"
            }
        }
        "plugin.dispatch.timeout" => "failed",
        "plugin.cancel" => "cancelled",
        "phase.decision" => "decision",
        "schedule" => "scheduled",
        "triggers" => "triggered",
        _ => "info",
    };

    let run_id = env
        .run_id
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "run_id"))
        .or_else(|| meta_string(env.meta.as_ref(), "workflow_id"));
    let workflow_ref = meta_string(env.meta.as_ref(), "workflow_ref");
    let phase_id = env.phase_id.clone();
    let subject_id = env
        .subject_id
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "subject_id"));
    let schedule_id = env
        .schedule_id
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "schedule_id"));

    let duration_ms = env
        .duration_ms
        .or_else(|| meta_u64(env.meta.as_ref(), "duration_ms"));
    let exit_code = env
        .exit_code
        .or_else(|| meta_i64(env.meta.as_ref(), "exit_code"));
    let error = env.error.clone();

    let model = env
        .model
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "model"));
    let raw_tool = env
        .tool
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "tool"));
    let plugin = meta_string(env.meta.as_ref(), "plugin");
    let agent = meta_string(env.meta.as_ref(), "agent")
        .or_else(|| meta_string(env.meta.as_ref(), "agent_id"));
    let role = env.role.clone();
    // phase.decision carries its explanation in meta.reason, not content.
    let content = env
        .content
        .clone()
        .or_else(|| meta_string(env.meta.as_ref(), "reason"));
    let verdict = meta_string(env.meta.as_ref(), "verdict");
    let command_program = meta_string(env.meta.as_ref(), "program");
    let command_args = env
        .meta
        .as_ref()
        .and_then(|m| m.get("args"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // LLM categories carry their meaningful payload in different places.
    // tool_call: msg = tool name (e.g. "Bash"), meta.params = call args.
    // tool_result: meta.tool = "toolu_<id>" (a use-id, NOT a name); the
    //              actual result text lives in meta.result.
    // thinking: no content at all (just a marker).
    let (tool_name, tool_use_id, tool_params, tool_result, tool_success, tool) = match cat_str
    {
        "llm.tool_call" => {
            let name = if env.msg.as_deref().unwrap_or("").is_empty() {
                raw_tool.clone()
            } else {
                env.msg.clone()
            };
            let params = env
                .meta
                .as_ref()
                .and_then(|m| m.get("params"))
                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default());
            (name, None, params, None, None, None)
        }
        "llm.tool_result" => {
            let use_id = raw_tool.clone();
            let result_text = env
                .meta
                .as_ref()
                .and_then(|m| m.get("result"))
                .and_then(|v| match v {
                    Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                });
            let success = env
                .meta
                .as_ref()
                .and_then(|m| m.get("success"))
                .and_then(|v| v.as_bool());
            (None, use_id, None, result_text, success, None)
        }
        _ => (None, None, None, None, None, raw_tool),
    };

    let cycle = CycleEvent {
        project_id: pid.clone(),
        ts: env.ts.clone(),
        level: env.level.clone(),
        cat: cat_str.to_string(),
        msg: Some(msg_str.to_string()),
        run_id: run_id.clone(),
        workflow_ref,
        phase_id: phase_id.clone(),
        subject_id,
        schedule_id,
        duration_ms,
        exit_code,
        error,
        model,
        tool,
        plugin,
        agent,
        role,
        content,
        tool_name,
        tool_use_id,
        tool_params,
        tool_result,
        tool_success,
        verdict,
        command_program,
        command_args,
        // Legacy fields for back-compat with the existing JS reducer.
        status: derived_status.to_string(),
        phase: phase_id,
        cycle_id: run_id,
    };
    let _ = app.emit("cycle-event", &cycle);
}

#[derive(Default)]
struct EventEnvelope {
    ts: Option<String>,
    level: Option<String>,
    cat: Option<String>,
    msg: Option<String>,
    meta: Option<Value>,
    phase_id: Option<String>,
    run_id: Option<String>,
    subject_id: Option<String>,
    schedule_id: Option<String>,
    duration_ms: Option<u64>,
    exit_code: Option<i64>,
    error: Option<String>,
    model: Option<String>,
    tool: Option<String>,
    role: Option<String>,
    content: Option<String>,
}

fn extract_envelope(value: &Value) -> EventEnvelope {
    let mut env = EventEnvelope::default();
    let Some(obj) = value.as_object() else {
        return env;
    };
    env.ts = obj.get("ts").and_then(|v| v.as_str()).map(String::from);
    env.level = obj.get("level").and_then(|v| v.as_str()).map(String::from);
    env.cat = obj.get("cat").and_then(|v| v.as_str()).map(String::from);
    env.msg = obj.get("msg").and_then(|v| v.as_str()).map(String::from);
    env.meta = obj.get("meta").cloned();
    env.phase_id = obj.get("phase_id").and_then(|v| v.as_str()).map(String::from);
    env.run_id = obj.get("run_id").and_then(|v| v.as_str()).map(String::from);
    env.subject_id = obj.get("subject_id").and_then(|v| v.as_str()).map(String::from);
    env.schedule_id = obj.get("schedule_id").and_then(|v| v.as_str()).map(String::from);
    env.duration_ms = obj.get("duration_ms").and_then(|v| v.as_u64());
    env.exit_code = obj.get("exit_code").and_then(|v| v.as_i64());
    env.error = obj.get("error").and_then(|v| v.as_str()).map(String::from);
    env.model = obj.get("model").and_then(|v| v.as_str()).map(String::from);
    env.tool = obj.get("tool").and_then(|v| v.as_str()).map(String::from);
    env.role = obj.get("role").and_then(|v| v.as_str()).map(String::from);
    env.content = obj.get("content").and_then(|v| v.as_str()).map(String::from);
    env
}

fn meta_string(meta: Option<&Value>, key: &str) -> Option<String> {
    meta.and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn meta_u64(meta: Option<&Value>, key: &str) -> Option<u64> {
    meta.and_then(|m| m.get(key)).and_then(|v| v.as_u64())
}

fn meta_i64(meta: Option<&Value>, key: &str) -> Option<i64> {
    meta.and_then(|m| m.get(key)).and_then(|v| v.as_i64())
}

fn daemon_status_from_msg(msg: &str) -> Option<&'static str> {
    let m = msg.to_ascii_lowercase();
    if m.contains("daemon started") || m == "started" || m == "running" {
        Some("running")
    } else if m.contains("daemon stopped") || m == "stopped" || m.contains("shutdown") {
        Some("stopped")
    } else {
        None
    }
}

fn cycle_status_from_msg(msg: &str) -> Option<&'static str> {
    match msg {
        "phase_started" | "workflow_started" => Some("started"),
        "phase_completed" | "workflow_completed" => Some("completed"),
        "workflow_failed" | "phase_failed" => Some("failed"),
        _ => None,
    }
}
