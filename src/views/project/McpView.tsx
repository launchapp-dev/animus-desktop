import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "boring-avatars";
import {
  localWorkflowsRead,
  invalidateLocalWorkflowsCache,
  localMcpLink,
  localMcpServerUpsert,
  type McpServerInput,
  type McpServerSummary,
  type AgentSummary,
  type WorkflowYamlReport,
} from "../../api/workflow_yaml";
import type { Project } from "../../types/contracts";

const AVATAR_PALETTE = ["#eee8e0", "#d97757", "#e6b34c", "#8ee29a", "#7fa9ff", "#c992d4"];

// Animus transports are stdio (default) or http; OAuth only attaches to http.
function effectiveTransport(s: McpServerSummary): string {
  if (s.transport) return s.transport.toLowerCase();
  if (s.url) return "http";
  return "stdio";
}

function transportColor(t: string, oauth: boolean): string {
  if (oauth) return "var(--copper)";
  switch (t) {
    case "stdio":
      return "var(--green)";
    case "http":
    case "https":
      return "var(--blue)";
    default:
      return "var(--text-faint)";
  }
}

function transportLabel(s: McpServerSummary): string {
  const t = effectiveTransport(s);
  return s.oauth ? `${t} · oauth` : t;
}

interface ServerContext {
  server: McpServerSummary;
  attachedAgents: AgentSummary[];
}

function buildContexts(report: WorkflowYamlReport): ServerContext[] {
  return report.mcpServers.map((s) => ({
    server: s,
    attachedAgents: report.agents.filter((a) => a.mcpServers.includes(s.id)),
  }));
}

function OauthBlock({ server }: { server: McpServerSummary }) {
  const o = server.oauth;
  if (!o) return null;
  const rows: Array<[string, string | null]> = [
    ["flow", o.flow],
    ["token url", o.tokenUrl],
    ["client id env", o.clientIdEnv],
    ["client secret env", o.clientSecretEnv],
    ["refresh token env", o.refreshTokenEnv],
    ["bearer env", o.bearerEnv],
    ["audience", o.audience],
  ];
  return (
    <section>
      <h4 className="team-member__section-title">
        OAuth <span className="mcp-oauth-badge">web</span>
      </h4>
      <div className="personality-grid">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="personality-chip">
              <span className="personality-chip__label">{k}</span>
              <span className="personality-chip__value">
                <code style={{ background: "transparent" }}>{v}</code>
              </span>
            </div>
          ))}
        <div className="personality-chip">
          <span className="personality-chip__label">token cache</span>
          <span className="personality-chip__value">
            {o.cache === false ? "off" : "on"}
          </span>
        </div>
      </div>
      {o.scopes.length > 0 && (
        <ul className="capability-block__list" style={{ marginTop: 8 }}>
          {o.scopes.map((sc) => (
            <li
              key={sc}
              className="capability-block__chip"
              style={{ borderColor: "var(--copper)", color: "var(--copper)" }}
            >
              {sc}
            </li>
          ))}
        </ul>
      )}
      <p className="mcp-hint">
        Credentials resolve from the daemon's env vars at run time; the daemon
        brokers a bearer token and injects it as an Authorization header.
      </p>
    </section>
  );
}

function LinkPanel({
  server,
  allAgents,
  onToggle,
  busy,
}: {
  server: McpServerSummary;
  allAgents: AgentSummary[];
  onToggle: (agent: AgentSummary, linked: boolean) => void;
  busy: string | null;
}) {
  return (
    <section>
      <h4 className="team-member__section-title">Link to agents</h4>
      {allAgents.length === 0 ? (
        <p className="mcp-hint">No agents defined in this project yet.</p>
      ) : (
        <ul className="mcp-link-list">
          {allAgents.map((a) => {
            const linked = a.mcpServers.includes(server.id);
            const key = `${server.id}:${a.id}`;
            return (
              <li key={a.id} className="mcp-link-row">
                <label className="mcp-link-label">
                  <input
                    type="checkbox"
                    checked={linked}
                    disabled={busy === key}
                    onChange={(e) => onToggle(a, e.target.checked)}
                  />
                  <span className="mcp-link-name">@{a.id}</span>
                  {a.model && <code className="mcp-link-model">{a.model}</code>}
                </label>
                {busy === key && <span className="mcp-hint">saving…</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function McpCard({
  ctx,
  allAgents,
  expanded,
  onToggle,
  onLink,
  linkBusy,
}: {
  ctx: ServerContext;
  allAgents: AgentSummary[];
  expanded: boolean;
  onToggle: () => void;
  onLink: (agent: AgentSummary, linked: boolean, serverId: string) => void;
  linkBusy: string | null;
}) {
  const { server, attachedAgents } = ctx;
  const t = effectiveTransport(server);
  const ttColor = transportColor(t, !!server.oauth);
  const runCommand =
    server.command && t === "stdio"
      ? [server.command, ...server.args].join(" ")
      : null;

  return (
    <article className={`mcp-card ${expanded ? "mcp-card--expanded" : ""}`}>
      <header className="mcp-card__head" onClick={onToggle}>
        <span className="mcp-card__avatar" aria-hidden>
          <Avatar size={32} name={server.id} variant="bauhaus" colors={AVATAR_PALETTE} square />
        </span>
        <div className="mcp-card__id-block">
          <h3 className="mcp-card__name">{server.id}</h3>
          <p className="mcp-card__short">
            {server.url ?? runCommand ?? `${t} transport`}
          </p>
        </div>
        <div className="mcp-card__chips">
          <span className="team-member__chip" style={{ color: ttColor, borderColor: ttColor }}>
            {transportLabel(server)}
          </span>
          <span className="team-member__chip team-member__chip--count">
            {attachedAgents.length} agent{attachedAgents.length === 1 ? "" : "s"}
          </span>
          {server.tools.length > 0 && (
            <span className="team-member__chip team-member__chip--count">
              {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <span className="team-member__expand">{expanded ? "▼" : "▶"}</span>
      </header>

      {expanded && (
        <div className="mcp-card__body">
          <section>
            <h4 className="team-member__section-title">Connection</h4>
            {runCommand && (
              <code className="cmd-block__line" style={{ display: "block", marginBottom: 8 }}>
                $ {runCommand}
              </code>
            )}
            <div className="personality-grid">
              <div className="personality-chip">
                <span className="personality-chip__label">Transport</span>
                <span className="personality-chip__value" style={{ color: ttColor }}>
                  {transportLabel(server)}
                </span>
              </div>
              {server.url && (
                <div className="personality-chip">
                  <span className="personality-chip__label">URL</span>
                  <span className="personality-chip__value">
                    <code style={{ background: "transparent" }}>{server.url}</code>
                  </span>
                </div>
              )}
            </div>
          </section>

          <OauthBlock server={server} />

          {t === "http" && !server.oauth && (
            <p className="mcp-hint">
              Interactive login — the agent authenticates with this server on
              first connect (browser OAuth) and caches the token. No headless
              token is configured.
            </p>
          )}

          {server.tools.length > 0 && (
            <section>
              <h4 className="team-member__section-title">
                Tools exposed ({server.tools.length})
              </h4>
              <ul className="capability-block__list">
                {server.tools.map((t2) => (
                  <li
                    key={t2}
                    className="capability-block__chip"
                    style={{ borderColor: "var(--green)", color: "var(--green)" }}
                  >
                    {t2}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {server.envKeys.length > 0 && (
            <section>
              <h4 className="team-member__section-title">
                Env vars read ({server.envKeys.length})
              </h4>
              <ul className="capability-block__list">
                {server.envKeys.map((k) => (
                  <li
                    key={k}
                    className="capability-block__chip"
                    style={{
                      borderColor: "var(--text-muted)",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {k}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <LinkPanel
            server={server}
            allAgents={allAgents}
            busy={linkBusy}
            onToggle={(agent, linked) => onLink(agent, linked, server.id)}
          />

          <footer className="team-member__foot">
            <span className="team-member__source" title={server.sourceFile}>
              {server.sourceFile}
            </span>
          </footer>
        </div>
      )}
    </article>
  );
}

const OAUTH_FLOWS = ["client_credentials", "refresh_token", "manual_bearer"] as const;

type AuthMode = "interactive" | "headless";

interface FormState {
  id: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  env: string;
  tools: string;
  authMode: AuthMode;
  flow: (typeof OAUTH_FLOWS)[number];
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  refreshTokenEnv: string;
  bearerEnv: string;
  scopes: string;
  audience: string;
}

const EMPTY_FORM: FormState = {
  id: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  tools: "",
  authMode: "interactive",
  flow: "client_credentials",
  tokenUrl: "",
  clientIdEnv: "",
  clientSecretEnv: "",
  refreshTokenEnv: "",
  bearerEnv: "",
  scopes: "",
  audience: "",
};

function parseEnv(text: string): { key: string; value: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      if (i === -1) return { key: l, value: `\${${l}}` };
      return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    })
    .filter((p) => p.key);
}

function words(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function AddServerForm({
  onSubmit,
  onCancel,
  targetFile,
  saving,
  error,
}: {
  onSubmit: (id: string, input: McpServerInput) => void;
  onCancel: () => void;
  targetFile: string;
  saving: boolean;
  error: string | null;
}) {
  const [f, setF] = useState<FormState>(EMPTY_FORM);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const isHttp = f.transport === "http";

  const submit = () => {
    const input: McpServerInput = {
      transport: f.transport,
      command: isHttp ? null : f.command || null,
      args: isHttp ? [] : words(f.args),
      url: isHttp ? f.url || null : null,
      env: parseEnv(f.env),
      tools: words(f.tools),
      oauth:
        isHttp && f.authMode === "headless"
          ? {
              flow: f.flow,
              tokenUrl: f.tokenUrl || null,
              clientIdEnv: f.clientIdEnv || null,
              clientSecretEnv: f.clientSecretEnv || null,
              refreshTokenEnv: f.refreshTokenEnv || null,
              bearerEnv: f.bearerEnv || null,
              scopes: words(f.scopes),
              audience: f.audience || null,
              cache: null,
            }
          : null,
    };
    onSubmit(f.id.trim(), input);
  };

  return (
    <div className="mcp-form">
      <div className="mcp-form__grid">
        <label className="mcp-field">
          <span>Server id</span>
          <input value={f.id} onChange={(e) => set("id", e.target.value)} placeholder="context7" />
        </label>
        <label className="mcp-field">
          <span>Transport</span>
          <select
            value={f.transport}
            onChange={(e) => set("transport", e.target.value as "stdio" | "http")}
          >
            <option value="stdio">stdio (local process)</option>
            <option value="http">http (web)</option>
          </select>
        </label>

        {!isHttp && (
          <>
            <label className="mcp-field">
              <span>Command</span>
              <input value={f.command} onChange={(e) => set("command", e.target.value)} placeholder="npx" />
            </label>
            <label className="mcp-field">
              <span>Args</span>
              <input value={f.args} onChange={(e) => set("args", e.target.value)} placeholder="-y @context7/mcp" />
            </label>
          </>
        )}

        {isHttp && (
          <label className="mcp-field mcp-field--wide">
            <span>URL</span>
            <input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://agent.robinhood.com/mcp/trading" />
          </label>
        )}

        <label className="mcp-field mcp-field--wide">
          <span>Env (one KEY=value per line; bare KEY ⇒ {"${KEY}"})</span>
          <textarea
            rows={2}
            value={f.env}
            onChange={(e) => set("env", e.target.value)}
            placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}"}
          />
        </label>

        <label className="mcp-field mcp-field--wide">
          <span>Tools (optional, space-separated)</span>
          <input value={f.tools} onChange={(e) => set("tools", e.target.value)} placeholder="search fetch" />
        </label>
      </div>

      {isHttp && (
        <div className="mcp-form__oauth">
          <div className="mcp-authmode">
            <label className="mcp-checkbox">
              <input
                type="radio"
                name="mcp-authmode"
                checked={f.authMode === "interactive"}
                onChange={() => set("authMode", "interactive")}
              />
              <span>Interactive login</span>
            </label>
            <label className="mcp-checkbox">
              <input
                type="radio"
                name="mcp-authmode"
                checked={f.authMode === "headless"}
                onChange={() => set("authMode", "headless")}
              />
              <span>Headless token</span>
            </label>
          </div>
          {f.authMode === "interactive" ? (
            <p className="mcp-hint">
              You only have a URL — that's all you need. The agent signs in to
              this server via browser on first connect (standard MCP OAuth) and
              caches the token itself. Use this for servers like Robinhood.
              Choose <strong>Headless token</strong> only for unattended daemon
              runs where no human can complete a browser login.
            </p>
          ) : (
            <div className="mcp-form__grid">
              <label className="mcp-field">
                <span>Flow</span>
                <select value={f.flow} onChange={(e) => set("flow", e.target.value as FormState["flow"])}>
                  {OAUTH_FLOWS.map((fl) => (
                    <option key={fl} value={fl}>{fl}</option>
                  ))}
                </select>
              </label>
              {f.flow !== "manual_bearer" && (
                <label className="mcp-field">
                  <span>Token URL</span>
                  <input value={f.tokenUrl} onChange={(e) => set("tokenUrl", e.target.value)} placeholder="https://auth.example.com/oauth/token" />
                </label>
              )}
              {f.flow === "manual_bearer" ? (
                <label className="mcp-field">
                  <span>Bearer env</span>
                  <input value={f.bearerEnv} onChange={(e) => set("bearerEnv", e.target.value)} placeholder="MCP_BEARER_TOKEN" />
                </label>
              ) : (
                <>
                  <label className="mcp-field">
                    <span>Client id env</span>
                    <input value={f.clientIdEnv} onChange={(e) => set("clientIdEnv", e.target.value)} placeholder="MCP_CLIENT_ID" />
                  </label>
                  <label className="mcp-field">
                    <span>Client secret env</span>
                    <input value={f.clientSecretEnv} onChange={(e) => set("clientSecretEnv", e.target.value)} placeholder="MCP_CLIENT_SECRET" />
                  </label>
                  {f.flow === "refresh_token" && (
                    <label className="mcp-field">
                      <span>Refresh token env</span>
                      <input value={f.refreshTokenEnv} onChange={(e) => set("refreshTokenEnv", e.target.value)} placeholder="MCP_REFRESH_TOKEN" />
                    </label>
                  )}
                  <label className="mcp-field">
                    <span>Scopes (space-separated)</span>
                    <input value={f.scopes} onChange={(e) => set("scopes", e.target.value)} placeholder="read write" />
                  </label>
                  <label className="mcp-field">
                    <span>Audience (optional)</span>
                    <input value={f.audience} onChange={(e) => set("audience", e.target.value)} />
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mcp-form__error">{error}</p>}
      <div className="mcp-form__actions">
        <span className="mcp-hint">writes to {targetFile}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="plugins-pane__ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="workflow-row__run"
            onClick={submit}
            disabled={saving || !f.id.trim()}
          >
            {saving ? "Saving…" : "Add server"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function McpView({ project }: { project: Project }) {
  const [report, setReport] = useState<WorkflowYamlReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const path = project.repo_path?.trim();
    if (!path) {
      setError("This project has no folder path on disk.");
      return;
    }
    setLoading(true);
    setError(null);
    invalidateLocalWorkflowsCache(path);
    try {
      const r = await localWorkflowsRead(path);
      setReport(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [project.repo_path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const contexts = useMemo(() => (report ? buildContexts(report) : []), [report]);
  const allAgents = report?.agents ?? [];

  const targetFile = useMemo(() => {
    if (report?.mcpServers[0]) return report.mcpServers[0].sourceFile;
    const root = report?.projectRoot ?? project.repo_path ?? "";
    return `${root}/.animus/workflows/mcp-servers.yaml`;
  }, [report, project.repo_path]);

  const handleLink = useCallback(
    async (agent: AgentSummary, linked: boolean, serverId: string) => {
      const path = project.repo_path?.trim();
      if (!path) return;
      const key = `${serverId}:${agent.id}`;
      setLinkBusy(key);
      try {
        await localMcpLink(agent.sourceFile, agent.id, serverId, linked);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setLinkBusy(null);
      }
    },
    [project.repo_path, refresh],
  );

  const handleAdd = useCallback(
    async (id: string, input: McpServerInput) => {
      setSaving(true);
      setFormError(null);
      try {
        await localMcpServerUpsert(targetFile, id, input);
        setShowAdd(false);
        await refresh();
        setExpanded((prev) => new Set(prev).add(id));
      } catch (e) {
        setFormError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [targetFile, refresh],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contexts;
    return contexts.filter(
      (c) =>
        c.server.id.toLowerCase().includes(q) ||
        (c.server.command ?? "").toLowerCase().includes(q) ||
        (c.server.url ?? "").toLowerCase().includes(q) ||
        effectiveTransport(c.server).includes(q) ||
        c.server.tools.some((t) => t.toLowerCase().includes(q)) ||
        c.server.envKeys.some((k) => k.toLowerCase().includes(q)) ||
        c.attachedAgents.some((a) => a.id.toLowerCase().includes(q)),
    );
  }, [contexts, search]);

  if (loading && !report) {
    return <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Reading mcp_servers…</p>;
  }
  if (error && !report) {
    return (
      <div className="workflow-error">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn't read workflow files</div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
      </div>
    );
  }
  if (!report) return null;

  const byTransport = contexts.reduce<Record<string, number>>((acc, c) => {
    const key = c.server.oauth ? "oauth" : effectiveTransport(c.server);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const transportSummary = Object.entries(byTransport)
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");

  return (
    <div className="agents-pane">
      <header className="agents-pane__head">
        <div>
          <h2 className="workflows-pane__title">MCP servers</h2>
          <p className="workflows-pane__subtitle">
            {contexts.length} server{contexts.length === 1 ? "" : "s"}
            {transportSummary ? ` · ${transportSummary}` : ""} ·{" "}
            {report.agents.filter((a) => a.mcpServers.length > 0).length} of{" "}
            {report.agents.length} agents connected
          </p>
        </div>
        <button
          type="button"
          className="workflow-row__run"
          onClick={() => {
            setShowAdd((v) => !v);
            setFormError(null);
          }}
        >
          {showAdd ? "Close" : "+ Add MCP server"}
        </button>
      </header>

      {showAdd && (
        <AddServerForm
          onSubmit={handleAdd}
          onCancel={() => setShowAdd(false)}
          targetFile={targetFile}
          saving={saving}
          error={formError}
        />
      )}

      {error && report && <p className="mcp-form__error">{error}</p>}

      {contexts.length === 0 && !showAdd ? (
        <div className="workflow-error" style={{ background: "var(--bg-elevated)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No MCP servers configured</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Use <strong>+ Add MCP server</strong> above, or add an{" "}
            <code>mcp_servers:</code> block to a file under{" "}
            <code>.animus/workflows/</code>. stdio servers run a local command;
            http servers point at a URL and can broker OAuth.
          </p>
        </div>
      ) : (
        <>
          <div className="plugins-pane__toolbar">
            <input
              className="plugins-pane__search"
              placeholder="Search by id, command, url, transport, tool, env, agent…"
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
                    : new Set(contexts.map((c) => c.server.id)),
                )
              }
            >
              {expanded.size === contexts.length ? "Collapse all" : "Expand all"}
            </button>
          </div>

          {filtered.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: 12, padding: "12px 0" }}>
              No MCP servers match.
            </p>
          ) : (
            <ul className="team-list">
              {filtered.map((ctx) => (
                <li key={ctx.server.id}>
                  <McpCard
                    ctx={ctx}
                    allAgents={allAgents}
                    expanded={expanded.has(ctx.server.id)}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(ctx.server.id)) next.delete(ctx.server.id);
                        else next.add(ctx.server.id);
                        return next;
                      })
                    }
                    onLink={handleLink}
                    linkBusy={linkBusy}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
