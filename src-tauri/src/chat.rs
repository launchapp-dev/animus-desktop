use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../../src/types/generated/"))]
pub struct ChatContext {
    pub project_id: Option<String>,
    pub cycle_id: Option<String>,
}

#[tauri::command]
pub async fn chat_send(
    user_message: String,
    context: Option<ChatContext>,
) -> Result<ChatMessage, String> {
    let project_hint = context
        .as_ref()
        .and_then(|c| c.project_id.as_ref())
        .map(|id| format!(" (project: {id})"))
        .unwrap_or_default();

    let body = format!(
        "Chat backend stub — provider plugin wire-up is the next \
         commit.{project_hint}\n\nYou said: \"{user_message}\"\n\n\
         Once wired, this agent will have read-only access to projects, \
         cycles, daemon status, and plugin list via the existing Tauri \
         commands, and will be able to suggest actions (open project, \
         restart daemon, view logs) the user can confirm.",
    );

    Ok(ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "assistant".to_string(),
        content: body,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
