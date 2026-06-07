use std::path::PathBuf;
use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

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

async fn run_animus_json(args: &[&str], project_root: Option<&str>) -> Result<Value, String> {
    let bin = animus_binary_path().ok_or_else(|| "animus binary not found".to_string())?;
    let mut cmd = Command::new(&bin);
    for arg in args {
        cmd.arg(arg);
    }
    if let Some(root) = project_root {
        cmd.arg("--project-root").arg(root);
    }
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("spawn animus: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "animus {} failed: {}",
            args.join(" "),
            stderr.trim()
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Value>(&text).map_err(|e| format!("parse animus output: {e}"))
}

#[tauri::command]
pub async fn subject_list(kind: String, project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(
        &["subject", "list", "--kind", &kind, "--json"],
        project_root.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn subject_get(
    kind: String,
    id: String,
    project_root: Option<String>,
) -> Result<Value, String> {
    run_animus_json(
        &[
            "subject", "get", "--kind", &kind, "--id", &id, "--json",
        ],
        project_root.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn subject_next(kind: String, project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(
        &["subject", "next", "--kind", &kind, "--json"],
        project_root.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn animus_status(project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(&["status", "--json"], project_root.as_deref()).await
}

#[tauri::command]
pub async fn animus_history(
    limit: Option<u32>,
    project_root: Option<String>,
) -> Result<Value, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    run_animus_json(
        &["history", "--limit", &limit_str, "--json"],
        project_root.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn logs_tail(
    limit: Option<u32>,
    project_root: Option<String>,
) -> Result<Value, String> {
    let limit_str = limit.unwrap_or(100).to_string();
    run_animus_json(
        &["logs", "tail", "--limit", &limit_str, "--json"],
        project_root.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn daemon_health(project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(&["daemon", "health", "--json"], project_root.as_deref()).await
}
