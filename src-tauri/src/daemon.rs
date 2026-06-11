use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

const INSTALL_SCRIPT_URL: &str =
    "https://raw.githubusercontent.com/launchapp-dev/animus-cli/main/scripts/install.sh";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct DaemonStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    pub pid: Option<u32>,
    pub plugins_installed: usize,
    pub binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct InstallProgress {
    pub stage: String,
    pub percent: Option<u8>,
    pub message: String,
}

// Resolving the binary can shell out to `which`, which is too slow/blocky to
// run on every Tauri command. Cache successful resolutions only — a miss
// (not installed yet) re-checks each call, and the install flow invalidates
// the cache so a fresh install is picked up immediately.
static ANIMUS_BIN_CACHE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

pub(crate) async fn resolve_animus_binary() -> Option<PathBuf> {
    if let Ok(guard) = ANIMUS_BIN_CACHE.lock() {
        if let Some(p) = guard.as_ref() {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }
    let found = locate_animus_binary().await;
    if let Some(p) = &found {
        if let Ok(mut guard) = ANIMUS_BIN_CACHE.lock() {
            *guard = Some(p.clone());
        }
    }
    found
}

fn invalidate_animus_binary_cache() {
    if let Ok(mut guard) = ANIMUS_BIN_CACHE.lock() {
        *guard = None;
    }
}

async fn locate_animus_binary() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(&home).join(".local/bin/animus");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let output = Command::new("which").arg("animus").output().await.ok()?;
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

async fn animus_version(bin: &PathBuf) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    Some(text.trim().to_string())
}

async fn count_plugins(bin: &PathBuf) -> usize {
    let output = match Command::new(bin)
        .arg("plugin")
        .arg("list")
        .arg("--json")
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return 0,
    };
    if !output.status.success() {
        return 0;
    }
    let text = match String::from_utf8(output.stdout) {
        Ok(t) => t,
        Err(_) => return 0,
    };
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    if let Some(arr) = json.as_array() {
        return arr.len();
    }
    if let Some(data) = json.get("data") {
        if let Some(arr) = data.as_array() {
            return arr.len();
        }
        if let Some(arr) = data.get("plugins").and_then(|v| v.as_array()) {
            return arr.len();
        }
        if let Some(arr) = data.get("items").and_then(|v| v.as_array()) {
            return arr.len();
        }
    }
    for key in ["plugins", "items"] {
        if let Some(arr) = json.get(key).and_then(|v| v.as_array()) {
            return arr.len();
        }
    }
    0
}

async fn detect_running_pid(bin: &PathBuf, project_root: Option<&str>) -> (bool, Option<u32>) {
    let mut cmd = Command::new(bin);
    cmd.arg("daemon").arg("status").arg("--json");
    if let Some(root) = project_root {
        cmd.arg("--project-root").arg(root);
    }
    if let Ok(output) = cmd.output().await {
        if output.status.success() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let data = json.get("data");
                    if let Some(s) = data.and_then(|d| d.as_str()) {
                        if s.eq_ignore_ascii_case("stopped") {
                            return (false, None);
                        }
                        if s.eq_ignore_ascii_case("running") {
                            let (_, pid) = pgrep_animus_daemon(project_root).await;
                            return (true, pid);
                        }
                    }
                    let running = json
                        .get("running")
                        .and_then(|v| v.as_bool())
                        .or_else(|| data.and_then(|d| d.get("running")).and_then(|v| v.as_bool()))
                        .unwrap_or(false);
                    let pid = json
                        .get("pid")
                        .and_then(|v| v.as_u64())
                        .or_else(|| data.and_then(|d| d.get("pid")).and_then(|v| v.as_u64()))
                        .map(|v| v as u32);
                    if running || pid.is_some() {
                        return (running || pid.is_some(), pid);
                    }
                }
            }
        }
    }
    pgrep_animus_daemon(project_root).await
}

async fn pgrep_animus_daemon(project_root: Option<&str>) -> (bool, Option<u32>) {
    // List full cmdlines and filter in Rust instead of handing pgrep a regex:
    // the old `animus daemon.*<root>` pattern (a) matched our own event
    // bridge's `animus daemon stream …` children — reporting a stopped daemon
    // as "running" with a bogus PID — and (b) broke entirely when the root
    // path contained regex metacharacters (`+`, `(`, `[`).
    let output = match Command::new("pgrep").arg("-fl").arg("animus").output().await {
        Ok(o) => o,
        Err(_) => return (false, None),
    };
    if !output.status.success() {
        return (false, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let Some((pid_str, cmdline)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        // A real daemon process runs `animus … daemon run|start …`; the
        // bridge's stream children run `animus daemon stream …`.
        let is_daemon_proc = (cmdline.contains("daemon run") || cmdline.contains("daemon start"))
            && !cmdline.contains("daemon stream");
        if !is_daemon_proc {
            continue;
        }
        if let Some(root) = project_root {
            if !cmdline.contains(root) {
                continue;
            }
        }
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            return (true, Some(pid));
        }
    }
    (false, None)
}

async fn current_status_for(project_root: Option<&str>) -> DaemonStatus {
    let bin_path = match resolve_animus_binary().await {
        Some(b) => b,
        None => {
            return DaemonStatus {
                installed: false,
                running: false,
                version: None,
                pid: None,
                plugins_installed: 0,
                binary_path: None,
            }
        }
    };
    let version = animus_version(&bin_path).await;
    let (running, pid) = detect_running_pid(&bin_path, project_root).await;
    let plugins_installed = count_plugins(&bin_path).await;
    DaemonStatus {
        installed: true,
        running,
        version,
        pid,
        plugins_installed,
        binary_path: Some(bin_path.to_string_lossy().to_string()),
    }
}

fn emit_progress(app: &AppHandle, stage: &str, percent: Option<u8>, message: &str) {
    let payload = InstallProgress {
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    };
    let _ = app.emit("install-progress", payload);
}

#[tauri::command]
pub async fn daemon_install(app: AppHandle) -> Result<DaemonStatus, String> {
    emit_progress(
        &app,
        "downloading",
        Some(10),
        "Fetching Animus install script",
    );

    let script = reqwest::get(INSTALL_SCRIPT_URL)
        .await
        .map_err(|e| format!("failed to fetch install script: {e}"))?
        .error_for_status()
        .map_err(|e| format!("install script request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("failed to read install script body: {e}"))?;

    emit_progress(&app, "extracting", Some(40), "Running install script");

    let mut child = Command::new("bash")
        .arg("-s")
        .arg("--")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn bash: {e}"))?;

    {
        use tokio::io::AsyncWriteExt;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open bash stdin".to_string())?;
        stdin
            .write_all(script.as_bytes())
            .await
            .map_err(|e| format!("failed to pipe install script: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("failed to close install stdin: {e}"))?;
    }

    emit_progress(&app, "verifying", Some(80), "Waiting for installer to finish");

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("install script wait failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        emit_progress(&app, "error", None, &stderr);
        return Err(format!(
            "install script exited with status {}: {}",
            output.status, stderr
        ));
    }

    invalidate_animus_binary_cache();
    let status = current_status_for(None).await;
    emit_progress(&app, "done", Some(100), "Animus installed");
    Ok(status)
}

#[tauri::command]
pub async fn daemon_status(project_root: Option<String>) -> Result<DaemonStatus, String> {
    Ok(current_status_for(project_root.as_deref()).await)
}

#[tauri::command]
pub async fn daemon_start(project_root: Option<String>) -> Result<DaemonStatus, String> {
    let bin = resolve_animus_binary()
        .await
        .ok_or_else(|| "animus binary not found; run daemon_install first".to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.arg("daemon").arg("start").arg("--autonomous");
    if let Some(root) = project_root.as_deref() {
        cmd.arg("--project-root").arg(root);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run animus daemon start: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "daemon start failed ({}): {}",
            output.status,
            stderr.trim()
        ));
    }
    // Give the daemon a moment to register before pgrep checks.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    Ok(current_status_for(project_root.as_deref()).await)
}

#[tauri::command]
pub async fn daemon_stop(project_root: Option<String>) -> Result<DaemonStatus, String> {
    let bin = resolve_animus_binary()
        .await
        .ok_or_else(|| "animus binary not found".to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.arg("daemon").arg("stop");
    if let Some(root) = project_root.as_deref() {
        cmd.arg("--project-root").arg(root);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run animus daemon stop: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "daemon stop failed ({}): {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(current_status_for(project_root.as_deref()).await)
}

#[tauri::command]
pub async fn daemon_restart(project_root: Option<String>) -> Result<DaemonStatus, String> {
    let _ = daemon_stop(project_root.clone()).await;
    daemon_start(project_root).await
}
