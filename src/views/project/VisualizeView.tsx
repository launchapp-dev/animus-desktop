import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  localWorkflowsRead,
  type PhaseSummary,
  type ScheduleSummary,
  type TriggerSummary,
  type WorkflowSummary,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import { animusWorkflowRun } from "../../api/animus";
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

interface PhaseNodeData extends Record<string, unknown> {
  label: string;
  mode: string | null;
  agent: string | null;
  workflowRef: string | null;
  liveState?: AgentState | null;
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
      className={`rf-phase-node ${live ? "rf-phase-node--live" : ""}`}
      style={liveColor ? { borderColor: liveColor } : undefined}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-phase-node__head">
        <span
          aria-hidden
          className={`rf-phase-node__dot ${live === "running" || live === "thinking" ? "rf-phase-node__dot--pulse" : ""}`}
          style={{ background: liveColor ?? colorFor(d.mode) }}
        />
        <span className="rf-phase-node__title">{d.label}</span>
        {live && <span className="rf-phase-node__live">{live}</span>}
      </div>
      <div className="rf-phase-node__meta">
        {d.agent && <span>@{d.agent}</span>}
        {d.mode && d.mode !== "agent" && <span>· {d.mode}</span>}
        {d.workflowRef && <span>↳ {d.workflowRef}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="rf-handle" />
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
          {d.running ? "Running…" : "▶ Run"}
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

function buildGraph(
  report: WorkflowYamlReport,
  agentStates: Record<string, AgentState>,
  runningWf: string | null,
  onRun: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

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
    wf.phases.forEach((p, pIdx) => {
      const key = p.value;
      const ps = phaseById.get(key);
      const phaseNodeId = `${wfNodeId}:p:${pIdx}:${key}`;
      const isRef = p.kind === "workflow-ref";
      nodes.push({
        id: phaseNodeId,
        type: "phase",
        position: { x: FIRST_PHASE_X + pIdx * PHASE_GAP, y: y + 20 },
        data: {
          label: key,
          mode: isRef ? "ref" : ps?.mode ?? null,
          agent: ps?.agent ?? null,
          workflowRef: isRef ? key : null,
          liveState: ps?.agent ? agentStates[ps.agent] ?? null : null,
        } as PhaseNodeData,
      });
      edges.push({
        id: `${prev}->${phaseNodeId}`,
        source: prev,
        target: phaseNodeId,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "var(--border-strong)", strokeWidth: 1.25 },
      });
      prev = phaseNodeId;
    });
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

export function VisualizeView({ project }: { project: Project }) {
  const [report, setReport] = useState<WorkflowYamlReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [gridMode, setGridMode] = useState(false);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
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

  const { nodes, edges } = useMemo(() => {
    if (!report) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildGraph(report, agentStates, running, runWorkflow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, agentStates, running]);

  const selectedPhase = report?.phases.find((p) => p.id === selected) ?? null;

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
        <div className="wf-seg wf-seg--sm" style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className={!gridMode ? "wf-seg__on" : ""}
            onClick={() => setGridMode(false)}
          >
            Graph
          </button>
          <button
            type="button"
            className={gridMode ? "wf-seg__on" : ""}
            onClick={() => setGridMode(true)}
          >
            Grid
          </button>
        </div>
      </div>
      {gridMode ? (
        <GridOfRuns runs={runs} now={now} />
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
            }
          }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="var(--bg-tint-5)" />
          <Controls position="bottom-right" />
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
              {selectedPhase.directive && (
                <div className="sk-detail__section">
                  <div className="sk-detail__label">Directive</div>
                  <pre className="sk-detail__prompt">{selectedPhase.directive}</pre>
                </div>
              )}
              <button
                type="button"
                className="plugins-pane__ghost"
                onClick={() => setMode("journal")}
              >
                Open run in Journal →
              </button>
              {(selectedPhase.decisionVerdicts?.length ?? 0) > 0 && (
                <p className="aj-muted" style={{ fontSize: 11 }}>
                  This phase has a decision gate — approve/reject a paused run from
                  the Journal tab.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
      )}
    </div>
  );
}
