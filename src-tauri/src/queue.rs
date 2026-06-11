use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

async fn run_animus_json(args: &[&str], project_root: Option<&str>) -> Result<Value, String> {
    let bin = crate::daemon::resolve_animus_binary().await.ok_or_else(|| "animus binary not found".to_string())?;
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
            crate::animus_cli::truncate_output(&stderr)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Value>(&text).map_err(|e| format!("parse animus output: {e}"))
}

async fn run_animus_void(args: &[&str], project_root: Option<&str>) -> Result<(), String> {
    let bin = crate::daemon::resolve_animus_binary().await.ok_or_else(|| "animus binary not found".to_string())?;
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
            crate::animus_cli::truncate_output(&stderr)
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn queue_list(project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(&["queue", "list", "--json"], project_root.as_deref()).await
}

#[tauri::command]
pub async fn queue_stats(project_root: Option<String>) -> Result<Value, String> {
    run_animus_json(&["queue", "stats", "--json"], project_root.as_deref()).await
}

#[tauri::command]
pub async fn queue_hold(task_id: String, project_root: Option<String>) -> Result<(), String> {
    run_animus_void(&["queue", "hold", &task_id], project_root.as_deref()).await
}

#[tauri::command]
pub async fn queue_release(task_id: String, project_root: Option<String>) -> Result<(), String> {
    run_animus_void(&["queue", "release", &task_id], project_root.as_deref()).await
}

#[tauri::command]
pub async fn queue_drop(task_id: String, project_root: Option<String>) -> Result<(), String> {
    run_animus_void(&["queue", "drop", &task_id], project_root.as_deref()).await
}
