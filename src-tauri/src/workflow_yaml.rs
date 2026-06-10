use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value as Yaml};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowYamlReport {
    pub project_root: String,
    pub files: Vec<WorkflowFileReport>,
    pub workflows: Vec<WorkflowSummary>,
    pub phases: Vec<PhaseSummary>,
    pub agents: Vec<AgentSummary>,
    pub schedules: Vec<ScheduleSummary>,
    pub triggers: Vec<TriggerSummary>,
    pub mcp_servers: Vec<McpServerSummary>,
    pub default_workflow_ref: Option<String>,
    pub tools_allowlist: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFileReport {
    pub path: String,
    pub kind: FileKind,
    pub ok: bool,
    pub error: Option<String>,
    /// What this file contributes, so the Files tab reads as a map of the config.
    pub counts: FileCounts,
}

#[derive(Debug, Clone, Copy, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileCounts {
    pub workflows: u32,
    pub phases: u32,
    pub agents: u32,
    pub schedules: u32,
    pub triggers: u32,
    pub mcp_servers: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileKind {
    Root,
    Workflow,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub phases: Vec<PhaseRef>,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseRef {
    pub kind: PhaseRefKind,
    pub value: String,
    /// Inline rework loop config (from `on_verdict.rework.target`) — the
    /// feedback edges that make a pipeline a graph rather than a list.
    pub max_rework_attempts: Option<u32>,
    pub rework_target: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhaseRefKind {
    Phase,
    WorkflowRef,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseSummary {
    pub id: String,
    pub mode: Option<String>,
    pub agent: Option<String>,
    pub directive: Option<String>,
    pub command: Option<String>,
    pub command_args: Vec<String>,
    pub command_cwd_mode: Option<String>,
    pub command_timeout_secs: Option<u32>,
    pub command_success_exit_codes: Vec<i64>,
    pub worktree: Option<bool>,
    pub capabilities: Vec<CapabilityFlag>,
    /// Allowed verdicts from a `decision_contract` (e.g. advance/rework/fail).
    pub decision_verdicts: Vec<String>,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSummary {
    pub style: Option<String>,
    pub instructions: Option<String>,
    pub traits: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlag {
    pub key: String,
    pub value: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub id: String,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub system_prompt: Option<String>,
    pub system_prompt_file: Option<String>,
    pub description: Option<String>,
    pub role: Option<String>,
    pub persona: PersonaSummary,
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
    pub capabilities: Vec<CapabilityFlag>,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSummary {
    pub id: String,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub env_keys: Vec<String>,
    pub tools: Vec<String>,
    pub oauth: Option<OauthSummary>,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthSummary {
    pub flow: Option<String>,
    pub token_url: Option<String>,
    pub client_id_env: Option<String>,
    pub client_secret_env: Option<String>,
    pub refresh_token_env: Option<String>,
    pub bearer_env: Option<String>,
    pub scopes: Vec<String>,
    pub audience: Option<String>,
    pub cache: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSummary {
    pub id: Option<String>,
    pub workflow: Option<String>,
    pub cron: Option<String>,
    pub timezone: Option<String>,
    pub enabled: Option<bool>,
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSummary {
    pub kind: Option<String>,
    pub workflow: Option<String>,
    pub path: Option<String>,
    pub source_file: String,
}

#[tauri::command]
pub async fn local_workflows_read(path: String) -> Result<WorkflowYamlReport, String> {
    let project_root = PathBuf::from(path.trim());
    if !project_root.is_dir() {
        return Err(format!("{} is not a directory", project_root.display()));
    }

    let animus_dir = project_root.join(".animus");
    let mut report = WorkflowYamlReport {
        project_root: project_root.display().to_string(),
        files: Vec::new(),
        workflows: Vec::new(),
        phases: Vec::new(),
        agents: Vec::new(),
        schedules: Vec::new(),
        triggers: Vec::new(),
        mcp_servers: Vec::new(),
        default_workflow_ref: None,
        tools_allowlist: Vec::new(),
        errors: Vec::new(),
    };

    if !animus_dir.is_dir() {
        return Ok(report);
    }

    let root_file = animus_dir.join("workflows.yaml");
    if root_file.is_file() {
        ingest_file(&root_file, FileKind::Root, &mut report).await;
    }

    let workflows_dir = animus_dir.join("workflows");
    if workflows_dir.is_dir() {
        match tokio::fs::read_dir(&workflows_dir).await {
            Ok(mut rd) => {
                let mut files: Vec<PathBuf> = Vec::new();
                while let Ok(Some(entry)) = rd.next_entry().await {
                    let p = entry.path();
                    if p.extension()
                        .and_then(|e| e.to_str())
                        .map(|s| s.eq_ignore_ascii_case("yaml") || s.eq_ignore_ascii_case("yml"))
                        .unwrap_or(false)
                    {
                        files.push(p);
                    }
                }
                files.sort();
                for p in files {
                    ingest_file(&p, FileKind::Workflow, &mut report).await;
                }
            }
            Err(e) => report.errors.push(format!(
                "read .animus/workflows/ failed: {}",
                e
            )),
        }
    }

    // Dedup workflow ids — later files override earlier ones (workflow YAML
    // doesn't formally support this but it keeps the display sane).
    dedup_workflows(&mut report.workflows);

    Ok(report)
}

async fn ingest_file(path: &Path, kind: FileKind, report: &mut WorkflowYamlReport) {
    let source_file = path.display().to_string();
    // Snapshot section sizes so we can attribute what this file contributed.
    let before = (
        report.workflows.len(),
        report.phases.len(),
        report.agents.len(),
        report.schedules.len(),
        report.triggers.len(),
        report.mcp_servers.len(),
    );
    let content = match tokio::fs::read_to_string(path).await {
        Ok(c) => c,
        Err(e) => {
            report.files.push(WorkflowFileReport {
                path: source_file.clone(),
                kind,
                ok: false,
                error: Some(format!("read failed: {}", e)),
                counts: FileCounts::default(),
            });
            report
                .errors
                .push(format!("{}: read failed: {}", source_file, e));
            return;
        }
    };

    let parsed: Yaml = match serde_yaml::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            report.files.push(WorkflowFileReport {
                path: source_file.clone(),
                kind,
                ok: false,
                error: Some(format!("YAML parse failed: {}", e)),
                counts: FileCounts::default(),
            });
            report
                .errors
                .push(format!("{}: YAML parse failed: {}", source_file, e));
            return;
        }
    };

    let mapping = match parsed.as_mapping() {
        Some(m) => m,
        None => {
            // Empty or scalar file — record as ok with no contents.
            report.files.push(WorkflowFileReport {
                path: source_file.clone(),
                kind,
                ok: true,
                error: None,
                counts: FileCounts::default(),
            });
            return;
        }
    };

    // workflows: [{ id, name, description, phases: [...] }]
    if let Some(Yaml::Sequence(workflows)) = mapping.get(Yaml::String("workflows".into())) {
        for wf in workflows {
            if let Some(m) = wf.as_mapping() {
                let id = m
                    .get(Yaml::String("id".into()))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let name = m
                    .get(Yaml::String("name".into()))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&id)
                    .to_string();
                let description = m
                    .get(Yaml::String("description".into()))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let phases = m
                    .get(Yaml::String("phases".into()))
                    .and_then(|v| v.as_sequence())
                    .map(|seq| seq.iter().map(phase_ref_from_yaml).collect::<Vec<_>>())
                    .unwrap_or_default();
                report.workflows.push(WorkflowSummary {
                    id,
                    name,
                    description,
                    phases,
                    source_file: source_file.clone(),
                });
            }
        }
    }

    // phases: { phase_id: { mode, agent, directive, command } }
    if let Some(Yaml::Mapping(phases)) = mapping.get(Yaml::String("phases".into())) {
        for (k, v) in phases {
            if let Some(id) = k.as_str() {
                if let Some(m) = v.as_mapping() {
                    let mode = m
                        .get(Yaml::String("mode".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let agent = m
                        .get(Yaml::String("agent".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let directive = m
                        .get(Yaml::String("directive".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let command_map = m
                        .get(Yaml::String("command".into()))
                        .and_then(|cv| cv.as_mapping());
                    let command = command_map.and_then(|cm| {
                        cm.get(Yaml::String("program".into()))
                            .and_then(|p| p.as_str())
                            .map(String::from)
                    });
                    let command_args = command_map
                        .map(|cm| collect_strings(cm, "args"))
                        .unwrap_or_default();
                    let command_cwd_mode = command_map.and_then(|cm| {
                        cm.get(Yaml::String("cwd_mode".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    });
                    let command_timeout_secs = command_map.and_then(|cm| {
                        cm.get(Yaml::String("timeout_secs".into()))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32)
                    });
                    let command_success_exit_codes = command_map
                        .and_then(|cm| {
                            cm.get(Yaml::String("success_exit_codes".into()))
                                .and_then(|v| v.as_sequence())
                                .map(|seq| seq.iter().filter_map(|v| v.as_i64()).collect())
                        })
                        .unwrap_or_default();
                    let worktree = m
                        .get(Yaml::String("worktree".into()))
                        .and_then(|v| v.as_bool());
                    let capabilities = m
                        .get(Yaml::String("capabilities".into()))
                        .and_then(|v| v.as_mapping())
                        .map(|cm| {
                            cm.iter()
                                .filter_map(|(k, v)| {
                                    Some(CapabilityFlag {
                                        key: k.as_str()?.to_string(),
                                        value: v.as_bool()?,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let decision_verdicts = m
                        .get(Yaml::String("decision_contract".into()))
                        .and_then(|v| v.as_mapping())
                        .and_then(|dc| dc.get(Yaml::String("fields".into())))
                        .and_then(|v| v.as_mapping())
                        .and_then(|f| f.get(Yaml::String("verdict".into())))
                        .and_then(|v| v.as_mapping())
                        .map(|vm| collect_strings(vm, "enum"))
                        .unwrap_or_default();
                    report.phases.push(PhaseSummary {
                        id: id.to_string(),
                        mode,
                        agent,
                        directive,
                        command,
                        command_args,
                        command_cwd_mode,
                        command_timeout_secs,
                        command_success_exit_codes,
                        worktree,
                        capabilities,
                        decision_verdicts,
                        source_file: source_file.clone(),
                    });
                }
            }
        }
    }

    // agents: { agent_id: { ...lots of optional fields... } }
    if let Some(Yaml::Mapping(agents)) = mapping.get(Yaml::String("agents".into())) {
        for (k, v) in agents {
            if let Some(id) = k.as_str() {
                if let Some(m) = v.as_mapping() {
                    let memory = m
                        .get(Yaml::String("memory".into()))
                        .and_then(|v| v.as_mapping());
                    let communication = m
                        .get(Yaml::String("communication".into()))
                        .and_then(|v| v.as_mapping());
                    let tool_policy = m
                        .get(Yaml::String("tool_policy".into()))
                        .and_then(|v| v.as_mapping());
                    let persona_map = m
                        .get(Yaml::String("persona".into()))
                        .and_then(|v| v.as_mapping());

                    let persona = PersonaSummary {
                        style: persona_map.and_then(|pm| {
                            pm.get(Yaml::String("style".into()))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        }),
                        instructions: persona_map.and_then(|pm| {
                            pm.get(Yaml::String("instructions".into()))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        }),
                        traits: persona_map
                            .map(|pm| collect_strings(pm, "traits"))
                            .unwrap_or_default(),
                    };

                    report.agents.push(AgentSummary {
                        id: id.to_string(),
                        model: m
                            .get(Yaml::String("model".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        tool: m
                            .get(Yaml::String("tool".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        system_prompt: m
                            .get(Yaml::String("system_prompt".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        system_prompt_file: m
                            .get(Yaml::String("system_prompt_file".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        description: m
                            .get(Yaml::String("description".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        role: m
                            .get(Yaml::String("role".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        persona,
                        models: collect_strings(m, "models"),
                        skills: collect_strings(m, "skills"),
                        fallback_models: collect_strings(m, "fallback_models"),
                        fallback_tools: collect_strings(m, "fallback_tools"),
                        extra_args: collect_strings(m, "extra_args"),
                        codex_config_overrides: collect_strings(m, "codex_config_overrides"),
                        mcp_servers: collect_strings(m, "mcp_servers"),
                        memory_enabled: memory.and_then(|mm| {
                            mm.get(Yaml::String("enabled".into()))
                                .and_then(|v| v.as_bool())
                        }),
                        memory_write_policy: memory.and_then(|mm| {
                            mm.get(Yaml::String("write_policy".into()))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        }),
                        memory_scope: memory.and_then(|mm| {
                            mm.get(Yaml::String("scope".into()))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        }),
                        memory_max_context_chars: memory.and_then(|mm| {
                            mm.get(Yaml::String("max_context_chars".into()))
                                .and_then(|v| v.as_u64())
                                .map(|n| n as u32)
                        }),
                        communication_enabled: communication.and_then(|cm| {
                            cm.get(Yaml::String("enabled".into()))
                                .and_then(|v| v.as_bool())
                        }),
                        communication_channels: communication
                            .map(|cm| collect_strings(cm, "channels"))
                            .unwrap_or_default(),
                        communication_can_message: communication
                            .map(|cm| collect_strings(cm, "can_message"))
                            .unwrap_or_default(),
                        communication_max_context_chars: communication.and_then(|cm| {
                            cm.get(Yaml::String("max_context_chars".into()))
                                .and_then(|v| v.as_u64())
                                .map(|n| n as u32)
                        }),
                        network_access: m
                            .get(Yaml::String("network_access".into()))
                            .and_then(|v| v.as_bool()),
                        web_search: m
                            .get(Yaml::String("web_search".into()))
                            .and_then(|v| v.as_bool()),
                        reasoning_effort: m
                            .get(Yaml::String("reasoning_effort".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        max_attempts: m
                            .get(Yaml::String("max_attempts".into()))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        max_continuations: m
                            .get(Yaml::String("max_continuations".into()))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        timeout_secs: m
                            .get(Yaml::String("timeout_secs".into()))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32),
                        tool_profile: m
                            .get(Yaml::String("tool_profile".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        tool_allow: tool_policy
                            .map(|tp| collect_strings(tp, "allow"))
                            .unwrap_or_default(),
                        tool_deny: tool_policy
                            .map(|tp| collect_strings(tp, "deny"))
                            .unwrap_or_default(),
                        capabilities: m
                            .get(Yaml::String("capabilities".into()))
                            .and_then(|v| v.as_mapping())
                            .map(|cm| {
                                cm.iter()
                                    .filter_map(|(k, v)| {
                                        let key = k.as_str()?.to_string();
                                        let value = v.as_bool()?;
                                        Some(CapabilityFlag { key, value })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                        source_file: source_file.clone(),
                    });
                }
            }
        }
    }

    // mcp_servers: { id: { transport, command, args, url, env, tools } }
    if let Some(Yaml::Mapping(mcps)) = mapping.get(Yaml::String("mcp_servers".into())) {
        for (k, v) in mcps {
            if let Some(id) = k.as_str() {
                if let Some(m) = v.as_mapping() {
                    let env_keys: Vec<String> = m
                        .get(Yaml::String("env".into()))
                        .and_then(|v| v.as_mapping())
                        .map(|em| {
                            em.iter()
                                .filter_map(|(k, _)| k.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let oauth = m
                        .get(Yaml::String("oauth".into()))
                        .and_then(|v| v.as_mapping())
                        .map(|om| {
                            let s = |key: &str| {
                                om.get(Yaml::String(key.into()))
                                    .and_then(|v| v.as_str())
                                    .map(String::from)
                            };
                            OauthSummary {
                                flow: s("flow"),
                                token_url: s("token_url"),
                                client_id_env: s("client_id_env"),
                                client_secret_env: s("client_secret_env"),
                                refresh_token_env: s("refresh_token_env"),
                                bearer_env: s("bearer_env"),
                                scopes: collect_strings(om, "scopes"),
                                audience: s("audience"),
                                cache: om
                                    .get(Yaml::String("cache".into()))
                                    .and_then(|v| v.as_bool()),
                            }
                        });
                    report.mcp_servers.push(McpServerSummary {
                        id: id.to_string(),
                        transport: m
                            .get(Yaml::String("transport".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        command: m
                            .get(Yaml::String("command".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        args: collect_strings(m, "args"),
                        url: m
                            .get(Yaml::String("url".into()))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        env_keys,
                        tools: collect_strings(m, "tools"),
                        oauth,
                        source_file: source_file.clone(),
                    });
                }
            }
        }
    }

    // schedules: [{ workflow, cron, timezone }]
    if let Some(Yaml::Sequence(schedules)) = mapping.get(Yaml::String("schedules".into())) {
        for s in schedules {
            if let Some(m) = s.as_mapping() {
                report.schedules.push(ScheduleSummary {
                    id: m
                        .get(Yaml::String("id".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    // The schedule target is keyed `workflow_ref` in practice;
                    // accept the bare `workflow` form too.
                    workflow: m
                        .get(Yaml::String("workflow_ref".into()))
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            m.get(Yaml::String("workflow".into())).and_then(|v| v.as_str())
                        })
                        .map(String::from),
                    cron: m
                        .get(Yaml::String("cron".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    timezone: m
                        .get(Yaml::String("timezone".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    enabled: m
                        .get(Yaml::String("enabled".into()))
                        .and_then(|v| v.as_bool()),
                    source_file: source_file.clone(),
                });
            }
        }
    }

    // triggers: [{ kind, workflow, path }]
    if let Some(Yaml::Sequence(triggers)) = mapping.get(Yaml::String("triggers".into())) {
        for t in triggers {
            if let Some(m) = t.as_mapping() {
                report.triggers.push(TriggerSummary {
                    kind: m
                        .get(Yaml::String("kind".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    workflow: m
                        .get(Yaml::String("workflow_ref".into()))
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            m.get(Yaml::String("workflow".into())).and_then(|v| v.as_str())
                        })
                        .map(String::from),
                    path: m
                        .get(Yaml::String("path".into()))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    source_file: source_file.clone(),
                });
            }
        }
    }

    // Top-level config knobs (typically in custom.yaml) — last writer wins.
    if let Some(d) = mapping
        .get(Yaml::String("default_workflow_ref".into()))
        .and_then(|v| v.as_str())
    {
        report.default_workflow_ref = Some(d.to_string());
    }
    let allow = collect_strings(mapping, "tools_allowlist");
    if !allow.is_empty() {
        report.tools_allowlist = allow;
    }

    report.files.push(WorkflowFileReport {
        path: source_file,
        kind,
        ok: true,
        error: None,
        counts: FileCounts {
            workflows: (report.workflows.len() - before.0) as u32,
            phases: (report.phases.len() - before.1) as u32,
            agents: (report.agents.len() - before.2) as u32,
            schedules: (report.schedules.len() - before.3) as u32,
            triggers: (report.triggers.len() - before.4) as u32,
            mcp_servers: (report.mcp_servers.len() - before.5) as u32,
        },
    });
}

fn phase_ref_from_yaml(v: &Yaml) -> PhaseRef {
    if let Some(s) = v.as_str() {
        return PhaseRef {
            kind: PhaseRefKind::Phase,
            value: s.to_string(),
            max_rework_attempts: None,
            rework_target: None,
        };
    }
    if let Some(m) = v.as_mapping() {
        // Inline phase step: `phase-id: { max_rework_attempts, on_verdict: {...} }`.
        // The key is the phase id and the value its inline overrides.
        if let Some((k, body)) = m.iter().next() {
            if let Some(key) = k.as_str() {
                // workflow_ref / id keyed forms take precedence over inline steps.
                if key != "workflow_ref" && key != "id" {
                    let inline = body.as_mapping();
                    return PhaseRef {
                        kind: PhaseRefKind::Phase,
                        value: key.to_string(),
                        max_rework_attempts: inline.and_then(|im| {
                            im.get(Yaml::String("max_rework_attempts".into()))
                                .and_then(|x| x.as_u64())
                                .map(|n| n as u32)
                        }),
                        rework_target: inline.and_then(rework_target_from_inline),
                    };
                }
            }
        }
        if let Some(wref) = m.get(Yaml::String("workflow_ref".into())) {
            if let Some(s) = wref.as_str() {
                return PhaseRef {
                    kind: PhaseRefKind::WorkflowRef,
                    value: s.to_string(),
                    max_rework_attempts: None,
                    rework_target: None,
                };
            }
        }
        if let Some(id) = m.get(Yaml::String("id".into())) {
            if let Some(s) = id.as_str() {
                return PhaseRef {
                    kind: PhaseRefKind::Phase,
                    value: s.to_string(),
                    max_rework_attempts: None,
                    rework_target: None,
                };
            }
        }
    }
    PhaseRef {
        kind: PhaseRefKind::Phase,
        value: "<unknown>".to_string(),
        max_rework_attempts: None,
        rework_target: None,
    }
}

/// Pull `on_verdict.rework.target` out of an inline phase step.
fn rework_target_from_inline(inline: &serde_yaml::Mapping) -> Option<String> {
    inline
        .get(Yaml::String("on_verdict".into()))
        .and_then(|v| v.as_mapping())
        .and_then(|ov| ov.get(Yaml::String("rework".into())))
        .and_then(|v| v.as_mapping())
        .and_then(|rw| rw.get(Yaml::String("target".into())))
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn collect_strings(m: &serde_yaml::Mapping, key: &str) -> Vec<String> {
    m.get(Yaml::String(key.into()))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

/// Read the raw text of a single config file for the Files viewer. The path
/// must resolve inside the project's `.animus` directory — no escaping out.
#[tauri::command]
pub async fn local_workflow_file_read(project_root: String, path: String) -> Result<String, String> {
    let root = PathBuf::from(project_root.trim());
    let animus = root.join(".animus");
    let target = PathBuf::from(path.trim());
    let canon_animus = animus
        .canonicalize()
        .map_err(|e| format!("cannot resolve .animus: {}", e))?;
    let canon_target = target
        .canonicalize()
        .map_err(|e| format!("cannot resolve file: {}", e))?;
    if !canon_target.starts_with(&canon_animus) {
        return Err("refusing to read a file outside .animus/".into());
    }
    tokio::fs::read_to_string(&canon_target)
        .await
        .map_err(|e| format!("read failed: {}", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPair {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthInput {
    pub flow: Option<String>,
    pub token_url: Option<String>,
    pub client_id_env: Option<String>,
    pub client_secret_env: Option<String>,
    pub refresh_token_env: Option<String>,
    pub bearer_env: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub audience: Option<String>,
    pub cache: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub transport: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub env: Vec<EnvPair>,
    #[serde(default)]
    pub tools: Vec<String>,
    pub oauth: Option<OauthInput>,
}

fn opt_str(map: &mut Mapping, key: &str, value: &Option<String>) {
    if let Some(v) = value {
        if !v.trim().is_empty() {
            map.insert(Yaml::String(key.into()), Yaml::String(v.clone()));
        }
    }
}

fn opt_list(map: &mut Mapping, key: &str, list: &[String]) {
    let items: Vec<Yaml> = list
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| Yaml::String(s.clone()))
        .collect();
    if !items.is_empty() {
        map.insert(Yaml::String(key.into()), Yaml::Sequence(items));
    }
}

fn build_mcp_entry(input: &McpServerInput) -> Mapping {
    let mut entry = Mapping::new();
    opt_str(&mut entry, "transport", &input.transport);
    opt_str(&mut entry, "command", &input.command);
    opt_list(&mut entry, "args", &input.args);
    opt_str(&mut entry, "url", &input.url);
    if !input.env.is_empty() {
        let mut env = Mapping::new();
        for pair in &input.env {
            if pair.key.trim().is_empty() {
                continue;
            }
            env.insert(
                Yaml::String(pair.key.clone()),
                Yaml::String(pair.value.clone()),
            );
        }
        if !env.is_empty() {
            entry.insert(Yaml::String("env".into()), Yaml::Mapping(env));
        }
    }
    opt_list(&mut entry, "tools", &input.tools);
    if let Some(o) = &input.oauth {
        let mut om = Mapping::new();
        opt_str(&mut om, "flow", &o.flow);
        opt_str(&mut om, "token_url", &o.token_url);
        opt_str(&mut om, "client_id_env", &o.client_id_env);
        opt_str(&mut om, "client_secret_env", &o.client_secret_env);
        opt_str(&mut om, "refresh_token_env", &o.refresh_token_env);
        opt_str(&mut om, "bearer_env", &o.bearer_env);
        opt_list(&mut om, "scopes", &o.scopes);
        opt_str(&mut om, "audience", &o.audience);
        if let Some(c) = o.cache {
            om.insert(Yaml::String("cache".into()), Yaml::Bool(c));
        }
        if !om.is_empty() {
            entry.insert(Yaml::String("oauth".into()), Yaml::Mapping(om));
        }
    }
    entry
}

/// Writes from the renderer are confined to workflow YAML inside a project's
/// `.animus/` directory — `source_file` is frontend-supplied, and without
/// this check a buggy/compromised renderer could overwrite any YAML-shaped
/// file the user owns.
fn validate_animus_yaml_path(path: &std::path::Path) -> Result<(), String> {
    use std::path::Component;
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("yaml") || e.eq_ignore_ascii_case("yml"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!("{}: not a YAML file", path.display()));
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("source_file may not contain `..`".into());
    }
    if !path
        .components()
        .any(|c| matches!(c, Component::Normal(n) if n == ".animus"))
    {
        return Err(format!(
            "{}: writes are confined to a project's .animus/ directory",
            path.display()
        ));
    }
    Ok(())
}

/// Best-effort `.bak` snapshot before rewriting a hand-editable YAML file —
/// the serde round-trip strips comments/anchors, so keep the user's original.
async fn backup_yaml(path: &std::path::Path) {
    if path.is_file() {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("yaml");
        let bak = path.with_extension(format!("{ext}.bak"));
        let _ = tokio::fs::copy(path, &bak).await;
    }
}

/// Create or overwrite a single `mcp_servers:` entry. `source_file` is the YAML
/// file to write into — it is created (with an `mcp_servers:` block) if missing.
#[tauri::command]
pub async fn local_mcp_server_upsert(
    source_file: String,
    id: String,
    input: McpServerInput,
) -> Result<String, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("server id is required".into());
    }
    let path = PathBuf::from(source_file.trim());
    validate_animus_yaml_path(&path)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }

    let mut doc: Yaml = if path.is_file() {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("read {}: {}", path.display(), e))?;
        if content.trim().is_empty() {
            Yaml::Mapping(Mapping::new())
        } else {
            serde_yaml::from_str(&content)
                .map_err(|e| format!("parse {}: {}", path.display(), e))?
        }
    } else {
        Yaml::Mapping(Mapping::new())
    };

    let root = doc
        .as_mapping_mut()
        .ok_or_else(|| format!("{} is not a YAML mapping", path.display()))?;
    let servers_key = Yaml::String("mcp_servers".into());
    if !root.contains_key(&servers_key) {
        root.insert(servers_key.clone(), Yaml::Mapping(Mapping::new()));
    }
    let servers = root
        .get_mut(&servers_key)
        .and_then(|v| v.as_mapping_mut())
        .ok_or_else(|| format!("`mcp_servers:` in {} is not a mapping", path.display()))?;

    servers.insert(Yaml::String(id.clone()), Yaml::Mapping(build_mcp_entry(&input)));

    let mut serialized =
        serde_yaml::to_string(&doc).map_err(|e| format!("serialize: {}", e))?;
    if !serialized.ends_with('\n') {
        serialized.push('\n');
    }
    backup_yaml(&path).await;
    tokio::fs::write(&path, serialized.as_bytes())
        .await
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

/// Add or remove a server id from an agent's `mcp_servers:` list in-place,
/// touching nothing else in the agent definition.
#[tauri::command]
pub async fn local_mcp_link(
    source_file: String,
    agent_id: String,
    server_id: String,
    linked: bool,
) -> Result<(), String> {
    let path = PathBuf::from(source_file.trim());
    validate_animus_yaml_path(&path)?;
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    let mut doc: Yaml =
        serde_yaml::from_str(&content).map_err(|e| format!("parse {}: {}", path.display(), e))?;

    let entry = doc
        .as_mapping_mut()
        .and_then(|root| {
            root.get_mut(Yaml::String("agents".into()))
                .and_then(|v| v.as_mapping_mut())
        })
        .and_then(|agents| {
            agents
                .get_mut(Yaml::String(agent_id.clone()))
                .and_then(|v| v.as_mapping_mut())
        })
        .ok_or_else(|| format!("agent `{}` not found in {}", agent_id, path.display()))?;

    let key = Yaml::String("mcp_servers".into());
    let mut list: Vec<String> = entry
        .get(&key)
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    list.retain(|s| s != &server_id);
    if linked {
        list.push(server_id);
    }

    if list.is_empty() {
        entry.remove(&key);
    } else {
        entry.insert(
            key,
            Yaml::Sequence(list.into_iter().map(Yaml::String).collect()),
        );
    }

    let mut serialized =
        serde_yaml::to_string(&doc).map_err(|e| format!("serialize: {}", e))?;
    if !serialized.ends_with('\n') {
        serialized.push('\n');
    }
    backup_yaml(&path).await;
    tokio::fs::write(&path, serialized.as_bytes())
        .await
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

fn dedup_workflows(workflows: &mut Vec<WorkflowSummary>) {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut i = 0;
    while i < workflows.len() {
        let id = workflows[i].id.clone();
        if let Some(&existing) = seen.get(&id) {
            workflows.remove(existing);
            seen.clear();
            for (idx, w) in workflows.iter().enumerate() {
                seen.insert(w.id.clone(), idx);
            }
        } else {
            seen.insert(id, i);
            i += 1;
        }
    }
}
