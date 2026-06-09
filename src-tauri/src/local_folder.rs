use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFolderInspection {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub is_git_repo: bool,
    pub has_remote: bool,
    pub default_branch: Option<String>,
    pub detected_language: Option<String>,
    pub animus_dir_exists: bool,
    pub is_animus_project: bool,
    pub animus_workflow_names: Vec<String>,
}

#[tauri::command]
pub async fn local_folder_inspect(path: String) -> Result<LocalFolderInspection, String> {
    let raw = path.trim().to_string();
    let p = PathBuf::from(&raw);
    let exists = p.exists();
    let is_dir = exists && p.is_dir();

    let mut out = LocalFolderInspection {
        path: raw.clone(),
        exists,
        is_dir,
        is_git_repo: false,
        has_remote: false,
        default_branch: None,
        detected_language: None,
        animus_dir_exists: false,
        is_animus_project: false,
        animus_workflow_names: Vec::new(),
    };

    if !is_dir {
        return Ok(out);
    }

    out.is_git_repo = is_git_repo(&p).await;
    if out.is_git_repo {
        out.has_remote = git_has_remote(&p).await;
        out.default_branch = git_default_branch(&p).await;
    }
    out.detected_language = detect_language(&p).await;

    let animus_dir = p.join(".animus");
    out.animus_dir_exists = animus_dir.is_dir();
    if out.animus_dir_exists {
        out.animus_workflow_names = list_animus_workflows(&animus_dir).await;
        out.is_animus_project = !out.animus_workflow_names.is_empty();
    }

    Ok(out)
}

#[tauri::command]
pub async fn project_adopt_local(
    path: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<crate::state::Project, String> {
    let raw = path.trim().to_string();
    let p = PathBuf::from(&raw);
    if !p.is_dir() {
        return Err(format!("{} is not a directory", p.display()));
    }

    let animus_dir = p.join(".animus");
    tokio::fs::create_dir_all(&animus_dir)
        .await
        .map_err(|e| format!("create .animus dir at {}: {}", animus_dir.display(), e))?;

    let basename = p
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "project".to_string());
    let label = format!("local/{basename}");

    let language = detect_language(&p).await.unwrap_or_else(|| "generic".to_string());

    let project = crate::state::Project {
        id: uuid::Uuid::new_v4().to_string(),
        repo_full_name: label,
        repo_path: raw,
        language,
        template: "adopted".to_string(),
        webhook_id: None,
        webhook_secret: String::new(),
        tunnel_url: String::new(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_cycle: None,
    };

    {
        let mut guard = state.projects.write().await;
        guard.insert(project.id.clone(), project.clone());
    }
    state.persist().await?;
    Ok(project)
}

async fn list_animus_workflows(animus_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();

    let main_file = animus_dir.join("workflows.yaml");
    if main_file.is_file() {
        if let Ok(content) = tokio::fs::read_to_string(&main_file).await {
            for line in content.lines() {
                let trimmed = line.trim_end();
                if trimmed.starts_with(' ') || trimmed.starts_with('\t') {
                    continue;
                }
                if let Some(name) = trimmed.strip_suffix(':') {
                    let n = name.trim().trim_matches('"').trim_matches('\'');
                    if !n.is_empty()
                        && !n.starts_with('#')
                        && n != "schedules"
                        && n != "triggers"
                        && n != "daemon"
                    {
                        names.push(n.to_string());
                    }
                }
            }
        }
    }

    let workflows_dir = animus_dir.join("workflows");
    if workflows_dir.is_dir() {
        if let Ok(mut rd) = tokio::fs::read_dir(&workflows_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                let path = entry.path();
                if path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.eq_ignore_ascii_case("yaml") || s.eq_ignore_ascii_case("yml"))
                    .unwrap_or(false)
                {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        names.push(stem.to_string());
                    }
                }
            }
        }
    }

    names.sort();
    names.dedup();
    names
}

#[tauri::command]
pub async fn local_folder_git_init(path: String) -> Result<LocalFolderInspection, String> {
    let raw = path.trim().to_string();
    let p = PathBuf::from(&raw);
    if !p.exists() {
        tokio::fs::create_dir_all(&p)
            .await
            .map_err(|e| format!("create dir {}: {}", p.display(), e))?;
    }
    if !p.is_dir() {
        return Err(format!("{} is not a directory", p.display()));
    }
    let status = Command::new("git")
        .arg("init")
        .arg(&p)
        .status()
        .await
        .map_err(|e| format!("git init failed to spawn: {}", e))?;
    if !status.success() {
        return Err(format!("git init exited with {}", status));
    }
    local_folder_inspect(raw).await
}

async fn is_git_repo(p: &Path) -> bool {
    if p.join(".git").exists() {
        return true;
    }
    // Honour worktrees / nested repos by deferring to git itself.
    let Ok(out) = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(p)
        .output()
        .await
    else {
        return false;
    };
    out.status.success()
        && String::from_utf8_lossy(&out.stdout)
            .trim()
            .eq_ignore_ascii_case("true")
}

async fn git_has_remote(p: &Path) -> bool {
    let Ok(out) = Command::new("git")
        .args(["remote"])
        .current_dir(p)
        .output()
        .await
    else {
        return false;
    };
    out.status.success() && !out.stdout.is_empty()
}

async fn git_default_branch(p: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .current_dir(p)
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

async fn detect_language(p: &Path) -> Option<String> {
    let candidates: &[(&str, &str)] = &[
        ("Cargo.toml", "rust"),
        ("package.json", "typescript"),
        ("tsconfig.json", "typescript"),
        ("pnpm-lock.yaml", "typescript"),
        ("yarn.lock", "typescript"),
        ("go.mod", "go"),
        ("pyproject.toml", "python"),
        ("requirements.txt", "python"),
        ("Pipfile", "python"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
        ("mix.exs", "elixir"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("build.gradle.kts", "kotlin"),
    ];
    for (file, lang) in candidates {
        if p.join(file).exists() {
            return Some((*lang).to_string());
        }
    }
    None
}

// ======================================================================
// File / folder viewer — worktree-aware browsing
// ======================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRoot {
    /// Display label, e.g. "task-42".
    pub id: String,
    pub path: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub text: Option<String>,
    pub is_binary: bool,
    pub truncated: bool,
    pub size: u64,
}

const FILE_READ_CAP: u64 = 1_048_576; // 1 MiB

/// Replicates Animus's `repository_scope_for_path`: a sanitized basename plus a
/// 12-hex prefix of the SHA-256 of the canonical path. Worktrees for a project
/// live under `~/.animus/<scope>/worktrees/`.
fn repository_scope_for_path(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let canonical_display = canonical.to_string_lossy();
    let repo_name = canonical
        .file_name()
        .and_then(|v| v.to_str())
        .map(|s| sanitize_identifier(s, "repo"))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "repo".to_string());
    let digest = Sha256::digest(canonical_display.as_bytes());
    let suffix = format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        digest[0], digest[1], digest[2], digest[3], digest[4], digest[5]
    );
    format!("{repo_name}-{suffix}")
}

fn sanitize_identifier(value: &str, fallback: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut trailing = false;
    for ch in value.chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => {
                out.push(ch.to_ascii_lowercase());
                trailing = false;
            }
            ' ' | '_' | '-' if !out.is_empty() && !trailing => {
                out.push('-');
                trailing = true;
            }
            _ => {}
        }
    }
    if trailing {
        out.pop();
    }
    if out.is_empty() {
        fallback.to_string()
    } else {
        out
    }
}

/// List the Animus task worktrees for a project (under
/// `~/.animus/<scope>/worktrees/`). Returns an empty list when none exist.
#[tauri::command]
pub async fn local_worktrees_list(project_root: String) -> Result<Vec<WorktreeRoot>, String> {
    let root = PathBuf::from(project_root.trim());
    let home = dirs::home_dir().ok_or("no home directory")?;
    let scope = repository_scope_for_path(&root);
    let worktrees_dir = home.join(".animus").join(scope).join("worktrees");
    if !worktrees_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<PathBuf> = Vec::new();
    let mut rd = tokio::fs::read_dir(&worktrees_dir)
        .await
        .map_err(|e| format!("read worktrees dir: {}", e))?;
    while let Ok(Some(e)) = rd.next_entry().await {
        let p = e.path();
        if p.is_dir() {
            entries.push(p);
        }
    }
    entries.sort();

    let mut out = Vec::new();
    for p in entries {
        let id = p
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("worktree")
            .to_string();
        let branch = git_current_branch(&p).await;
        out.push(WorktreeRoot {
            id,
            path: p.display().to_string(),
            branch,
        });
    }
    Ok(out)
}

async fn git_current_branch(p: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", &p.display().to_string(), "branch", "--show-current"])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Resolve `base` + `rel`, guaranteeing the result stays inside `base` (after
/// canonicalization) so a crafted `rel` can't escape the chosen root.
fn confine(base: &str, rel: &str) -> Result<PathBuf, String> {
    let base_path = PathBuf::from(base.trim());
    let canon_base = base_path
        .canonicalize()
        .map_err(|e| format!("resolve base: {}", e))?;
    let joined = canon_base.join(rel.trim_start_matches(['/', '\\']));
    let canon = joined
        .canonicalize()
        .map_err(|e| format!("resolve path: {}", e))?;
    if !canon.starts_with(&canon_base) {
        return Err("path escapes the selected root".into());
    }
    Ok(canon)
}

/// List one directory level under `base`/`rel`. Folders first, then files,
/// each sorted case-insensitively.
#[tauri::command]
pub async fn local_dir_list(base: String, rel: String) -> Result<Vec<DirEntryInfo>, String> {
    let dir = confine(&base, &rel)?;
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", dir.display()));
    }
    let base_canon = PathBuf::from(base.trim())
        .canonicalize()
        .map_err(|e| format!("resolve base: {}", e))?;

    let mut rd = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| format!("read dir: {}", e))?;
    let mut out: Vec<DirEntryInfo> = Vec::new();
    while let Ok(Some(e)) = rd.next_entry().await {
        let path = e.path();
        let meta = match tokio::fs::symlink_metadata(&path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_symlink = meta.file_type().is_symlink();
        // Resolve symlinks for the is_dir flag so links to folders navigate.
        let is_dir = if is_symlink {
            tokio::fs::metadata(&path).await.map(|m| m.is_dir()).unwrap_or(false)
        } else {
            meta.is_dir()
        };
        let name = e.file_name().to_string_lossy().to_string();
        let rel = path
            .strip_prefix(&base_canon)
            .map(|r| r.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());
        out.push(DirEntryInfo {
            name,
            rel,
            is_dir,
            is_symlink,
            size: if is_dir { 0 } else { meta.len() },
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Read a file under `base`/`rel` as UTF-8 text, capped at 1 MiB. Binary files
/// (NUL byte or invalid UTF-8) come back with `isBinary: true` and no text.
#[tauri::command]
pub async fn local_file_read(base: String, rel: String) -> Result<FileContent, String> {
    let path = confine(&base, &rel)?;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("stat: {}", e))?;
    if meta.is_dir() {
        return Err("path is a directory".into());
    }
    let size = meta.len();
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read: {}", e))?;
    let truncated = size > FILE_READ_CAP;
    let slice = if truncated {
        &bytes[..FILE_READ_CAP as usize]
    } else {
        &bytes[..]
    };
    if slice.contains(&0) {
        return Ok(FileContent {
            text: None,
            is_binary: true,
            truncated,
            size,
        });
    }
    match std::str::from_utf8(slice) {
        Ok(s) => Ok(FileContent {
            text: Some(s.to_string()),
            is_binary: false,
            truncated,
            size,
        }),
        Err(_) => Ok(FileContent {
            text: None,
            is_binary: true,
            truncated,
            size,
        }),
    }
}
