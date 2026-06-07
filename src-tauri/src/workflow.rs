use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct WorkflowRunResult {
    pub ok: bool,
    pub message: String,
    pub run_id: Option<String>,
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

async fn run_animus(args: &[&str], project_root: Option<&str>) -> Result<Value, String> {
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

fn extract_run_id(value: &Value) -> Option<String> {
    let data = value.get("data")?;
    for key in &["run_id", "id", "workflow_run_id"] {
        if let Some(s) = data.get(key).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn workflow_run_task(
    task_id: String,
    project_root: Option<String>,
) -> Result<WorkflowRunResult, String> {
    let value = run_animus(
        &["workflow", "run", "--task-id", &task_id, "--json"],
        project_root.as_deref(),
    )
    .await?;
    Ok(WorkflowRunResult {
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
        message: format!("workflow run --task-id {task_id} dispatched"),
        run_id: extract_run_id(&value),
    })
}

#[tauri::command]
pub async fn workflow_run_id(
    workflow_id: String,
    project_root: Option<String>,
) -> Result<WorkflowRunResult, String> {
    let value = run_animus(
        &["workflow", "run", "--workflow", &workflow_id, "--json"],
        project_root.as_deref(),
    )
    .await?;
    Ok(WorkflowRunResult {
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
        message: format!("workflow run --workflow {workflow_id} dispatched"),
        run_id: extract_run_id(&value),
    })
}

#[tauri::command]
pub async fn workflow_list(project_root: Option<String>) -> Result<Value, String> {
    run_animus(&["workflow", "list", "--json"], project_root.as_deref()).await
}
