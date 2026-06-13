import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  animusWorkflowPhaseUpsert,
  type AnimusStatus,
} from "../../api/animus";
import type { Project } from "../../types/contracts";
import { AgentFace, type AgentState } from "../../components/AgentFace";
import { useProjectAgentLiveStates } from "../../state/projectEvents";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Compose a phase (agent or command) and upsert it to the generated overlay.
 *  Returns the new phase id to the caller so the workflow composer can chain. */
function PhaseComposer({
  repoPath,
  agents,
  onSaved,
  onCancel,
}: {
  repoPath: string;
  agents: { id: string }[];
  onSaved: (phaseId: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [mode, setMode] = useState<"agent" | "command">("agent");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "swe");
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
          <label className="wf-field">
            <span>Agent</span>
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
          </label>
          <label className="wf-field">
            <span>Directive</span>
            <textarea
              className="wf-input"
              rows={3}
              placeholder="What should this agent do in this phase?"
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
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
          disabled={busy || !SLUG_RE.test(id.trim())}
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
  agents,
  onSaved,
  onRefresh,
  onCancel,
}: {
  repoPath: string;
  availablePhases: string[];
  agents: { id: string }[];
  onSaved: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [picker, setPicker] = useState("");
  const [newPhase, setNewPhase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existing phases + any newly authored ones not already in the picker list.
  const pickable = useMemo(
    () => Array.from(new Set([...availablePhases])).sort(),
    [availablePhases],
  );

  const addPhase = (p: string) => {
    if (p && !phases.includes(p)) setPhases((prev) => [...prev, p]);
    setPicker("");
  };
  const move = (i: number, d: -1 | 1) =>
    setPhases((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = async () => {
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
      if (res.ok) onSaved();
      else
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

  return (
    <section className="wf-compose">
      <div className="wf-compose__head">
        <h3 className="workflows-pane__group-title">New workflow</h3>
      </div>
      <div className="wf-compose__row">
        <input
          className="wf-input"
          placeholder="workflow-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="wf-input"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <input
        className="wf-input"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="wf-compose__phases">
        <div className="wf-compose__label">Phases (run in order)</div>
        {phases.length === 0 ? (
          <div className="wf-compose__empty">No phases yet — add one below.</div>
        ) : (
          <ol className="wf-phaselist">
            {phases.map((p, i) => (
              <li key={p} className="wf-phaselist__item">
                <span className="wf-phaselist__idx">{i + 1}</span>
                <span className="wf-phaselist__name">{p}</span>
                <div className="wf-phaselist__ctrls">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === phases.length - 1} aria-label="Move down">↓</button>
                  <button
                    type="button"
                    onClick={() => setPhases((prev) => prev.filter((x) => x !== p))}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {newPhase ? (
          <PhaseComposer
            repoPath={repoPath}
            agents={agents}
            onSaved={(pid) => {
              addPhase(pid);
              setNewPhase(false);
              onRefresh(); // refresh so the new phase shows in the picker too
            }}
            onCancel={() => setNewPhase(false)}
          />
        ) : (
          <div className="wf-compose__add">
            <select
              className="wf-input"
              value={picker}
              onChange={(e) => addPhase(e.target.value)}
            >
              <option value="">+ Add existing phase…</option>
              {pickable
                .filter((p) => !phases.includes(p))
                .map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => setNewPhase(true)}
            >
              + New phase
            </button>
          </div>
        )}
      </div>

      {error && <div className="wf-compose__err">{error}</div>}
      <div className="wf-compose__actions">
        <button
          type="button"
          className="workflow-row__run"
          disabled={busy || !SLUG_RE.test(id.trim()) || phases.length === 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Create workflow"}
        </button>
        <button type="button" className="plugins-pane__ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
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

      {tab === "workflows" && composing && (
        <WorkflowComposer
          repoPath={project.repo_path?.trim() ?? ""}
          availablePhases={report.phases.map((p) => p.id)}
          agents={report.agents.map((a) => ({ id: a.id }))}
          onSaved={() => {
            setComposing(false);
            void refresh();
          }}
          onRefresh={() => void refresh()}
          onCancel={() => setComposing(false)}
        />
      )}

      {tab === "workflows" && !composing && (
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
