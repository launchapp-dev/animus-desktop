use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct Project {
    pub id: String,
    pub repo_full_name: String,
    #[serde(default)]
    pub repo_path: String,
    pub language: String,
    pub template: String,
    #[serde(default)]
    pub webhook_id: Option<u64>,
    pub webhook_secret: String,
    pub tunnel_url: String,
    pub created_at: String,
    #[serde(default)]
    pub last_cycle: Option<Cycle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct Cycle {
    pub id: String,
    pub project_id: String,
    pub status: CycleStatus,
    pub started_at: String,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub phases: Vec<Phase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/", rename_all = "lowercase"))]
pub enum CycleStatus {
    Running,
    Passed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct Phase {
    pub name: String,
    pub status: PhaseStatus,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/", rename_all = "lowercase"))]
pub enum PhaseStatus {
    Pending,
    Running,
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedState {
    #[serde(default)]
    projects: HashMap<String, Project>,
}

pub struct AppState {
    pub projects: RwLock<HashMap<String, Project>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub async fn new() -> Result<Self, String> {
        let data_dir = resolve_data_dir()?;
        if let Err(e) = tokio::fs::create_dir_all(&data_dir).await {
            return Err(format!("failed to create data dir: {e}"));
        }

        let projects = load_projects(&data_dir).await?;
        Ok(Self {
            projects: RwLock::new(projects),
            data_dir,
        })
    }

    pub fn projects_file(&self) -> PathBuf {
        self.data_dir.join("projects.json")
    }

    pub async fn persist(&self) -> Result<(), String> {
        let snapshot = {
            let guard = self.projects.read().await;
            PersistedState {
                projects: guard.clone(),
            }
        };

        let path = self.projects_file();
        let tmp_path = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&snapshot)
            .map_err(|e| format!("serialize projects: {e}"))?;

        tokio::fs::write(&tmp_path, &bytes)
            .await
            .map_err(|e| format!("write projects tmp: {e}"))?;
        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| format!("rename projects file: {e}"))?;
        Ok(())
    }
}

fn resolve_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or_else(|| "could not resolve platform data directory".to_string())?;
    Ok(base.join("dev.animus.desktop"))
}

async fn load_projects(data_dir: &PathBuf) -> Result<HashMap<String, Project>, String> {
    let path = data_dir.join("projects.json");
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            if bytes.is_empty() {
                return Ok(HashMap::new());
            }
            let parsed: PersistedState = serde_json::from_slice(&bytes)
                .map_err(|e| format!("parse projects.json: {e}"))?;
            Ok(parsed.projects)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("read projects.json: {e}")),
    }
}
