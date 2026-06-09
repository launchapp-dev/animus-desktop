use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value as Yaml};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonaUpdate {
    pub style: Option<String>,
    pub instructions: Option<String>,
    #[serde(default)]
    pub traits: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlagUpdate {
    pub key: String,
    pub value: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdate {
    pub model: Option<String>,
    pub tool: Option<String>,
    pub system_prompt: Option<String>,
    pub system_prompt_file: Option<String>,
    pub description: Option<String>,
    pub role: Option<String>,
    #[serde(default)]
    pub persona: PersonaUpdate,
    pub models: Vec<String>,
    pub skills: Vec<String>,
    pub fallback_models: Vec<String>,
    pub fallback_tools: Vec<String>,
    pub extra_args: Vec<String>,
    pub codex_config_overrides: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub memory_enabled: Option<bool>,
    pub memory_write_policy: Option<String>,
    pub memory_scope: Option<String>,
    pub memory_max_context_chars: Option<u32>,
    pub communication_enabled: Option<bool>,
    pub communication_channels: Vec<String>,
    pub communication_can_message: Vec<String>,
    pub communication_max_context_chars: Option<u32>,
    pub network_access: Option<bool>,
    pub web_search: Option<bool>,
    pub reasoning_effort: Option<String>,
    pub max_attempts: Option<u32>,
    pub max_continuations: Option<u32>,
    pub timeout_secs: Option<u32>,
    pub tool_profile: Option<String>,
    pub tool_allow: Vec<String>,
    pub tool_deny: Vec<String>,
    pub capabilities: Vec<CapabilityFlagUpdate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateResult {
    pub written: bool,
    pub source_file: String,
    pub agent_id: String,
}

#[tauri::command]
pub async fn local_agent_update(
    source_file: String,
    agent_id: String,
    update: AgentUpdate,
) -> Result<AgentUpdateResult, String> {
    let path = PathBuf::from(source_file.trim());
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read {}: {}", path.display(), e))?;

    let mut doc: Yaml = serde_yaml::from_str(&content)
        .map_err(|e| format!("parse {}: {}", path.display(), e))?;

    let root = doc
        .as_mapping_mut()
        .ok_or_else(|| format!("{} is not a YAML mapping", path.display()))?;

    let agents_key = Yaml::String("agents".into());
    if !root.contains_key(&agents_key) {
        root.insert(agents_key.clone(), Yaml::Mapping(Mapping::new()));
    }
    let agents = root
        .get_mut(&agents_key)
        .and_then(|v| v.as_mapping_mut())
        .ok_or_else(|| format!("`agents:` in {} is not a mapping", path.display()))?;

    let id_key = Yaml::String(agent_id.clone());
    if !agents.contains_key(&id_key) {
        agents.insert(id_key.clone(), Yaml::Mapping(Mapping::new()));
    }
    let entry = agents
        .get_mut(&id_key)
        .and_then(|v| v.as_mapping_mut())
        .ok_or_else(|| format!("agent `{}` is not a mapping", agent_id))?;

    apply(entry, "model", update.model.map(Yaml::from));
    apply(entry, "tool", update.tool.map(Yaml::from));
    apply(entry, "system_prompt", update.system_prompt.map(Yaml::from));
    apply(
        entry,
        "system_prompt_file",
        update.system_prompt_file.map(Yaml::from),
    );
    apply(entry, "description", update.description.map(Yaml::from));
    apply(entry, "role", update.role.map(Yaml::from));
    apply_list(entry, "models", update.models);
    apply_list(entry, "skills", update.skills);
    apply_list(entry, "fallback_models", update.fallback_models);
    apply_list(entry, "fallback_tools", update.fallback_tools);
    apply_list(entry, "extra_args", update.extra_args);
    apply_list(
        entry,
        "codex_config_overrides",
        update.codex_config_overrides,
    );
    apply_list(entry, "mcp_servers", update.mcp_servers);
    apply(
        entry,
        "network_access",
        update.network_access.map(Yaml::from),
    );
    apply(entry, "web_search", update.web_search.map(Yaml::from));
    apply(
        entry,
        "reasoning_effort",
        update.reasoning_effort.map(Yaml::from),
    );
    apply(
        entry,
        "max_attempts",
        update.max_attempts.map(|n| Yaml::Number((n as u64).into())),
    );
    apply(
        entry,
        "max_continuations",
        update
            .max_continuations
            .map(|n| Yaml::Number((n as u64).into())),
    );
    apply(
        entry,
        "timeout_secs",
        update.timeout_secs.map(|n| Yaml::Number((n as u64).into())),
    );
    apply(entry, "tool_profile", update.tool_profile.map(Yaml::from));
    apply_capabilities(entry, update.capabilities);
    apply_persona(entry, update.persona);

    apply_nested(
        entry,
        "memory",
        &[
            ("enabled", update.memory_enabled.map(Yaml::from)),
            ("write_policy", update.memory_write_policy.map(Yaml::from)),
            ("scope", update.memory_scope.map(Yaml::from)),
            (
                "max_context_chars",
                update
                    .memory_max_context_chars
                    .map(|n| Yaml::Number((n as u64).into())),
            ),
        ],
    );
    apply_communication(
        entry,
        update.communication_enabled,
        update.communication_channels,
        update.communication_can_message,
        update.communication_max_context_chars,
    );
    apply_tool_policy(entry, update.tool_allow, update.tool_deny);

    let mut serialized = serde_yaml::to_string(&doc)
        .map_err(|e| format!("serialize {}: {}", path.display(), e))?;
    if !serialized.ends_with('\n') {
        serialized.push('\n');
    }
    tokio::fs::write(&path, serialized.as_bytes())
        .await
        .map_err(|e| format!("write {}: {}", path.display(), e))?;

    Ok(AgentUpdateResult {
        written: true,
        source_file: path.display().to_string(),
        agent_id,
    })
}

fn apply(entry: &mut Mapping, key: &str, value: Option<Yaml>) {
    let k = Yaml::String(key.into());
    match value {
        Some(v) => {
            entry.insert(k, v);
        }
        None => {
            entry.remove(&k);
        }
    }
}

fn apply_list(entry: &mut Mapping, key: &str, list: Vec<String>) {
    let k = Yaml::String(key.into());
    if list.is_empty() {
        entry.remove(&k);
    } else {
        entry.insert(k, Yaml::Sequence(list.into_iter().map(Yaml::from).collect()));
    }
}

fn apply_nested(entry: &mut Mapping, parent_key: &str, fields: &[(&str, Option<Yaml>)]) {
    let parent_k = Yaml::String(parent_key.into());
    let existing = entry
        .get(&parent_k)
        .and_then(|v| v.as_mapping())
        .cloned()
        .unwrap_or_default();
    let mut next = existing;
    for (sub_key, value) in fields {
        let sub_k = Yaml::String((*sub_key).into());
        match value {
            Some(v) => {
                next.insert(sub_k, v.clone());
            }
            None => {
                next.remove(&sub_k);
            }
        }
    }
    if next.is_empty() {
        entry.remove(&parent_k);
    } else {
        entry.insert(parent_k, Yaml::Mapping(next));
    }
}

fn apply_persona(entry: &mut Mapping, persona: PersonaUpdate) {
    let parent_k = Yaml::String("persona".into());
    let existing = entry
        .get(&parent_k)
        .and_then(|v| v.as_mapping())
        .cloned()
        .unwrap_or_default();
    let mut next = existing;
    let style_k = Yaml::String("style".into());
    let instr_k = Yaml::String("instructions".into());
    let traits_k = Yaml::String("traits".into());
    match persona.style {
        Some(s) => {
            next.insert(style_k, Yaml::String(s));
        }
        None => {
            next.remove(&style_k);
        }
    }
    match persona.instructions {
        Some(s) => {
            next.insert(instr_k, Yaml::String(s));
        }
        None => {
            next.remove(&instr_k);
        }
    }
    if persona.traits.is_empty() {
        next.remove(&traits_k);
    } else {
        next.insert(
            traits_k,
            Yaml::Sequence(persona.traits.into_iter().map(Yaml::from).collect()),
        );
    }
    if next.is_empty() {
        entry.remove(&parent_k);
    } else {
        entry.insert(parent_k, Yaml::Mapping(next));
    }
}

fn apply_capabilities(entry: &mut Mapping, flags: Vec<CapabilityFlagUpdate>) {
    let k = Yaml::String("capabilities".into());
    if flags.is_empty() {
        entry.remove(&k);
        return;
    }
    let mut m = Mapping::new();
    for f in flags {
        m.insert(Yaml::String(f.key), Yaml::Bool(f.value));
    }
    entry.insert(k, Yaml::Mapping(m));
}

fn apply_communication(
    entry: &mut Mapping,
    enabled: Option<bool>,
    channels: Vec<String>,
    can_message: Vec<String>,
    max_context_chars: Option<u32>,
) {
    let parent_k = Yaml::String("communication".into());
    let existing = entry
        .get(&parent_k)
        .and_then(|v| v.as_mapping())
        .cloned()
        .unwrap_or_default();
    let mut next = existing;
    let enabled_k = Yaml::String("enabled".into());
    match enabled {
        Some(b) => {
            next.insert(enabled_k, Yaml::Bool(b));
        }
        None => {
            next.remove(&enabled_k);
        }
    }
    let channels_k = Yaml::String("channels".into());
    if channels.is_empty() {
        next.remove(&channels_k);
    } else {
        next.insert(
            channels_k,
            Yaml::Sequence(channels.into_iter().map(Yaml::from).collect()),
        );
    }
    let can_message_k = Yaml::String("can_message".into());
    if can_message.is_empty() {
        next.remove(&can_message_k);
    } else {
        next.insert(
            can_message_k,
            Yaml::Sequence(can_message.into_iter().map(Yaml::from).collect()),
        );
    }
    let max_k = Yaml::String("max_context_chars".into());
    match max_context_chars {
        Some(n) => {
            next.insert(max_k, Yaml::Number((n as u64).into()));
        }
        None => {
            next.remove(&max_k);
        }
    }
    if next.is_empty() {
        entry.remove(&parent_k);
    } else {
        entry.insert(parent_k, Yaml::Mapping(next));
    }
}

fn apply_tool_policy(entry: &mut Mapping, allow: Vec<String>, deny: Vec<String>) {
    let parent_k = Yaml::String("tool_policy".into());
    let existing = entry
        .get(&parent_k)
        .and_then(|v| v.as_mapping())
        .cloned()
        .unwrap_or_default();
    let mut next = existing;
    let allow_k = Yaml::String("allow".into());
    let deny_k = Yaml::String("deny".into());
    if allow.is_empty() {
        next.remove(&allow_k);
    } else {
        next.insert(
            allow_k,
            Yaml::Sequence(allow.into_iter().map(Yaml::from).collect()),
        );
    }
    if deny.is_empty() {
        next.remove(&deny_k);
    } else {
        next.insert(
            deny_k,
            Yaml::Sequence(deny.into_iter().map(Yaml::from).collect()),
        );
    }
    if next.is_empty() {
        entry.remove(&parent_k);
    } else {
        entry.insert(parent_k, Yaml::Mapping(next));
    }
}
