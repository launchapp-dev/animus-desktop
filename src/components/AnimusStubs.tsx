// Renderers for `animus:<type>` fenced stubs emitted by the chat copilot.
// Payload is one JSON object per fence; anything malformed or unknown falls
// back to a plain code block. Payloads are model-generated, so every field
// access is defensive and collection sizes are capped.

import { Flame, Network, Sparkles } from "lucide-react";
import AgentFace, { type AgentState } from "./AgentFace";
import { statusTone, StatusPill } from "./AnimusJson";

export const ANIMUS_STUB_LANGS = [
  "animus:team",
  "animus:org",
  "animus:mcp",
  "animus:progress",
  "animus:scorecard",
  "animus:status",
];

const MEMBER_CAP = 24;
const ORG_DEPTH_CAP = 4;
const ORG_NODE_CAP = 50;
const TILE_CAP = 12;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function objList(v: unknown, cap: number): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).slice(0, cap);
}

function faceState(status: string): AgentState {
  const tone = statusTone(status);
  if (tone === "brass") return "running";
  if (tone === "green") return "done";
  if (tone === "crimson") return "error";
  return "idle";
}

const TONES = ["blue", "brass", "green", "crimson", "gray"];

function tone(v: unknown, fallback = "blue"): string {
  const t = str(v)?.toLowerCase();
  return t && TONES.includes(t) ? t : fallback;
}

function Bar({
  label,
  value,
  max,
  barTone,
}: {
  label: string | null;
  value: number;
  max: number;
  barTone: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="ast-bar">
      {label && (
        <div className="ast-bar__top">
          <span className="ast-bar__label">{label}</span>
          <span className="ast-bar__value">
            {value}
            {max !== 100 && ` / ${max}`}
          </span>
        </div>
      )}
      <div className="ast-bar__track">
        <div
          className={`ast-bar__fill ast-bar__fill--${barTone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TeamStub({ data }: { data: Record<string, unknown> }) {
  const members = objList(data.members, MEMBER_CAP);
  return (
    <div className="aj ast">
      <div className="aj__head">
        <span className="aj__icon"><Network size={13} /></span>
        <span className="aj__title">{str(data.name) ?? "Team"}</span>
        <span className="aj__count">{members.length} agents</span>
      </div>
      <div className="ast-team">
        {members.map((m, i) => {
          const id = str(m.id) ?? str(m.name) ?? `agent-${i}`;
          const status = str(m.status);
          return (
            <div key={i} className="ast-team__member">
              <AgentFace
                seed={id}
                state={status ? faceState(status) : "idle"}
                size={34}
              />
              <div className="ast-team__main">
                <div className="ast-team__name">{id}</div>
                <div className="ast-team__meta">
                  {str(m.role) && (
                    <span className="ast-chip ast-chip--role">
                      {str(m.role)}
                    </span>
                  )}
                  {str(m.tool) && <code className="aj-tag">{str(m.tool)}</code>}
                  {str(m.model) && (
                    <code className="aj-tag">{str(m.model)}</code>
                  )}
                </div>
              </div>
              {status && <StatusPill status={status} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrgNode({
  node,
  depth,
  budget,
}: {
  node: Record<string, unknown>;
  depth: number;
  budget: { left: number };
}) {
  if (budget.left <= 0) return null;
  budget.left -= 1;
  const children =
    depth < ORG_DEPTH_CAP ? objList(node.children, ORG_NODE_CAP) : [];
  return (
    <li className="ast-org__node">
      <div className="ast-org__card">
        <span className="ast-org__name">{str(node.name) ?? "—"}</span>
        {str(node.meta) && <span className="ast-org__meta">{str(node.meta)}</span>}
      </div>
      {children.length > 0 && (
        <ul className="ast-org__children">
          {children.map((c, i) => (
            <OrgNode key={i} node={c} depth={depth + 1} budget={budget} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrgStub({ data }: { data: Record<string, unknown> }) {
  const budget = { left: ORG_NODE_CAP };
  return (
    <div className="aj ast">
      <div className="aj__head">
        <span className="aj__icon">⌥</span>
        <span className="aj__title">Hierarchy</span>
      </div>
      <ul className="ast-org">
        <OrgNode node={data} depth={1} budget={budget} />
      </ul>
    </div>
  );
}

function McpStub({ data }: { data: Record<string, unknown> }) {
  const servers = objList(data.servers, TILE_CAP);
  return (
    <div className="aj ast">
      <div className="aj__head">
        <span className="aj__icon">⇄</span>
        <span className="aj__title">MCP Servers</span>
        <span className="aj__count">{servers.length}</span>
      </div>
      <div className="ast-mcp">
        {servers.map((s, i) => {
          const status = str(s.status)?.toLowerCase() ?? "unknown";
          const dot =
            status === "connected" ? "green" : status === "error" ? "crimson" : "gray";
          return (
            <div key={i} className="ast-mcp__server">
              <span className={`ast-dot ast-dot--${dot}`} />
              <div className="ast-mcp__main">
                <div className="ast-mcp__name">{str(s.name) ?? "—"}</div>
                {str(s.description) && (
                  <div className="ast-mcp__desc">{str(s.description)}</div>
                )}
              </div>
              <div className="ast-mcp__meta">
                {str(s.transport) && (
                  <code className="aj-tag">{str(s.transport)}</code>
                )}
                {num(s.tools) !== null && (
                  <span className="aj-muted">{num(s.tools)} tools</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressStub({ data }: { data: Record<string, unknown> }) {
  const items = objList(data.items, TILE_CAP);
  const barTone = tone(data.tone);
  return (
    <div className="aj ast ast--pad">
      {items.length > 0 ? (
        items.map((it, i) => (
          <Bar
            key={i}
            label={str(it.label)}
            value={num(it.value) ?? 0}
            max={num(it.max) ?? 100}
            barTone={tone(it.tone, barTone)}
          />
        ))
      ) : (
        <Bar
          label={str(data.label)}
          value={num(data.value) ?? 0}
          max={num(data.max) ?? 100}
          barTone={barTone}
        />
      )}
    </div>
  );
}

function ScorecardStub({ data }: { data: Record<string, unknown> }) {
  const stats = objList(data.stats, TILE_CAP);
  const level = isObj(data.level) ? data.level : null;
  const streak = num(data.streak);
  return (
    <div className="aj ast">
      <div className="aj__head">
        <span className="aj__icon"><Sparkles size={13} /></span>
        <span className="aj__title">{str(data.title) ?? "Scorecard"}</span>
        {streak !== null && streak > 0 && (
          <span className="ast-streak">
            <Flame size={12} /> {streak}
          </span>
        )}
      </div>
      {stats.length > 0 && (
        <div className="ast-tiles">
          {stats.map((s, i) => {
            const v = s.value;
            const value =
              typeof v === "number" || typeof v === "string" ? String(v) : "—";
            return (
              <div key={i} className="ast-tile">
                <div className={`ast-tile__value ast-tile__value--${tone(s.tone, "none")}`}>
                  {value}
                </div>
                <div className="ast-tile__label">{str(s.label) ?? ""}</div>
                {str(s.delta) && (
                  <div className="ast-tile__delta">{str(s.delta)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {level && (
        <div className="ast-level">
          <span className="ast-level__name">{str(level.name) ?? "Level"}</span>
          <Bar
            label={null}
            value={num(level.xp) ?? 0}
            max={num(level.next) ?? 100}
            barTone="brass"
          />
          <span className="ast-level__xp">
            {num(level.xp) ?? 0} / {num(level.next) ?? 100} XP
          </span>
        </div>
      )}
    </div>
  );
}

function StatusStub({ data }: { data: Record<string, unknown> }) {
  const tiles = objList(data.tiles, TILE_CAP);
  const stateTone = (state: string | null): string => {
    if (state === "ok") return "green";
    if (state === "warn") return "brass";
    if (state === "error") return "crimson";
    return "none";
  };
  return (
    <div className="aj ast">
      <div className="ast-tiles">
        {tiles.map((t, i) => (
          <div key={i} className="ast-tile">
            <div
              className={`ast-tile__value ast-tile__value--${stateTone(str(t.state))}`}
            >
              {str(t.value) ?? (num(t.value) !== null ? String(num(t.value)) : "—")}
            </div>
            <div className="ast-tile__label">{str(t.label) ?? ""}</div>
            {str(t.hint) && <div className="ast-tile__delta">{str(t.hint)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Fallback({ raw }: { raw: string }) {
  return (
    <pre className="ast-fallback">
      <code>{raw}</code>
    </pre>
  );
}

export function AnimusStub({ type, raw }: { type: string; raw: string }) {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return <Fallback raw={raw} />;
    data = parsed;
  } catch {
    return <Fallback raw={raw} />;
  }
  switch (type) {
    case "team":
      return <TeamStub data={data} />;
    case "org":
      return <OrgStub data={data} />;
    case "mcp":
      return <McpStub data={data} />;
    case "progress":
      return <ProgressStub data={data} />;
    case "scorecard":
      return <ScorecardStub data={data} />;
    case "status":
      return <StatusStub data={data} />;
    default:
      return <Fallback raw={raw} />;
  }
}

export default AnimusStub;
