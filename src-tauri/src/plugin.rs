use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::daemon::InstallProgress;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct Plugin {
    pub name: String,
    pub kind: String,
    pub version: String,
    pub repo: String,
    pub installed: bool,
}

fn emit_progress(app: &AppHandle, stage: &str, percent: Option<u8>, message: &str) {
    let payload = InstallProgress {
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    };
    let _ = app.emit("install-progress", payload);
}

fn parse_plugin(value: &serde_json::Value) -> Option<Plugin> {
    let obj = value.as_object()?;
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("id").and_then(|v| v.as_str()))?
        .to_string();
    let kind = obj
        .get("plugin_kind")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("kind").and_then(|v| v.as_str()))
        .or_else(|| obj.get("role").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let version = obj
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let repo = obj
        .get("repo")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("source").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let installed = obj
        .get("installed")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    Some(Plugin {
        name,
        kind,
        version,
        repo,
        installed,
    })
}

fn extract_plugins_array(json: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(arr) = json.as_array() {
        return arr.clone();
    }
    if let Some(data) = json.get("data") {
        if let Some(arr) = data.as_array() {
            return arr.clone();
        }
        if let Some(arr) = data.get("plugins").and_then(|v| v.as_array()) {
            return arr.clone();
        }
        if let Some(arr) = data.get("items").and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    for key in ["plugins", "items"] {
        if let Some(arr) = json.get(key).and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    Vec::new()
}

#[tauri::command]
pub async fn plugin_list() -> Result<Vec<Plugin>, String> {
    let bin = crate::daemon::resolve_animus_binary().await.ok_or_else(|| "animus binary not found".to_string())?;
    let output = Command::new(&bin)
        .arg("plugin")
        .arg("list")
        .arg("--json")
        .output()
        .await
        .map_err(|e| format!("failed to run animus plugin list: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "plugin list failed ({}): {}",
            output.status, stderr
        ));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|e| format!("plugin list returned non-utf8 output: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("plugin list JSON parse error: {e}"))?;
    let arr = extract_plugins_array(&json);
    let plugins: Vec<Plugin> = arr.iter().filter_map(parse_plugin).collect();
    eprintln!(
        "[plugin] plugin_list -> {} entries (raw array len {})",
        plugins.len(),
        arr.len()
    );
    Ok(plugins)
}

#[tauri::command]
pub async fn plugin_install(app: AppHandle, name: String) -> Result<(), String> {
    let bin = crate::daemon::resolve_animus_binary().await.ok_or_else(|| "animus binary not found".to_string())?;
    emit_progress(&app, "downloading", Some(10), &format!("Installing {name}"));
    let output = Command::new(&bin)
        .arg("plugin")
        .arg("install")
        .arg(&name)
        .output()
        .await
        .map_err(|e| format!("failed to run animus plugin install: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        emit_progress(&app, "error", None, &stderr);
        return Err(format!(
            "plugin install failed ({}): {}",
            output.status, stderr
        ));
    }
    emit_progress(&app, "done", Some(100), &format!("Installed {name}"));
    Ok(())
}

#[tauri::command]
pub async fn plugin_install_defaults(app: AppHandle) -> Result<(), String> {
    let bin = crate::daemon::resolve_animus_binary().await.ok_or_else(|| "animus binary not found".to_string())?;
    emit_progress(
        &app,
        "downloading",
        Some(10),
        "Installing recommended plugin set",
    );
    let output = Command::new(&bin)
        .arg("plugin")
        .arg("install-defaults")
        .arg("--include-subjects")
        .arg("--include-transports")
        .output()
        .await
        .map_err(|e| format!("failed to run animus plugin install-defaults: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        emit_progress(&app, "error", None, &stderr);
        return Err(format!(
            "plugin install-defaults failed ({}): {}",
            output.status, stderr
        ));
    }
    emit_progress(&app, "done", Some(100), "Recommended plugins installed");
    Ok(())
}
