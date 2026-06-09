use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

// Hard caps to prevent runaway allocation if a child process hangs or
// emits unbounded output. With cmd.output() the parent buffers ALL stdout
// into a Vec<u8> until the child exits — without these bounds a stuck or
// pathological subprocess can balloon RAM into double-digit GBs.
const ANIMUS_CALL_TIMEOUT: Duration = Duration::from_secs(60);
const ANIMUS_STDOUT_MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimusCliResult {
    pub ok: bool,
    pub data: Option<Value>,
    pub error: Option<Value>,
    pub raw_stderr: String,
}

fn animus_binary() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        let local = home.join(".local").join("bin").join("animus");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("animus")
}

async fn run_animus_json(path: &str, args: &[&str]) -> Result<AnimusCliResult, String> {
    let bin = animus_binary();
    let project_root = path.trim().to_string();
    if project_root.is_empty() {
        return Err("project_root is required".to_string());
    }

    let mut cmd = Command::new(&bin);
    cmd.arg("--project-root").arg(&project_root);
    for a in args {
        cmd.arg(a);
    }
    cmd.arg("--json");

    let output = match timeout(ANIMUS_CALL_TIMEOUT, cmd.output()).await {
        Ok(res) => res
            .map_err(|e| format!("spawn animus failed: {}: {}", bin.display(), e))?,
        Err(_) => {
            return Err(format!(
                "animus subprocess timed out after {}s ({} {:?})",
                ANIMUS_CALL_TIMEOUT.as_secs(),
                bin.display(),
                args
            ));
        }
    };

    if output.stdout.len() > ANIMUS_STDOUT_MAX_BYTES {
        return Err(format!(
            "animus subprocess returned {} bytes of stdout (cap {} bytes); refusing to deserialize",
            output.stdout.len(),
            ANIMUS_STDOUT_MAX_BYTES
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.trim().is_empty() {
        return Err(format!(
            "animus returned no stdout (status={:?}, stderr={})",
            output.status.code(),
            stderr.trim()
        ));
    }

    let envelope: Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        format!(
            "animus output is not JSON: {} (raw='{}', stderr='{}')",
            e,
            stdout.trim(),
            stderr.trim()
        )
    })?;

    let ok = envelope
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let data = envelope.get("data").cloned();
    let error = envelope.get("error").cloned();
    Ok(AnimusCliResult {
        ok,
        data,
        error,
        raw_stderr: stderr.trim().to_string(),
    })
}

#[tauri::command]
pub async fn animus_workflow_config(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["workflow", "config", "get"]).await
}

#[tauri::command]
pub async fn animus_workflow_list(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["workflow", "list"]).await
}

#[tauri::command]
pub async fn animus_status_get(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["status"]).await
}

#[tauri::command]
pub async fn animus_queue_list(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["queue", "list"]).await
}

#[tauri::command]
pub async fn animus_workflow_run(
    path: String,
    workflow_id: String,
) -> Result<AnimusCliResult, String> {
    run_animus_json(
        &path,
        &["workflow", "run", "--workflow-id", workflow_id.as_str()],
    )
    .await
}

#[tauri::command]
pub async fn animus_secret_list(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["secret", "list"]).await
}

#[tauri::command]
pub async fn animus_secret_set(
    path: String,
    key: String,
    value: String,
) -> Result<AnimusCliResult, String> {
    // `--value` exposes the secret on the argv of the spawned process for the
    // brief lifetime of the call. The CLI's pipe-from-stdin path would be more
    // secure but std::process::Command doesn't make piping ergonomic from a
    // Tauri command. ps(1) on macOS shows argv to the calling user only, so
    // the worst-case leak is bounded to processes you already control.
    run_animus_json(
        &path,
        &["secret", "set", key.as_str(), "--value", value.as_str()],
    )
    .await
}

#[tauri::command]
pub async fn animus_secret_get(
    path: String,
    key: String,
) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["secret", "get", key.as_str()]).await
}

#[tauri::command]
pub async fn animus_secret_rm(
    path: String,
    key: String,
) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["secret", "rm", key.as_str()]).await
}

#[tauri::command]
pub async fn animus_secret_import_env(
    path: String,
    file: Option<String>,
    overwrite: bool,
) -> Result<AnimusCliResult, String> {
    let mut args: Vec<&str> = vec!["secret", "import-env"];
    if let Some(f) = file.as_deref() {
        args.push("--file");
        args.push(f);
    }
    if overwrite {
        args.push("--overwrite");
    }
    run_animus_json(&path, &args).await
}

#[tauri::command]
pub async fn animus_secret_export_env(
    path: String,
    file: Option<String>,
) -> Result<AnimusCliResult, String> {
    let mut args: Vec<&str> = vec!["secret", "export-env"];
    if let Some(f) = file.as_deref() {
        args.push("--file");
        args.push(f);
    }
    run_animus_json(&path, &args).await
}
