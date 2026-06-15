import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Maximize2, Settings2, Trash2 } from "lucide-react";
import {
  localWorkflowsRead,
  localWorkflowFileRead,
  type CapabilityFlag,
  type PhaseRef,
  type PhaseSummary,
  type ScheduleSummary,
  type TriggerSummary,
  type WorkflowSummary,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import {
  animusWorkflowRun,
  animusStatusGet,
  animusWorkflowDefinitionUpsert,
  animusWorkflowPhaseGet,
  animusWorkflowPhaseUpsert,
  animusWorkflowSetRouting,
  type AnimusStatus,
  type PhaseRouting,
} from "../../api/animus";

// Canonical decision verdicts when a phase doesn't declare its own enum.
// Routing maps each verdict → a target phase (engine default: approve advances,
// reject halts, rework loops). animus accepts `target` only, no terminal action.
const DEFAULT_VERDICTS = ["approve", "rework", "reject"];
const VERDICT_HINT: Record<string, string> = {
  approve: "on pass",
  advance: "on pass",
  pass: "on pass",
  rework: "loop back",
  reject: "on fail",
  fail: "on fail",
};
import type { Project } from "../../types/contracts";
import { AgentFace, type AgentState } from "../../components/AgentFace";
import { useProjectAgentLiveStates } from "../../state/projectEvents";
import { localAgentCreate, emptyAgentUpdate } from "../../api/agent_edit";
import { chatProviders, type ProviderOption } from "../../api/chat";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useNodesState,
  type EdgeProps,
  type Node as RfNode,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";

type PhaseInfo = Record<
  string,
  {
    mode: string | null;
    agent: string | null;
    gate?: boolean;
    directive?: string | null;
  }
>;

interface LintIssue {
  level: "error" | "warn";
  message: string;
  phase?: string;
}

/** Design-time lint of a workflow being composed — surfaces problems before
 *  you run (most builders only catch these at runtime). */
function lintWorkflow(
  id: string,
  phases: string[],
  phaseInfo: PhaseInfo,
  agentIds: Set<string>,
  existingWorkflows: Set<string>,
): LintIssue[] {
  const out: LintIssue[] = [];
  if (!id.trim()) out.push({ level: "error", message: "Workflow id is required." });
  else if (!SLUG_RE.test(id.trim()))
    out.push({ level: "error", message: "Workflow id must be lowercase letters, digits, '-' or '_'." });
  if (phases.length === 0) out.push({ level: "error", message: "Add at least one phase." });
  if (id.trim() && existingWorkflows.has(id.trim()))
    out.push({ level: "warn", message: `Overwrites existing workflow “${id.trim()}”.` });
  for (const p of phases) {
    const info = phaseInfo[p];
    if (!info) {
      out.push({ level: "error", message: `Phase “${p}” is not defined.`, phase: p });
      continue;
    }
    if (info.mode === "agent") {
      if (info.agent && !agentIds.has(info.agent))
        out.push({
          level: "error",
          message: `Phase “${p}” references unknown agent @${info.agent}.`,
          phase: p,
        });
      if (!info.agent)
        out.push({ level: "error", message: `Phase “${p}” has no agent.`, phase: p });
      if (info.agent && agentIds.has(info.agent) && !(info.directive ?? "").trim())
        out.push({ level: "warn", message: `Phase “${p}” has an empty directive.`, phase: p });
    }
  }
  return out;
}

/** A draggable phase node for the visual builder. Order is derived from
 *  horizontal position, so dragging left/right reorders the workflow. */
function BuildNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string;
    mode: string | null;
    agent: string | null;
    gate?: boolean;
    issue?: "error" | "warn" | null;
    onRemove: () => void;
    onConfig: () => void;
  };
  const dot =
    d.mode === "agent"
      ? "var(--accent)"
      : d.mode === "command"
        ? "var(--green)"
        : d.mode === "manual"
          ? "var(--yellow)"
          : "var(--copper)";
  return (
    <div
      className={`rf-phase-node ${d.gate ? "rf-phase-node--gate" : ""} ${
        selected ? "rf-phase-node--selected" : ""
      } ${d.issue ? `rf-phase-node--issue-${d.issue}` : ""}`}
    >
      {d.issue && (
        <span
          className={`rf-phase-node__issue rf-phase-node__issue--${d.issue}`}
          title={d.issue === "error" ? "Has a blocking issue" : "Has a warning"}
          aria-hidden
        >
          {d.issue === "error" ? "!" : "?"}
        </span>
      )}
      <NodeToolbar position={Position.Top} offset={8} className="rf-node-toolbar">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            d.onConfig();
          }}
          title="Configure phase"
          aria-label="Configure phase"
        >
          <Settings2 size={13} />
        </button>
        <button
          type="button"
          className="rf-node-toolbar__danger"
          onClick={(e) => {
            e.stopPropagation();
            d.onRemove();
          }}
          title="Remove phase"
          aria-label="Remove phase"
        >
          <Trash2 size={13} />
        </button>
      </NodeToolbar>
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-phase-node__head">
        <span aria-hidden className="rf-phase-node__dot" style={{ background: dot }} />
        <span className="rf-phase-node__title">{d.label}</span>
        {d.gate && (
          <span className="rf-phase-node__gate" title="Decision gate (approve / rework)">
            <GitBranch size={10} /> gate
          </span>
        )}
      </div>
      <div className="rf-phase-node__meta">
        {d.agent && <span>@{d.agent}</span>}
        {d.mode && d.mode !== "agent" && <span>· {d.mode}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

const BUILD_NODE_TYPES = { build: BuildNode };

/** Edge with a "+" button at its midpoint to insert a phase between two phases. */
function InsertEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  const data = props.data as { onPlus?: (x: number, y: number) => void } | undefined;
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="wf-edge-plus"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={(e) => {
            e.stopPropagation();
            data?.onPlus?.(e.clientX, e.clientY);
          }}
          aria-label="Insert phase here"
          title="Insert phase here"
        >
          +
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Directive text field: compact textarea + expand-to-fullscreen focused editor,
 *  plus a chip count of the `{{dispatch_input}}` variables it references. */
function DirectiveField({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [full, setFull] = useState(false);
  const vars = useMemo(
    () => [...new Set([...value.matchAll(VAR_RE)].map((m) => m[1]!))],
    [value],
  );
  return (
    <div className="wf-directive">
      <div className="wf-directive__bar">
        <span className="wf-directive__vars">
          {vars.length > 0 ? (
            vars.map((v) => (
              <span key={v} className="wf-directive__var">{`{{${v}}}`}</span>
            ))
          ) : (
            <span className="wf-directive__hint">reference run inputs with {"{{var}}"}</span>
          )}
        </span>
        <button
          type="button"
          className="wf-directive__expand"
          onClick={() => setFull(true)}
          title="Expand editor"
          aria-label="Expand directive editor"
        >
          <Maximize2 size={12} />
        </button>
      </div>
      <textarea
        className="wf-input"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {full && (
        <>
          <div className="wf-review__backdrop" onClick={() => setFull(false)} />
          <div className="wf-directive__modal" role="dialog">
            <div className="wf-directive__modal-head">
              <span>Directive</span>
              <button
                type="button"
                className="wf-cfg__x"
                onClick={() => setFull(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <textarea
              className="wf-input wf-directive__modal-area"
              value={value}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
            />
            {vars.length > 0 && (
              <div className="wf-directive__vars">
                {vars.map((v) => (
                  <span key={v} className="wf-directive__var">{`{{${v}}}`}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const BUILD_EDGE_TYPES = { insert: InsertEdge };

/** Searchable, keyboard-navigable phase picker used by the +/drop/⌘K add
 *  affordances. Filters the unused-phase list; Enter picks the top hit (or
 *  creates a new phase when the query matches nothing). */
function PhasePicker({
  unused,
  position,
  onPick,
  onNew,
  onClose,
}: {
  unused: string[];
  position: { x: number; y: number; centered?: boolean };
  onPick: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return unused;
    return unused.filter((p) => p.toLowerCase().includes(needle));
  }, [q, unused]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(matches.length, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < matches.length && matches[active]) onPick(matches[active]!);
      else onNew();
    }
  };

  const style = position.centered
    ? { left: "50%", top: "16%", transform: "translateX(-50%)" }
    : { left: position.x, top: position.y };

  return (
    <>
      <div className="wf-chooser__backdrop" onClick={onClose} />
      <div className="wf-chooser wf-chooser--search" style={style} role="dialog">
        <input
          ref={inputRef}
          className="wf-chooser__search"
          placeholder="Search phases…  ↑↓ then ⏎"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        <div className="wf-chooser__list">
          {matches.length === 0 ? (
            <div className="wf-chooser__empty">
              {unused.length === 0 ? "All phases already added" : "No match"}
            </div>
          ) : (
            matches.map((p, i) => (
              <button
                key={p}
                type="button"
                className={`wf-chooser__item ${i === active ? "wf-chooser__item--active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(p)}
              >
                {p}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className={`wf-chooser__new ${active >= matches.length ? "wf-chooser__item--active" : ""}`}
          onClick={onNew}
        >
          + New phase{q.trim() ? ` "${q.trim()}"` : ""}
        </button>
      </div>
    </>
  );
}

/** Visual (React Flow) workflow builder: phases laid out left→right; drag a
 *  node to reorder (order = x-position), × to remove. Reflects/writes the
 *  composer's ordered `phases` array. */
function WorkflowCanvas({
  phases,
  setPhases,
  phaseInfo,
  phaseIssues,
  availablePhases,
  routes,
  onInsert,
  onNewPhaseAt,
  onSelectPhase,
}: {
  phases: string[];
  setPhases: (next: string[]) => void;
  phaseInfo: PhaseInfo;
  phaseIssues?: Record<string, "error" | "warn">;
  availablePhases: string[];
  routes: Record<string, Record<string, string>>;
  onInsert: (index: number, phaseId: string) => void;
  onNewPhaseAt: (index: number) => void;
  onSelectPhase: (id: string) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [chooser, setChooser] = useState<{
    index: number;
    x: number;
    y: number;
    centered?: boolean;
  } | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // ⌘K / Ctrl-K opens the add-phase picker (append at the end) while the
  // builder canvas is in view — keyboard-first, shared with the +/drop picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!wrapRef.current?.isConnected) return;
        e.preventDefault();
        setChooser({ index: phases.length, x: 0, y: 0, centered: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phases.length]);

  // Keep the chain in view as phases are added/removed.
  useEffect(() => {
    if (rf) requestAnimationFrame(() => rf.fitView({ padding: 0.25, duration: 200 }));
  }, [phases.length, rf]);

  // Re-lay-out whenever the ordered array changes (snaps nodes to a clean
  // left→right chain in the current order).
  useEffect(() => {
    setNodes(
      phases.map((p, i) => ({
        id: p,
        type: "build",
        position: { x: i * 210, y: 0 },
        data: {
          label: p,
          mode: phaseInfo[p]?.mode ?? null,
          agent: phaseInfo[p]?.agent ?? null,
          gate: phaseInfo[p]?.gate ?? false,
          issue: phaseIssues?.[p] ?? null,
          onRemove: () => setPhases(phases.filter((x) => x !== p)),
          onConfig: () => onSelectPhase(p),
        },
      })),
    );
  }, [phases, phaseInfo, phaseIssues, setNodes, setPhases, onSelectPhase]);

  const edges = phases.slice(1).map((p, i) => ({
    id: `${phases[i]}->${p}`,
    source: phases[i]!,
    target: p,
    type: "insert",
    animated: true,
    style: { stroke: "var(--copper)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--copper)" },
    data: { onPlus: (x: number, y: number) => setChooser({ index: i + 1, x, y }) },
  }));

  // Decision gates: each configured verdict route becomes a labeled branch
  // edge — approve/pass green, rework yellow loop-back, reject/fail red.
  const branchEdges = phases.flatMap((p) => {
    const verdicts = routes[p] ?? {};
    return Object.entries(verdicts).flatMap(([verdict, target]) => {
      if (!target || target === p || !phases.includes(target)) return [];
      const v = verdict.toLowerCase();
      const color =
        v === "rework"
          ? "var(--yellow)"
          : v === "reject" || v === "fail"
            ? "var(--crimson)"
            : v === "approve" || v === "advance" || v === "pass"
              ? "var(--green)"
              : "var(--copper)";
      const dashed = v !== "approve" && v !== "advance" && v !== "pass";
      return [
        {
          id: `route:${p}:${v}`,
          source: p,
          target,
          type: "default",
          animated: v === "rework",
          label: verdict,
          style: { stroke: color, ...(dashed ? { strokeDasharray: "5 4" } : {}) },
          labelStyle: { fill: color, fontSize: 10 },
          labelBgStyle: { fill: "var(--bg-elevated)", fillOpacity: 0.9 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        },
      ];
    });
  });
  const allEdges = [...edges, ...branchEdges];

  const unused = availablePhases.filter((p) => !phases.includes(p));

  const reorderByX = () => {
    const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
    if (sorted.length === phases.length && sorted.join(" ") !== phases.join(" ")) {
      setPhases(sorted);
    }
  };

  if (phases.length === 0) {
    return (
      <div className="wf-canvas wf-canvas--empty" ref={wrapRef}>
        <div className="wf-empty">
          <div className="wf-empty__mark" aria-hidden>
            <GitBranch size={22} />
          </div>
          <div className="wf-empty__title">Compose a workflow</div>
          <p className="wf-empty__sub">
            Add phases in order — they appear here as a chain you can drag,
            branch, and route.
          </p>
          <button
            type="button"
            className="wf-empty__cta"
            onClick={() => onNewPhaseAt(0)}
          >
            Add first phase
          </button>
          <span className="wf-empty__hint">
            or pick a template from the palette · <kbd>⌘K</kbd> to add
          </span>
        </div>
        {chooser && (
          <PhasePicker
            unused={unused}
            position={chooser}
            onPick={(p) => {
              onInsert(chooser.index, p);
              setChooser(null);
            }}
            onNew={() => {
              onNewPhaseAt(chooser.index);
              setChooser(null);
            }}
            onClose={() => setChooser(null)}
          />
        )}
      </div>
    );
  }
  return (
    <div className="wf-canvas" ref={wrapRef}>
      <ReactFlow
        nodes={nodes}
        edges={allEdges}
        nodeTypes={BUILD_NODE_TYPES}
        edgeTypes={BUILD_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={reorderByX}
        onInit={setRf}
        onNodeClick={(_, node) => onSelectPhase(node.id)}
        onConnectEnd={(event, conn) => {
          // Drag from a node's handle and release on empty canvas → insert a
          // phase right after that node (spawn-and-connect gesture).
          if (conn.isValid) return;
          const fromId = conn.fromNode?.id;
          if (!fromId) return;
          const idx = phases.indexOf(fromId);
          if (idx < 0) return;
          const me = event as MouseEvent;
          setChooser({ index: idx + 1, x: me.clientX || 0, y: me.clientY || 0 });
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        edgesFocusable={false}
        snapToGrid
        snapGrid={[26, 26]}
      >
        <Panel position="top-left">
          <button
            type="button"
            className="plugins-pane__ghost wf-tidy"
            onClick={() => {
              // Re-snap nodes to the clean left→right chain, then fit.
              setPhases([...phases]);
              requestAnimationFrame(() => rf?.fitView({ duration: 250, padding: 0.2 }));
            }}
            title="Auto-layout"
          >
            Tidy
          </button>
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="var(--copper)" nodeStrokeWidth={0} />
      </ReactFlow>
      {chooser && (
        <PhasePicker
          unused={unused}
          position={chooser}
          onPick={(p) => {
            onInsert(chooser.index, p);
            setChooser(null);
          }}
          onNew={() => {
            onNewPhaseAt(chooser.index);
            setChooser(null);
          }}
          onClose={() => setChooser(null)}
        />
      )}
    </div>
  );
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const PROVIDER_TOOLS = ["claude", "codex", "gemini", "opencode"];

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Candidate phase ids in order; only those present in the project are used. */
  phases: string[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "code-review",
    name: "Code review",
    description: "Implement a change, then gate it through review.",
    phases: ["implementation", "lint", "code-review"],
  },
  {
    id: "research",
    name: "Research",
    description: "Gather and synthesize, then review the findings.",
    phases: ["requirements", "research", "deliverable-validation"],
  },
  {
    id: "implementation",
    name: "Implementation",
    description: "Plan, implement, and QA a task end-to-end.",
    phases: ["requirements", "implementation", "lint", "code-review"],
  },
  {
    id: "qa",
    name: "QA pass",
    description: "Run checks and tests over the current state.",
    phases: ["lint", "run-checks", "run-tests"],
  },
];

function errMessage(res: { error: unknown; rawStderr: string }, fallback: string): string {
  return (
    (res.error && typeof res.error === "object" && "message" in res.error
      ? String((res.error as { message: unknown }).message)
      : null) ?? (res.rawStderr || fallback)
  );
}

/** Side panel to edit an existing phase definition (mode/agent/directive/gate),
 *  loaded via `phases get` and saved via `phases upsert` (preserving unmodeled
 *  runtime fields). Edits the shared phase definition. */
function PhaseConfigPanel({
  repoPath,
  phaseId,
  agents,
  siblingPhases,
  routes,
  onRoutes,
  onClose,
  onSaved,
}: {
  repoPath: string;
  phaseId: string;
  agents: { id: string }[];
  siblingPhases?: string[];
  routes?: Record<string, string>;
  onRoutes?: (verdict: string, target: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [runtime, setRuntime] = useState<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState("agent");
  const [agentId, setAgentId] = useState("");
  const [directive, setDirective] = useState("");
  const [gate, setGate] = useState(false);
  const [program, setProgram] = useState("");
  const [args, setArgs] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    animusWorkflowPhaseGet(repoPath, phaseId)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.data?.runtime) {
          const rt = res.data.runtime;
          setRuntime(rt);
          setMode(String(rt.mode ?? "agent"));
          setAgentId(String(rt.agent_id ?? ""));
          setDirective(typeof rt.directive === "string" ? rt.directive : "");
          setGate(rt.decision_contract != null);
          setAdvancedOpen(rt.decision_contract != null);
          const cmd = rt.command as { program?: string; args?: string[] } | null;
          if (cmd) {
            setProgram(cmd.program ?? "");
            setArgs((cmd.args ?? []).join(" "));
          }
        } else {
          setError(errMessage(res, "could not load phase"));
        }
        setLoading(false);
      })
      .catch((e) => {
        if (live) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [repoPath, phaseId]);

  // Verdicts this phase can emit: its declared decision_contract enum, else the
  // canonical approve/rework/reject. Each can route to any sibling phase.
  const verdicts = useMemo(() => {
    const dc = runtime?.decision_contract as
      | { fields?: { verdict?: { enum?: unknown } } }
      | null
      | undefined;
    const en = dc?.fields?.verdict?.enum;
    if (Array.isArray(en) && en.length > 0) return en.map(String);
    return DEFAULT_VERDICTS;
  }, [runtime]);

  const save = async () => {
    const base = runtime ?? {};
    const merged: Record<string, unknown> = {
      ...base,
      mode,
      agent_id: mode === "agent" ? agentId : null,
      directive: mode === "agent" ? directive.trim() || null : null,
      decision_contract: gate
        ? (base.decision_contract as object) ?? { allow_missing_decision: false }
        : null,
      command:
        mode === "command"
          ? {
              ...((base.command as object) ?? {}),
              program: program.trim(),
              args: args.trim() ? args.trim().split(/\s+/) : [],
            }
          : null,
    };
    setBusy(true);
    setError(null);
    try {
      const res = await animusWorkflowPhaseUpsert(repoPath, phaseId, merged);
      if (res.ok) onSaved();
      else setError(errMessage(res, "phase upsert failed"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="wf-cfg">
      <header className="wf-cfg__head">
        <span className="wf-cfg__title">{phaseId}</span>
        <button type="button" className="wf-cfg__x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {loading ? (
        <div className="wf-cfg__body aj-muted">Loading…</div>
      ) : (
        <div className="wf-cfg__body">
          <div className="wf-seg">
            {["agent", "command", "manual"].map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "wf-seg__on" : ""}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === "agent" && (
            <>
              <label className="wf-field">
                <span>Agent</span>
                <select
                  className="wf-input"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  {!agents.some((a) => a.id === agentId) && agentId && (
                    <option value={agentId}>{agentId}</option>
                  )}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wf-field">
                <span>Directive</span>
                <DirectiveField value={directive} onChange={setDirective} rows={6} />
              </label>
            </>
          )}
          {mode === "command" && (
            <>
              <label className="wf-field">
                <span>Program</span>
                <input
                  className="wf-input"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              </label>
              <label className="wf-field">
                <span>Args</span>
                <input
                  className="wf-input"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </label>
            </>
          )}
          {mode === "agent" && (
            <div className="wf-adv">
              <button
                type="button"
                className="wf-adv__toggle"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <span className="wf-adv__caret">{advancedOpen ? "▾" : "▸"}</span>
                Advanced
                {gate && <span className="wf-adv__tag">gate</span>}
              </button>
              {advancedOpen && (
                <div className="wf-adv__body">
                  <label className="wf-check">
                    <input
                      type="checkbox"
                      checked={gate}
                      onChange={(e) => setGate(e.target.checked)}
                    />
                    <span>Decision gate (branches on verdict)</span>
                  </label>
                  {gate && onRoutes && siblingPhases && (
                    <div className="wf-field wf-routes">
                      <span>Verdict routing</span>
                      <p className="wf-routes__hint">
                        Where each decision verdict sends the run. Leave on
                        default to advance (pass) or halt (fail).
                      </p>
                      {verdicts.map((v) => (
                        <div key={v} className="wf-routes__row">
                          <span className={`wf-routes__verdict wf-routes__verdict--${v.toLowerCase()}`}>
                            {v}
                            {VERDICT_HINT[v.toLowerCase()] && (
                              <em>{VERDICT_HINT[v.toLowerCase()]}</em>
                            )}
                          </span>
                          <select
                            className="wf-input wf-routes__select"
                            value={routes?.[v] ?? ""}
                            onChange={(e) => onRoutes(v, e.target.value)}
                          >
                            <option value="">→ default</option>
                            {siblingPhases.map((p) => (
                              <option key={p} value={p}>
                                → {p}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <div className="wf-compose__err">{error}</div>}
          <div className="wf-compose__actions">
            <button
              type="button"
              className="workflow-row__run"
              disabled={busy || (mode === "command" && !program.trim())}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save phase"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Inline "new agent" form — writes a project-local agent profile so a phase
 *  can reference it. Optionally wires skills + MCP servers it should use. */
function AgentMiniComposer({
  repoPath,
  skills,
  mcpServers,
  onSaved,
  onCancel,
}: {
  repoPath: string;
  skills: string[];
  mcpServers: string[];
  onSaved: (agentId: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [tool, setTool] = useState("claude");
  const [model, setModel] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pickedSkills, setPickedSkills] = useState<string[]>([]);
  const [pickedMcp, setPickedMcp] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chatProviders()
      .then(setProviders)
      .catch(() => {});
  }, []);
  const modelOptions = providers.find((p) => p.tool === tool)?.models ?? [];

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    const aid = id.trim();
    if (!SLUG_RE.test(aid)) {
      setError("Agent id must be lowercase letters, digits, '-' or '_'.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await localAgentCreate(
        repoPath,
        aid,
        emptyAgentUpdate({
          tool,
          model: model.trim() || null,
          role: role.trim() || null,
          systemPrompt: systemPrompt.trim() || null,
          skills: pickedSkills,
          mcpServers: pickedMcp,
        }),
      );
      if (res.written) onSaved(aid);
      else setError("agent was not written");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wf-compose__phase">
      <div className="wf-compose__label">New agent</div>
      <div className="wf-compose__row">
        <input
          className="wf-input"
          placeholder="agent-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <select
          className="wf-input"
          value={tool}
          onChange={(e) => {
            setTool(e.target.value);
            setModel("");
          }}
        >
          {PROVIDER_TOOLS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="wf-compose__row">
        <input
          className="wf-input"
          placeholder="model (provider default)"
          list="wf-model-options"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="wf-model-options">
          {modelOptions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <input
          className="wf-input"
          placeholder="role (optional)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </div>
      <label className="wf-field">
        <span>System prompt</span>
        <textarea
          className="wf-input"
          rows={3}
          placeholder="Who is this agent and how should it behave?"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </label>
      {skills.length > 0 && (
        <div className="wf-field">
          <span>Skills</span>
          <div className="wf-chips">
            {skills.slice(0, 24).map((s) => (
              <button
                key={s}
                type="button"
                className={`wf-chip ${pickedSkills.includes(s) ? "wf-chip--on" : ""}`}
                onClick={() => setPickedSkills((p) => toggle(p, s))}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {mcpServers.length > 0 && (
        <div className="wf-field">
          <span>MCP servers</span>
          <div className="wf-chips">
            {mcpServers.map((s) => (
              <button
                key={s}
                type="button"
                className={`wf-chip ${pickedMcp.includes(s) ? "wf-chip--on" : ""}`}
                onClick={() => setPickedMcp((p) => toggle(p, s))}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className="wf-compose__err">{error}</div>}
      <div className="wf-compose__actions">
        <button
          type="button"
          className="workflow-row__run"
          disabled={busy || !SLUG_RE.test(id.trim())}
          onClick={() => void save()}
        >
          {busy ? "Creating…" : "Create agent"}
        </button>
        <button type="button" className="plugins-pane__ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Compose a phase (agent or command) and upsert it to the generated overlay.
 *  Returns the new phase id to the caller so the workflow composer can chain. */
function PhaseComposer({
  repoPath,
  agents,
  skills,
  mcpServers,
  onAgentCreated,
  onSaved,
  onCancel,
}: {
  repoPath: string;
  agents: { id: string }[];
  skills: string[];
  mcpServers: string[];
  onAgentCreated: () => void;
  onSaved: (phaseId: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"agent" | "command">("agent");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [newAgent, setNewAgent] = useState(agents.length === 0);
  const [directive, setDirective] = useState("");
  const [gate, setGate] = useState(false);
  const [program, setProgram] = useState("");
  const [args, setArgs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const pid = id.trim();
    if (!SLUG_RE.test(pid)) {
      setError("Phase id must be lowercase letters, digits, '-' or '_'.");
      return;
    }
    const runtime =
      mode === "agent"
        ? {
            mode: "agent",
            agent_id: agentId,
            directive: directive.trim() || null,
            command: null,
            capabilities: null,
            decision_contract: gate ? { allow_missing_decision: false } : null,
            default_tool: null,
            manual: null,
          }
        : {
            mode: "command",
            agent_id: null,
            directive: null,
            command: {
              program: program.trim(),
              args: args.trim() ? args.trim().split(/\s+/) : [],
              cwd_mode: "project_root",
              success_exit_codes: [0],
              timeout_secs: 120,
              env: {},
            },
            capabilities: null,
            decision_contract: null,
          };
    setBusy(true);
    setError(null);
    try {
      const res = await animusWorkflowPhaseUpsert(repoPath, pid, runtime);
      if (res.ok) onSaved(pid);
      else
        setError(
          (res.error && typeof res.error === "object" && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : null) ?? res.rawStderr ?? "phase upsert failed",
        );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wf-compose__phase">
      <div className="wf-compose__row">
        <input
          className="wf-input"
          placeholder="phase-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <div className="wf-seg">
          <button
            type="button"
            className={mode === "agent" ? "wf-seg__on" : ""}
            onClick={() => setMode("agent")}
          >
            Agent
          </button>
          <button
            type="button"
            className={mode === "command" ? "wf-seg__on" : ""}
            onClick={() => setMode("command")}
          >
            Command
          </button>
        </div>
      </div>
      {mode === "agent" ? (
        <>
          {newAgent ? (
            <AgentMiniComposer
              repoPath={repoPath}
              skills={skills}
              mcpServers={mcpServers}
              onSaved={(aid) => {
                setAgentId(aid);
                setNewAgent(false);
                onAgentCreated();
              }}
              onCancel={() => setNewAgent(agents.length === 0)}
            />
          ) : (
            <div className="wf-field">
              <span>Agent</span>
              <div className="wf-compose__add">
                <select
                  className="wf-input"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="plugins-pane__ghost"
                  onClick={() => setNewAgent(true)}
                >
                  + New agent
                </button>
              </div>
            </div>
          )}
          <label className="wf-field">
            <span>Directive</span>
            <DirectiveField
              value={directive}
              onChange={setDirective}
              rows={3}
              placeholder="What should this agent do in this phase?"
            />
          </label>
          <label className="wf-check">
            <input
              type="checkbox"
              checked={gate}
              onChange={(e) => setGate(e.target.checked)}
            />
            <span>Decision gate (pauses for approve/reject)</span>
          </label>
        </>
      ) : (
        <div className="wf-compose__row">
          <input
            className="wf-input"
            placeholder="program (e.g. cargo)"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          />
          <input
            className="wf-input"
            placeholder="args (space-separated)"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        </div>
      )}
      {error && <div className="wf-compose__err">{error}</div>}
      <div className="wf-compose__actions">
        <button
          type="button"
          className="workflow-row__run"
          disabled={
            busy ||
            !SLUG_RE.test(id.trim()) ||
            (mode === "agent" && !agentId) ||
            (mode === "command" && !program.trim())
          }
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save phase"}
        </button>
        <button type="button" className="plugins-pane__ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Compose a workflow from ordered phases (existing or freshly authored). */
function WorkflowComposer({
  repoPath,
  availablePhases,
  phaseInfo,
  agents,
  skills,
  mcpServers,
  existingWorkflows,
  onSaved,
  onRefresh,
  onCancel,
}: {
  repoPath: string;
  availablePhases: string[];
  phaseInfo: PhaseInfo;
  agents: { id: string }[];
  skills: string[];
  mcpServers: string[];
  existingWorkflows: string[];
  onSaved: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [newPhase, setNewPhase] = useState(false);
  // When set, a freshly-authored phase is spliced in at this index (vs appended).
  const [pendingInsert, setPendingInsert] = useState<number | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  // Per-phase, per-verdict routing (workflow-step routing), applied on Create.
  // Shape: { phaseId: { verdict: targetPhase } }.
  const [routes, setRoutes] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existing phases + any newly authored ones not already in the picker list.
  const pickable = useMemo(
    () => Array.from(new Set([...availablePhases])).sort(),
    [availablePhases],
  );

  const lint = useMemo(
    () =>
      lintWorkflow(
        id,
        phases,
        phaseInfo,
        new Set(agents.map((a) => a.id)),
        new Set(existingWorkflows),
      ),
    [id, phases, phaseInfo, agents, existingWorkflows],
  );
  const lintErrors = lint.filter((l) => l.level === "error");
  // Per-phase issue level for on-node badges (error wins over warn).
  const phaseIssues = useMemo(() => {
    const m: Record<string, "error" | "warn"> = {};
    for (const l of lint) {
      if (!l.phase) continue;
      if (l.level === "error" || !m[l.phase]) m[l.phase] = l.level;
    }
    return m;
  }, [lint]);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [showReview, setShowReview] = useState(false);
  const lintWarnings = lint.filter((l) => l.level === "warn");

  // Every {{dispatch_input}} variable referenced across the chosen phases,
  // mapped to the phases that use it — the workflow's input surface.
  const inputVars = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of phases) {
      const dir = phaseInfo[p]?.directive ?? "";
      for (const m of dir.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        const v = m[1]!;
        const cur = map.get(v) ?? [];
        if (!cur.includes(p)) cur.push(p);
        map.set(v, cur);
      }
    }
    return [...map.entries()];
  }, [phases, phaseInfo]);

  const addPhase = (p: string) => {
    if (p && !phases.includes(p)) setPhases((prev) => [...prev, p]);
  };
  const insertPhaseAt = (index: number, p: string) => {
    if (!p || phases.includes(p)) return;
    setPhases((prev) => [...prev.slice(0, index), p, ...prev.slice(index)]);
  };
  const templates = useMemo(
    () =>
      WORKFLOW_TEMPLATES.map((t) => ({
        ...t,
        usable: t.phases.filter((p) => availablePhases.includes(p)),
      })).filter((t) => t.usable.length > 0),
    [availablePhases],
  );
  const applyTemplate = (t: { id: string; name: string; description: string; usable: string[] }) => {
    if (!id.trim()) setId(t.id);
    if (!name.trim()) setName(t.name);
    if (!description.trim()) setDescription(t.description);
    setPhases(t.usable);
  };
  const save =async () => {
    const wid = id.trim();
    if (!SLUG_RE.test(wid)) {
      setError("Workflow id must be lowercase letters, digits, '-' or '_'.");
      return;
    }
    if (phases.length === 0) {
      setError("Add at least one phase.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await animusWorkflowDefinitionUpsert(repoPath, {
        id: wid,
        name: name.trim() || wid,
        description: description.trim(),
        phases,
        budget: null,
      });
      if (res.ok) {
        // Apply per-phase, per-verdict routing (upsert can't carry inline
        // on_verdict — set_routing rewrites the generated overlay).
        const routing: PhaseRouting[] = phases
          .map((p): PhaseRouting | null => {
            const verdicts = routes[p] ?? {};
            const specs = Object.entries(verdicts)
              .filter(([, target]) => target)
              .map(([verdict, target]) => ({ verdict, target }));
            return specs.length > 0
              ? { phase: p, maxAttempts: 3, routes: specs }
              : null;
          })
          .filter((x): x is PhaseRouting => x !== null);
        if (routing.length > 0) {
          try {
            await animusWorkflowSetRouting(repoPath, wid, routing);
          } catch {
            /* non-fatal — workflow still created without routing */
          }
        }
        onSaved();
      } else
        setError(
          (res.error && typeof res.error === "object" && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : null) ?? res.rawStderr ?? "workflow upsert failed",
        );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const unusedPhases = pickable.filter((p) => !phases.includes(p));
  return (
    <div className="wf-builder">
      <div className="wf-builder__header">
        <input
          className="wf-input wf-builder__id"
          placeholder="workflow-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="wf-input wf-builder__name"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="wf-input wf-builder__desc"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="wf-builder__actions">
          {lintErrors.length > 0 && (
            <span className="wf-builder__lintchip wf-builder__lintchip--err">
              {lintErrors.length} issue{lintErrors.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            className="workflow-row__run"
            disabled={busy || lintErrors.length > 0 || phases.length === 0}
            onClick={() => setShowReview(true)}
          >
            {busy ? "Saving…" : "Review & Create"}
          </button>
          {showReview && (
            <>
              <div className="wf-review__backdrop" onClick={() => setShowReview(false)} />
              <div className="wf-review" role="dialog">
                <div className="wf-review__title">Review workflow</div>
                <div className="wf-review__meta">
                  <code>{id.trim() || "workflow-id"}</code>
                  <span>· {phases.length} phase{phases.length === 1 ? "" : "s"}</span>
                </div>
                <ol className="wf-review__phases">
                  {phases.map((p, i) => {
                    const info = phaseInfo[p];
                    const pr = routes[p] ?? {};
                    return (
                      <li key={p} className="wf-review__phase">
                        <span className="wf-review__idx">{i + 1}</span>
                        <span className="wf-review__pname">{p}</span>
                        <span className="wf-review__pmeta">
                          {info?.mode ?? "agent"}
                          {info?.agent ? ` · @${info.agent}` : ""}
                          {info?.gate ? " · gate" : ""}
                        </span>
                        {Object.entries(pr)
                          .filter(([, t]) => t)
                          .map(([v, t]) => (
                            <span key={v} className="wf-review__route">
                              on {v} → {t}
                            </span>
                          ))}
                      </li>
                    );
                  })}
                </ol>
                {lintWarnings.length > 0 && (
                  <div className="wf-review__warns">
                    {lintWarnings.map((w, i) => (
                      <div key={i} className="wf-review__warn">⚠ {w.message}</div>
                    ))}
                  </div>
                )}
                <p className="wf-review__note">
                  Creating writes this workflow's YAML to{" "}
                  <code>.animus/workflows/</code>. Nothing runs yet.
                </p>
                <div className="wf-review__actions">
                  <button
                    type="button"
                    className="plugins-pane__ghost"
                    onClick={() => setShowReview(false)}
                    disabled={busy}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="workflow-row__run"
                    disabled={busy}
                    onClick={() => {
                      setShowReview(false);
                      void save();
                    }}
                  >
                    {busy ? "Creating…" : "Create workflow"}
                  </button>
                </div>
              </div>
            </>
          )}
          <button type="button" className="plugins-pane__ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <div className="wf-builder__main">
        {!paletteOpen && (
          <button
            type="button"
            className="wf-builder__palette-tab"
            onClick={() => setPaletteOpen(true)}
            title="Show phases & templates"
            aria-label="Show palette"
          >
            +
          </button>
        )}
        {paletteOpen && (
        <aside className="wf-builder__palette">
          <div className="wf-pal-head">
            <span className="wf-compose__label" style={{ margin: 0 }}>Library</span>
            <button
              type="button"
              className="wf-pal-collapse"
              onClick={() => setPaletteOpen(false)}
              title="Collapse palette"
              aria-label="Collapse palette"
            >
              ‹
            </button>
          </div>
          {phases.length === 0 && templates.length > 0 && (
            <div className="wf-pal-section">
              <span className="wf-compose__label">Templates</span>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="wf-tcard"
                  onClick={() => applyTemplate(t)}
                  title={t.description}
                >
                  <span className="wf-tcard__head">
                    <span className="wf-tcard__name">{t.name}</span>
                    <span className="wf-tcard__count">
                      {t.usable.length} phase{t.usable.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="wf-tcard__chain" aria-hidden>
                    {t.usable.map((p, i) => (
                      <span key={p} className="wf-tcard__chain-seg">
                        <span className="wf-tcard__dot" />
                        {i < t.usable.length - 1 && <span className="wf-tcard__link" />}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
          {inputVars.length > 0 && (
            <div className="wf-pal-section">
              <span className="wf-compose__label">Inputs</span>
              <p className="wf-pal-note">
                dispatch_input variables these phases reference
              </p>
              <div className="wf-pal-vars">
                {inputVars.map(([v, where]) => (
                  <span
                    key={v}
                    className="wf-pal-var"
                    title={`used in: ${where.join(", ")}`}
                  >
                    {`{{${v}}}`}
                    <em>{where.length}</em>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="wf-pal-section wf-pal-section--grow">
            <span className="wf-compose__label">Phases</span>
            <div className="wf-pal-list">
              {unusedPhases.length === 0 ? (
                <span className="wf-pal-empty">All phases added</span>
              ) : (
                unusedPhases.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="wf-pal-item"
                    onClick={() => addPhase(p)}
                    title="Add to workflow"
                  >
                    <span className="wf-pal-item__name">{p}</span>
                    {phaseInfo[p]?.gate && <span className="wf-pal-item__gate">⟐</span>}
                    <span className="wf-pal-item__add">+</span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className="plugins-pane__ghost wf-pal-new"
              onClick={() => {
                setPendingInsert(null);
                setNewPhase(true);
                setSelectedPhase(null);
              }}
            >
              + New phase
            </button>
          </div>
        </aside>
        )}

        <div className="wf-builder__canvas">
          <WorkflowCanvas
            phases={phases}
            setPhases={setPhases}
            phaseInfo={phaseInfo}
            phaseIssues={phaseIssues}
            availablePhases={pickable}
            routes={routes}
            onInsert={insertPhaseAt}
            onNewPhaseAt={(index) => {
              setPendingInsert(index);
              setNewPhase(true);
              setSelectedPhase(null);
            }}
            onSelectPhase={(p) => {
              setNewPhase(false);
              setSelectedPhase(p);
            }}
          />
          {newPhase && (
            <aside className="wf-cfg">
              <header className="wf-cfg__head">
                <span className="wf-cfg__title">New phase</span>
                <button
                  type="button"
                  className="wf-cfg__x"
                  onClick={() => {
                    setPendingInsert(null);
                    setNewPhase(false);
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>
              <div className="wf-cfg__body">
                <PhaseComposer
                  repoPath={repoPath}
                  agents={agents}
                  skills={skills}
                  mcpServers={mcpServers}
                  onAgentCreated={onRefresh}
                  onSaved={(pid) => {
                    if (pendingInsert != null) insertPhaseAt(pendingInsert, pid);
                    else addPhase(pid);
                    setPendingInsert(null);
                    setNewPhase(false);
                    onRefresh();
                  }}
                  onCancel={() => {
                    setPendingInsert(null);
                    setNewPhase(false);
                  }}
                />
              </div>
            </aside>
          )}
          {!newPhase && selectedPhase && (
            <PhaseConfigPanel
              repoPath={repoPath}
              phaseId={selectedPhase}
              agents={agents}
              siblingPhases={phases.filter((p) => p !== selectedPhase)}
              routes={routes[selectedPhase] ?? {}}
              onRoutes={(verdict, target) =>
                setRoutes((prev) => {
                  const cur = { ...(prev[selectedPhase] ?? {}) };
                  if (target) cur[verdict] = target;
                  else delete cur[verdict];
                  const next = { ...prev };
                  if (Object.keys(cur).length > 0) next[selectedPhase] = cur;
                  else delete next[selectedPhase];
                  return next;
                })
              }
              onClose={() => setSelectedPhase(null)}
              onSaved={() => {
                setSelectedPhase(null);
                onRefresh();
              }}
            />
          )}
        </div>
      </div>

      {lint.length > 0 && (
        <div className="wf-builder__lint">
          {lint.map((iss, i) => (
            <button
              key={i}
              type="button"
              className={`wf-lintchip wf-lintchip--${iss.level} ${iss.phase ? "wf-lintchip--clickable" : ""}`}
              onClick={() => iss.phase && setSelectedPhase(iss.phase)}
            >
              <span className="wf-lint__dot" aria-hidden />
              {iss.message}
            </button>
          ))}
        </div>
      )}
      {error && <div className="wf-compose__err">{error}</div>}
    </div>
  );
}

function phaseAgentState(mode: string | null | undefined): AgentState {
  if (mode === "command") return "running";
  if (mode === "agent") return "thinking";
  return "idle";
}

function modeColor(mode: string | null | undefined): string {
  switch (mode) {
    case "agent":
      return "var(--accent)";
    case "command":
      return "var(--green)";
    case "manual":
      return "var(--yellow)";
    case "ref":
      return "var(--copper)";
    default:
      return "var(--gray)";
  }
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

// Best-effort human reading of the common cron shapes. Falls back to the raw
// expression for anything it doesn't recognise.
function cronToHuman(cron: string | null): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;
  if (min?.startsWith("*/") && hr === "*" && dom === "*" && mon === "*" && dow === "*")
    return `every ${min.slice(2)} min`;
  if (hr?.startsWith("*/") && min === "0" && dom === "*" && mon === "*" && dow === "*")
    return `every ${hr.slice(2)} h`;
  if (min === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*")
    return "hourly";
  if (min !== "*" && hr !== "*" && dom === "*" && mon === "*" && dow === "*")
    return `daily at ${hr.padStart(2, "0")}:${min.padStart(2, "0")}`;
  return null;
}

interface ResolvedPhase {
  ref: PhaseRef;
  summary: PhaseSummary | null;
  isRef: boolean;
}

function resolvePhases(
  wf: WorkflowSummary,
  phaseById: Map<string, PhaseSummary>,
): ResolvedPhase[] {
  return wf.phases.map((ref) => ({
    ref,
    summary: ref.kind === "phase" ? phaseById.get(ref.value) ?? null : null,
    isRef: ref.kind === "workflow-ref",
  }));
}

function CapabilityChips({ caps }: { caps: CapabilityFlag[] }) {
  const on = caps.filter((c) => c.value);
  if (on.length === 0) return null;
  return (
    <div className="cap-chips">
      {on.map((c) => (
        <span key={c.key} className="cap-chip" title="capability">
          {c.key.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function PhaseChip({
  resolved,
  onClick,
  liveAgentState,
}: {
  resolved: ResolvedPhase;
  onClick?: () => void;
  liveAgentState?: AgentState;
}) {
  const mode = resolved.isRef ? "ref" : resolved.summary?.mode ?? null;
  const agent = resolved.summary?.agent ?? null;
  const decides = (resolved.summary?.decisionVerdicts.length ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`phase-chip phase-chip--clickable`}
      title={agent ? `Phase ${resolved.ref.value} · run by @${agent}` : resolved.ref.value}
    >
      {agent ? (
        <span className="phase-chip__avatar">
          <AgentFace
            seed={agent}
            size={16}
            state={liveAgentState ?? phaseAgentState(mode)}
          />
        </span>
      ) : (
        <span
          aria-hidden
          className="phase-chip__dot"
          style={{ background: modeColor(mode) }}
        />
      )}
      <span className="phase-chip__label">{resolved.ref.value}</span>
      {agent && (
        <span className="phase-chip__agent" title="Agent">
          @{agent}
        </span>
      )}
      {decides && (
        <span className="phase-chip__gate" title="Decision gate — branches on verdict">
          ⚖
        </span>
      )}
      {resolved.isRef && (
        <span className="phase-chip__ref" title="Workflow reference">
          ↳ ref
        </span>
      )}
    </button>
  );
}

function CommandLine({ phase }: { phase: PhaseSummary }) {
  if (!phase.command) return null;
  const full = [phase.command, ...phase.commandArgs].join(" ");
  return (
    <div className="cmd-block">
      <code className="cmd-block__line">$ {full}</code>
      <div className="cmd-block__meta">
        {phase.commandCwdMode && <span>cwd: {phase.commandCwdMode}</span>}
        {phase.commandTimeoutSecs != null && (
          <span>timeout: {phase.commandTimeoutSecs}s</span>
        )}
        {phase.commandSuccessExitCodes.length > 0 && (
          <span>exit ok: {phase.commandSuccessExitCodes.join(", ")}</span>
        )}
      </div>
    </div>
  );
}

function PhaseDetail({
  phase,
  usedBy,
  reworkRef,
  liveAgentState,
}: {
  phase: PhaseSummary;
  usedBy?: string[];
  reworkRef?: PhaseRef;
  liveAgentState?: AgentState;
}) {
  return (
    <div className="phase-detail">
      <div className="phase-detail__head">
        {phase.agent ? (
          <span className="phase-detail__avatar" title={`@${phase.agent}`}>
            <AgentFace
              seed={phase.agent}
              size={20}
              state={liveAgentState ?? phaseAgentState(phase.mode)}
            />
          </span>
        ) : (
          <span
            aria-hidden
            className="phase-detail__dot"
            style={{ background: modeColor(phase.mode) }}
          />
        )}
        <code className="phase-detail__id">{phase.id}</code>
        {phase.mode && (
          <span className="phase-detail__pill">{phase.mode}</span>
        )}
        {phase.agent && (
          <span className="phase-detail__pill phase-detail__pill--agent">
            @{phase.agent}
          </span>
        )}
        {phase.command && (
          <span className="phase-detail__pill phase-detail__pill--cmd">
            {phase.command}
          </span>
        )}
        {phase.worktree === false && (
          <span className="phase-detail__pill phase-detail__pill--warn" title="Runs in the task root, not an isolated worktree">
            no worktree
          </span>
        )}
        <span className="phase-detail__source" title={phase.sourceFile}>
          {basename(phase.sourceFile)}
        </span>
      </div>

      <CommandLine phase={phase} />
      <CapabilityChips caps={phase.capabilities} />

      {reworkRef?.reworkTarget && (
        <div className="phase-detail__rework">
          ↺ on rework → <code>{reworkRef.reworkTarget}</code>
          {reworkRef.maxReworkAttempts ? ` (max ${reworkRef.maxReworkAttempts})` : ""}
        </div>
      )}

      {phase.decisionVerdicts.length > 0 && (
        <div className="verdicts">
          <span className="verdicts__label">decides</span>
          {phase.decisionVerdicts.map((v) => (
            <span key={v} className={`verdict verdict--${v}`}>
              {v}
            </span>
          ))}
        </div>
      )}

      {usedBy && usedBy.length > 0 && (
        <div className="phase-detail__usedby">
          used by{" "}
          {usedBy.map((w, i) => (
            <span key={w}>
              <code>{w}</code>
              {i < usedBy.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}

      {phase.directive && (
        <details className="phase-detail__directive-wrap">
          <summary>Directive</summary>
          <pre className="phase-detail__directive">{phase.directive.trim()}</pre>
        </details>
      )}
    </div>
  );
}

function WorkflowCard({
  wf,
  resolved,
  expanded,
  onToggle,
  onRun,
  running,
  isDefault,
  agentLiveStates,
  agents,
  schedules,
  triggers,
}: {
  wf: WorkflowSummary;
  resolved: ResolvedPhase[];
  expanded: boolean;
  onToggle: () => void;
  onRun: (id: string) => void;
  running: boolean;
  isDefault: boolean;
  agentLiveStates: Record<string, AgentState>;
  agents: string[];
  schedules: ScheduleSummary[];
  triggers: TriggerSummary[];
}) {
  const triggeredBy = schedules.length + triggers.length;

  // Two-step Run: first click arms, second click fires. Auto-disarms so a
  // stray click can't enqueue paid agent work.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <article className={`workflow-row ${expanded ? "workflow-row--expanded" : ""}`}>
      <header className="workflow-row__head">
        <button
          type="button"
          className="workflow-row__expand"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▼" : "▶"}
        </button>
        <div
          className="workflow-row__title-wrap"
          onClick={onToggle}
          role="button"
          aria-expanded={expanded}
        >
          <h3 className="workflow-row__title">
            {wf.name}
            {isDefault && <span className="workflow-row__default">default</span>}
          </h3>
          <div className="workflow-row__meta-line">
            <code className="workflow-row__id">{wf.id}</code>
            <span className="workflow-row__source" title={wf.sourceFile}>
              {basename(wf.sourceFile)}
            </span>
            {agents.length > 0 && (
              <span className="workflow-row__agents">
                {agents.slice(0, 4).map((a) => (
                  <span key={a} className="workflow-row__agent-av" title={`@${a}`}>
                    <AgentFace seed={a} size={16} state={agentLiveStates[a] ?? "idle"} />
                  </span>
                ))}
              </span>
            )}
            {triggeredBy > 0 && (
              <span className="workflow-row__trig" title="Fired by a schedule or trigger">
                ⏱ {triggeredBy}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`workflow-row__run ${armed ? "workflow-row__run--armed" : ""}`}
          onClick={() => {
            if (armed) {
              setArmed(false);
              onRun(wf.id);
            } else {
              setArmed(true);
            }
          }}
          disabled={running}
          title={
            armed
              ? "Click again to enqueue this workflow"
              : "Enqueue this workflow on the project daemon"
          }
        >
          {running ? "Queuing…" : armed ? "Run? ✓" : "Run"}
        </button>
      </header>

      {resolved.length === 0 ? (
        <p style={{ color: "var(--text-faint)", fontSize: 11 }}>
          No phases defined
        </p>
      ) : (
        <ol className="phase-chain">
          {resolved.map((rp, idx) => (
            <li
              key={`${rp.ref.value}-${idx}`}
              className="phase-chain__item"
            >
              <PhaseChip
                resolved={rp}
                liveAgentState={
                  rp.summary?.agent
                    ? agentLiveStates[rp.summary.agent]
                    : undefined
                }
                onClick={() => {
                  if (!expanded) onToggle();
                }}
              />
              {rp.ref.reworkTarget && (
                <span
                  className="phase-chain__rework"
                  title={`On rework, loop back to ${rp.ref.reworkTarget}${
                    rp.ref.maxReworkAttempts ? ` (max ${rp.ref.maxReworkAttempts})` : ""
                  }`}
                >
                  ↺ {rp.ref.reworkTarget}
                  {rp.ref.maxReworkAttempts ? ` ×${rp.ref.maxReworkAttempts}` : ""}
                </span>
              )}
              {idx < resolved.length - 1 && (
                <span aria-hidden className="phase-chain__arrow">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {expanded && (
        <div className="workflow-row__body">
          {wf.description && (
            <pre className="workflow-row__desc-full">{wf.description.trim()}</pre>
          )}
          <dl className="workflow-row__facts">
            <dt>Phases</dt>
            <dd>{wf.phases.length}</dd>
            {agents.length > 0 && (
              <>
                <dt>Agents</dt>
                <dd>{agents.map((a) => `@${a}`).join(", ")}</dd>
              </>
            )}
            {schedules.map((s, i) => (
              <FactFragment key={`s${i}`} dt="Schedule" dd={`${s.cron ?? "—"}${s.enabled === false ? " (disabled)" : ""}`} />
            ))}
            {triggers.map((t, i) => (
              <FactFragment key={`t${i}`} dt="Trigger" dd={`${t.kind ?? "—"}${t.path ? ` · ${t.path}` : ""}`} />
            ))}
            <dt>Source</dt>
            <dd className="mono small">{wf.sourceFile}</dd>
          </dl>

          <div className="workflow-steps">
            <h4 className="workflow-steps__title">Steps</h4>
            <ol className="workflow-steps__list">
              {resolved.map((rp, idx) => (
                <li key={`${rp.ref.value}-${idx}`} className="workflow-steps__item">
                  <span className="workflow-steps__num">{idx + 1}</span>
                  <div className="workflow-steps__detail">
                    {rp.summary ? (
                      <PhaseDetail
                        phase={rp.summary}
                        reworkRef={rp.ref}
                        liveAgentState={
                          rp.summary.agent
                            ? agentLiveStates[rp.summary.agent]
                            : undefined
                        }
                      />
                    ) : rp.isRef ? (
                      <div className="phase-detail phase-detail--ref">
                        <span className="phase-detail__pill">workflow ref</span>
                        <code className="phase-detail__id">↳ {rp.ref.value}</code>
                      </div>
                    ) : (
                      <div className="phase-detail phase-detail--missing">
                        <code className="phase-detail__id">{rp.ref.value}</code>
                        <span className="phase-detail__source">no definition found</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </article>
  );
}

function FactFragment({ dt, dd }: { dt: string; dd: string }) {
  return (
    <>
      <dt>{dt}</dt>
      <dd className="small">{dd}</dd>
    </>
  );
}

function ScheduleRow({ s }: { s: ScheduleSummary }) {
  const human = cronToHuman(s.cron);
  return (
    <li className="trig-row">
      <span
        className={`status-dot status-dot--${s.enabled === false ? "off" : "ok"}`}
        title={s.enabled === false ? "disabled" : "enabled"}
      />
      {s.id && <code className="trig-row__id">{s.id}</code>}
      <code className="trig-row__cron">{s.cron ?? "—"}</code>
      {human && <span className="trig-row__human">{human}</span>}
      <span className="trig-row__arrow">→</span>
      <span className="trig-row__target">{s.workflow ?? "—"}</span>
      {s.timezone && <span className="trig-row__tz">{s.timezone}</span>}
      <span className="trig-row__source" title={s.sourceFile}>
        {basename(s.sourceFile)}
      </span>
    </li>
  );
}

function TriggerRow({ t }: { t: TriggerSummary }) {
  return (
    <li className="trig-row">
      <span className="trig-row__kind">{t.kind ?? "—"}</span>
      {t.path && <code className="trig-row__path">{t.path}</code>}
      <span className="trig-row__arrow">→</span>
      <span className="trig-row__target">{t.workflow ?? "—"}</span>
      <span className="trig-row__source" title={t.sourceFile}>
        {basename(t.sourceFile)}
      </span>
    </li>
  );
}

type TabKey = "workflows" | "phases" | "triggers" | "files";

interface FileView {
  path: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}

export function WorkflowsView({ project }: { project: Project }) {
  const [report, setReport] = useState<WorkflowYamlReport | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AnimusStatus | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("workflows");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [fileView, setFileView] = useState<FileView | null>(null);
  const agentLiveStates = useProjectAgentLiveStates(project.id);

  // Last-issued-wins token: a slow read must not overwrite a newer one.
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const path = project.repo_path?.trim();
    const seq = ++refreshSeq.current;
    if (!path) {
      setReport(null);
      setReadError("This project has no folder path on disk.");
      return;
    }
    setLoading(true);
    setReadError(null);
    try {
      const r = await localWorkflowsRead(path);
      if (seq !== refreshSeq.current) return;
      setReport(r);
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      setReadError(String(e));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
    animusStatusGet(path)
      .then((s) => {
        if (seq === refreshSeq.current && s.ok && s.data) setStatus(s.data);
      })
      .catch(() => {});
  }, [project.repo_path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRun = useCallback(
    async (id: string) => {
      const path = project.repo_path?.trim();
      if (!path) return;
      setRunning(id);
      setRunResult(null);
      try {
        const res = await animusWorkflowRun(path, id);
        if (res.ok) {
          setRunResult(`Enqueued "${id}".`);
        } else {
          setRunResult(
            `Run failed: ${(res.error as { message?: string } | null)?.message ?? res.rawStderr}`,
          );
        }
      } catch (e) {
        setRunResult(`Run failed: ${e}`);
      } finally {
        setRunning(null);
      }
    },
    [project.repo_path],
  );

  const openFile = useCallback(
    async (filePath: string) => {
      const root = project.repo_path?.trim();
      if (!root) return;
      setFileView({ path: filePath, content: null, loading: true, error: null });
      try {
        const content = await localWorkflowFileRead(root, filePath);
        setFileView({ path: filePath, content, loading: false, error: null });
      } catch (e) {
        setFileView({ path: filePath, content: null, loading: false, error: String(e) });
      }
    },
    [project.repo_path],
  );

  const phaseById = useMemo(
    () => new Map((report?.phases ?? []).map((p) => [p.id, p])),
    [report],
  );

  // Reverse indexes: which workflows use a phase, which schedules/triggers fire
  // a workflow, and which agents a workflow ends up touching.
  const phaseUsedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of report?.workflows ?? []) {
      for (const ph of w.phases) {
        if (ph.kind !== "phase") continue;
        const arr = m.get(ph.value) ?? [];
        if (!arr.includes(w.id)) arr.push(w.id);
        m.set(ph.value, arr);
      }
    }
    return m;
  }, [report]);

  const schedulesByWorkflow = useMemo(() => {
    const m = new Map<string, ScheduleSummary[]>();
    for (const s of report?.schedules ?? []) {
      if (!s.workflow) continue;
      const arr = m.get(s.workflow) ?? [];
      arr.push(s);
      m.set(s.workflow, arr);
    }
    return m;
  }, [report]);

  const triggersByWorkflow = useMemo(() => {
    const m = new Map<string, TriggerSummary[]>();
    for (const t of report?.triggers ?? []) {
      if (!t.workflow) continue;
      const arr = m.get(t.workflow) ?? [];
      arr.push(t);
      m.set(t.workflow, arr);
    }
    return m;
  }, [report]);

  const agentsByWorkflow = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of report?.workflows ?? []) {
      const agents: string[] = [];
      for (const ph of w.phases) {
        if (ph.kind !== "phase") continue;
        const a = phaseById.get(ph.value)?.agent;
        if (a && !agents.includes(a)) agents.push(a);
      }
      m.set(w.id, agents);
    }
    return m;
  }, [report, phaseById]);

  const filteredWorkflows = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    if (!q) return report.workflows;
    return report.workflows.filter(
      (w) =>
        w.id.toLowerCase().includes(q) ||
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.phases.some((ph) => ph.value.toLowerCase().includes(q)),
    );
  }, [report, search]);

  const filteredPhases = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    if (!q) return report.phases;
    return report.phases.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        (p.agent ?? "").toLowerCase().includes(q) ||
        (p.command ?? "").toLowerCase().includes(q) ||
        (p.directive ?? "").toLowerCase().includes(q),
    );
  }, [report, search]);

  if (loading && !report) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Reading .animus/workflows.yaml…
      </p>
    );
  }
  if (readError) {
    return (
      <div className="workflow-error">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Couldn't read workflow files
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{readError}</pre>
        <button
          type="button"
          onClick={() => void refresh()}
          className="workflow-row__run"
          style={{ marginTop: 12 }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!report) return null;

  // Full-bleed builder takes over the whole pane while composing.
  if (composing) {
    return (
      <div className="workflows-pane workflows-pane--builder">
        <WorkflowComposer
          repoPath={project.repo_path?.trim() ?? ""}
          availablePhases={report.phases.map((p) => p.id)}
          phaseInfo={Object.fromEntries(
            report.phases.map((p) => [
              p.id,
              {
                mode: p.mode,
                agent: p.agent,
                gate: (p.decisionVerdicts?.length ?? 0) > 0,
                directive: p.directive,
              },
            ]),
          )}
          existingWorkflows={report.workflows.map((w) => w.id)}
          agents={report.agents.map((a) => ({ id: a.id }))}
          skills={Array.from(
            new Set(report.agents.flatMap((a) => a.skills ?? [])),
          ).sort()}
          mcpServers={report.mcpServers.map((m) => m.id)}
          onSaved={() => {
            setComposing(false);
            void refresh();
          }}
          onRefresh={() => void refresh()}
          onCancel={() => setComposing(false)}
        />
      </div>
    );
  }

  const counts = {
    workflows: report.workflows.length,
    phases: report.phases.length,
    agents: report.agents.length,
    triggers: report.triggers.length + report.schedules.length,
    files: report.files.length,
  };

  return (
    <div className="workflows-pane">
      <header className="workflows-pane__head">
        <div>
          <h2 className="workflows-pane__title">Workflows</h2>
          <p className="workflows-pane__subtitle">
            {counts.workflows} workflow{counts.workflows === 1 ? "" : "s"} ·{" "}
            {counts.phases} phase{counts.phases === 1 ? "" : "s"} ·{" "}
            {counts.agents} agent{counts.agents === 1 ? "" : "s"} ·{" "}
            {counts.triggers} trigger{counts.triggers === 1 ? "" : "s"} ·{" "}
            {counts.files} file{counts.files === 1 ? "" : "s"}
          </p>
        </div>
        <div className="workflows-pane__meta">
          {status?.daemon && (
            <span
              className={`status-dot status-dot--${status.daemon.running ? "ok" : "off"}`}
              title="daemon"
            />
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {status ? (status.daemon.running ? "daemon up" : "daemon down") : "checking daemon…"}
          </span>
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => {
              setTab("workflows");
              setComposing(true);
            }}
            style={{ marginLeft: 8 }}
          >
            New workflow
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => void refresh()}
            disabled={loading}
            style={{ marginLeft: 8 }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {report.errors.length > 0 && (
        <div className="workflow-error">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {report.errors.length} file{report.errors.length === 1 ? "" : "s"} failed to parse
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {report.errors.map((e, i) => (
              <li key={i} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="workflows-subtabs" aria-label="Project graph sections">
        {(
          [
            { key: "workflows", label: `Workflows`, count: counts.workflows },
            { key: "phases", label: `Phases`, count: counts.phases },
            { key: "triggers", label: `Triggers`, count: counts.triggers },
            { key: "files", label: `Files`, count: counts.files },
          ] as Array<{ key: TabKey; label: string; count: number }>
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`workflows-subtab ${tab === t.key ? "workflows-subtab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
            <span className="workflows-subtab__count">{t.count}</span>
          </button>
        ))}
      </nav>

      {tab !== "files" && (
        <div className="plugins-pane__toolbar">
          <input
            className="plugins-pane__search"
            placeholder={`Search ${tab}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {runResult && tab === "workflows" && (
        <div className="workflows-pane__toast">{runResult}</div>
      )}

      {tab === "workflows" && (
        <section className="workflows-pane__group">
          {filteredWorkflows.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: 12 }}>
              {report.workflows.length === 0
                ? "No workflows defined. Add a workflows: block to .animus/workflows.yaml or drop a file under .animus/workflows/."
                : "No workflows match your search."}
            </p>
          ) : (
            filteredWorkflows.map((w) => (
              <WorkflowCard
                key={w.id + w.sourceFile}
                wf={w}
                resolved={resolvePhases(w, phaseById)}
                expanded={expanded.has(w.id)}
                isDefault={report.defaultWorkflowRef === w.id}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.id)) next.delete(w.id);
                    else next.add(w.id);
                    return next;
                  })
                }
                onRun={handleRun}
                running={running === w.id}
                agentLiveStates={agentLiveStates}
                agents={agentsByWorkflow.get(w.id) ?? []}
                schedules={schedulesByWorkflow.get(w.id) ?? []}
                triggers={triggersByWorkflow.get(w.id) ?? []}
              />
            ))
          )}
        </section>
      )}

      {tab === "phases" && (
        <section className="workflows-pane__group">
          {filteredPhases.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: 12 }}>
              No phase definitions in this project's YAML.
            </p>
          ) : (
            <ul className="phase-list">
              {filteredPhases.map((p) => (
                <li key={p.id + p.sourceFile}>
                  <PhaseDetail
                    phase={p}
                    usedBy={phaseUsedBy.get(p.id)}
                    liveAgentState={p.agent ? agentLiveStates[p.agent] : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "triggers" && (
        <section className="workflows-pane__group" style={{ gap: 16 }}>
          <div>
            <h3 className="workflows-pane__group-title">Schedules</h3>
            {report.schedules.length === 0 ? (
              <p style={{ color: "var(--text-faint)", fontSize: 12 }}>None.</p>
            ) : (
              <ul className="trig-list">
                {report.schedules.map((s, i) => (
                  <ScheduleRow key={i} s={s} />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="workflows-pane__group-title">Triggers</h3>
            {report.triggers.length === 0 ? (
              <p style={{ color: "var(--text-faint)", fontSize: 12 }}>None.</p>
            ) : (
              <ul className="trig-list">
                {report.triggers.map((t, i) => (
                  <TriggerRow key={i} t={t} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {tab === "files" && (
        <section className="workflows-pane__group" style={{ gap: 14 }}>
          {(report.defaultWorkflowRef || report.toolsAllowlist.length > 0) && (
            <div className="files-config">
              {report.defaultWorkflowRef && (
                <div className="files-config__row">
                  <span className="files-config__key">default workflow</span>
                  <code>{report.defaultWorkflowRef}</code>
                </div>
              )}
              {report.toolsAllowlist.length > 0 && (
                <div className="files-config__row">
                  <span className="files-config__key">tools allowlist</span>
                  <span className="files-config__tools">
                    {report.toolsAllowlist.map((t) => (
                      <code key={t}>{t}</code>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
          <ul className="files-list">
            {report.files.map((f) => {
              const chips: string[] = [];
              if (f.counts.workflows) chips.push(`${f.counts.workflows} wf`);
              if (f.counts.phases) chips.push(`${f.counts.phases} phases`);
              if (f.counts.agents) chips.push(`${f.counts.agents} agents`);
              if (f.counts.schedules) chips.push(`${f.counts.schedules} sched`);
              if (f.counts.triggers) chips.push(`${f.counts.triggers} trig`);
              if (f.counts.mcpServers) chips.push(`${f.counts.mcpServers} mcp`);
              const open = fileView?.path === f.path;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`files-row files-row--btn ${f.ok ? "" : "files-row--err"} ${open ? "files-row--open" : ""}`}
                    title={f.error ?? "View file"}
                    onClick={() => (open ? setFileView(null) : void openFile(f.path))}
                  >
                    <span className="files-row__mark">{f.ok ? "✓" : "✗"}</span>
                    <span className="files-row__kind">{f.kind}</span>
                    <code className="files-row__path">{basename(f.path)}</code>
                    {chips.length > 0 && (
                      <span className="files-row__chips">
                        {chips.map((c) => (
                          <span key={c} className="files-row__chip">
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                    {f.error && <span className="files-row__error">{f.error}</span>}
                    <span className="files-row__view">{open ? "Hide" : "View"}</span>
                  </button>
                  {open && (
                    <div className="file-viewer">
                      {fileView?.loading && (
                        <p className="file-viewer__status">Reading…</p>
                      )}
                      {fileView?.error && (
                        <p className="file-viewer__status file-viewer__status--err">
                          {fileView.error}
                        </p>
                      )}
                      {fileView?.content != null && (
                        <pre className="file-viewer__pre">{fileView.content}</pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
