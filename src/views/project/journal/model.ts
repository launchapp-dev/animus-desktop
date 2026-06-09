import type { AgentState } from "../../../components/AgentFace";
import type { CycleEvent } from "../../../state/projectEvents";
import type { HistoricalEvent } from "../../../api/event_log";

export type FilterKey =
  | "all"
  | "workflows"
  | "phases"
  | "dispatch"
  | "llm"
  | "schedule"
  | "errors";

export interface NormalizedEvent {
  ts: number;
  tsRaw: string | null;
  level: string | null;
  cat: string;
  msg: string;
  runId: string | null;
  workflowRef: string | null;
  phaseId: string | null;
  subjectId: string | null;
  scheduleId: string | null;
  durationMs: number | null;
  exitCode: number | null;
  error: string | null;
  model: string | null;
  tool: string | null;
  plugin: string | null;
  agent: string | null;
  role: string | null;
  content: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolParams: string | null;
  toolResult: string | null;
  toolSuccess: boolean | null;
  verdict: string | null;
  commandProgram: string | null;
  commandArgs: string[];
  raw?: string;
  source: "live" | "history";
}

export const ALL_CATS = new Set([
  "workflow.start",
  "workflow.complete",
  "phase.start",
  "phase.complete",
  "phase.decision",
  "plugin.dispatch.start",
  "plugin.dispatch.complete",
  "plugin.dispatch.timeout",
  "plugin.cancel",
  "schedule",
  "triggers",
  "command.complete",
  "llm.thinking",
  "llm.output",
  "llm.complete",
  "llm.tool_result",
  "llm.tool_call",
]);

export function parseTs(ts: string | null | undefined, fallback: number): number {
  if (!ts) return fallback;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : fallback;
}

export function relTime(now: number, then: number): string {
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function statusFromCat(
  cat: string,
  level: string | null,
  exitCode: number | null,
): string {
  if (
    cat === "workflow.start" ||
    cat === "phase.start" ||
    cat === "plugin.dispatch.start"
  ) {
    return "started";
  }
  if (
    cat === "workflow.complete" ||
    cat === "phase.complete" ||
    cat === "plugin.dispatch.complete" ||
    cat === "command.complete"
  ) {
    if (level === "error") return "failed";
    if (exitCode != null && exitCode !== 0) return "failed";
    return "completed";
  }
  if (cat === "plugin.dispatch.timeout") return "failed";
  if (cat === "plugin.cancel") return "cancelled";
  if (cat === "phase.decision") return "decision";
  if (cat === "schedule") return "scheduled";
  if (cat === "triggers") return "triggered";
  return "info";
}

export function statusColor(status: string): string {
  switch (status) {
    case "started":
      return "var(--blue)";
    case "completed":
      return "var(--green)";
    case "failed":
      return "var(--crimson)";
    case "cancelled":
      return "var(--yellow)";
    case "decision":
      return "var(--copper)";
    case "scheduled":
      return "var(--text-muted)";
    case "triggered":
      return "var(--brass)";
    default:
      return "var(--text-faint)";
  }
}

export function statusToAgentState(status: string): AgentState {
  if (status === "started") return "running";
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  return "idle";
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function fromCycleEvent(c: CycleEvent, fallbackTs: number): NormalizedEvent {
  return {
    ts: parseTs(c.ts, fallbackTs),
    tsRaw: c.ts,
    level: c.level,
    cat: c.cat,
    msg: c.msg ?? c.status,
    runId: c.run_id,
    workflowRef: c.workflow_ref,
    phaseId: c.phase_id,
    subjectId: c.subject_id,
    scheduleId: c.schedule_id,
    durationMs: c.duration_ms,
    exitCode: c.exit_code,
    error: c.error,
    model: c.model,
    tool: c.tool,
    plugin: c.plugin,
    agent: c.agent,
    role: c.role,
    content: c.content,
    toolName: c.tool_name,
    toolUseId: c.tool_use_id,
    toolParams: c.tool_params,
    toolResult: c.tool_result,
    toolSuccess: c.tool_success,
    verdict: c.verdict,
    commandProgram: c.command_program,
    commandArgs: c.command_args ?? [],
    source: "live",
  };
}

export function fromHistoricalEvent(
  h: HistoricalEvent,
  fallbackTs: number,
): NormalizedEvent {
  return {
    ts: parseTs(h.ts, fallbackTs),
    tsRaw: h.ts,
    level: h.level,
    cat: h.cat ?? "unknown",
    msg: h.msg ?? "",
    runId: h.runId,
    workflowRef: h.workflowRef,
    phaseId: h.phaseId,
    subjectId: h.subjectId,
    scheduleId: h.scheduleId,
    durationMs: h.durationMs,
    exitCode: h.exitCode,
    error: h.error,
    model: h.model,
    tool: h.tool,
    plugin: h.plugin,
    agent: h.agent,
    role: h.role,
    content: h.content,
    toolName: h.toolName,
    toolUseId: h.toolUseId,
    toolParams: h.toolParams,
    toolResult: h.toolResult,
    toolSuccess: h.toolSuccess,
    verdict: h.verdict,
    commandProgram: h.commandProgram,
    commandArgs: h.commandArgs ?? [],
    raw: h.raw,
    source: "history",
  };
}

export function isErrorEvent(e: NormalizedEvent): boolean {
  if (e.level === "error" || e.level === "fatal") return true;
  if (e.exitCode != null && e.exitCode !== 0) return true;
  if (e.cat === "plugin.dispatch.timeout") return true;
  if (e.error) return true;
  return false;
}

export function matchesFilter(e: NormalizedEvent, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "errors") return isErrorEvent(e);
  if (f === "workflows") return e.cat.startsWith("workflow.");
  if (f === "phases") return e.cat.startsWith("phase.");
  if (f === "dispatch") return e.cat.startsWith("plugin.");
  if (f === "llm") return e.cat.startsWith("llm.");
  if (f === "schedule") return e.cat === "schedule" || e.cat === "triggers";
  return true;
}

export interface PhaseRow {
  phaseId: string;
  startedTs: number;
  finishedTs: number | null;
  durationMs: number | null;
  status: string;
  agent: string | null;
  error: string | null;
}

export interface WorkflowRun {
  runId: string;
  workflowRef: string | null;
  subjectId: string | null;
  scheduleId: string | null;
  startedTs: number;
  finishedTs: number | null;
  durationMs: number | null;
  status: string;
  phaseRows: PhaseRow[];
  /** Every event in this run, oldest-first — used to build the transcript. */
  timeline: NormalizedEvent[];
  errorCount: number;
  llmCount: number;
  dispatchCount: number;
  agents: string[];
  primaryAgent: string | null;
}

/** Resolve an event's agent: explicit field, else phase→agent map. */
function eventAgent(
  e: NormalizedEvent,
  agentByPhase: Record<string, string>,
): string | null {
  if (e.agent) return e.agent;
  if (e.phaseId && agentByPhase[e.phaseId]) return agentByPhase[e.phaseId]!;
  return null;
}

export function buildRuns(
  events: NormalizedEvent[],
  agentByPhase: Record<string, string> = {},
): { runs: WorkflowRun[]; ungrouped: NormalizedEvent[] } {
  const byRun = new Map<string, WorkflowRun>();
  const ungrouped: NormalizedEvent[] = [];
  const agentSets = new Map<string, Set<string>>();

  for (const e of events) {
    const resolvedAgent = eventAgent(e, agentByPhase);
    const enriched = resolvedAgent ? { ...e, agent: resolvedAgent } : e;

    if (!e.runId) {
      ungrouped.push(enriched);
      continue;
    }
    let run = byRun.get(e.runId);
    if (!run) {
      run = {
        runId: e.runId,
        workflowRef: e.workflowRef,
        subjectId: e.subjectId,
        scheduleId: e.scheduleId,
        startedTs: e.ts,
        finishedTs: null,
        durationMs: null,
        status: "info",
        phaseRows: [],
        timeline: [],
        errorCount: 0,
        llmCount: 0,
        dispatchCount: 0,
        agents: [],
        primaryAgent: null,
      };
      byRun.set(e.runId, run);
      agentSets.set(e.runId, new Set());
    }
    run.workflowRef = run.workflowRef ?? e.workflowRef;
    run.subjectId = run.subjectId ?? e.subjectId;
    run.scheduleId = run.scheduleId ?? e.scheduleId;
    run.startedTs = Math.min(run.startedTs, e.ts);
    run.timeline.push(enriched);
    if (resolvedAgent) agentSets.get(e.runId)!.add(resolvedAgent);
    if (isErrorEvent(e)) run.errorCount += 1;
    if (e.cat.startsWith("llm.")) run.llmCount += 1;
    if (e.cat.startsWith("plugin.dispatch.")) run.dispatchCount += 1;

    if (e.cat === "workflow.start") {
      run.status = run.status === "info" ? "started" : run.status;
    } else if (e.cat === "workflow.complete") {
      run.finishedTs = e.ts;
      run.durationMs = e.durationMs ?? e.ts - run.startedTs;
      run.status = isErrorEvent(e) ? "failed" : "completed";
    } else if (e.cat === "phase.start" && e.phaseId) {
      run.phaseRows.push({
        phaseId: e.phaseId,
        startedTs: e.ts,
        finishedTs: null,
        durationMs: null,
        status: "started",
        agent: resolvedAgent,
        error: null,
      });
    } else if (e.cat === "phase.complete" && e.phaseId) {
      const existing = run.phaseRows.find(
        (p) => p.phaseId === e.phaseId && p.finishedTs === null,
      );
      const status = isErrorEvent(e) ? "failed" : "completed";
      if (existing) {
        existing.finishedTs = e.ts;
        existing.durationMs = e.durationMs ?? e.ts - existing.startedTs;
        existing.status = status;
        existing.error = e.error;
      } else {
        run.phaseRows.push({
          phaseId: e.phaseId,
          startedTs: e.ts,
          finishedTs: e.ts,
          durationMs: e.durationMs,
          status,
          agent: resolvedAgent,
          error: e.error,
        });
      }
    }
  }

  for (const run of byRun.values()) {
    run.timeline.sort((a, b) => a.ts - b.ts);
    run.agents = Array.from(agentSets.get(run.runId) ?? []);
    run.primaryAgent = run.agents[0] ?? null;
    // If the run never got a terminal workflow.complete but all phases are
    // done, mark accordingly.
    if (run.status === "started" || run.status === "info") {
      if (run.errorCount > 0) run.status = "failed";
      else if (run.phaseRows.every((p) => p.finishedTs !== null) && run.phaseRows.length > 0)
        run.status = "completed";
    }
  }

  const runs = Array.from(byRun.values()).sort(
    (a, b) => b.startedTs - a.startedTs,
  );
  return { runs, ungrouped: ungrouped.sort((a, b) => b.ts - a.ts) };
}

/** Parse a raw JSON line emitted by `animus agent run --json --stream`. */
export function parseRawEventLine(
  raw: string,
  fallbackTs: number,
): NormalizedEvent | null {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    // envelope may wrap data
    v =
      parsed && typeof parsed === "object" && "data" in parsed && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : (parsed as Record<string, unknown>);
  } catch {
    return null;
  }
  const str = (k: string): string | null =>
    typeof v[k] === "string" ? (v[k] as string) : null;
  const num = (k: string): number | null =>
    typeof v[k] === "number" ? (v[k] as number) : null;
  const meta = (v.meta ?? null) as Record<string, unknown> | null;
  const metaStr = (k: string): string | null =>
    meta && typeof meta[k] === "string" ? (meta[k] as string) : null;
  const cat = str("cat") ?? "llm.output";

  let toolName: string | null = null;
  let toolUseId: string | null = null;
  let toolParams: string | null = null;
  let toolResult: string | null = null;
  let toolSuccess: boolean | null = null;
  if (cat === "llm.tool_call") {
    toolName = str("msg") || metaStr("tool");
    if (meta && "params" in meta) {
      try {
        toolParams = JSON.stringify(meta.params, null, 2);
      } catch {
        toolParams = String(meta.params);
      }
    }
  } else if (cat === "llm.tool_result") {
    toolUseId = metaStr("tool");
    if (meta && "result" in meta) {
      toolResult =
        typeof meta.result === "string"
          ? (meta.result as string)
          : JSON.stringify(meta.result);
    }
    if (meta && typeof meta.success === "boolean") toolSuccess = meta.success;
  }

  return {
    ts: parseTs(str("ts"), fallbackTs),
    tsRaw: str("ts"),
    level: str("level"),
    cat,
    msg: str("msg") ?? "",
    runId: str("run_id"),
    workflowRef: metaStr("workflow_ref"),
    phaseId: str("phase_id"),
    subjectId: str("subject_id"),
    scheduleId: str("schedule_id"),
    durationMs: num("duration_ms") ?? (meta && typeof meta.duration_ms === "number" ? (meta.duration_ms as number) : null),
    exitCode: num("exit_code"),
    error: str("error"),
    model: str("model") ?? metaStr("model"),
    tool: str("tool") ?? metaStr("tool"),
    plugin: metaStr("plugin"),
    agent: metaStr("agent") ?? metaStr("agent_id"),
    role: str("role"),
    content: str("content") ?? metaStr("reason"),
    toolName,
    toolUseId,
    toolParams,
    toolResult,
    toolSuccess,
    verdict: metaStr("verdict"),
    commandProgram: metaStr("program"),
    commandArgs:
      (meta && Array.isArray(meta.args)
        ? (meta.args as unknown[]).filter((x): x is string => typeof x === "string")
        : []),
    source: "live",
  };
}

/** Collapse streaming-duplicate assistant messages. `llm.output` events are
 *  cumulative (each carries the full text so far) and `llm.complete` repeats
 *  the final text — so the same message renders many times. Keep only the
 *  fullest version of each streaming run, and drop globally-identical repeats. */
export function collapseStreamingMessages(
  events: NormalizedEvent[],
): NormalizedEvent[] {
  const isMsg = (e: NormalizedEvent) =>
    e.cat === "llm.output" || e.cat === "llm.complete";
  const msgText = (e: NormalizedEvent) => (e.content ?? e.msg ?? "").trim();

  const result: NormalizedEvent[] = [];
  let lastMsgIdx = -1; // index in `result` of the last message kept
  const seen = new Set<string>();

  for (const e of events) {
    if (!isMsg(e)) {
      result.push(e);
      continue;
    }
    const c = msgText(e);
    if (!c) continue;

    if (lastMsgIdx >= 0) {
      const prev = msgText(result[lastMsgIdx]!);
      // current extends the previous (streaming) → replace with fuller one
      if (c.startsWith(prev) || prev === c) {
        seen.delete(prev);
        seen.add(c);
        result[lastMsgIdx] = e;
        continue;
      }
      // previous already contains current (current is a shorter prefix) → skip
      if (prev.startsWith(c)) continue;
    }
    // global exact-duplicate guard (e.g. llm.output then llm.complete identical
    // but separated by other events)
    if (seen.has(c)) continue;
    seen.add(c);
    result.push(e);
    lastMsgIdx = result.length - 1;
  }
  return result;
}

/** Strong dedup across live + historical sources. */
export function dedupEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    const key = [
      e.tsRaw ?? e.ts.toString(),
      e.cat,
      e.runId ?? "",
      e.phaseId ?? "",
      (e.msg ?? "").slice(0, 120),
      e.durationMs ?? "",
      e.exitCode ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
