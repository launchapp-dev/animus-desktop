import { useEffect, useMemo, useState } from "react";
import {
  invalidateLocalWorkflowsCache,
  localWorkflowsRead,
  type AgentSummary,
  type PhaseSummary,
  type WorkflowSummary,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import type { Project } from "../../types/contracts";
import { AgentFace, type AgentState } from "../../components/AgentFace";
import { localAgentUpdate, type AgentUpdate } from "../../api/agent_edit";
import { useProjectAgentLiveStates } from "../../state/projectEvents";

interface AgentContext {
  agent: AgentSummary;
  phases: PhaseSummary[];
  workflows: WorkflowSummary[];
  role: string;
}

function firstSentence(s: string): string {
  const trimmed = s.trim();
  const dot = trimmed.search(/[.!?](\s|$)/);
  if (dot > 0 && dot < 160) return trimmed.slice(0, dot + 1);
  if (trimmed.length <= 140) return trimmed;
  return trimmed.slice(0, 140) + "…";
}

function deriveRole(a: AgentSummary): string {
  if (a.role && a.role.trim()) return a.role.trim();
  if (a.description && a.description.trim()) return firstSentence(a.description);
  if (a.systemPrompt && a.systemPrompt.trim()) return firstSentence(a.systemPrompt);
  return "";
}

function buildContexts(report: WorkflowYamlReport): AgentContext[] {
  const phasesByAgent = new Map<string, PhaseSummary[]>();
  for (const p of report.phases) {
    if (!p.agent) continue;
    const list = phasesByAgent.get(p.agent) ?? [];
    list.push(p);
    phasesByAgent.set(p.agent, list);
  }
  const workflowsByPhase = new Map<string, WorkflowSummary[]>();
  for (const w of report.workflows) {
    for (const ref of w.phases) {
      if (ref.kind !== "phase") continue;
      const list = workflowsByPhase.get(ref.value) ?? [];
      list.push(w);
      workflowsByPhase.set(ref.value, list);
    }
  }
  return report.agents.map((a) => {
    const phases = phasesByAgent.get(a.id) ?? [];
    const workflows = Array.from(
      new Set(
        phases.flatMap((p) => workflowsByPhase.get(p.id) ?? []).map((w) => w.id),
      ),
    )
      .map((id) => report.workflows.find((w) => w.id === id))
      .filter((w): w is WorkflowSummary => !!w);
    return {
      agent: a,
      phases,
      workflows,
      role: deriveRole(a),
    };
  });
}

function PersonalityChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
}) {
  const color =
    tone === "good"
      ? "var(--green)"
      : tone === "warn"
        ? "var(--yellow)"
        : "var(--text)";
  return (
    <div className="personality-chip">
      <span className="personality-chip__label">{label}</span>
      <span className="personality-chip__value" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function BoolValue(v: boolean | null | undefined): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "default";
}
function BoolTone(v: boolean | null | undefined): "good" | "warn" | "neutral" {
  if (v === true) return "good";
  if (v === false) return "warn";
  return "neutral";
}

function AgentTeamMember({
  ctx,
  expanded,
  onToggle,
  liveState,
  editing,
  onEditToggle,
  onSaved,
}: {
  ctx: AgentContext;
  expanded: boolean;
  onToggle: () => void;
  liveState: AgentState;
  editing: boolean;
  onEditToggle: () => void;
  onSaved: () => void;
}) {
  const { agent, phases, workflows, role } = ctx;
  return (
    <article className={`team-member ${expanded ? "team-member--expanded" : ""}`}>
      <header
        className="team-member__head"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".team-member__edit-btn")) return;
          onToggle();
        }}
      >
        <span className="team-member__avatar team-member__avatar--boring">
          <AgentFace
            seed={agent.id}
            size={32}
            state={liveState}
            title={`@${agent.id}`}
          />
        </span>
        <div className="team-member__id-block">
          <h3 className="team-member__name">@{agent.id}</h3>
          {role && <p className="team-member__role">{role}</p>}
        </div>
        <div className="team-member__chips">
          {agent.model && (
            <span className="team-member__chip team-member__chip--brain">
              {agent.model}
            </span>
          )}
          {agent.tool && (
            <span className="team-member__chip team-member__chip--tool">
              {agent.tool}
            </span>
          )}
          <span className="team-member__chip team-member__chip--count">
            {phases.length} phase{phases.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          type="button"
          className="team-member__edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEditToggle();
          }}
          title={editing ? "Cancel editing" : "Edit agent"}
        >
          {editing ? "✕" : "✎"}
        </button>
        <span className="team-member__expand">{expanded ? "▼" : "▶"}</span>
      </header>

      {expanded && editing && (
        <div className="team-member__body">
          <AgentEditForm
            agent={agent}
            sourceFile={agent.sourceFile}
            agentId={agent.id}
            onCancel={onEditToggle}
            onSaved={() => {
              onEditToggle();
              onSaved();
            }}
          />
        </div>
      )}

      {expanded && !editing && (
        <div className="team-member__body">
          {agent.description && (
            <section>
              <h4 className="team-member__section-title">Description</h4>
              <p className="team-member__desc">{agent.description}</p>
            </section>
          )}

          {agent.systemPrompt && (
            <section>
              <h4 className="team-member__section-title">Briefing</h4>
              <pre className="team-member__prompt">{agent.systemPrompt}</pre>
            </section>
          )}

          {agent.systemPromptFile && (
            <section>
              <h4 className="team-member__section-title">Briefing file</h4>
              <code className="mono small">{agent.systemPromptFile}</code>
            </section>
          )}

          {(agent.persona.style ||
            agent.persona.instructions ||
            agent.persona.traits.length > 0) && (
            <section>
              <h4 className="team-member__section-title">Persona</h4>
              <div className="personality-grid">
                {agent.persona.style && (
                  <PersonalityChip label="Style" value={agent.persona.style} />
                )}
                {agent.persona.traits.length > 0 && (
                  <PersonalityChip
                    label="Traits"
                    value={agent.persona.traits.join(", ")}
                  />
                )}
              </div>
              {agent.persona.instructions && (
                <pre
                  className="team-member__prompt"
                  style={{ marginTop: 6 }}
                >
                  {agent.persona.instructions}
                </pre>
              )}
            </section>
          )}

          <section>
            <h4 className="team-member__section-title">Behavior</h4>
            <div className="personality-grid">
              <PersonalityChip
                label="Memory"
                value={
                  agent.memoryEnabled === true
                    ? `on · ${agent.memoryWritePolicy ?? "explicit"}`
                    : BoolValue(agent.memoryEnabled)
                }
                tone={BoolTone(agent.memoryEnabled)}
              />
              {agent.memoryScope && (
                <PersonalityChip
                  label="Memory scope"
                  value={agent.memoryScope}
                />
              )}
              {agent.memoryMaxContextChars != null && (
                <PersonalityChip
                  label="Memory ctx"
                  value={`${agent.memoryMaxContextChars} chars`}
                />
              )}
              <PersonalityChip
                label="Comms"
                value={BoolValue(agent.communicationEnabled)}
                tone={BoolTone(agent.communicationEnabled)}
              />
              {agent.communicationChannels.length > 0 && (
                <PersonalityChip
                  label="Channels"
                  value={agent.communicationChannels.join(", ")}
                />
              )}
              {agent.communicationCanMessage.length > 0 && (
                <PersonalityChip
                  label="Can DM"
                  value={agent.communicationCanMessage.join(", ")}
                />
              )}
              {agent.communicationMaxContextChars != null && (
                <PersonalityChip
                  label="Comms ctx"
                  value={`${agent.communicationMaxContextChars} chars`}
                />
              )}
              <PersonalityChip
                label="Network"
                value={BoolValue(agent.networkAccess)}
                tone={BoolTone(agent.networkAccess)}
              />
              <PersonalityChip
                label="Web search"
                value={BoolValue(agent.webSearch)}
                tone={BoolTone(agent.webSearch)}
              />
              {agent.reasoningEffort && (
                <PersonalityChip
                  label="Reasoning"
                  value={agent.reasoningEffort}
                />
              )}
            </div>
          </section>

          {(agent.maxAttempts != null ||
            agent.maxContinuations != null ||
            agent.timeoutSecs != null ||
            agent.toolProfile) && (
            <section>
              <h4 className="team-member__section-title">Limits</h4>
              <div className="personality-grid">
                {agent.maxAttempts != null && (
                  <PersonalityChip
                    label="Max attempts"
                    value={`${agent.maxAttempts}`}
                  />
                )}
                {agent.maxContinuations != null && (
                  <PersonalityChip
                    label="Max continuations"
                    value={`${agent.maxContinuations}`}
                  />
                )}
                {agent.timeoutSecs != null && (
                  <PersonalityChip
                    label="Timeout"
                    value={`${agent.timeoutSecs}s`}
                  />
                )}
                {agent.toolProfile && (
                  <PersonalityChip
                    label="Tool profile"
                    value={agent.toolProfile}
                  />
                )}
              </div>
            </section>
          )}

          {(agent.skills.length > 0 ||
            agent.capabilities.length > 0 ||
            agent.mcpServers.length > 0 ||
            agent.models.length > 0 ||
            agent.fallbackModels.length > 0 ||
            agent.fallbackTools.length > 0 ||
            agent.extraArgs.length > 0 ||
            agent.codexConfigOverrides.length > 0 ||
            agent.toolAllow.length > 0 ||
            agent.toolDeny.length > 0) && (
            <section>
              <h4 className="team-member__section-title">Tools &amp; skills</h4>
              <div className="capability-grid">
                {agent.skills.length > 0 && (
                  <CapabilityBlock label="Skills" items={agent.skills} />
                )}
                {agent.capabilities.length > 0 && (
                  <CapabilityBlock
                    label="Capability flags"
                    items={agent.capabilities.map(
                      (c) => `${c.key}=${c.value ? "on" : "off"}`,
                    )}
                  />
                )}
                {agent.mcpServers.length > 0 && (
                  <CapabilityBlock label="MCP" items={agent.mcpServers} />
                )}
                {agent.models.length > 0 && (
                  <CapabilityBlock
                    label="Models (registry refs)"
                    items={agent.models}
                  />
                )}
                {agent.fallbackModels.length > 0 && (
                  <CapabilityBlock
                    label="Fallback models"
                    items={agent.fallbackModels}
                  />
                )}
                {agent.fallbackTools.length > 0 && (
                  <CapabilityBlock
                    label="Fallback tools"
                    items={agent.fallbackTools}
                  />
                )}
                {agent.extraArgs.length > 0 && (
                  <CapabilityBlock label="Extra args" items={agent.extraArgs} />
                )}
                {agent.codexConfigOverrides.length > 0 && (
                  <CapabilityBlock
                    label="Codex overrides"
                    items={agent.codexConfigOverrides}
                  />
                )}
                {agent.toolAllow.length > 0 && (
                  <CapabilityBlock
                    label="Tools allowed"
                    items={agent.toolAllow}
                    tone="good"
                  />
                )}
                {agent.toolDeny.length > 0 && (
                  <CapabilityBlock
                    label="Tools denied"
                    items={agent.toolDeny}
                    tone="warn"
                  />
                )}
              </div>
            </section>
          )}

          <section>
            <h4 className="team-member__section-title">Active in</h4>
            {workflows.length === 0 ? (
              <p style={{ color: "var(--text-faint)", fontSize: 11 }}>
                Not used by any workflow yet.
              </p>
            ) : (
              <ul className="team-member__workflows">
                {workflows.map((w) => (
                  <li key={w.id} className="team-member__workflow">
                    <span className="team-member__workflow-name">{w.name}</span>
                    <code className="team-member__workflow-id">{w.id}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="team-member__section-title">Phases owned</h4>
            {phases.length === 0 ? (
              <p style={{ color: "var(--text-faint)", fontSize: 11 }}>
                No phases reference this agent.
              </p>
            ) : (
              <ul className="team-member__phases">
                {phases.map((p) => (
                  <li key={p.id + p.sourceFile} className="team-member__phase">
                    <code className="team-member__phase-id">{p.id}</code>
                    {p.directive && (
                      <span className="team-member__phase-directive">
                        {firstSentence(p.directive)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="team-member__foot">
            <span className="team-member__source" title={agent.sourceFile}>
              {agent.sourceFile}
            </span>
          </footer>
        </div>
      )}
    </article>
  );
}

function toUpdate(a: AgentContext["agent"]): AgentUpdate {
  return {
    model: a.model,
    tool: a.tool,
    systemPrompt: a.systemPrompt,
    systemPromptFile: a.systemPromptFile,
    description: a.description,
    role: a.role,
    persona: {
      style: a.persona.style,
      instructions: a.persona.instructions,
      traits: [...a.persona.traits],
    },
    models: [...a.models],
    skills: [...a.skills],
    fallbackModels: [...a.fallbackModels],
    fallbackTools: [...a.fallbackTools],
    extraArgs: [...a.extraArgs],
    codexConfigOverrides: [...a.codexConfigOverrides],
    mcpServers: [...a.mcpServers],
    memoryEnabled: a.memoryEnabled,
    memoryWritePolicy: a.memoryWritePolicy,
    memoryScope: a.memoryScope,
    memoryMaxContextChars: a.memoryMaxContextChars,
    communicationEnabled: a.communicationEnabled,
    communicationChannels: [...a.communicationChannels],
    communicationCanMessage: [...a.communicationCanMessage],
    communicationMaxContextChars: a.communicationMaxContextChars,
    networkAccess: a.networkAccess,
    webSearch: a.webSearch,
    reasoningEffort: a.reasoningEffort,
    maxAttempts: a.maxAttempts,
    maxContinuations: a.maxContinuations,
    timeoutSecs: a.timeoutSecs,
    toolProfile: a.toolProfile,
    toolAllow: [...a.toolAllow],
    toolDeny: [...a.toolDeny],
    capabilities: a.capabilities.map((c) => ({ key: c.key, value: c.value })),
  };
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseIntOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function TristateToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="agent-edit__tristate">
      <span className="agent-edit__label">{label}</span>
      <div className="agent-edit__tristate-options">
        {(["yes", "no", "default"] as const).map((opt) => {
          const next = opt === "yes" ? true : opt === "no" ? false : null;
          const active =
            (opt === "yes" && value === true) ||
            (opt === "no" && value === false) ||
            (opt === "default" && value === null);
          return (
            <button
              key={opt}
              type="button"
              className={`agent-edit__pill ${active ? "agent-edit__pill--active" : ""}`}
              onClick={() => onChange(next)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentEditForm({
  agent,
  sourceFile,
  agentId,
  onCancel,
  onSaved,
}: {
  agent: AgentContext["agent"];
  sourceFile: string;
  agentId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<AgentUpdate>(() => toUpdate(agent));
  const [skillsText, setSkillsText] = useState(agent.skills.join(", "));
  const [fallbackModelsText, setFallbackModelsText] = useState(
    agent.fallbackModels.join(", "),
  );
  const [fallbackToolsText, setFallbackToolsText] = useState(
    agent.fallbackTools.join(", "),
  );
  const [mcpServersText, setMcpServersText] = useState(
    agent.mcpServers.join(", "),
  );
  const [toolAllowText, setToolAllowText] = useState(agent.toolAllow.join(", "));
  const [toolDenyText, setToolDenyText] = useState(agent.toolDeny.join(", "));
  const [modelsText, setModelsText] = useState(agent.models.join(", "));
  const [extraArgsText, setExtraArgsText] = useState(agent.extraArgs.join(", "));
  const [codexOverridesText, setCodexOverridesText] = useState(
    agent.codexConfigOverrides.join(", "),
  );
  const [personaTraitsText, setPersonaTraitsText] = useState(
    agent.persona.traits.join(", "),
  );
  const [commChannelsText, setCommChannelsText] = useState(
    agent.communicationChannels.join(", "),
  );
  const [commCanMessageText, setCommCanMessageText] = useState(
    agent.communicationCanMessage.join(", "),
  );
  const [capabilityFlags, setCapabilityFlags] = useState<
    Array<{ key: string; value: boolean }>
  >(() => agent.capabilities.map((c) => ({ key: c.key, value: c.value })));
  const [maxAttemptsText, setMaxAttemptsText] = useState(
    agent.maxAttempts == null ? "" : String(agent.maxAttempts),
  );
  const [maxContText, setMaxContText] = useState(
    agent.maxContinuations == null ? "" : String(agent.maxContinuations),
  );
  const [timeoutText, setTimeoutText] = useState(
    agent.timeoutSecs == null ? "" : String(agent.timeoutSecs),
  );
  const [memMaxText, setMemMaxText] = useState(
    agent.memoryMaxContextChars == null
      ? ""
      : String(agent.memoryMaxContextChars),
  );
  const [commMaxText, setCommMaxText] = useState(
    agent.communicationMaxContextChars == null
      ? ""
      : String(agent.communicationMaxContextChars),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patch<K extends keyof AgentUpdate>(key: K, value: AgentUpdate[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const finalDraft: AgentUpdate = {
      ...draft,
      models: splitCsv(modelsText),
      skills: splitCsv(skillsText),
      fallbackModels: splitCsv(fallbackModelsText),
      fallbackTools: splitCsv(fallbackToolsText),
      extraArgs: splitCsv(extraArgsText),
      codexConfigOverrides: splitCsv(codexOverridesText),
      mcpServers: splitCsv(mcpServersText),
      toolAllow: splitCsv(toolAllowText),
      toolDeny: splitCsv(toolDenyText),
      capabilities: capabilityFlags
        .map((c) => ({ key: c.key.trim(), value: c.value }))
        .filter((c) => c.key !== ""),
      persona: {
        ...draft.persona,
        traits: splitCsv(personaTraitsText),
      },
      communicationChannels: splitCsv(commChannelsText),
      communicationCanMessage: splitCsv(commCanMessageText),
      memoryMaxContextChars: parseIntOrNull(memMaxText),
      communicationMaxContextChars: parseIntOrNull(commMaxText),
      maxAttempts: parseIntOrNull(maxAttemptsText),
      maxContinuations: parseIntOrNull(maxContText),
      timeoutSecs: parseIntOrNull(timeoutText),
    };
    try {
      await localAgentUpdate(sourceFile, agentId, finalDraft);
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agent-edit">
      <section>
        <h4 className="team-member__section-title">Identity</h4>
        <div className="agent-edit__grid">
          <label className="agent-edit__row">
            <span className="agent-edit__label">Role</span>
            <input
              className="plugins-pane__search"
              value={draft.role ?? ""}
              onChange={(e) =>
                patch("role", e.target.value === "" ? null : e.target.value)
              }
              placeholder="Product owner"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Description</span>
            <input
              className="plugins-pane__search"
              value={draft.description ?? ""}
              onChange={(e) =>
                patch(
                  "description",
                  e.target.value === "" ? null : e.target.value,
                )
              }
            />
          </label>
        </div>
        <label className="agent-edit__row" style={{ marginTop: 8 }}>
          <span className="agent-edit__label">System prompt (briefing)</span>
          <textarea
            className="agent-edit__textarea"
            rows={6}
            value={draft.systemPrompt ?? ""}
            onChange={(e) =>
              patch(
                "systemPrompt",
                e.target.value === "" ? null : e.target.value,
              )
            }
          />
        </label>
        <label className="agent-edit__row" style={{ marginTop: 8 }}>
          <span className="agent-edit__label">
            Briefing file <span style={{ color: "var(--text-faint)" }}>(optional, path to external prompt)</span>
          </span>
          <input
            className="plugins-pane__search"
            value={draft.systemPromptFile ?? ""}
            onChange={(e) =>
              patch(
                "systemPromptFile",
                e.target.value === "" ? null : e.target.value,
              )
            }
            placeholder=".animus/prompts/po.md"
          />
        </label>
      </section>

      <section>
        <h4 className="team-member__section-title">Persona</h4>
        <div className="agent-edit__grid">
          <label className="agent-edit__row">
            <span className="agent-edit__label">Style</span>
            <input
              className="plugins-pane__search"
              value={draft.persona.style ?? ""}
              onChange={(e) =>
                patch("persona", {
                  ...draft.persona,
                  style: e.target.value === "" ? null : e.target.value,
                })
              }
              placeholder="concise / friendly / formal"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Traits (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={personaTraitsText}
              onChange={(e) => setPersonaTraitsText(e.target.value)}
              placeholder="skeptical, detail-oriented"
            />
          </label>
        </div>
        <label className="agent-edit__row" style={{ marginTop: 8 }}>
          <span className="agent-edit__label">Persona instructions</span>
          <textarea
            className="agent-edit__textarea"
            rows={4}
            value={draft.persona.instructions ?? ""}
            onChange={(e) =>
              patch("persona", {
                ...draft.persona,
                instructions: e.target.value === "" ? null : e.target.value,
              })
            }
            placeholder="Additional shaping for tone/voice on top of the briefing"
          />
        </label>
      </section>

      <section>
        <h4 className="team-member__section-title">Brain &amp; hands</h4>
        <div className="agent-edit__grid">
          <label className="agent-edit__row">
            <span className="agent-edit__label">Model</span>
            <input
              className="plugins-pane__search"
              value={draft.model ?? ""}
              onChange={(e) =>
                patch("model", e.target.value === "" ? null : e.target.value)
              }
              placeholder="claude-sonnet-4-6"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Tool</span>
            <input
              className="plugins-pane__search"
              value={draft.tool ?? ""}
              onChange={(e) =>
                patch("tool", e.target.value === "" ? null : e.target.value)
              }
              placeholder="claude"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Tool profile</span>
            <input
              className="plugins-pane__search"
              value={draft.toolProfile ?? ""}
              onChange={(e) =>
                patch(
                  "toolProfile",
                  e.target.value === "" ? null : e.target.value,
                )
              }
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Reasoning effort</span>
            <input
              className="plugins-pane__search"
              value={draft.reasoningEffort ?? ""}
              onChange={(e) =>
                patch(
                  "reasoningEffort",
                  e.target.value === "" ? null : e.target.value,
                )
              }
              placeholder="low / medium / high"
            />
          </label>
        </div>
        <div className="agent-edit__grid" style={{ marginTop: 8 }}>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Fallback models (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={fallbackModelsText}
              onChange={(e) => setFallbackModelsText(e.target.value)}
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Fallback tools (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={fallbackToolsText}
              onChange={(e) => setFallbackToolsText(e.target.value)}
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Models registry refs (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              placeholder="primary, fallback-1, fallback-2"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Extra args (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={extraArgsText}
              onChange={(e) => setExtraArgsText(e.target.value)}
              placeholder="--flag, value"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Codex overrides (comma-sep)</span>
            <input
              className="plugins-pane__search"
              value={codexOverridesText}
              onChange={(e) => setCodexOverridesText(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section>
        <h4 className="team-member__section-title">Behavior</h4>
        <div className="agent-edit__tristate-grid">
          <TristateToggle
            label="Memory"
            value={draft.memoryEnabled}
            onChange={(v) => patch("memoryEnabled", v)}
          />
          <TristateToggle
            label="Comms"
            value={draft.communicationEnabled}
            onChange={(v) => patch("communicationEnabled", v)}
          />
          <TristateToggle
            label="Network"
            value={draft.networkAccess}
            onChange={(v) => patch("networkAccess", v)}
          />
          <TristateToggle
            label="Web search"
            value={draft.webSearch}
            onChange={(v) => patch("webSearch", v)}
          />
        </div>
        {draft.memoryEnabled === true && (
          <div className="agent-edit__grid" style={{ marginTop: 8 }}>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Memory write policy</span>
              <select
                className="plugins-pane__search"
                value={draft.memoryWritePolicy ?? ""}
                onChange={(e) =>
                  patch(
                    "memoryWritePolicy",
                    e.target.value === "" ? null : e.target.value,
                  )
                }
              >
                <option value="">(default: explicit)</option>
                <option value="explicit">explicit</option>
                <option value="phase_summary">phase_summary</option>
              </select>
            </label>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Memory scope</span>
              <input
                className="plugins-pane__search"
                value={draft.memoryScope ?? ""}
                onChange={(e) =>
                  patch(
                    "memoryScope",
                    e.target.value === "" ? null : e.target.value,
                  )
                }
                placeholder="project / global / phase"
              />
            </label>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Memory max context (chars)</span>
              <input
                className="plugins-pane__search"
                value={memMaxText}
                onChange={(e) =>
                  setMemMaxText(e.target.value.replace(/[^0-9]/g, ""))
                }
              />
            </label>
          </div>
        )}
        {draft.communicationEnabled === true && (
          <div className="agent-edit__grid" style={{ marginTop: 8 }}>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Channels (comma-sep)</span>
              <input
                className="plugins-pane__search"
                value={commChannelsText}
                onChange={(e) => setCommChannelsText(e.target.value)}
              />
            </label>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Can message (comma-sep)</span>
              <input
                className="plugins-pane__search"
                value={commCanMessageText}
                onChange={(e) => setCommCanMessageText(e.target.value)}
              />
            </label>
            <label className="agent-edit__row">
              <span className="agent-edit__label">Comms max context (chars)</span>
              <input
                className="plugins-pane__search"
                value={commMaxText}
                onChange={(e) =>
                  setCommMaxText(e.target.value.replace(/[^0-9]/g, ""))
                }
              />
            </label>
          </div>
        )}
      </section>

      <section>
        <h4 className="team-member__section-title">Limits</h4>
        <div className="agent-edit__grid">
          <label className="agent-edit__row">
            <span className="agent-edit__label">Max attempts</span>
            <input
              className="plugins-pane__search"
              value={maxAttemptsText}
              onChange={(e) =>
                setMaxAttemptsText(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="leave blank for default"
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Max continuations</span>
            <input
              className="plugins-pane__search"
              value={maxContText}
              onChange={(e) =>
                setMaxContText(e.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Timeout (sec)</span>
            <input
              className="plugins-pane__search"
              value={timeoutText}
              onChange={(e) =>
                setTimeoutText(e.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </label>
        </div>
      </section>

      <section>
        <h4 className="team-member__section-title">Tools &amp; skills</h4>
        <label className="agent-edit__row">
          <span className="agent-edit__label">Skills (comma-sep)</span>
          <input
            className="plugins-pane__search"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
          />
        </label>
        <div className="agent-edit__row" style={{ marginTop: 6 }}>
          <span className="agent-edit__label">
            Capability flags <span style={{ color: "var(--text-faint)" }}>(key + on/off)</span>
          </span>
          <ul
            style={{
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              marginTop: 4,
            }}
          >
            {capabilityFlags.map((flag, i) => (
              <li
                key={i}
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <input
                  className="plugins-pane__search"
                  style={{ flex: 1 }}
                  value={flag.key}
                  onChange={(e) =>
                    setCapabilityFlags((arr) =>
                      arr.map((c, idx) =>
                        idx === i ? { ...c, key: e.target.value } : c,
                      ),
                    )
                  }
                  placeholder="memory"
                />
                <button
                  type="button"
                  className={`agent-edit__pill ${flag.value ? "agent-edit__pill--active" : ""}`}
                  style={{ flex: "none", minWidth: 50 }}
                  onClick={() =>
                    setCapabilityFlags((arr) =>
                      arr.map((c, idx) =>
                        idx === i ? { ...c, value: !c.value } : c,
                      ),
                    )
                  }
                >
                  {flag.value ? "on" : "off"}
                </button>
                <button
                  type="button"
                  className="plugins-pane__ghost"
                  style={{ flex: "none" }}
                  onClick={() =>
                    setCapabilityFlags((arr) => arr.filter((_, idx) => idx !== i))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="plugins-pane__ghost"
                onClick={() =>
                  setCapabilityFlags((arr) => [...arr, { key: "", value: true }])
                }
              >
                + Add capability flag
              </button>
            </li>
          </ul>
        </div>
        <label className="agent-edit__row" style={{ marginTop: 6 }}>
          <span className="agent-edit__label">MCP servers (comma-sep)</span>
          <input
            className="plugins-pane__search"
            value={mcpServersText}
            onChange={(e) => setMcpServersText(e.target.value)}
          />
        </label>
        <div className="agent-edit__grid" style={{ marginTop: 6 }}>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Tools allowed</span>
            <input
              className="plugins-pane__search"
              value={toolAllowText}
              onChange={(e) => setToolAllowText(e.target.value)}
            />
          </label>
          <label className="agent-edit__row">
            <span className="agent-edit__label">Tools denied</span>
            <input
              className="plugins-pane__search"
              value={toolDenyText}
              onChange={(e) => setToolDenyText(e.target.value)}
            />
          </label>
        </div>
      </section>

      {err && (
        <div className="workflow-error">
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{err}</pre>
        </div>
      )}

      <footer className="agent-edit__foot">
        <span className="team-member__source" title={sourceFile}>
          writing to {sourceFile}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function CapabilityBlock({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone?: "good" | "warn";
}) {
  const color =
    tone === "good"
      ? "var(--green)"
      : tone === "warn"
        ? "var(--crimson)"
        : "var(--text-muted)";
  return (
    <div className="capability-block">
      <span className="capability-block__label">{label}</span>
      <ul className="capability-block__list">
        {items.map((s, i) => (
          <li
            key={i}
            className="capability-block__chip"
            style={{ borderColor: color, color }}
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentsView({ project }: { project: Project }) {
  const [report, setReport] = useState<WorkflowYamlReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const agentLiveStates = useProjectAgentLiveStates(project.id);

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

  const refresh = async () => {
    const path = project.repo_path?.trim();
    if (!path) return;
    invalidateLocalWorkflowsCache(path);
    try {
      const r = await localWorkflowsRead(path);
      setReport(r);
    } catch (e) {
      setError(String(e));
    }
  };

  const contexts = useMemo(
    () => (report ? buildContexts(report) : []),
    [report],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contexts;
    return contexts.filter((c) => {
      return (
        c.agent.id.toLowerCase().includes(q) ||
        (c.agent.model ?? "").toLowerCase().includes(q) ||
        (c.agent.tool ?? "").toLowerCase().includes(q) ||
        (c.agent.systemPrompt ?? "").toLowerCase().includes(q) ||
        (c.agent.description ?? "").toLowerCase().includes(q) ||
        c.agent.skills.some((s) => s.toLowerCase().includes(q)) ||
        c.agent.capabilities.some((c) => c.key.toLowerCase().includes(q)) ||
        c.workflows.some((w) =>
          (w.id + " " + w.name).toLowerCase().includes(q),
        ) ||
        c.phases.some((p) => p.id.toLowerCase().includes(q))
      );
    });
  }, [contexts, search]);

  const stats = useMemo(() => {
    const models = new Set<string>();
    const tools = new Set<string>();
    let phaseCount = 0;
    for (const c of contexts) {
      if (c.agent.model) models.add(c.agent.model);
      if (c.agent.tool) tools.add(c.agent.tool);
      phaseCount += c.phases.length;
    }
    return { models: Array.from(models), tools: Array.from(tools), phaseCount };
  }, [contexts]);

  if (loading && !report) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Reading agent roster…
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

  if (report.agents.length === 0) {
    return (
      <div className="workflow-error" style={{ background: "var(--bg-elevated)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          No agents on this team yet
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Add an <code>agents:</code> block to{" "}
          <code>.animus/workflows.yaml</code> or any file under{" "}
          <code>.animus/workflows/</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="agents-pane">
      <header className="agents-pane__head">
        <div>
          <h2 className="workflows-pane__title">Team</h2>
          <p className="workflows-pane__subtitle">
            {contexts.length} agent{contexts.length === 1 ? "" : "s"} ·{" "}
            {stats.models.length} model
            {stats.models.length === 1 ? "" : "s"} in use · owning{" "}
            {stats.phaseCount} phase{stats.phaseCount === 1 ? "" : "s"} across
            workflows
          </p>
        </div>
        <div className="agents-pane__head-stats">
          {stats.models.map((m) => (
            <span key={m} className="team-member__chip team-member__chip--brain">
              {m}
            </span>
          ))}
        </div>
      </header>

      <div className="plugins-pane__toolbar">
        <input
          className="plugins-pane__search"
          placeholder="Search agents, models, prompts, skills, phases…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="plugins-pane__ghost"
          onClick={() =>
            setExpanded(
              expanded.size === contexts.length
                ? new Set()
                : new Set(contexts.map((c) => c.agent.id)),
            )
          }
        >
          {expanded.size === contexts.length ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "var(--text-faint)", fontSize: 12, padding: "12px 0" }}>
          No agents match your search.
        </p>
      ) : (
        <ul className="team-list">
          {filtered.map((ctx) => (
            <li key={ctx.agent.id}>
              <AgentTeamMember
                ctx={ctx}
                liveState={agentLiveStates[ctx.agent.id] ?? "idle"}
                expanded={expanded.has(ctx.agent.id)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(ctx.agent.id)) next.delete(ctx.agent.id);
                    else next.add(ctx.agent.id);
                    return next;
                  })
                }
                editing={editing === ctx.agent.id}
                onEditToggle={() => {
                  setEditing((cur) => (cur === ctx.agent.id ? null : ctx.agent.id));
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    next.add(ctx.agent.id);
                    return next;
                  });
                }}
                onSaved={() => void refresh()}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
