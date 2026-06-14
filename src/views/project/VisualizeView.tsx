import { useEffect, useMemo, useState } from "react";
import { Code2, Loader2, Play } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  invalidateLocalWorkflowsCache,
  localWorkflowFileRead,
  localWorkflowsRead,
  type BranchRoute,
  type PhaseSummary,
  type ScheduleSummary,
  type TriggerSummary,
  type WorkflowSummary,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import {
  animusWorkflowRun,
  animusWorkflowSetRouting,
  type RouteSpec,
} from "../../api/animus";
import {
  localWorkflowRuns,
  type WorkflowRunSummary,
} from "../../api/event_log";
import { relTime, statusColor } from "./journal/model";
import { useProjectAgentLiveStates } from "../../state/projectEvents";
import { useActiveProject } from "../../state/activeProject";
import type { AgentState } from "../../components/AgentFace";
import type { Project } from "../../types/contracts";

const LIVE_COLOR: Record<string, string> = {
  running: "var(--copper)",
  thinking: "var(--copper)",
  done: "var(--green)",
  error: "var(--crimson)",
  refusing: "var(--crimson)",
};

/** MiniMap dot color by node type / live state. */
function miniMapColor(node: Node): string {
  if (node.type === "workflow") return "var(--copper)";
  if (node.type === "trigger") return "var(--text-faint)";
  const live = (node.data as PhaseNodeData)?.liveState;
  if (live && LIVE_COLOR[live]) return LIVE_COLOR[live]!;
  return "var(--border-strong)";
}

interface PhaseNodeData extends Record<string, unknown> {
  label: string;
  mode: string | null;
  agent: string | null;
  workflowRef: string | null;
  liveState?: AgentState | null;
  /** Run-overlay: phase not exercised by the selected run (render faded). */
  dimmed?: boolean;
  /** Run-overlay: times this phase ran in the selected run (>1 = rework). */
  attempts?: number;
}
interface WorkflowNodeData extends Record<string, unknown> {
  name: string;
  id: string;
  phaseCount: number;
  running?: boolean;
  onRun?: () => void;
}
interface TriggerNodeData extends Record<string, unknown> {
  label: string;
  detail: string;
}

const MODE_COLOR: Record<string, string> = {
  agent: "var(--accent)",
  command: "var(--green)",
  manual: "var(--yellow)",
  ref: "var(--copper)",
};

function colorFor(mode: string | null | undefined): string {
  if (!mode) return "var(--gray)";
  return MODE_COLOR[mode] ?? "var(--gray)";
}

function PhaseNode({ data }: NodeProps) {
  const d = data as PhaseNodeData;
  const live = d.liveState && d.liveState !== "idle" ? d.liveState : null;
  const liveColor = live ? LIVE_COLOR[live] : null;
  return (
    <div
      className={`rf-phase-node ${live ? "rf-phase-node--live" : ""} ${d.dimmed ? "rf-phase-node--dim" : ""}`}
      style={liveColor ? { borderColor: liveColor } : undefined}
    >
      {!!d.attempts && d.attempts > 1 && (
        <span className="rf-phase-node__attempts" title={`Ran ${d.attempts}× in this run (rework)`}>
          ×{d.attempts}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-phase-node__head">
        {live === "running" || live === "thinking" ? (
          <Loader2 size={12} className="rf-spin" style={{ color: liveColor ?? "var(--copper)" }} />
        ) : (
          <span
            aria-hidden
            className="rf-phase-node__dot"
            style={{ background: liveColor ?? colorFor(d.mode) }}
          />
        )}
        <span className="rf-phase-node__title">{d.label}</span>
        {live && <span className="rf-phase-node__live">{live}</span>}
      </div>
      <div className="rf-phase-node__meta">
        {d.agent && <span>@{d.agent}</span>}
        {d.mode && d.mode !== "agent" && <span>· {d.mode}</span>}
        {d.workflowRef && <span>↳ {d.workflowRef}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="rf-handle" />
      {/* Dedicated bottom handles so rework / back-branch edges bow BELOW the
          spine instead of overlapping it. */}
      <Handle
        type="source"
        id="loop-out"
        position={Position.Bottom}
        className="rf-handle rf-handle--loop"
        style={{ left: "68%" }}
      />
      <Handle
        type="target"
        id="loop-in"
        position={Position.Bottom}
        className="rf-handle rf-handle--loop"
        style={{ left: "32%" }}
      />
    </div>
  );
}

function WorkflowNode({ data }: NodeProps) {
  const d = data as WorkflowNodeData;
  return (
    <div className="rf-workflow-node">
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-workflow-node__title">{d.name}</div>
      <code className="rf-workflow-node__id">{d.id}</code>
      <div className="rf-workflow-node__meta">
        {d.phaseCount} phase{d.phaseCount === 1 ? "" : "s"}
      </div>
      {d.onRun && (
        <button
          type="button"
          className="rf-workflow-node__run"
          disabled={d.running}
          onClick={(e) => {
            e.stopPropagation();
            d.onRun?.();
          }}
        >
          {d.running ? (
            <>
              <Loader2 size={11} className="rf-spin" /> Running…
            </>
          ) : (
            <>
              <Play size={11} /> Run
            </>
          )}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

function TriggerNode({ data }: NodeProps) {
  const d = data as TriggerNodeData;
  return (
    <div
      className="rf-workflow-node"
      style={{
        borderColor: "var(--copper)",
        background: "var(--copper-bg-soft)",
      }}
    >
      <div className="rf-workflow-node__title" style={{ color: "var(--copper)" }}>
        {d.label}
      </div>
      <div className="rf-workflow-node__meta">{d.detail}</div>
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

const NODE_TYPES = {
  phase: PhaseNode,
  workflow: WorkflowNode,
  trigger: TriggerNode,
};

interface RunOverlay {
  /** phase value -> number of times it executed in the selected run. */
  attempts: Map<string, number>;
  taken: Set<string>;
}

function buildGraph(
  report: WorkflowYamlReport,
  agentStates: Record<string, AgentState>,
  runningWf: string | null,
  onRun: (id: string) => void,
  overlay: RunOverlay | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const dimEdge = (e: Edge): Edge =>
    overlay
      ? {
          ...e,
          animated: false,
          style: {
            ...(e.style ?? {}),
            opacity: 0.22,
            strokeDasharray: "4 4",
          },
        }
      : e;

  const ROW_HEIGHT = 170;
  const PHASE_GAP = 220;
  const TRIGGER_X = -260;
  const WORKFLOW_X = 0;
  const FIRST_PHASE_X = 290;

  const phaseById = new Map<string, PhaseSummary>(
    report.phases.map((p) => [p.id, p]),
  );

  // Map workflow id -> y row, drawing in declaration order.
  const wfRow = new Map<string, number>();
  report.workflows.forEach((wf: WorkflowSummary, idx: number) => {
    wfRow.set(wf.id, idx);

    const y = idx * ROW_HEIGHT;
    const wfNodeId = `wf:${wf.id}`;
    nodes.push({
      id: wfNodeId,
      type: "workflow",
      position: { x: WORKFLOW_X, y },
      data: {
        name: wf.name,
        id: wf.id,
        phaseCount: wf.phases.length,
        running: runningWf === wf.id,
        onRun: () => onRun(wf.id),
      } as WorkflowNodeData,
    });

    let prev = wfNodeId;
    const phaseNodeByValue = new Map<string, string>();
    const phaseIdxByValue = new Map<string, number>();
    const branchSpecs: {
      from: string;
      fromIdx: number;
      verdict: string;
      target: string;
      max: number | null;
    }[] = [];
    wf.phases.forEach((p, pIdx) => {
      const key = p.value;
      const ps = phaseById.get(key);
      const phaseNodeId = `${wfNodeId}:p:${pIdx}:${key}`;
      const isRef = p.kind === "workflow-ref";
      const live = ps?.agent ? agentStates[ps.agent] ?? null : null;
      const isActive = live === "running" || live === "thinking";
      const taken = !overlay || overlay.taken.has(key);
      const attempts = overlay?.attempts.get(key) ?? 0;
      nodes.push({
        id: phaseNodeId,
        type: "phase",
        position: { x: FIRST_PHASE_X + pIdx * PHASE_GAP, y: y + 20 },
        data: {
          label: key,
          mode: isRef ? "ref" : ps?.mode ?? null,
          agent: ps?.agent ?? null,
          workflowRef: isRef ? key : null,
          liveState: overlay ? null : live,
          dimmed: overlay ? !taken : false,
          attempts: attempts > 1 ? attempts : 0,
        } as PhaseNodeData,
      });
      // The spine edge lights up (copper + animated) when the phase it feeds
      // into is the one currently running — the "data flowing in" cue.
      const spine: Edge = {
        id: `${prev}->${phaseNodeId}`,
        source: prev,
        target: phaseNodeId,
        animated: isActive,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? "var(--copper)" : undefined,
        },
        style: {
          stroke: isActive ? "var(--copper)" : "var(--border-strong)",
          strokeWidth: isActive ? 1.75 : 1.25,
        },
      };
      edges.push(taken ? spine : dimEdge(spine));
      phaseNodeByValue.set(key, phaseNodeId);
      phaseIdxByValue.set(key, pIdx);
      // Every on_verdict route with a target phase becomes a branch edge.
      const routes = (p.branches ?? []).filter((b) => b.target);
      for (const b of routes) {
        branchSpecs.push({
          from: phaseNodeId,
          fromIdx: pIdx,
          verdict: b.verdict,
          target: b.target!,
          max: b.verdict === "rework" ? p.maxReworkAttempts : null,
        });
      }
      // Fall back to a bare reworkTarget if on_verdict wasn't expanded.
      if (p.reworkTarget && !routes.some((b) => b.verdict === "rework")) {
        branchSpecs.push({
          from: phaseNodeId,
          fromIdx: pIdx,
          verdict: "rework",
          target: p.reworkTarget,
          max: p.maxReworkAttempts,
        });
      }
      prev = phaseNodeId;
    });

    // Branch edges: approve/advance = green solid, rework = yellow dashed loop,
    // reject/fail = red. Routing is derived from on_verdict, not stored linear.
    // Back-edges (target sits at or before the source) route through the
    // dedicated bottom handles so the loop bows BELOW the spine — never over it.
    for (const spec of branchSpecs) {
      const targetNode = phaseNodeByValue.get(spec.target);
      if (!targetNode) continue;
      const v = spec.verdict.toLowerCase();
      const isRework = v === "rework";
      const isFail = v === "fail" || v === "reject";
      const targetIdx = phaseIdxByValue.get(spec.target) ?? spec.fromIdx + 1;
      const isBack = targetIdx <= spec.fromIdx;
      const color = isRework
        ? "var(--yellow)"
        : isFail
          ? "var(--crimson)"
          : v === "approve" || v === "advance" || v === "pass"
            ? "var(--green)"
            : "var(--copper)";
      const branchEdge: Edge = {
        id: `branch:${spec.from}:${v}->${targetNode}`,
        source: spec.from,
        target: targetNode,
        ...(isBack
          ? { sourceHandle: "loop-out", targetHandle: "loop-in", type: "smoothstep" }
          : { type: "default" }),
        animated: isRework,
        label: isRework && spec.max ? `rework ×${spec.max}` : spec.verdict,
        style: {
          stroke: color,
          strokeWidth: 1.25,
          ...(isRework || isFail ? { strokeDasharray: "5 4" } : {}),
        },
        labelStyle: { fill: color, fontSize: 10 },
        labelBgStyle: { fill: "var(--bg-elevated)", fillOpacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      };
      // In a run overlay, dim any branch whose source or target phase the run
      // didn't exercise — leaving the route actually taken at full strength.
      const bothTaken =
        !overlay ||
        (overlay.taken.has(spec.target) &&
          [...overlay.attempts.keys()].length > 0 &&
          // source phase value is encoded in the node id suffix
          overlay.taken.has(spec.from.split(":").pop() ?? ""));
      edges.push(bothTaken ? branchEdge : dimEdge(branchEdge));
    }
  });

  // Triggers + schedules → workflow edges (left-of-workflow column).
  const triggerY = new Map<string, number>();
  let triggerSlot = 0;
  const addTrigger = (
    sourceLabel: string,
    detail: string,
    targetWorkflow: string | null,
    nodeIdPrefix: string,
  ) => {
    if (!targetWorkflow) return;
    const row = wfRow.get(targetWorkflow);
    if (row === undefined) return;
    const y = row * ROW_HEIGHT;
    const nodeId = `${nodeIdPrefix}:${triggerSlot++}`;
    triggerY.set(nodeId, y);
    nodes.push({
      id: nodeId,
      type: "trigger",
      position: { x: TRIGGER_X, y: y + 10 },
      data: { label: sourceLabel, detail } as TriggerNodeData,
    });
    edges.push({
      id: `${nodeId}->wf:${targetWorkflow}`,
      source: nodeId,
      target: `wf:${targetWorkflow}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--copper)", strokeWidth: 1.25 },
    });
  };

  report.schedules.forEach((s: ScheduleSummary) => {
    addTrigger(
      "schedule",
      s.cron ?? "—",
      s.workflow,
      "sched",
    );
  });
  report.triggers.forEach((t: TriggerSummary) => {
    addTrigger(
      t.kind ?? "trigger",
      t.path ?? "",
      t.workflow,
      "trig",
    );
  });

  return { nodes, edges };
}

/** Airflow-style grid: runs are columns, phases are rows, cells are status
 *  squares (colored by the run's status). A scannable run-history overview. */
function GridOfRuns({ runs, now }: { runs: WorkflowRunSummary[]; now: number }) {
  if (runs.length === 0) {
    return <div className="rf-grid rf-grid--empty">No runs recorded yet.</div>;
  }
  const cols = runs.slice(0, 24);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of cols) for (const p of r.phases) if (!seen.has(p)) { seen.add(p); order.push(p); }
  return (
    <div className="rf-grid">
      <table className="rf-grid__table">
        <thead>
          <tr>
            <th className="rf-grid__corner">phase \ run</th>
            {cols.map((r, i) => (
              <th
                key={i}
                className="rf-grid__colhead"
                title={`${r.workflowRef ?? "run"} · ${r.status}`}
              >
                <span className="rf-grid__sq" style={{ background: statusColor(r.status) }} />
                <span className="rf-grid__time">
                  {r.startedMs ? relTime(now, r.startedMs) : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((ph) => (
            <tr key={ph}>
              <td className="rf-grid__rowhead" title={ph}>{ph}</td>
              {cols.map((r, i) => (
                <td key={i} className="rf-grid__cell">
                  {r.phases.includes(ph) && (
                    <span
                      className="rf-grid__sq"
                      style={{ background: statusColor(r.status) }}
                      title={r.status}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Timeline / Gantt of recent runs: one bar per run positioned by start time,
 *  width by duration, colored by status. Surfaces cadence, duration, and gaps —
 *  the time dimension the grid can't show. */
function GanttOfRuns({
  runs,
  now,
  onPick,
}: {
  runs: WorkflowRunSummary[];
  now: number;
  onPick: (uuid: string) => void;
}) {
  const rows = runs.slice(0, 40).filter((r) => r.startedMs > 0);
  if (rows.length === 0) {
    return <div className="rf-grid rf-grid--empty">No timed runs recorded yet.</div>;
  }
  const endOf = (r: WorkflowRunSummary): number => {
    const e = r.endedTs ? Date.parse(r.endedTs) : NaN;
    return Number.isFinite(e) ? e : Math.min(now, r.startedMs + 1000);
  };
  const minStart = Math.min(...rows.map((r) => r.startedMs));
  const maxEnd = Math.max(...rows.map(endOf), minStart + 1);
  const span = Math.max(1, maxEnd - minStart);
  const fmtDur = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };
  return (
    <div className="rf-gantt">
      <div className="rf-gantt__axis">
        <span>{relTime(now, minStart)}</span>
        <span>{maxEnd >= now - 1000 ? "now" : relTime(now, maxEnd)}</span>
      </div>
      <div className="rf-gantt__rows">
        {rows.map((r) => {
          const end = endOf(r);
          const left = ((r.startedMs - minStart) / span) * 100;
          const width = Math.max(1.5, ((end - r.startedMs) / span) * 100);
          const running = r.status === "running";
          return (
            <button
              key={r.wfUuid}
              type="button"
              className="rf-gantt__row"
              onClick={() => onPick(r.wfUuid)}
              title={`${r.workflowRef ?? "run"} · ${r.status} · ${fmtDur(end - r.startedMs)}`}
            >
              <span className="rf-gantt__label">{r.workflowRef ?? "run"}</span>
              <span className="rf-gantt__track">
                <span
                  className={`rf-gantt__bar ${running ? "rf-gantt__bar--running" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: statusColor(r.status),
                  }}
                >
                  <span className="rf-gantt__dur">{fmtDur(end - r.startedMs)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type RouteChoice =
  | { kind: "default" }
  | { kind: "phase"; value: string };

function routeToChoice(b: BranchRoute | undefined): RouteChoice {
  if (!b) return { kind: "default" };
  if (b.target) return { kind: "phase", value: b.target };
  return { kind: "default" };
}

/** Per-verdict routing editor for one phase of a project-created workflow.
 *  Each decision verdict maps to: continue normally (the engine's default —
 *  advance on approve, halt on reject), or jump back/forward to a named phase.
 *  Saves the full on_verdict map via set_routing. (animus 0.5.14 routes accept
 *  only a phase `target`; terminal verdicts are expressed by leaving them
 *  on the default.) */
function RoutingEditor({
  path,
  workflowId,
  phaseId,
  verdicts,
  phaseOptions,
  current,
  maxAttempts,
  onSaved,
}: {
  path: string;
  workflowId: string;
  phaseId: string;
  verdicts: string[];
  phaseOptions: string[];
  current: BranchRoute[];
  maxAttempts: number | null;
  onSaved: () => void;
}) {
  const initial = useMemo(() => {
    const byVerdict = new Map(current.map((b) => [b.verdict, b]));
    const m: Record<string, RouteChoice> = {};
    for (const v of verdicts) m[v] = routeToChoice(byVerdict.get(v));
    return m;
  }, [current, verdicts]);

  const [choices, setChoices] = useState<Record<string, RouteChoice>>(initial);
  const [maxAttemptsInput, setMaxAttemptsInput] = useState(
    maxAttempts != null ? String(maxAttempts) : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setChoices(initial);
    setMaxAttemptsInput(maxAttempts != null ? String(maxAttempts) : "");
    setMsg(null);
  }, [initial, maxAttempts, phaseId]);

  const hasRework = Object.entries(choices).some(
    ([v, c]) => v === "rework" && c.kind !== "default",
  );

  function setChoice(verdict: string, value: string) {
    setChoices((prev) => {
      const choice: RouteChoice =
        value === "__default"
          ? { kind: "default" }
          : { kind: "phase", value: value.slice("phase:".length) };
      return { ...prev, [verdict]: choice };
    });
  }

  function choiceValue(c: RouteChoice): string {
    if (c.kind === "default") return "__default";
    return `phase:${c.value}`;
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const routes: RouteSpec[] = [];
    for (const v of verdicts) {
      const c = choices[v];
      if (!c || c.kind === "default") continue;
      routes.push({ verdict: v, target: c.value });
    }
    const max = Number.parseInt(maxAttemptsInput, 10);
    try {
      await animusWorkflowSetRouting(path, workflowId, [
        {
          phase: phaseId,
          maxAttempts: Number.isFinite(max) && max > 0 ? max : null,
          routes,
        },
      ]);
      invalidateLocalWorkflowsCache(path);
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sk-detail__section wf-route">
      <div className="sk-detail__label">Branch routing</div>
      {verdicts.map((v) => (
        <label key={v} className="wf-route__row">
          <span className={`wf-route__verdict wf-route__verdict--${v.toLowerCase()}`}>
            {v}
          </span>
          <select
            className="wf-route__select"
            value={choiceValue(choices[v] ?? { kind: "default" })}
            onChange={(e) => setChoice(v, e.target.value)}
            disabled={busy}
          >
            <option value="__default">↦ default (advance / halt)</option>
            <optgroup label="Jump to phase">
              {phaseOptions.map((pid) => (
                <option key={pid} value={`phase:${pid}`}>
                  → {pid}
                  {pid === phaseId ? " (loop)" : ""}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ))}
      {hasRework && (
        <label className="wf-route__row">
          <span className="wf-route__verdict">max rework</span>
          <input
            className="wf-route__select"
            type="number"
            min={1}
            value={maxAttemptsInput}
            onChange={(e) => setMaxAttemptsInput(e.target.value)}
            placeholder="∞"
            disabled={busy}
            style={{ width: 80 }}
          />
        </label>
      )}
      <div className="wf-route__foot">
        {msg && <span className="wf-route__msg">{msg}</span>}
        <button
          type="button"
          className="workflow-row__run"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save routing"}
        </button>
      </div>
    </div>
  );
}

export function VisualizeView({ project }: { project: Project }) {
  const [report, setReport] = useState<WorkflowYamlReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "gantt" | "grid">("graph");
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [overlayRun, setOverlayRun] = useState<string | null>(null);
  const [sourceWf, setSourceWf] = useState<WorkflowSummary | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const agentStates = useProjectAgentLiveStates(project.id);

  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) return;
    localWorkflowRuns({ repoPath: path, limit: 200 })
      .then(setRuns)
      .catch(() => {});
  }, [project.repo_path]);
  const setMode = useActiveProject((s) => s.setMode);
  const liveOf = (agent: string): string | null => {
    const s = agentStates[agent];
    return s && s !== "idle" ? s : null;
  };

  const runWorkflow = (id: string) => {
    const path = project.repo_path?.trim();
    if (!path) return;
    setRunning(id);
    setRunMsg(null);
    animusWorkflowRun(path, id)
      .then((res) => {
        setRunMsg(
          res.ok ? `Enqueued ${id}.` : `Run failed: ${res.rawStderr || "see logs"}`,
        );
      })
      .catch((e) => setRunMsg(String(e)))
      .finally(() => setRunning(null));
  };

  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) {
      setError("This project has no folder path on disk.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    localWorkflowsRead(path)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project.repo_path]);

  // When a past run is selected, build a per-phase attempt count + a taken-set
  // to overlay on the definition graph (dim untaken, badge reworked phases).
  const overlay = useMemo((): RunOverlay | null => {
    if (!overlayRun) return null;
    const run = runs.find((r) => r.wfUuid === overlayRun);
    if (!run) return null;
    const attempts = new Map<string, number>();
    for (const p of run.phases) attempts.set(p, (attempts.get(p) ?? 0) + 1);
    return { attempts, taken: new Set(run.phases) };
  }, [overlayRun, runs]);

  const { nodes, edges } = useMemo(() => {
    if (!report) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildGraph(report, agentStates, running, runWorkflow, overlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, agentStates, running, overlay]);

  const reloadReport = () => {
    const path = project.repo_path?.trim();
    if (!path) return;
    invalidateLocalWorkflowsCache(path);
    localWorkflowsRead(path)
      .then(setReport)
      .catch((e) => setError(String(e)));
  };

  // Load the YAML source for the workflow whose node was clicked — the canvas↔
  // YAML pairing (read-only; the canvas is a projection of this file).
  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!sourceWf || !path) {
      setSourceText(null);
      return;
    }
    let cancelled = false;
    setSourceText("Loading…");
    localWorkflowFileRead(path, sourceWf.sourceFile)
      .then((t) => !cancelled && setSourceText(t))
      .catch((e) => !cancelled && setSourceText(`Couldn't read source: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, [sourceWf, project.repo_path]);

  const selectedPhase = report?.phases.find((p) => p.id === selected) ?? null;

  // The (editable, project-created) workflow this phase belongs to, plus the
  // phase ids available as branch targets. Routing is only writable on the
  // generated overlay produced by the desktop builder.
  const routingCtx = (() => {
    if (!report || !selectedPhase) return null;
    const verdicts = selectedPhase.decisionVerdicts ?? [];
    if (verdicts.length === 0) return null;
    const wf = report.workflows.find((w) =>
      w.phases.some((p) => p.kind === "phase" && p.value === selectedPhase.id),
    );
    if (!wf) return null;
    const editable = wf.sourceFile.endsWith("generated-workflow.yaml");
    const ref = wf.phases.find(
      (p) => p.kind === "phase" && p.value === selectedPhase.id,
    );
    const phaseOptions = wf.phases
      .filter((p) => p.kind === "phase")
      .map((p) => p.value);
    return {
      workflowId: wf.id,
      editable,
      verdicts,
      phaseOptions,
      current: ref?.branches ?? [],
      maxAttempts: ref?.maxReworkAttempts ?? null,
    };
  })();

  if (loading && !report) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Building graph…
      </p>
    );
  }
  if (error) {
    return (
      <div className="workflow-error">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Couldn't read workflow files
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
      </div>
    );
  }
  if (!report) return null;

  if (report.workflows.length === 0) {
    return (
      <div className="workflow-error" style={{ background: "var(--bg-elevated)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          No workflows to draw
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Add a <code>workflows:</code> block to{" "}
          <code>.animus/workflows.yaml</code> or drop a file under{" "}
          <code>.animus/workflows/</code>.
        </p>
        {report.errors.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 11, color: "var(--crimson)" }}>
            {report.errors.map((e, i) => (
              <li key={i} style={{ fontFamily: "var(--font-mono)" }}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rf-shell">
      <div className="rf-toolbar">
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {report.workflows.length} workflow
          {report.workflows.length === 1 ? "" : "s"} ·{" "}
          {report.triggers.length + report.schedules.length} trigger
          {report.triggers.length + report.schedules.length === 1 ? "" : "s"}
        </span>
        {report.errors.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--crimson)" }}>
            {report.errors.length} file
            {report.errors.length === 1 ? "" : "s"} failed to parse
          </span>
        )}
        {runMsg && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{runMsg}</span>
        )}
        {view === "graph" && runs.length > 0 && (
          <label className="rf-runpick" style={{ marginLeft: "auto" }}>
            <span className="rf-runpick__label">Overlay run</span>
            <select
              className="rf-runpick__select"
              value={overlayRun ?? ""}
              onChange={(e) => setOverlayRun(e.target.value || null)}
            >
              <option value="">Definition (no run)</option>
              {runs.slice(0, 40).map((r) => (
                <option key={r.wfUuid} value={r.wfUuid}>
                  {(r.workflowRef ?? "run")} · {r.status} · {relTime(now, r.startedMs)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          className="wf-seg wf-seg--sm"
          style={view !== "graph" || runs.length === 0 ? { marginLeft: "auto" } : undefined}
        >
          <button
            type="button"
            className={view === "graph" ? "wf-seg__on" : ""}
            onClick={() => setView("graph")}
          >
            Graph
          </button>
          <button
            type="button"
            className={view === "gantt" ? "wf-seg__on" : ""}
            onClick={() => setView("gantt")}
          >
            Gantt
          </button>
          <button
            type="button"
            className={view === "grid" ? "wf-seg__on" : ""}
            onClick={() => setView("grid")}
          >
            Grid
          </button>
        </div>
      </div>
      {view === "grid" ? (
        <GridOfRuns runs={runs} now={now} />
      ) : view === "gantt" ? (
        <GanttOfRuns
          runs={runs}
          now={now}
          onPick={(uuid) => {
            setOverlayRun(uuid);
            setView("graph");
          }}
        />
      ) : (
      <div className="rf-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => {
            if (node.type === "phase") {
              const d = node.data as PhaseNodeData;
              setSelected(typeof d.label === "string" ? d.label : null);
            } else if (node.type === "workflow") {
              const d = node.data as WorkflowNodeData;
              const wf = report.workflows.find((w) => w.id === d.id) ?? null;
              setSourceWf(wf);
            }
          }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => miniMapColor(n)}
            nodeStrokeWidth={0}
          />
        </ReactFlow>
        {selectedPhase && (
          <aside className="wf-cfg">
            <header className="wf-cfg__head">
              <span className="wf-cfg__title">{selectedPhase.id}</span>
              <button
                type="button"
                className="wf-cfg__x"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="wf-cfg__body">
              <div className="rt-row">
                <span className="rt-row__role">mode</span>
                <span className="rt-row__name">{selectedPhase.mode ?? "—"}</span>
              </div>
              {selectedPhase.agent && (
                <div className="rt-row">
                  <span className="rt-row__role">agent</span>
                  <span className="rt-row__name">@{selectedPhase.agent}</span>
                  {liveOf(selectedPhase.agent) && (
                    <span className="rf-phase-node__live">{liveOf(selectedPhase.agent)}</span>
                  )}
                </div>
              )}
              {selectedPhase.command && (
                <div className="rt-row">
                  <span className="rt-row__role">run</span>
                  <code className="rt-row__name">
                    {selectedPhase.command} {selectedPhase.commandArgs.join(" ")}
                  </code>
                </div>
              )}
              {(selectedPhase.decisionVerdicts?.length ?? 0) > 0 && (
                <div className="rt-row">
                  <span className="rt-row__role">verdicts</span>
                  <span className="wf-cfg__chips">
                    {selectedPhase.decisionVerdicts.map((v) => (
                      <span key={v} className={`wf-cfg__chip wf-cfg__chip--${v.toLowerCase()}`}>
                        {v}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {selectedPhase.directive && (
                <div className="sk-detail__section">
                  <div className="sk-detail__label">Directive</div>
                  <pre className="sk-detail__prompt">{selectedPhase.directive}</pre>
                </div>
              )}
              {overlay &&
                (() => {
                  const run = runs.find((r) => r.wfUuid === overlayRun);
                  const attempts = overlay.attempts.get(selectedPhase.id) ?? 0;
                  const taken = overlay.taken.has(selectedPhase.id);
                  if (!run) return null;
                  return (
                    <div className="sk-detail__section">
                      <div className="sk-detail__label">In selected run</div>
                      <div className="rt-row">
                        <span className="rt-row__role">status</span>
                        <span
                          className="rt-row__name"
                          style={{ color: taken ? statusColor(run.status) : "var(--text-faint)" }}
                        >
                          {taken ? run.status : "not exercised"}
                        </span>
                      </div>
                      {attempts > 0 && (
                        <div className="rt-row">
                          <span className="rt-row__role">ran</span>
                          <span className="rt-row__name">
                            ×{attempts}
                            {attempts > 1 ? " (rework)" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              <button
                type="button"
                className="plugins-pane__ghost"
                onClick={() => setMode("journal")}
              >
                {overlay ? "Open this run in Journal →" : "Open run in Journal →"}
              </button>
              {routingCtx &&
                (routingCtx.editable ? (
                  <RoutingEditor
                    path={project.repo_path?.trim() ?? ""}
                    workflowId={routingCtx.workflowId}
                    phaseId={selectedPhase.id}
                    verdicts={routingCtx.verdicts}
                    phaseOptions={routingCtx.phaseOptions}
                    current={routingCtx.current}
                    maxAttempts={routingCtx.maxAttempts}
                    onSaved={reloadReport}
                  />
                ) : (
                  <p className="aj-muted" style={{ fontSize: 11 }}>
                    This phase has a decision gate ({routingCtx.verdicts.join(", ")}).
                    Routing is only editable on workflows created in this project's
                    builder.
                  </p>
                ))}
            </div>
          </aside>
        )}
        {sourceWf && (
          <aside className="wf-cfg wf-cfg--source">
            <header className="wf-cfg__head">
              <span className="wf-cfg__title">
                <Code2 size={13} /> {sourceWf.id}.yaml
              </span>
              <button
                type="button"
                className="wf-cfg__x"
                onClick={() => setSourceWf(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="wf-cfg__body">
              <p className="aj-muted" style={{ fontSize: 11, margin: 0 }}>
                {sourceWf.sourceFile} — the canvas is a projection of this file.
              </p>
              <pre className="wf-source">{sourceText ?? ""}</pre>
            </div>
          </aside>
        )}
      </div>
      )}
    </div>
  );
}
