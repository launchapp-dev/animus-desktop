// Read on-disk historical events (the events.jsonl file the daemon writes
// to ~/.animus/<repo-scope>/logs/events.jsonl). Lets the Journal scan
// arbitrary historical windows without re-running `animus daemon stream`.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Skip any single run/transcript file larger than this rather than loading
/// it whole — LLM transcripts can carry enormous tool_result payloads.
const MAX_RUN_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalEvent {
    pub ts: Option<String>,
    pub level: Option<String>,
    pub cat: Option<String>,
    pub msg: Option<String>,
    pub run_id: Option<String>,
    pub workflow_ref: Option<String>,
    pub phase_id: Option<String>,
    pub subject_id: Option<String>,
    pub schedule_id: Option<String>,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub plugin: Option<String>,
    pub agent: Option<String>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,
    pub tool_params: Option<String>,
    pub tool_result: Option<String>,
    pub tool_success: Option<bool>,
    pub verdict: Option<String>,
    pub command_program: Option<String>,
    pub command_args: Vec<String>,
    pub raw: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HistoricalReadArgs {
    pub repo_path: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub since_ts: Option<String>,
}

/// Read events.jsonl from the project's scoped state directory in reverse.
/// Returns the most recent `limit` lines (default 2000), with optional
/// `since_ts` filter so the UI can request "everything since 1 hour ago".
#[tauri::command]
pub async fn local_events_read(
    args: HistoricalReadArgs,
) -> Result<Vec<HistoricalEvent>, String> {
    let path = logs_dir_for(&args.repo_path)?.join("events.jsonl");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let limit = args.limit.unwrap_or(2000).clamp(1, 20_000);
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("open {}: {}", path.display(), e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    // Bounded ring: events.jsonl is the daemon's append-only log and grows
    // without limit (multi-GB files have happened). Holding only the trailing
    // `limit` parsed events keeps memory flat no matter the file size.
    let mut buf: std::collections::VecDeque<HistoricalEvent> =
        std::collections::VecDeque::with_capacity(limit + 1);
    while let Ok(Some(text)) = lines.next_line().await {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let evt = parse_event_line(trimmed);
        if let Some(since) = args.since_ts.as_deref() {
            if let (Some(ts), since_v) = (evt.ts.as_deref(), since) {
                if ts < since_v {
                    continue;
                }
            }
        }
        buf.push_back(evt);
        if buf.len() > limit {
            buf.pop_front();
        }
    }
    // Newest first.
    let mut out: Vec<HistoricalEvent> = buf.into_iter().collect();
    out.reverse();
    Ok(out)
}

fn parse_event_line(trimmed: &str) -> HistoricalEvent {
    let v: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return HistoricalEvent {
                raw: trimmed.to_string(),
                ..base()
            };
        }
    };
    let obj = v.as_object();
    HistoricalEvent {
        ts: obj.and_then(|o| o.get("ts")).and_then(|v| v.as_str()).map(String::from),
        level: obj.and_then(|o| o.get("level")).and_then(|v| v.as_str()).map(String::from),
        cat: obj.and_then(|o| o.get("cat")).and_then(|v| v.as_str()).map(String::from),
        msg: obj.and_then(|o| o.get("msg")).and_then(|v| v.as_str()).map(String::from),
        run_id: obj.and_then(|o| o.get("run_id")).and_then(|v| v.as_str()).map(String::from),
        workflow_ref: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("workflow_ref"))
            .and_then(|v| v.as_str())
            .map(String::from),
        phase_id: obj.and_then(|o| o.get("phase_id")).and_then(|v| v.as_str()).map(String::from),
        subject_id: obj.and_then(|o| o.get("subject_id")).and_then(|v| v.as_str()).map(String::from),
        schedule_id: obj.and_then(|o| o.get("schedule_id")).and_then(|v| v.as_str()).map(String::from),
        duration_ms: obj.and_then(|o| o.get("duration_ms")).and_then(|v| v.as_u64()),
        exit_code: obj.and_then(|o| o.get("exit_code")).and_then(|v| v.as_i64()),
        error: obj.and_then(|o| o.get("error")).and_then(|v| v.as_str()).map(String::from),
        model: obj.and_then(|o| o.get("model")).and_then(|v| v.as_str()).map(String::from),
        tool: obj.and_then(|o| o.get("tool")).and_then(|v| v.as_str()).map(String::from),
        plugin: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("plugin"))
            .and_then(|v| v.as_str())
            .map(String::from),
        agent: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("agent").or_else(|| m.get("agent_id")))
            .and_then(|v| v.as_str())
            .map(String::from),
        role: obj.and_then(|o| o.get("role")).and_then(|v| v.as_str()).map(String::from),
        content: obj
            .and_then(|o| o.get("content"))
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| {
                // phase.decision carries its explanation in meta.reason
                obj.and_then(|o| o.get("meta"))
                    .and_then(|m| m.get("reason"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
            }),
        tool_name: extract_tool_name(obj),
        tool_use_id: extract_tool_use_id(obj),
        tool_params: extract_tool_params(obj),
        tool_result: extract_tool_result(obj),
        tool_success: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("success"))
            .and_then(|v| v.as_bool()),
        verdict: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("verdict"))
            .and_then(|v| v.as_str())
            .map(String::from),
        command_program: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("program"))
            .and_then(|v| v.as_str())
            .map(String::from),
        command_args: obj
            .and_then(|o| o.get("meta"))
            .and_then(|m| m.get("args"))
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        raw: trimmed.to_string(),
    }
}

fn logs_dir_for(repo_path: &str) -> Result<PathBuf, String> {
    let repo = PathBuf::from(repo_path.trim());
    if !repo.is_dir() {
        return Err(format!("{} is not a directory", repo.display()));
    }
    // Reuse chat.rs's exact mirror of animus scope resolution (sha256 +
    // sanitized basename + `.project-root` marker fallback). The previous
    // local impl hashed with DefaultHasher and prefix-matched the raw
    // basename, which could resolve to ANOTHER project's scope (two repos
    // both named `api`) or to nothing at all (`My_Repo` vs `my-repo-…`).
    crate::chat::scoped_state_root(&repo)
        .map(|scope| scope.join("logs"))
        .ok_or_else(|| {
            format!(
                "no scoped state directory for {} (looked under ~/.animus/)",
                repo.display()
            )
        })
}

/// A per-phase run file groups under a workflow uuid. Filename shape:
/// `wf-<uuid>-<phase>-<index>-c<N>-a<N>-<32hex>.jsonl`. The uuid is 5
/// dash-segments and the PHASE CAN CONTAIN DASHES (qa-review, conductor-sweep,
/// push-branch), so we take everything between the uuid and the trailing
/// `<index>-c<N>-a<N>-<hash>` suffix — not just one segment.
fn parse_run_filename(stem: &str) -> Option<(String, String)> {
    if !stem.starts_with("wf-") {
        return None;
    }
    let parts: Vec<&str> = stem.split('-').collect();
    // 6 (wf + 5 uuid) + phase(>=1) + 4 suffix segments
    if parts.len() < 11 {
        // Fall back to the single-segment phase for unexpected shapes.
        if parts.len() >= 7 {
            return Some((parts[0..6].join("-"), parts[6].to_string()));
        }
        return None;
    }
    let wf_uuid = parts[0..6].join("-");
    // Trailing 4 segments are: <index>, c<N>, a<N>, <hash>.
    let phase = parts[6..parts.len() - 4].join("-");
    Some((wf_uuid, phase))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunSummary {
    pub wf_uuid: String,
    pub workflow_ref: Option<String>,
    pub subject_id: Option<String>,
    pub started_ts: Option<String>,
    pub ended_ts: Option<String>,
    pub started_ms: i64,
    pub phases: Vec<String>,
    pub run_ids: Vec<String>,
    pub event_count: u32,
    pub error_count: u32,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunsIndexArgs {
    pub repo_path: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

fn ts_to_ms(ts: &str) -> i64 {
    // RFC3339-ish; cheap parse by chopping to chrono.
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

/// Workflow spans from events.jsonl, used to attach workflow_ref + status to
/// per-run file groups (the run files don't carry the workflow name).
struct WorkflowSpan {
    workflow_ref: Option<String>,
    subject_id: Option<String>,
    start_ms: i64,
    end_ms: i64,
    failed: bool,
}

async fn read_workflow_spans(logs_dir: &Path) -> Vec<WorkflowSpan> {
    let path = logs_dir.join("events.jsonl");
    let mut spans: Vec<WorkflowSpan> = Vec::new();
    let Ok(file) = tokio::fs::File::open(&path).await else {
        return spans;
    };
    let mut lines = BufReader::new(file).lines();
    // Concurrent workflows interleave their events, so key open spans by
    // run_id; the anonymous slot only covers events that carry no id at all.
    let mut open_by_run: std::collections::HashMap<String, WorkflowSpan> =
        std::collections::HashMap::new();
    let mut open_anon: Option<WorkflowSpan> = None;
    while let Ok(Some(text)) = lines.next_line().await {
        let t = text.trim();
        if t.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(t) else {
            continue;
        };
        let cat = v.get("cat").and_then(|x| x.as_str()).unwrap_or("");
        let ts = v.get("ts").and_then(|x| x.as_str()).unwrap_or("");
        let ms = ts_to_ms(ts);
        let run_id = v
            .get("run_id")
            .and_then(|x| x.as_str())
            .or_else(|| {
                v.get("meta")
                    .and_then(|m| m.get("run_id"))
                    .and_then(|x| x.as_str())
            })
            .map(String::from);
        if cat == "workflow.start" {
            let span = WorkflowSpan {
                workflow_ref: v
                    .get("meta")
                    .and_then(|m| m.get("workflow_ref"))
                    .and_then(|x| x.as_str())
                    .map(String::from),
                subject_id: v.get("subject_id").and_then(|x| x.as_str()).map(String::from),
                start_ms: ms,
                end_ms: ms,
                failed: false,
            };
            match run_id {
                Some(id) => {
                    if let Some(prev) = open_by_run.insert(id, span) {
                        spans.push(prev);
                    }
                }
                None => {
                    if let Some(prev) = open_anon.replace(span) {
                        spans.push(prev);
                    }
                }
            }
        } else if cat == "workflow.complete" {
            let closing = match run_id {
                Some(id) => open_by_run.remove(&id).or_else(|| open_anon.take()),
                None => open_anon.take(),
            };
            if let Some(mut s) = closing {
                s.end_ms = ms;
                s.failed = v.get("level").and_then(|x| x.as_str()) == Some("error");
                spans.push(s);
            }
        }
    }
    spans.extend(open_by_run.into_values());
    if let Some(s) = open_anon.take() {
        spans.push(s);
    }
    spans
}

/// List workflow runs by scanning the per-run transcript files in
/// logs/runs/, grouped by workflow uuid, newest first.
#[tauri::command]
pub async fn local_workflow_runs(
    args: RunsIndexArgs,
) -> Result<Vec<WorkflowRunSummary>, String> {
    let logs_dir = logs_dir_for(&args.repo_path)?;
    let runs_dir = logs_dir.join("runs");
    if !runs_dir.is_dir() {
        return Ok(Vec::new());
    }
    let limit = args.limit.unwrap_or(300).clamp(1, 5000);
    let spans = read_workflow_spans(&logs_dir).await;

    use std::collections::HashMap;
    let mut groups: HashMap<String, WorkflowRunSummary> = HashMap::new();

    let mut rd = tokio::fs::read_dir(&runs_dir)
        .await
        .map_err(|e| format!("read runs dir: {}", e))?;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let p = entry.path();
        let is_jsonl = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false);
        if !is_jsonl {
            continue;
        }
        let stem = match p.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let Some((wf_uuid, phase)) = parse_run_filename(&stem) else {
            continue;
        };

        // Read the file to get ts range + counts. Size-guarded: a transcript
        // with huge tool_result payloads must not balloon a directory scan.
        if tokio::fs::metadata(&p)
            .await
            .map(|m| m.len() > MAX_RUN_FILE_BYTES)
            .unwrap_or(true)
        {
            continue;
        }
        let Ok(content) = tokio::fs::read_to_string(&p).await else {
            continue;
        };
        let mut first_ts: Option<String> = None;
        let mut last_ts: Option<String> = None;
        let mut count: u32 = 0;
        let mut errors: u32 = 0;
        for line in content.lines() {
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            count += 1;
            if let Ok(v) = serde_json::from_str::<Value>(t) {
                if let Some(ts) = v.get("ts").and_then(|x| x.as_str()) {
                    if first_ts.is_none() {
                        first_ts = Some(ts.to_string());
                    }
                    last_ts = Some(ts.to_string());
                }
                let lvl = v.get("level").and_then(|x| x.as_str()).unwrap_or("");
                let cat = v.get("cat").and_then(|x| x.as_str()).unwrap_or("");
                if lvl == "error" || cat == "llm.error" {
                    errors += 1;
                }
            }
        }

        let entry = groups.entry(wf_uuid.clone()).or_insert_with(|| {
            WorkflowRunSummary {
                wf_uuid: wf_uuid.clone(),
                workflow_ref: None,
                subject_id: None,
                started_ts: None,
                ended_ts: None,
                started_ms: i64::MAX,
                phases: Vec::new(),
                run_ids: Vec::new(),
                event_count: 0,
                error_count: 0,
                status: "completed".to_string(),
            }
        });
        entry.run_ids.push(stem.clone());
        if !entry.phases.contains(&phase) {
            entry.phases.push(phase);
        }
        entry.event_count += count;
        entry.error_count += errors;
        if let Some(ft) = first_ts.as_deref() {
            let ms = ts_to_ms(ft);
            if ms < entry.started_ms {
                entry.started_ms = ms;
                entry.started_ts = Some(ft.to_string());
            }
        }
        if let Some(lt) = last_ts {
            entry.ended_ts = Some(lt);
        }
    }

    // Attach workflow_ref + status from events.jsonl spans by time overlap.
    let mut out: Vec<WorkflowRunSummary> = groups.into_values().collect();
    for run in out.iter_mut() {
        if run.error_count > 0 {
            run.status = "failed".to_string();
        }
        // Find the span whose window contains the run start.
        let mut best: Option<&WorkflowSpan> = None;
        for sp in &spans {
            if run.started_ms >= sp.start_ms - 5000 && run.started_ms <= sp.end_ms + 5000 {
                best = Some(sp);
                break;
            }
        }
        if best.is_none() {
            // fallback: nearest span start before run start
            best = spans
                .iter()
                .filter(|s| s.start_ms <= run.started_ms.saturating_add(5000))
                .min_by_key(|s| (run.started_ms - s.start_ms).abs());
        }
        if let Some(sp) = best {
            run.workflow_ref = sp.workflow_ref.clone();
            run.subject_id = sp.subject_id.clone();
            if sp.failed && run.error_count == 0 {
                run.status = "failed".to_string();
            }
        }
        if run.started_ms == i64::MAX {
            run.started_ms = 0;
        }
    }
    out.sort_by(|a, b| b.started_ms.cmp(&a.started_ms));
    out.truncate(limit);
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTranscriptArgs {
    pub repo_path: String,
    pub wf_uuid: String,
}

/// Full transcript for one workflow run = all events across its per-phase
/// files, merged and sorted by timestamp.
#[tauri::command]
pub async fn local_run_transcript(
    args: RunTranscriptArgs,
) -> Result<Vec<HistoricalEvent>, String> {
    let logs_dir = logs_dir_for(&args.repo_path)?;
    let runs_dir = logs_dir.join("runs");
    if !runs_dir.is_dir() {
        return Ok(Vec::new());
    }
    let prefix = format!("{}-", args.wf_uuid);
    let mut events: Vec<(i64, HistoricalEvent)> = Vec::new();
    let mut rd = tokio::fs::read_dir(&runs_dir)
        .await
        .map_err(|e| format!("read runs dir: {}", e))?;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let p = entry.path();
        let name = match p.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if !name.starts_with(&prefix) || !name.ends_with(".jsonl") {
            continue;
        }
        // Size-guarded for the same reason as the runs index scan.
        if tokio::fs::metadata(&p)
            .await
            .map(|m| m.len() > MAX_RUN_FILE_BYTES)
            .unwrap_or(true)
        {
            continue;
        }
        let Ok(content) = tokio::fs::read_to_string(&p).await else {
            continue;
        };
        for line in content.lines() {
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            let evt = parse_event_line(t);
            let ms = evt.ts.as_deref().map(ts_to_ms).unwrap_or(0);
            events.push((ms, evt));
        }
    }
    events.sort_by_key(|(ms, _)| *ms);
    Ok(events.into_iter().map(|(_, e)| e).collect())
}

fn extract_tool_name(obj: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let cat = obj?.get("cat")?.as_str()?;
    if cat != "llm.tool_call" {
        return None;
    }
    let msg = obj?.get("msg").and_then(|v| v.as_str()).map(String::from);
    if msg.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
        return msg;
    }
    obj?.get("meta")?.get("tool")?.as_str().map(String::from)
}

fn extract_tool_use_id(obj: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let cat = obj?.get("cat")?.as_str()?;
    if cat != "llm.tool_result" {
        return None;
    }
    obj?.get("meta")?.get("tool")?.as_str().map(String::from)
}

fn extract_tool_params(obj: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let cat = obj?.get("cat")?.as_str()?;
    if cat != "llm.tool_call" {
        return None;
    }
    let params = obj?.get("meta")?.get("params")?;
    Some(serde_json::to_string_pretty(params).ok()?)
}

fn extract_tool_result(obj: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let cat = obj?.get("cat")?.as_str()?;
    if cat != "llm.tool_result" {
        return None;
    }
    let value = obj?.get("meta")?.get("result")?;
    match value {
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

fn base() -> HistoricalEvent {
    HistoricalEvent {
        ts: None,
        level: None,
        cat: None,
        msg: None,
        run_id: None,
        workflow_ref: None,
        phase_id: None,
        subject_id: None,
        schedule_id: None,
        duration_ms: None,
        exit_code: None,
        error: None,
        model: None,
        tool: None,
        plugin: None,
        agent: None,
        role: None,
        content: None,
        tool_name: None,
        tool_use_id: None,
        tool_params: None,
        tool_result: None,
        tool_success: None,
        verdict: None,
        command_program: None,
        command_args: Vec::new(),
        raw: String::new(),
    }
}

