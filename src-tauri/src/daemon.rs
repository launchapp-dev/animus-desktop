use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

const INSTALL_SCRIPT_URL: &str =
    "https://raw.githubusercontent.com/launchapp-dev/animus-cli/main/scripts/install.sh";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    pub pid: Option<u32>,
    pub plugins_installed: usize,
    pub binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub stage: String,
    pub percent: Option<u8>,
    pub message: String,
}

fn animus_binary_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let candidate = PathBuf::from(home).join(".local/bin/animus");
    if candidate.exists() {
        Some(candidate)
    } else {
        which_animus()
    }
}

fn which_animus() -> Option<PathBuf> {
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

async fn detect_running_pid(bin: &PathBuf) -> (bool, Option<u32>) {
    if let Ok(output) = Command::new(bin)
        .arg("daemon")
        .arg("status")
        .arg("--json")
        .output()
        .await
    {
        if output.status.success() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let data = json.get("data");
                    if let Some(s) = data.and_then(|d| d.as_str()) {
                        if s.eq_ignore_ascii_case("stopped") {
                            return (false, None);
                        }
                        if s.eq_ignore_ascii_case("running") {
                            let (_, pid) = pgrep_animus_daemon().await;
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
    pgrep_animus_daemon().await
}

async fn pgrep_animus_daemon() -> (bool, Option<u32>) {
    let output = match Command::new("pgrep")
        .arg("-f")
        .arg("animus daemon")
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return (false, None),
    };
    if !output.status.success() {
        return (false, None);
    }
    let text = match String::from_utf8(output.stdout) {
        Ok(t) => t,
        Err(_) => return (false, None),
    };
    let pid = text
        .lines()
        .next()
        .and_then(|line| line.trim().parse::<u32>().ok());
    (pid.is_some(), pid)
}

async fn current_status() -> DaemonStatus {
    let bin = animus_binary_path();
    let installed = bin.is_some();
    if !installed {
        return DaemonStatus {
            installed: false,
            running: false,
            version: None,
            pid: None,
            plugins_installed: 0,
            binary_path: None,
        };
    }
    let bin_path = match bin {
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
    let (running, pid) = detect_running_pid(&bin_path).await;
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

    let status = current_status().await;
    emit_progress(&app, "done", Some(100), "Animus installed");
    Ok(status)
}

#[tauri::command]
pub async fn daemon_status() -> Result<DaemonStatus, String> {
    Ok(current_status().await)
}

#[tauri::command]
pub async fn daemon_start() -> Result<DaemonStatus, String> {
    let bin = animus_binary_path()
        .ok_or_else(|| "animus binary not found; run daemon_install first".to_string())?;
    let output = Command::new(&bin)
        .arg("daemon")
        .arg("start")
        .arg("--autonomous")
        .output()
        .await
        .map_err(|e| format!("failed to run animus daemon start: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "daemon start failed ({}): {}",
            output.status, stderr
        ));
    }
    Ok(current_status().await)
}

#[tauri::command]
pub async fn daemon_stop() -> Result<DaemonStatus, String> {
    let bin = animus_binary_path()
        .ok_or_else(|| "animus binary not found".to_string())?;
    let output = Command::new(&bin)
        .arg("daemon")
        .arg("stop")
        .output()
        .await
        .map_err(|e| format!("failed to run animus daemon stop: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "daemon stop failed ({}): {}",
            output.status, stderr
        ));
    }
    Ok(current_status().await)
}

#[tauri::command]
pub async fn daemon_restart() -> Result<DaemonStatus, String> {
    let _ = daemon_stop().await;
    daemon_start().await
}
