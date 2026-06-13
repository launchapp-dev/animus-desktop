use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
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

/// Trim + cap CLI output before embedding it in an error string, so a noisy
/// child can't balloon error payloads (or echo sensitive output back whole).
pub(crate) fn truncate_output(s: &str) -> String {
    const MAX: usize = 500;
    let t = s.trim();
    if t.len() <= MAX {
        return t.to_string();
    }
    let mut end = MAX;
    while !t.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [{} more bytes]", &t[..end], t.len() - end)
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
            truncate_output(&stderr)
        ));
    }

    // Never embed raw stdout here — secret get/set responses flow through
    // this path and must not be echoed back in error strings.
    let envelope: Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        format!(
            "animus output is not JSON: {} (stdout {} bytes, stderr='{}')",
            e,
            stdout.trim().len(),
            truncate_output(&stderr)
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
pub async fn animus_daemon_config_get(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["daemon", "config"]).await
}

#[tauri::command]
pub async fn animus_daemon_config_set(
    path: String,
    pool_size: Option<u32>,
    interval_secs: Option<u32>,
    max_tasks_per_tick: Option<u32>,
    auto_run_ready: Option<bool>,
    auto_pr: Option<bool>,
    auto_merge: Option<bool>,
) -> Result<AnimusCliResult, String> {
    let mut args: Vec<String> = vec!["daemon".into(), "config".into()];
    if let Some(v) = pool_size {
        args.push("--pool-size".into());
        args.push(v.to_string());
    }
    if let Some(v) = interval_secs {
        args.push("--interval-secs".into());
        args.push(v.to_string());
    }
    if let Some(v) = max_tasks_per_tick {
        args.push("--max-tasks-per-tick".into());
        args.push(v.to_string());
    }
    if let Some(v) = auto_run_ready {
        args.push("--auto-run-ready".into());
        args.push(v.to_string());
    }
    if let Some(v) = auto_pr {
        args.push("--auto-pr".into());
        args.push(v.to_string());
    }
    if let Some(v) = auto_merge {
        args.push("--auto-merge".into());
        args.push(v.to_string());
    }
    if args.len() == 2 {
        return Err("no config changes provided".to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_animus_json(&path, &refs).await
}

/// The project's active flavor + drift report against its manifest. This is
/// the only project-scoped view of "what plugins this project needs" — plugin
/// installs themselves are machine-global (`~/.animus/plugins/`).
#[tauri::command]
pub async fn animus_flavor_current(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["flavor", "current"]).await
}

fn valid_phase_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Create or replace a workflow definition. The CLI validates the JSON and
/// writes it to the generated overlay — no manual YAML editing.
#[tauri::command]
pub async fn animus_workflow_definition_upsert(
    path: String,
    input_json: String,
) -> Result<AnimusCliResult, String> {
    serde_json::from_str::<Value>(&input_json)
        .map_err(|e| format!("invalid workflow JSON: {e}"))?;
    run_animus_json(
        &path,
        &["workflow", "definitions", "upsert", "--input-json", &input_json],
    )
    .await
}

/// Create or replace a phase definition in the generated overlay.
#[tauri::command]
pub async fn animus_workflow_phase_upsert(
    path: String,
    phase_id: String,
    input_json: String,
) -> Result<AnimusCliResult, String> {
    let pid = phase_id.trim();
    if !valid_phase_id(pid) {
        return Err("invalid phase id: use lowercase letters, digits, '-', '_'".to_string());
    }
    serde_json::from_str::<Value>(&input_json)
        .map_err(|e| format!("invalid phase JSON: {e}"))?;
    run_animus_json(
        &path,
        &["workflow", "phases", "upsert", "--phase", pid, "--input-json", &input_json],
    )
    .await
}

/// Remove a generated-overlay phase definition (confirmation token required).
#[tauri::command]
pub async fn animus_workflow_phase_remove(
    path: String,
    phase_id: String,
) -> Result<AnimusCliResult, String> {
    let pid = phase_id.trim();
    if !valid_phase_id(pid) {
        return Err("invalid phase id".to_string());
    }
    run_animus_json(
        &path,
        &["workflow", "phases", "remove", "--phase", pid, "--confirm", pid],
    )
    .await
}

#[tauri::command]
pub async fn animus_skill_list(path: String) -> Result<AnimusCliResult, String> {
    run_animus_json(&path, &["skill", "list"]).await
}

#[tauri::command]
pub async fn animus_skill_info(path: String, name: String) -> Result<AnimusCliResult, String> {
    if !crate::chat::valid_skill_slug(name.trim()) {
        return Err("invalid skill name".to_string());
    }
    run_animus_json(&path, &["skill", "info", "--name", name.trim()]).await
}

/// Editable fields of a project-scope skill definition. Unmodeled YAML fields
/// (tool_policy, adapters, capabilities, …) are preserved on update.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSaveArgs {
    pub path: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub version: Option<String>,
    pub system_prompt: Option<String>,
    pub mcp_servers: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
}

fn project_skill_path(repo: &str, name: &str) -> Result<PathBuf, String> {
    let repo = PathBuf::from(repo.trim());
    if !repo.is_dir() {
        return Err(format!("project path not found: {}", repo.display()));
    }
    if !crate::chat::valid_skill_slug(name) {
        return Err("invalid skill name: use lowercase letters, digits, '-', '_'".to_string());
    }
    Ok(repo
        .join(".animus")
        .join("config")
        .join("skill_definitions")
        .join(format!("{name}.yaml")))
}

/// Create or update a project-scope skill YAML. Updates merge into the
/// existing document so fields the desktop doesn't model survive round-trips.
#[tauri::command]
pub async fn animus_skill_save(args: SkillSaveArgs) -> Result<(), String> {
    let name = args.name.trim().to_string();
    let target = project_skill_path(&args.path, &name)?;
    tokio::task::spawn_blocking(move || save_skill_yaml(&target, &name, &args))
        .await
        .map_err(|e| e.to_string())?
}

fn save_skill_yaml(
    target: &std::path::Path,
    name: &str,
    args: &SkillSaveArgs,
) -> Result<(), String> {
    use serde_yaml::{Mapping, Value as Yaml};

    let mut doc: Mapping = match std::fs::read_to_string(target) {
        Ok(body) => serde_yaml::from_str(&body)
            .map_err(|e| format!("existing skill YAML is invalid: {e}"))?,
        Err(_) => Mapping::new(),
    };
    doc.insert(Yaml::from("name"), Yaml::from(name));
    let set = |doc: &mut Mapping, key: &str, v: Option<Yaml>| {
        if let Some(v) = v {
            doc.insert(Yaml::from(key), v);
        }
    };
    set(&mut doc, "description", args.description.clone().map(Yaml::from));
    set(&mut doc, "version", args.version.clone().map(Yaml::from));
    if let Some(cat) = args.category.as_deref() {
        let cat = cat.trim().to_lowercase();
        if cat.is_empty() {
            doc.remove(Yaml::from("category"));
        } else {
            doc.insert(Yaml::from("category"), Yaml::from(cat));
        }
    }
    if let Some(system) = args.system_prompt.clone() {
        let prompt = doc
            .entry(Yaml::from("prompt"))
            .or_insert_with(|| Yaml::Mapping(Mapping::new()));
        let Yaml::Mapping(prompt) = prompt else {
            return Err("skill YAML `prompt:` is not a mapping".to_string());
        };
        prompt.insert(Yaml::from("system"), Yaml::from(system));
    }
    let list = |items: &[String]| {
        Yaml::Sequence(
            items
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(Yaml::from)
                .collect(),
        )
    };
    if let Some(servers) = args.mcp_servers.as_deref() {
        doc.insert(Yaml::from("mcp_servers"), list(servers));
    }
    if let Some(tags) = args.tags.as_deref() {
        doc.insert(Yaml::from("tags"), list(tags));
    }

    let body =
        serde_yaml::to_string(&Yaml::Mapping(doc)).map_err(|e| e.to_string())?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("yaml.tmp");
    std::fs::write(&tmp, body.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())?;
    Ok(())
}

/// Install a skill, either by name (resolved against configured registries /
/// sources) or from a local Markdown skill file/folder. Mirrors
/// `animus skill install`.
#[tauri::command]
pub async fn animus_skill_install(
    path: String,
    name: Option<String>,
    version: Option<String>,
    local_path: Option<String>,
    source: Option<String>,
) -> Result<AnimusCliResult, String> {
    let name = name.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let local = local_path.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if name.is_none() && local.is_none() {
        return Err("provide a skill name or a local path".to_string());
    }
    if let Some(n) = name {
        if !crate::chat::valid_skill_slug(n) {
            return Err("invalid skill name: use lowercase letters, digits, '-', '_'".to_string());
        }
    }
    let mut args: Vec<String> = vec!["skill".into(), "install".into()];
    if let Some(n) = name {
        args.push("--name".into());
        args.push(n.into());
    }
    if let Some(p) = local {
        args.push("--path".into());
        args.push(p.into());
    }
    if let Some(v) = version.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--version".into());
        args.push(v.into());
    }
    if let Some(s) = source.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--source".into());
        args.push(s.into());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_animus_json(&path, &refs).await
}

/// Re-resolve one installed skill, or all when `name` is omitted. Mirrors
/// `animus skill update`.
#[tauri::command]
pub async fn animus_skill_update(
    path: String,
    name: Option<String>,
) -> Result<AnimusCliResult, String> {
    let mut args: Vec<String> = vec!["skill".into(), "update".into()];
    if let Some(n) = name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !crate::chat::valid_skill_slug(n) {
            return Err("invalid skill name".to_string());
        }
        args.push("--name".into());
        args.push(n.into());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_animus_json(&path, &refs).await
}

/// Uninstall a registry/installed skill (removes materialized files + lock
/// entries). For project-scope YAML skills, use `animus_skill_delete` instead.
#[tauri::command]
pub async fn animus_skill_uninstall(
    path: String,
    name: String,
) -> Result<AnimusCliResult, String> {
    let name = name.trim();
    if !crate::chat::valid_skill_slug(name) {
        return Err("invalid skill name".to_string());
    }
    run_animus_json(&path, &["skill", "uninstall", name]).await
}

/// Delete a project-scope skill YAML. Only touches
/// `.animus/config/skill_definitions/` — never user/installed scopes.
#[tauri::command]
pub async fn animus_skill_delete(path: String, name: String) -> Result<(), String> {
    let target = project_skill_path(&path, name.trim())?;
    if !target.is_file() {
        return Err(format!("no project skill named '{}'", name.trim()));
    }
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

/// Approve or reject a pending workflow phase gate. `note` is required by the
/// CLI for reject; approve defaults it.
#[tauri::command]
pub async fn animus_phase_gate(
    path: String,
    workflow_id: String,
    phase_id: String,
    decision: String,
    note: Option<String>,
) -> Result<AnimusCliResult, String> {
    let verb = match decision.trim() {
        "approve" => "approve",
        "reject" => "reject",
        other => return Err(format!("invalid gate decision '{other}'")),
    };
    let wf = workflow_id.trim();
    let phase = phase_id.trim();
    if wf.is_empty() || phase.is_empty() {
        return Err("workflow id and phase id are required".to_string());
    }
    let mut args: Vec<&str> = vec!["workflow", "phase", verb, "--id", wf, "--phase", phase];
    let note = note.as_deref().map(str::trim).filter(|n| !n.is_empty());
    if verb == "reject" && note.is_none() {
        return Err("a note is required to reject a phase gate".to_string());
    }
    if let Some(n) = note {
        args.push("--note");
        args.push(n);
    }
    run_animus_json(&path, &args).await
}

#[tauri::command]
pub async fn animus_interactions_list(
    path: String,
    all: bool,
) -> Result<AnimusCliResult, String> {
    let mut args: Vec<&str> = vec!["agent", "interactions", "list"];
    if all {
        args.push("--all");
    }
    run_animus_json(&path, &args).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionsAnswerArgs {
    pub path: String,
    pub id: String,
    /// Approvals: "allow" | "deny".
    pub decision: Option<String>,
    /// Flat-question answer or freeform response.
    pub text: Option<String>,
    /// Structured selections, each "<question text>=label[,label…]".
    pub selects: Option<Vec<String>>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn animus_interactions_answer(
    args: InteractionsAnswerArgs,
) -> Result<AnimusCliResult, String> {
    let id = args.id.trim();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid interaction id".to_string());
    }
    let mut argv: Vec<String> = vec![
        "agent".into(),
        "interactions".into(),
        "answer".into(),
        id.into(),
    ];
    match args.decision.as_deref().map(str::trim) {
        Some("allow") => argv.push("--allow".into()),
        Some("deny") => argv.push("--deny".into()),
        Some(other) if !other.is_empty() => {
            return Err(format!("invalid decision '{other}': use allow or deny"));
        }
        _ => {}
    }
    if let Some(text) = args.text.as_deref() {
        if !text.trim().is_empty() {
            argv.push("--text".into());
            argv.push(text.to_string());
        }
    }
    for sel in args.selects.as_deref().unwrap_or(&[]) {
        if !sel.trim().is_empty() {
            argv.push("--select".into());
            argv.push(sel.clone());
        }
    }
    if let Some(msg) = args.message.as_deref() {
        if !msg.trim().is_empty() {
            argv.push("--message".into());
            argv.push(msg.to_string());
        }
    }
    let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    run_animus_json(&args.path, &refs).await
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

#[cfg(test)]
mod tests {
    use super::*;

    fn save_args(name: &str) -> SkillSaveArgs {
        SkillSaveArgs {
            path: String::new(),
            name: name.to_string(),
            description: Some("A test skill".into()),
            category: Some("operations".into()),
            version: Some("1.0.0".into()),
            system_prompt: Some("You are a test skill.".into()),
            mcp_servers: Some(vec!["animus".into(), "  ".into()]),
            tags: Some(vec!["test".into()]),
        }
    }

    #[test]
    fn save_skill_yaml_creates_and_round_trips() {
        let dir =
            std::env::temp_dir().join(format!("animus-skill-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("my-skill.yaml");

        save_skill_yaml(&target, "my-skill", &save_args("my-skill")).unwrap();
        let doc: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(doc["name"].as_str(), Some("my-skill"));
        assert_eq!(doc["category"].as_str(), Some("operations"));
        assert_eq!(doc["prompt"]["system"].as_str(), Some("You are a test skill."));
        let servers: Vec<&str> = doc["mcp_servers"]
            .as_sequence()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert_eq!(servers, vec!["animus"], "blank entries filtered");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_skill_yaml_preserves_unmodeled_fields() {
        let dir =
            std::env::temp_dir().join(format!("animus-skill-merge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("rich.yaml");
        std::fs::write(
            &target,
            concat!(
                "name: rich\n",
                "description: old\n",
                "tool_policy:\n  allow: [Read]\n",
                "capabilities:\n  writes_files: true\n",
                "prompt:\n  system: old prompt\n  directives:\n    - keep me\n",
            ),
        )
        .unwrap();

        save_skill_yaml(&target, "rich", &save_args("rich")).unwrap();
        let doc: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(doc["description"].as_str(), Some("A test skill"), "modeled field updated");
        assert_eq!(doc["prompt"]["system"].as_str(), Some("You are a test skill."));
        assert_eq!(
            doc["prompt"]["directives"][0].as_str(),
            Some("keep me"),
            "sibling prompt fields preserved",
        );
        assert_eq!(
            doc["tool_policy"]["allow"][0].as_str(),
            Some("Read"),
            "unmodeled top-level fields preserved",
        );
        assert_eq!(doc["capabilities"]["writes_files"].as_bool(), Some(true));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_skill_path_rejects_bad_names() {
        let repo = std::env::temp_dir();
        let repo_s = repo.to_string_lossy();
        assert!(project_skill_path(&repo_s, "good-skill_2").is_ok());
        assert!(project_skill_path(&repo_s, "../evil").is_err());
        assert!(project_skill_path(&repo_s, "Upper").is_err());
        assert!(project_skill_path(&repo_s, "").is_err());
        assert!(project_skill_path("/definitely/not/a/dir", "ok").is_err());
    }
}
