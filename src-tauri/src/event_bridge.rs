use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const INITIAL_BACKOFF_MS: u64 = 500;
const MAX_BACKOFF_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonLogEvent {
    pub ts: Option<String>,
    pub level: Option<String>,
    pub cat: Option<String>,
    pub msg: Option<String>,
    pub meta: Option<Value>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonStatusChanged {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleEvent {
    pub project_id: Option<String>,
    pub cycle_id: Option<String>,
    pub phase: Option<String>,
    pub status: String,
    pub msg: Option<String>,
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_loop(app).await;
    });
}

async fn run_loop(app: AppHandle) {
    let mut backoff_ms = INITIAL_BACKOFF_MS;
    loop {
        match run_once(&app).await {
            Ok(()) => {
                backoff_ms = INITIAL_BACKOFF_MS;
            }
            Err(err) => {
                eprintln!("event_bridge: stream error: {err}");
            }
        }

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

async fn run_once(app: &AppHandle) -> Result<(), String> {
    let bin = animus_binary_path().ok_or_else(|| "animus binary not found".to_string())?;

    let mut child = Command::new(&bin)
        .arg("daemon")
        .arg("stream")
        .arg("--json")
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

    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(text)) => dispatch_line(app, &text),
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

fn dispatch_line(app: &AppHandle, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }

    let parsed: Option<Value> = serde_json::from_str(trimmed).ok();

    let (ts, level, cat, msg, meta) = match parsed.as_ref() {
        Some(Value::Object(map)) => {
            let inner = match map.get("data") {
                Some(Value::Object(_)) => map.get("data").cloned().unwrap_or(Value::Null),
                _ => Value::Object(map.clone()),
            };
            extract_envelope(&inner)
        }
        _ => (None, None, None, None, None),
    };

    let log_event = DaemonLogEvent {
        ts: ts.clone(),
        level: level.clone(),
        cat: cat.clone(),
        msg: msg.clone(),
        meta: meta.clone(),
        raw: trimmed.to_string(),
    };
    let _ = app.emit("daemon-log", &log_event);

    let cat_str = cat.as_deref().unwrap_or("");
    let msg_str = msg.as_deref().unwrap_or("");

    match cat_str {
        "daemon" => {
            if let Some(status) = daemon_status_from_msg(msg_str) {
                let _ = app.emit(
                    "daemon-status-changed",
                    &DaemonStatusChanged {
                        status: status.to_string(),
                    },
                );
            }
        }
        "phase" | "workflow" => {
            if let Some(status) = cycle_status_from_msg(msg_str) {
                let cycle = CycleEvent {
                    project_id: meta_string(meta.as_ref(), "project_id"),
                    cycle_id: meta_string(meta.as_ref(), "cycle_id")
                        .or_else(|| meta_string(meta.as_ref(), "run_id"))
                        .or_else(|| meta_string(meta.as_ref(), "workflow_id")),
                    phase: meta_string(meta.as_ref(), "phase"),
                    status: status.to_string(),
                    msg: Some(msg_str.to_string()),
                };
                let _ = app.emit("cycle-event", &cycle);
            }
        }
        _ => {}
    }
}

fn extract_envelope(
    value: &Value,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<Value>,
) {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return (None, None, None, None, None),
    };
    let ts = obj
        .get("ts")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let level = obj
        .get("level")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let cat = obj
        .get("cat")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let msg = obj
        .get("msg")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let meta = obj.get("meta").cloned();
    (ts, level, cat, msg, meta)
}

fn meta_string(meta: Option<&Value>, key: &str) -> Option<String> {
    meta.and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
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
