use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;

use crate::state::{AppState, Project};
use crate::template::render_workflow_for;

#[tauri::command]
pub async fn project_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Project>, String> {
    let guard = state.projects.read().await;
    let mut out: Vec<Project> = guard.values().cloned().collect();
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(out)
}

#[tauri::command]
pub async fn project_get(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Project, String> {
    let guard = state.projects.read().await;
    guard
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("project '{id}' not found"))
}

#[tauri::command]
pub async fn project_create(
    repo_full_name: String,
    language: String,
    template: String,
    tunnel_url: String,
    webhook_id: u64,
    webhook_secret: String,
    state: tauri::State<'_, AppState>,
) -> Result<Project, String> {
    if template != "ci-cd" {
        return Err(format!(
            "template '{template}' is not supported; only 'ci-cd' is available in v1"
        ));
    }
    if repo_full_name.trim().is_empty() {
        return Err("repo_full_name must not be empty".to_string());
    }

    let project = Project {
        id: Uuid::new_v4().to_string(),
        repo_full_name,
        repo_path: String::new(),
        language,
        template,
        webhook_id: if webhook_id == 0 { None } else { Some(webhook_id) },
        webhook_secret,
        tunnel_url,
        created_at: Utc::now().to_rfc3339(),
        last_cycle: None,
    };

    {
        let mut guard = state.projects.write().await;
        guard.insert(project.id.clone(), project.clone());
    }
    state.persist().await?;
    Ok(project)
}

#[tauri::command]
pub async fn project_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut guard = state.projects.write().await;
        if guard.remove(&id).is_none() {
            return Err(format!("project '{id}' not found"));
        }
    }
    state.persist().await
}

#[tauri::command]
pub async fn project_setup_template(
    project_id: String,
    repo_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let (language, template) = {
        let guard = state.projects.read().await;
        let project = guard
            .get(&project_id)
            .ok_or_else(|| format!("project '{project_id}' not found"))?;
        (project.language.clone(), project.template.clone())
    };

    let render = render_workflow_for(&language, &template)?;

    let root = PathBuf::from(&repo_path);
    if !root.is_dir() {
        return Err(format!(
            "repo_path '{}' is not a directory",
            root.display()
        ));
    }

    let workflows_path = root.join(".animus").join("workflows.yaml");
    let script_path = root.join("scripts").join("gh-status-post.sh");

    if workflows_path.exists() {
        return Err(format!(
            "{} already exists; delete it before re-running setup",
            workflows_path.display()
        ));
    }
    if script_path.exists() {
        return Err(format!(
            "{} already exists; delete it before re-running setup",
            script_path.display()
        ));
    }

    create_parent(&workflows_path).await?;
    create_parent(&script_path).await?;

    tokio::fs::write(&workflows_path, render.workflows_yaml.as_bytes())
        .await
        .map_err(|e| {
            format!("write {}: {}", workflows_path.display(), e)
        })?;

    tokio::fs::write(&script_path, render.script.as_bytes())
        .await
        .map_err(|e| format!("write {}: {}", script_path.display(), e))?;

    set_executable(&script_path).await?;

    {
        let mut guard = state.projects.write().await;
        if let Some(p) = guard.get_mut(&project_id) {
            p.repo_path = repo_path;
        }
    }
    state.persist().await?;
    Ok(())
}

async fn create_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create dir {}: {}", parent.display(), e))?;
    }
    Ok(())
}

#[cfg(unix)]
async fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("stat {}: {}", path.display(), e))?
        .permissions();
    perms.set_mode(0o755);
    tokio::fs::set_permissions(path, perms)
        .await
        .map_err(|e| format!("chmod {}: {}", path.display(), e))
}

#[cfg(not(unix))]
async fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}
