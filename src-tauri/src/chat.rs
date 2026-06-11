use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamLine {
    pub session_id: String,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEnd {
    pub session_id: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct ChatManager {
    runs: Arc<Mutex<HashMap<String, (Option<u32>, JoinHandle<()>)>>>,
}

impl ChatManager {
    pub fn new() -> Self {
        Self::default()
    }
}

// Mirror of the event-bridge line cap (see event_bridge.rs): a provider that
// emits a pathological line must not be buffered/forwarded whole.
const CHAT_MAX_LINE_BYTES: usize = 64 * 1024;

/// SIGKILL an entire unix process group (children are spawned with
/// `process_group(0)`, so the group id is the child pid). Killing only the
/// direct `animus` child leaves the provider grandchild (claude/codex) alive.
#[cfg(unix)]
pub(crate) fn kill_process_group(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(not(unix))]
pub(crate) fn kill_process_group(_pid: u32) {}

fn animus_binary() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        let local = home.join(".local").join("bin").join("animus");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("animus")
}

// --- Scoped-state resolution (mirror of animus `repository_scope`) ----------
//
// Chat conversations live on disk at `~/.animus/<repo-scope>/chat/<id>/`.
// Reading them directly avoids spawning `animus chat list` per project — that
// shelled-out path booted the whole CLI per call and, fanned out across every
// project on launch, ballooned RAM (a single `chat list` once hit 10GB via a
// metrics bug). Pure disk reads are ~instant and allocate almost nothing.

/// Mirror of animus `sanitize_identifier`: lowercase alnum, runs of space/`_`/`-`
/// collapse to a single `-`, no leading/trailing separators.
fn sanitize_identifier(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut trailing = false;
    for ch in value.chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => {
                out.push(ch.to_ascii_lowercase());
                trailing = false;
            }
            ' ' | '_' | '-' if !out.is_empty() && !trailing => {
                out.push('-');
                trailing = true;
            }
            _ => {}
        }
    }
    if trailing {
        out.pop();
    }
    out
}

/// Mirror of animus `repository_scope_for_path`: `<slug>-<12 hex>` where the hex
/// is the first 6 bytes of sha256(canonical path).
fn repository_scope_for_path(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let display = canonical.to_string_lossy();
    let repo_name = canonical
        .file_name()
        .and_then(|v| v.to_str())
        .map(sanitize_identifier)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "repo".to_string());
    let mut hasher = Sha256::new();
    hasher.update(display.as_bytes());
    let d = hasher.finalize();
    let suffix = format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        d[0], d[1], d[2], d[3], d[4], d[5]
    );
    format!("{repo_name}-{suffix}")
}

/// Resolve `~/.animus/<scope>` for a project, mirroring animus: the
/// hash-derived dir if it exists, else a scope whose `.project-root` marker
/// canonicalizes to the same path (covers origin-fallback / moved scopes).
pub(crate) fn scoped_state_root(project_root: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let ao_root = home.join(".animus");
    let hashed = ao_root.join(repository_scope_for_path(project_root));
    if hashed.is_dir() {
        return Some(hashed);
    }
    let canonical = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    for entry in std::fs::read_dir(&ao_root).ok()?.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(dir.join(".project-root")) {
            let recorded = PathBuf::from(content.trim());
            let recorded = recorded.canonicalize().unwrap_or(recorded);
            if recorded == canonical {
                return Some(dir);
            }
        }
    }
    None
}

fn chat_dir_for(project_root: &Path) -> Option<PathBuf> {
    scoped_state_root(project_root).map(|s| s.join("chat"))
}

/// Read one conversation's `meta.json` as raw JSON, or `None` if missing/bad.
fn read_meta(conversation_dir: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(conversation_dir.join("meta.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRunArgs {
    pub session_id: String,
    pub repo_path: String,
    pub tool: String,
    pub model: Option<String>,
    pub prompt: String,
    /// Conversation id to continue (multi-turn). Omit to start a new one;
    /// the `turn_started` frame reports the generated id.
    pub conversation_id: Option<String>,
    pub timeout_secs: Option<u64>,
    /// Provider reasoning/thinking effort: "low" | "medium" | "high".
    /// Omitted/empty = provider default (flag not passed).
    pub reasoning_effort: Option<String>,
    /// Agent profile id — wires the profile's declared MCP servers into the
    /// chat session (`animus chat send --agent <id>`, v0.5.12+).
    pub agent_id: Option<String>,
}

/// Spawn `animus chat send` (v0.5.10+ multi-turn) and stream its JSON event
/// lines to the frontend as `chat-stream` events tagged with the session id.
/// Conversation continuity is owned by the CLI — pass `conversation_id` to
/// continue a prior turn. Emits `chat-stream-end` when the process exits.
#[tauri::command]
pub async fn chat_agent_run(
    app: AppHandle,
    manager: tauri::State<'_, ChatManager>,
    args: ChatRunArgs,
) -> Result<(), String> {
    let bin = animus_binary();
    let repo = PathBuf::from(args.repo_path.trim());
    if !repo.is_dir() {
        return Err(format!("project path not found: {}", repo.display()));
    }

    let session_id = args.session_id.clone();
    let app_for_task = app.clone();
    let runs_for_task = manager.runs.clone();
    // Wall-clock cap on the provider process. This field was previously
    // accepted but never read — a hung provider stalled the turn forever.
    let timeout_secs = args.timeout_secs.unwrap_or(600).clamp(10, 3600);

    let mut cmd = Command::new(&bin);
    cmd.arg("chat")
        .arg("send")
        .arg("--project-root")
        .arg(&repo)
        .arg("--tool")
        .arg(&args.tool)
        .arg("--stream")
        .arg("--json");
    if let Some(conv) = args.conversation_id.as_deref() {
        if !conv.trim().is_empty() {
            cmd.arg("--conversation").arg(conv);
        }
    }
    if let Some(model) = args.model.as_deref() {
        if !model.trim().is_empty() {
            cmd.arg("--model").arg(model);
        }
    }
    if let Some(effort) = args.reasoning_effort.as_deref() {
        // Allowlist the values the CLI's value_enum accepts — anything else
        // would make the spawn fail with an argparse error.
        let effort = effort.trim().to_ascii_lowercase();
        if matches!(effort.as_str(), "low" | "medium" | "high") {
            cmd.arg("--reasoning-effort").arg(&effort);
        }
    }
    if let Some(agent) = args.agent_id.as_deref() {
        if !agent.trim().is_empty() {
            cmd.arg("--agent").arg(agent.trim());
        }
    }
    // Positional message arg comes last, after `--` so a prompt starting
    // with `-` can't be parsed as a flag.
    cmd.arg("--").arg(&args.prompt);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    // Own process group so stop/timeout can SIGKILL the provider grandchild
    // (claude/codex), not just the direct `animus` child.
    #[cfg(unix)]
    cmd.process_group(0);

    // Hold the runs lock across spawn + insert so the task's self-removal at
    // completion can never lose the race with our insert (which would strand
    // a finished JoinHandle in the map forever).
    let mut runs_guard = manager.runs.lock().await;
    let (pid, handle) = match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            let handle = tauri::async_runtime::spawn(async move {
                let (exit_code, error) =
                    run_chat_child(child, &app_for_task, &session_id, timeout_secs).await;
                // Remove BEFORE emitting: chat_cancel only emits its synthetic end
                // event when it actually removed an entry, so exactly one
                // `chat-stream-end` is delivered per session, never two.
                runs_for_task.lock().await.remove(&session_id);
                let _ = app_for_task.emit(
                    "chat-stream-end",
                    &ChatStreamEnd { session_id: session_id.clone(), exit_code, error },
                );
            });
            (pid, handle)
        }
        Err(e) => {
            let handle = tauri::async_runtime::spawn(async move {
                runs_for_task.lock().await.remove(&session_id);
                let _ = app_for_task.emit(
                    "chat-stream-end",
                    &ChatStreamEnd {
                        session_id: session_id.clone(),
                        exit_code: None,
                        error: Some(format!("spawn failed: {e}")),
                    },
                );
            });
            (None, handle)
        }
    };
    if let Some((old_pid, old)) = runs_guard.insert(args.session_id.clone(), (pid, handle)) {
        // A reused session id must not leave the previous child streaming
        // under the same tag, uncancellable.
        old.abort();
        if let Some(p) = old_pid {
            kill_process_group(p);
        }
    }
    Ok(())
}

/// Drive one `animus chat send` child to completion: stream stdout lines as
/// `chat-stream` events, drain stderr CONCURRENTLY (a chatty provider that
/// fills the ~64KB stderr pipe buffer would otherwise deadlock the turn),
/// and enforce the wall-clock timeout. Returns (exit_code, error).
async fn run_chat_child(
    mut child: tokio::process::Child,
    app: &AppHandle,
    session_id: &str,
    timeout_secs: u64,
) -> (Option<i32>, Option<String>) {
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return (None, Some("no stdout".to_string())),
    };
    let stderr_task = child
        .stderr
        .take()
        .map(|se| tauri::async_runtime::spawn(read_stderr_capped(se)));
    let mut reader = BufReader::new(stdout).lines();

    let deadline =
        tokio::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    let mut timed_out = false;
    loop {
        match tokio::time::timeout_at(deadline, reader.next_line()).await {
            Err(_) => {
                timed_out = true;
                break;
            }
            Ok(Ok(Some(line))) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Same lesson as BRIDGE_MAX_LINE_BYTES: never forward a
                // pathological line whole. Replace it with a small synthetic
                // frame the frontend can fold safely.
                let raw = if trimmed.len() > CHAT_MAX_LINE_BYTES {
                    serde_json::json!({
                        "type": "warning",
                        "message": format!(
                            "[chat frame truncated: {} bytes dropped by the desktop bridge]",
                            trimmed.len()
                        ),
                    })
                    .to_string()
                } else {
                    trimmed.to_string()
                };
                let _ = app.emit(
                    "chat-stream",
                    &ChatStreamLine {
                        session_id: session_id.to_string(),
                        raw,
                    },
                );
            }
            Ok(Ok(None)) | Ok(Err(_)) => break,
        }
    }

    if timed_out {
        if let Some(pid) = child.id() {
            kill_process_group(pid);
        }
        let _ = child.start_kill();
    }
    let status = child.wait().await.ok();
    let stderr_text = match stderr_task {
        Some(t) => t
            .await
            .ok()
            .map(|s| crate::animus_cli::truncate_output(&s))
            .filter(|s| !s.is_empty()),
        None => None,
    };
    let exit_code = status.and_then(|s| s.code());
    // Only surface stderr as an error on a failed exit — providers write
    // warnings/progress to stderr on success, and forwarding it
    // unconditionally would mark perfectly good turns as failed.
    let error = if timed_out {
        Some(match stderr_text {
            Some(s) => format!("timed out after {timeout_secs}s; stderr: {s}"),
            None => format!("timed out after {timeout_secs}s"),
        })
    } else if exit_code != Some(0) {
        stderr_text.or_else(|| Some(format!("provider exited with code {exit_code:?}")))
    } else {
        None
    };
    (exit_code, error)
}

/// Drain a child's stderr to EOF, retaining at most 256KB (a runaway writer
/// must neither deadlock the pipe nor balloon memory).
async fn read_stderr_capped(mut se: tokio::process::ChildStderr) -> String {
    use tokio::io::AsyncReadExt;
    const CAP: usize = 256 * 1024;
    let mut kept: Vec<u8> = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match se.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if kept.len() < CAP {
                    let take = (CAP - kept.len()).min(n);
                    kept.extend_from_slice(&buf[..take]);
                }
            }
        }
    }
    String::from_utf8_lossy(&kept).to_string()
}

#[tauri::command]
pub async fn chat_cancel(
    app: AppHandle,
    manager: tauri::State<'_, ChatManager>,
    session_id: String,
) -> Result<(), String> {
    if let Some((pid, handle)) = manager.runs.lock().await.remove(&session_id) {
        // Aborting kills the task that would have emitted `chat-stream-end`
        // (the child dies via kill_on_drop), so emit a synthetic terminal
        // event — otherwise the turn spins as "running" forever. The group
        // kill takes the provider grandchild down with it.
        handle.abort();
        if let Some(p) = pid {
            kill_process_group(p);
        }
        let _ = app.emit(
            "chat-stream-end",
            &ChatStreamEnd {
                session_id,
                exit_code: None,
                error: Some("cancelled".to_string()),
            },
        );
    }
    Ok(())
}

async fn run_chat_json(repo: &PathBuf, args: &[&str]) -> Result<serde_json::Value, String> {
    let bin = animus_binary();
    let mut cmd = Command::new(&bin);
    cmd.arg("chat");
    for a in args {
        cmd.arg(a);
    }
    cmd.arg("--json").arg("--project-root").arg(repo);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("animus chat failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let v: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("parse chat json: {e}"))?;
    Ok(v.get("data").cloned().unwrap_or(serde_json::Value::Null))
}

/// List saved conversations for the project (most-recent first).
#[tauri::command]
pub async fn chat_list(repo_path: String) -> Result<serde_json::Value, String> {
    let repo = PathBuf::from(repo_path.trim());
    if !repo.is_dir() {
        return Err(format!("project path not found: {}", repo.display()));
    }
    run_chat_json(&repo, &["list"]).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConversation {
    pub project_id: String,
    pub project_name: String,
    pub id: String,
    pub title: Option<String>,
    pub tool: String,
    pub model: Option<String>,
    pub message_count: u64,
    pub updated_at: Option<String>,
}

/// Aggregate saved conversations across every adopted project, newest first.
/// Reads each project's scoped `chat/*/meta.json` directly from disk — no
/// subprocess, so fanning out across many projects costs ~nothing.
#[tauri::command]
pub async fn chat_list_all(
    projects: Vec<ProjectRef>,
) -> Result<Vec<ProjectConversation>, String> {
    // Pure disk scan, but std::fs — keep it off the async executor.
    tokio::task::spawn_blocking(move || chat_list_all_blocking(projects))
        .await
        .map_err(|e| format!("chat scan failed: {e}"))
}

fn chat_list_all_blocking(projects: Vec<ProjectRef>) -> Vec<ProjectConversation> {
    let mut out: Vec<ProjectConversation> = Vec::new();
    for p in projects {
        let repo = PathBuf::from(p.repo_path.trim());
        let Some(chat_dir) = chat_dir_for(&repo) else {
            continue;
        };
        let Ok(read) = std::fs::read_dir(&chat_dir) else {
            continue;
        };
        for entry in read.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Some(meta) = read_meta(&entry.path()) else {
                continue;
            };
            let Some(id) = meta.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            out.push(ProjectConversation {
                project_id: p.id.clone(),
                project_name: p.name.clone(),
                id: id.to_string(),
                title: meta.get("title").and_then(|v| v.as_str()).map(String::from),
                tool: meta
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or("claude")
                    .to_string(),
                model: meta.get("model").and_then(|v| v.as_str()).map(String::from),
                message_count: meta
                    .get("message_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                updated_at: meta
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });
        }
    }
    // newest first
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// Conversation ids become directory names — reject path separators and other
/// surprises before joining into a filesystem path (mirror of animus).
fn is_safe_conversation_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Read `messages.jsonl` as an array of raw message objects. Size-guarded so a
/// pathological file can never be loaded whole (same lesson as the metrics bug).
fn read_messages(path: &Path) -> Vec<serde_json::Value> {
    const MAX_BYTES: u64 = 64 * 1024 * 1024;
    if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        return Vec::new();
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .collect()
}

/// Full transcript for one conversation, read directly from the scoped chat
/// directory (no subprocess). Returns `{ meta, messages }`, where each message
/// carries the persisted `blocks` timeline when present.
#[tauri::command]
pub async fn chat_get(
    repo_path: String,
    conversation_id: String,
) -> Result<serde_json::Value, String> {
    let repo = PathBuf::from(repo_path.trim());
    if !is_safe_conversation_id(&conversation_id) {
        return Err(format!("invalid conversation id: {conversation_id}"));
    }
    // The transcript read can be tens of MB of sync IO — off the executor.
    tokio::task::spawn_blocking(move || {
        let chat_dir = chat_dir_for(&repo)
            .ok_or_else(|| "could not resolve scoped chat directory".to_string())?;
        let conv_dir = chat_dir.join(&conversation_id);
        let meta = read_meta(&conv_dir)
            .ok_or_else(|| format!("conversation '{conversation_id}' not found"))?;
        let messages = read_messages(&conv_dir.join("messages.jsonl"));
        Ok(serde_json::json!({ "meta": meta, "messages": messages }))
    })
    .await
    .map_err(|e| format!("chat read failed: {e}"))?
}

/// Set (or clear) a conversation's `title` in its `meta.json`, preserving every
/// other field. A blank title clears it back to `null`. Written atomically.
fn set_meta_title(conv_dir: &Path, title: Option<&str>) -> Result<(), String> {
    let mut meta = read_meta(conv_dir).ok_or_else(|| "conversation not found".to_string())?;
    let obj = meta
        .as_object_mut()
        .ok_or_else(|| "meta.json is not a JSON object".to_string())?;
    let value = match title {
        Some(t) if !t.trim().is_empty() => serde_json::Value::String(t.trim().to_string()),
        _ => serde_json::Value::Null,
    };
    obj.insert("title".to_string(), value);
    let body = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    let meta_path = conv_dir.join("meta.json");
    let tmp = meta_path.with_extension("json.tmp");
    std::fs::write(&tmp, body.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &meta_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Rename a conversation (sets `meta.json` title). Blank clears it.
#[tauri::command]
pub async fn chat_rename(
    repo_path: String,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let repo = PathBuf::from(repo_path.trim());
    if !is_safe_conversation_id(&conversation_id) {
        return Err(format!("invalid conversation id: {conversation_id}"));
    }
    tokio::task::spawn_blocking(move || {
        let chat_dir = chat_dir_for(&repo)
            .ok_or_else(|| "could not resolve scoped chat directory".to_string())?;
        let conv_dir = chat_dir.join(&conversation_id);
        if !conv_dir.is_dir() {
            return Err(format!("conversation '{conversation_id}' not found"));
        }
        set_meta_title(&conv_dir, Some(&title))
    })
    .await
    .map_err(|e| format!("chat rename failed: {e}"))?
}

/// Permanently delete a conversation (removes its scoped directory).
#[tauri::command]
pub async fn chat_delete(repo_path: String, conversation_id: String) -> Result<(), String> {
    let repo = PathBuf::from(repo_path.trim());
    if !is_safe_conversation_id(&conversation_id) {
        return Err(format!("invalid conversation id: {conversation_id}"));
    }
    tokio::task::spawn_blocking(move || {
        let chat_dir = chat_dir_for(&repo)
            .ok_or_else(|| "could not resolve scoped chat directory".to_string())?;
        let conv_dir = chat_dir.join(&conversation_id);
        if !conv_dir.is_dir() {
            return Err(format!("conversation '{conversation_id}' not found"));
        }
        std::fs::remove_dir_all(&conv_dir).map_err(|e| format!("delete failed: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("chat delete failed: {e}"))?
}

/// List provider plugins (kind=provider) and a sensible set of known models
/// per provider so the Chat composer can offer a picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOption {
    pub tool: String,
    pub name: String,
    pub installed: bool,
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn chat_providers() -> Result<Vec<ProviderOption>, String> {
    // Query installed plugins, filter to provider kind, map plugin name to a
    // CLI tool token. Known model lists are curated client-side fallbacks.
    let bin = animus_binary();
    let output = Command::new(&bin)
        .arg("plugin")
        .arg("list")
        .arg("--json")
        .output()
        .await
        .map_err(|e| format!("plugin list failed: {e}"))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let json: serde_json::Value = serde_json::from_str(text.trim()).unwrap_or(serde_json::Value::Null);

    let mut installed_tools: std::collections::HashSet<String> = std::collections::HashSet::new();
    let arr = json
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| json.as_array());
    if let Some(items) = arr {
        for item in items {
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if kind != "provider" {
                continue;
            }
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            // animus-provider-claude -> claude
            if let Some(tool) = name.strip_prefix("animus-provider-") {
                installed_tools.insert(tool.to_string());
            }
        }
    }

    let catalog: Vec<(&str, &str, Vec<&str>)> = vec![
        (
            "claude",
            "Claude",
            vec![
                "claude-fable-5",
                "claude-opus-4-8",
                "claude-opus-4-7",
                "claude-sonnet-4-6",
                "claude-haiku-4-5",
            ],
        ),
        (
            "codex",
            "Codex",
            vec!["gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5.4-mini"],
        ),
        (
            "gemini",
            "Gemini",
            vec!["gemini-3.1-pro-preview", "gemini-2.5-flash"],
        ),
        ("opencode", "OpenCode", vec![]),
        (
            "oai",
            "OpenAI",
            vec!["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-mini", "o3"],
        ),
    ];

    let mut out = Vec::new();
    for (tool, name, models) in catalog {
        out.push(ProviderOption {
            tool: tool.to_string(),
            name: name.to_string(),
            installed: installed_tools.contains(tool),
            models: models.into_iter().map(String::from).collect(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_identifier_mirrors_animus() {
        assert_eq!(sanitize_identifier("Repo Name"), "repo-name");
        assert_eq!(sanitize_identifier("___"), "");
        assert_eq!(sanitize_identifier("A__B--C"), "a-b-c");
        assert_eq!(sanitize_identifier("  __My Repo!! -- 2026__  "), "my-repo-2026");
        assert_eq!(sanitize_identifier("日本語"), "");
    }

    #[test]
    fn repository_scope_emits_slug_and_12_hex() {
        let scope = repository_scope_for_path(&std::env::temp_dir());
        let (slug, suffix) = scope.rsplit_once('-').expect("scope has a hyphen");
        assert!(!slug.is_empty());
        assert_eq!(suffix.len(), 12);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn is_safe_conversation_id_rejects_traversal() {
        assert!(is_safe_conversation_id("conv-abc123"));
        assert!(is_safe_conversation_id("my_conv-1"));
        assert!(!is_safe_conversation_id(""));
        assert!(!is_safe_conversation_id(".."));
        assert!(!is_safe_conversation_id("../etc"));
        assert!(!is_safe_conversation_id("a/b"));
    }

    #[test]
    fn set_meta_title_sets_clears_and_preserves_other_fields() {
        let base = std::env::temp_dir().join(format!("animus-chat-rename-{}", std::process::id()));
        let conv = base.join("conv-x");
        std::fs::create_dir_all(&conv).unwrap();
        std::fs::write(
            conv.join("meta.json"),
            r#"{"id":"conv-x","tool":"codex","message_count":3,"title":null}"#,
        )
        .unwrap();

        set_meta_title(&conv, Some("  My chat  ")).unwrap();
        let meta = read_meta(&conv).unwrap();
        assert_eq!(meta.get("title").unwrap(), "My chat", "trimmed title set");
        assert_eq!(meta.get("tool").unwrap(), "codex", "other fields preserved");
        assert_eq!(meta.get("message_count").unwrap(), 3);

        set_meta_title(&conv, Some("   ")).unwrap();
        assert!(read_meta(&conv).unwrap().get("title").unwrap().is_null(), "blank clears title");

        std::fs::remove_dir_all(&base).ok();
    }
}
