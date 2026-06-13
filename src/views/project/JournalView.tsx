import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentFace } from "../../components/AgentFace";
import {
  useProjectEvents,
  useProjectEventsBucket,
} from "../../state/projectEvents";
import {
  invalidateLocalWorkflowsCache,
  localWorkflowsRead,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import {
  localWorkflowRuns,
  localRunTranscript,
  type WorkflowRunSummary,
  type HistoricalEvent,
} from "../../api/event_log";
import { animusPhaseGate } from "../../api/animus";
import type { Project } from "../../types/contracts";
import {
  ALL_CATS,
  collapseStreamingMessages,
  dedupEvents,
  formatDuration,
  fromCycleEvent,
  fromHistoricalEvent,
  relTime,
  statusColor,
  statusToAgentState,
  type NormalizedEvent,
} from "./journal/model";
import { Transcript } from "./journal/Transcript";

type RunStatusFilter = "all" | "completed" | "failed";

const RUNS_PAGE = 80;

/** Bucket a run's start time into a human day label for list dividers. */
function dayLabel(now: number, startedMs: number | null): string {
  if (!startedMs) return "Undated";
  const d = new Date(startedMs);
  const today = new Date(now);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(today) - startOfDay(d)) / 86_400_000,
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Resolve which agents touched a run from its phases + the phase→agent map. */
function runAgents(
  run: WorkflowRunSummary,
  agentByPhase: Record<string, string>,
): string[] {
  const s = new Set<string>();
  for (const p of run.phases) {
    const a = agentByPhase[p];
    if (a) s.add(a);
  }
  return Array.from(s);
}

function RunListItem({
  run,
  agents,
  active,
  now,
  onClick,
}: {
  run: WorkflowRunSummary;
  agents: string[];
  active: boolean;
  now: number;
  onClick: () => void;
}) {
  const dur =
    run.startedTs && run.endedTs
      ? Date.parse(run.endedTs) - Date.parse(run.startedTs)
      : null;
  return (
    <button
      type="button"
      className={`runitem ${active ? "runitem--active" : ""} runitem--${run.status}`}
      onClick={onClick}
    >
      <span
        className="runitem__dot"
        style={{ background: statusColor(run.status) }}
        aria-hidden
      />
      <div className="runitem__body">
        <div className="runitem__title">{run.workflowRef ?? run.phases[0] ?? "run"}</div>
        <div className="runitem__meta">
          <span>{run.startedMs ? relTime(now, run.startedMs) : ""}</span>
          {dur != null && dur > 0 && (
            <>
              <span className="runitem__sep">·</span>
              <span>{formatDuration(dur)}</span>
            </>
          )}
          <span className="runitem__sep">·</span>
          <span>{run.phases.length}ph</span>
          {run.subjectId && (
            <>
              <span className="runitem__sep">·</span>
              <span className="runitem__subject" title={run.subjectId}>
                {run.subjectId}
              </span>
            </>
          )}
          {run.errorCount > 0 && (
            <>
              <span className="runitem__sep">·</span>
              <span style={{ color: "var(--crimson)" }}>{run.errorCount} err</span>
            </>
          )}
        </div>
      </div>
      <div className="runitem__agents">
        {agents.slice(0, 3).map((a) => (
          <span key={a} className="runitem__avatar" title={`@${a}`}>
            <AgentFace seed={a} size={18} state={statusToAgentState(run.status)} />
          </span>
        ))}
      </div>
    </button>
  );
}

/** Build a transcript with synthetic phase dividers inserted whenever the
 *  phase_id changes (the per-run files carry only llm.* events). */
function buildTranscript(events: HistoricalEvent[]): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  let lastPhase: string | null = null;
  events.forEach((h, i) => {
    const ev = fromHistoricalEvent(h, Date.now() + i);
    if (ev.phaseId && ev.phaseId !== lastPhase) {
      lastPhase = ev.phaseId;
      out.push({
        ...ev,
        cat: "phase.start",
        msg: ev.phaseId,
        content: null,
        toolName: null,
        toolParams: null,
        toolResult: null,
        verdict: null,
        commandProgram: null,
        commandArgs: [],
      });
    }
    out.push(ev);
  });
  return collapseStreamingMessages(out);
}

/** Approve/Reject controls for a run paused on a phase gate. The CLI applies
 *  the decision to the named phase of the paused workflow; reject requires a
 *  note. Shown only while the run reports `paused`. */
function PhaseGateBar({
  run,
  repoPath,
  onDecided,
}: {
  run: WorkflowRunSummary;
  repoPath: string;
  onDecided: () => void;
}) {
  const [phase, setPhase] = useState(run.phases[run.phases.length - 1] ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    if (!phase) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await animusPhaseGate({
        path: repoPath,
        workflowId: run.wfUuid,
        phaseId: phase,
        decision,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(
          (res.error && typeof res.error === "object" && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : null) ?? res.rawStderr ?? "gate decision failed",
        );
      } else {
        onDecided();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="gate-bar">
      <span className="gate-bar__label">Paused on a phase gate</span>
      <select
        className="gate-bar__phase"
        value={phase}
        onChange={(e) => setPhase(e.target.value)}
      >
        {run.phases.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input
        className="gate-bar__note"
        placeholder="Note (required to reject)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        className="ix-allow"
        disabled={busy !== null || !phase}
        onClick={() => void decide("approve")}
      >
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>
      <button
        type="button"
        className="ix-deny"
        disabled={busy !== null || !phase || !note.trim()}
        title={!note.trim() ? "Rejection requires a note" : undefined}
        onClick={() => void decide("reject")}
      >
        {busy === "reject" ? "Rejecting…" : "Reject"}
      </button>
      {error && <span className="gate-bar__error">{error}</span>}
    </div>
  );
}

function RunDetail({
  run,
  agents,
  now,
  transcript,
  loading,
  repoPath,
  onGateDecided,
}: {
  run: WorkflowRunSummary;
  agents: string[];
  now: number;
  transcript: NormalizedEvent[];
  loading: boolean;
  repoPath: string;
  onGateDecided: () => void;
}) {
  const dur =
    run.startedTs && run.endedTs
      ? Date.parse(run.endedTs) - Date.parse(run.startedTs)
      : null;
  return (
    <div className="rundetail">
      <header className="rundetail__head">
        <div className="rundetail__title-block">
          <h2 className="rundetail__title">
            {run.workflowRef ?? run.phases[0] ?? "run"}
          </h2>
          <div className="rundetail__meta">
            <span
              className="rundetail__status"
              style={{
                color: statusColor(run.status),
                borderColor: statusColor(run.status),
              }}
            >
              {run.status}
            </span>
            {dur != null && dur > 0 && (
              <span className="rundetail__dur">{formatDuration(dur)}</span>
            )}
            <span className="rundetail__time">
              {run.startedMs ? relTime(now, run.startedMs) : ""}
            </span>
            {run.subjectId && (
              <span className="rundetail__chip">{run.subjectId}</span>
            )}
          </div>
        </div>
        <div className="rundetail__agents">
          {agents.map((a) => (
            <span key={a} className="rundetail__agent" title={`@${a}`}>
              <AgentFace seed={a} size={22} state={statusToAgentState(run.status)} />
              <span>@{a}</span>
            </span>
          ))}
        </div>
      </header>
      <div className="rundetail__stats">
        <span>{run.phases.length} phases</span>
        <span>{run.eventCount} events</span>
        {run.errorCount > 0 && (
          <span style={{ color: "var(--crimson)" }}>{run.errorCount} errors</span>
        )}
        <code className="rundetail__runid">{run.wfUuid}</code>
      </div>
      {run.status === "paused" && repoPath && (
        <PhaseGateBar run={run} repoPath={repoPath} onDecided={onGateDecided} />
      )}
      {loading ? (
        <p style={{ color: "var(--text-muted)", fontSize: 12, paddingTop: 12 }}>
          Loading transcript…
        </p>
      ) : transcript.length === 0 ? (
        <p style={{ color: "var(--text-faint)", fontSize: 12, paddingTop: 12 }}>
          No transcript recorded for this run.
        </p>
      ) : (
        <Transcript events={transcript} />
      )}
    </div>
  );
}

export function JournalView({ project }: { project: Project }) {
  const setAgentByPhase = useProjectEvents((s) => s.setAgentByPhase);
  const bucket = useProjectEventsBucket(project.id);
  const [now, setNow] = useState(() => Date.now());
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [agentByPhase, setAgentByPhaseLocal] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>("all");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<NormalizedEvent[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [visibleCount, setVisibleCount] = useState(RUNS_PAGE);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // phase→agent map from workflow YAML
  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) return;
    let cancelled = false;
    localWorkflowsRead(path)
      .then((report: WorkflowYamlReport) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of report.phases) if (p.agent) map[p.id] = p.agent;
        setAgentByPhaseLocal(map);
        setAgentByPhase(project.id, map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, project.repo_path, setAgentByPhase]);

  // Last-issued-wins token so a slow 500-run scan can't land after a newer
  // load and overwrite it with stale results.
  const runsSeq = useRef(0);
  const loadRuns = useCallback(async () => {
    const path = project.repo_path?.trim();
    if (!path) return;
    const seq = ++runsSeq.current;
    setLoadingRuns(true);
    try {
      invalidateLocalWorkflowsCache(path);
      const list = await localWorkflowRuns({ repoPath: path, limit: 500 });
      if (seq === runsSeq.current) setRuns(list);
    } catch (e) {
      console.warn("[journal] run index failed", e);
    } finally {
      if (seq === runsSeq.current) setLoadingRuns(false);
    }
  }, [project.repo_path]);

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.repo_path]);

  const allAgents = useMemo(() => {
    const s = new Set<string>();
    for (const r of runs) for (const a of runAgents(r, agentByPhase)) s.add(a);
    return Array.from(s).sort();
  }, [runs, agentByPhase]);

  const filteredRuns = useMemo(() => {
    let arr = runs;
    if (statusFilter !== "all") {
      arr = arr.filter((r) => r.status === statusFilter);
    }
    if (agentFilter !== "all") {
      arr = arr.filter((r) => runAgents(r, agentByPhase).includes(agentFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (r) =>
          (r.workflowRef ?? "").toLowerCase().includes(q) ||
          r.wfUuid.toLowerCase().includes(q) ||
          (r.subjectId ?? "").toLowerCase().includes(q) ||
          r.phases.some((p) => p.toLowerCase().includes(q)),
      );
    }
    return arr;
  }, [runs, statusFilter, agentFilter, search, agentByPhase]);

  // Keep the DOM bounded: render runs in pages, reset when filters change.
  useEffect(() => {
    setVisibleCount(RUNS_PAGE);
  }, [statusFilter, agentFilter, search]);
  const visibleRuns = useMemo(
    () => filteredRuns.slice(0, visibleCount),
    [filteredRuns, visibleCount],
  );

  const selectedRun = useMemo(() => {
    if (selectedUuid) {
      const f = filteredRuns.find((r) => r.wfUuid === selectedUuid);
      if (f) return f;
    }
    return filteredRuns[0] ?? null;
  }, [selectedUuid, filteredRuns]);

  // Live merge: events for this run arriving over the bridge (run_id-tagged)
  // get folded into its transcript so an in-progress run updates in real time.
  const liveForRun = useMemo<NormalizedEvent[]>(() => {
    if (!selectedRun) return [];
    // The run's per-phase run_ids; a live event belongs if its run_id matches
    // one of them OR shares the workflow uuid prefix.
    const idSet = new Set(selectedRun.runIds);
    const out: NormalizedEvent[] = [];
    bucket.cycles.forEach((c, i) => {
      if (!ALL_CATS.has(c.cat)) return;
      const rid = c.run_id ?? "";
      const belongs =
        (rid && idSet.has(rid)) ||
        (rid && rid.startsWith(`${selectedRun.wfUuid}-`));
      if (!belongs) return;
      out.push(fromCycleEvent(c, now - i * 100));
    });
    return out;
  }, [selectedRun, bucket.cycles, now]);

  const mergedTranscript = useMemo<NormalizedEvent[]>(() => {
    if (liveForRun.length === 0) return transcript;
    const all = dedupEvents([...transcript, ...liveForRun]);
    all.sort((a, b) => a.ts - b.ts);
    return all;
  }, [transcript, liveForRun]);

  // Load transcript when selection changes
  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path || !selectedRun) {
      setTranscript([]);
      return;
    }
    let cancelled = false;
    setLoadingTranscript(true);
    localRunTranscript({ repoPath: path, wfUuid: selectedRun.wfUuid })
      .then((events) => {
        if (cancelled) return;
        setTranscript(buildTranscript(events));
      })
      .catch(() => {
        if (!cancelled) setTranscript([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.repo_path, selectedRun?.wfUuid]);

  return (
    <div className="journal-master">
      <aside className="journal-master__list">
        <div className="journal-master__list-head">
          <input
            className="plugins-pane__search"
            placeholder="Search runs, phases, subjects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="journal-master__filters">
          {(["all", "completed", "failed"] as RunStatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`journal-filter ${statusFilter === s ? "journal-filter--active" : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            className="journal-filter"
            onClick={() => void loadRuns()}
            title="Reload"
          >
            ↻
          </button>
        </div>
        <div className="journal-master__filters">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="all">all agents</option>
            {allAgents.map((a) => (
              <option key={a} value={a}>
                @{a}
              </option>
            ))}
          </select>
        </div>
        <div className="journal-master__count">
          {filteredRuns.length} run{filteredRuns.length === 1 ? "" : "s"}
          {loadingRuns ? " · loading…" : ""}
        </div>
        <ul className="journal-master__runs">
          {filteredRuns.length === 0 ? (
            <li className="journal-master__empty">
              {loadingRuns ? "Loading runs…" : "No runs yet."}
            </li>
          ) : (
            visibleRuns.map((run, i) => {
              const label = dayLabel(now, run.startedMs);
              const prevLabel =
                i > 0 ? dayLabel(now, visibleRuns[i - 1]!.startedMs) : null;
              return (
                <li key={run.wfUuid}>
                  {label !== prevLabel && (
                    <div className="journal-master__day">{label}</div>
                  )}
                  <RunListItem
                    run={run}
                    agents={runAgents(run, agentByPhase)}
                    active={selectedRun?.wfUuid === run.wfUuid}
                    now={now}
                    onClick={() => setSelectedUuid(run.wfUuid)}
                  />
                </li>
              );
            })
          )}
          {filteredRuns.length > visibleCount && (
            <li>
              <button
                type="button"
                className="journal-master__more"
                onClick={() => setVisibleCount((c) => c + RUNS_PAGE)}
              >
                Show {Math.min(RUNS_PAGE, filteredRuns.length - visibleCount)}{" "}
                more of {filteredRuns.length - visibleCount}
              </button>
            </li>
          )}
        </ul>
      </aside>
      <section className="journal-master__detail">
        {selectedRun ? (
          <RunDetail
            run={selectedRun}
            agents={runAgents(selectedRun, agentByPhase)}
            now={now}
            transcript={mergedTranscript}
            loading={loadingTranscript}
            repoPath={project.repo_path?.trim() ?? ""}
            onGateDecided={() => void loadRuns()}
          />
        ) : (
          <div className="journal-empty">
            No runs yet. Workflow runs appear here once the daemon executes
            them — each shows its full agent transcript.
          </div>
        )}
      </section>
    </div>
  );
}

export default JournalView;
