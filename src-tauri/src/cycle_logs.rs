use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct LogLine {
    pub ts: Option<String>,
    pub level: Option<String>,
    pub phase: Option<String>,
    pub message: String,
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

fn parse_log_line(raw: &str, fallback_cycle: &str) -> Option<LogLine> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return Some(LogLine {
                ts: None,
                level: None,
                phase: None,
                message: trimmed.to_string(),
            });
        }
    };

    let inner = match parsed.get("data") {
        Some(Value::Object(_)) => parsed.get("data").cloned().unwrap_or(parsed.clone()),
        _ => parsed.clone(),
    };

    let obj = inner.as_object()?;
    let event_cycle = obj
        .get("meta")
        .and_then(|m| m.get("cycle_id"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            obj.get("meta")
                .and_then(|m| m.get("run_id"))
                .and_then(|v| v.as_str())
        });

    if let Some(ev_cycle) = event_cycle {
        if !fallback_cycle.is_empty() && ev_cycle != fallback_cycle {
            return None;
        }
    }

    let ts = obj
        .get("ts")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let level = obj
        .get("level")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let phase = obj
        .get("meta")
        .and_then(|m| m.get("phase"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let message = obj
        .get("msg")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| trimmed.to_string());

    Some(LogLine {
        ts,
        level,
        phase,
        message,
    })
}

#[tauri::command]
pub async fn cycle_logs_subscribe(
    cycle_id: String,
    on_event: Channel<LogLine>,
) -> Result<(), String> {
    let bin = animus_binary_path().ok_or_else(|| "animus binary not found".to_string())?;

    let mut child = Command::new(&bin)
        .arg("daemon")
        .arg("stream")
        .arg("--json")
        .arg("--run")
        .arg(&cycle_id)
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
        match reader.next_line().await {
            Ok(Some(line)) => {
                if let Some(parsed) = parse_log_line(&line, &cycle_id) {
                    if on_event.send(parsed).is_err() {
                        let _ = child.kill().await;
                        return Ok(());
                    }
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
}
