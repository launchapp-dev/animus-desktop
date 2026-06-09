import { useEffect, useMemo, useState } from "react";
import Avatar from "boring-avatars";
import { pluginInstall, pluginInstallDefaults, pluginList } from "../../api/_invoke";
import { PLUGIN_REGISTRY } from "../../data/plugin_registry";
import type { Plugin } from "../../types/contracts";

type Kind = string;

interface RoleSpec {
  key: string;
  label: string;
  short: string;
  description: string;
  required: boolean;
  minimum: number;
  kinds: string[];
  exampleIds: string[];
}

// The runtime composition — every capability the daemon expects, in the order
// it should appear in the header diagram. Required roles first.
const ROLES: RoleSpec[] = [
  {
    key: "provider",
    label: "Providers",
    short: "Who speaks for the agents.",
    description:
      "Provider plugins wrap CLI tools like claude, codex, gemini, opencode. The daemon needs at least one to dispatch agent work.",
    required: true,
    minimum: 1,
    kinds: ["provider"],
    exampleIds: [
      "animus-provider-claude",
      "animus-provider-codex",
      "animus-provider-gemini",
    ],
  },
  {
    key: "subject_task",
    label: "Task subjects",
    short: "Where tasks live.",
    description:
      "Subject backends store tasks. Animus needs one bound to kind=task to power `animus subject --kind task`.",
    required: true,
    minimum: 1,
    kinds: ["subject_backend"],
    exampleIds: ["animus-subject-default", "animus-subject-linear"],
  },
  {
    key: "subject_requirement",
    label: "Requirement subjects",
    short: "Where requirements live.",
    description:
      "Stores requirements (the PO-side scope unit). Required for the requirement workflows.",
    required: true,
    minimum: 1,
    kinds: ["subject_backend"],
    exampleIds: ["animus-subject-requirements"],
  },
  {
    key: "workflow_runner",
    label: "Workflow runner",
    short: "Drives phase execution.",
    description:
      "Spawns the workflow runner binary that turns phase definitions into agent calls.",
    required: true,
    minimum: 1,
    kinds: ["workflow_runner"],
    exampleIds: ["animus-workflow-runner-default"],
  },
  {
    key: "queue",
    label: "Queue",
    short: "Backs the dispatch queue.",
    description:
      "Manages pending / assigned / held tasks the daemon hands to the runner.",
    required: true,
    minimum: 1,
    kinds: ["queue"],
    exampleIds: ["animus-queue-default"],
  },
  {
    key: "transport",
    label: "Transports",
    short: "How the web UI talks to the daemon.",
    description:
      "HTTP + GraphQL transports expose the daemon to the web UI plugin. Optional if you only use the CLI.",
    required: false,
    minimum: 0,
    kinds: ["transport"],
    exampleIds: ["animus-transport-http", "animus-transport-graphql"],
  },
  {
    key: "web_ui",
    label: "Web UI",
    short: "Browser surface.",
    description:
      "The plugin-shipped web app. Spawned by `animus web serve`.",
    required: false,
    minimum: 0,
    kinds: ["web_ui"],
    exampleIds: ["animus-web-ui"],
  },
  {
    key: "trigger",
    label: "Triggers",
    short: "External event sources.",
    description:
      "Webhook, Slack, GitHub, file-watcher and other plugins that turn outside events into workflow runs.",
    required: false,
    minimum: 0,
    kinds: ["trigger"],
    exampleIds: ["animus-trigger-webhook", "animus-trigger-slack"],
  },
  {
    key: "log_storage",
    label: "Log storage",
    short: "Persistent run logs.",
    description: "Optional backend for archived run logs.",
    required: false,
    minimum: 0,
    kinds: ["log_storage"],
    exampleIds: ["animus-log-storage-sqlite"],
  },
  {
    key: "pack",
    label: "Packs",
    short: "Curated skill + workflow bundles.",
    description:
      "Pack plugins drop in pre-authored workflows (animus.task, animus.requirement, animus.review, animus.core-skills, etc.).",
    required: false,
    minimum: 0,
    kinds: ["pack"],
    exampleIds: [
      "animus.task",
      "animus.requirement",
      "animus.review",
      "animus.core-skills",
    ],
  },
];

const KIND_LABEL: Record<string, string> = {
  provider: "Provider",
  subject_backend: "Subject backend",
  pack: "Pack",
  trigger: "Trigger",
  transport: "Transport",
  workflow_runner: "Workflow runner",
  queue: "Queue",
  web_ui: "Web UI",
  log_storage: "Log storage",
};

const KIND_BLURB: Record<string, string> = {
  provider:
    "Wraps an LLM CLI (claude, codex, gemini, opencode, …) the daemon calls to drive agent work.",
  subject_backend:
    "Stores the units of work — tasks, requirements, or anything custom — that workflows operate on.",
  pack:
    "Curated bundle of skills + workflow definitions a project can adopt wholesale.",
  trigger:
    "Listens for external events (webhook, schedule, file change, Slack, GitHub) and fires workflows.",
  transport:
    "Exposes the daemon's control plane over HTTP, GraphQL, or another protocol so other tools (and the web UI) can talk to it.",
  workflow_runner:
    "Compiles workflow phase definitions into runs and supervises execution.",
  queue: "Holds pending / assigned / held subjects waiting for a runner.",
  web_ui: "The browser surface launched by `animus web serve`.",
  log_storage: "Durable storage for archived run logs.",
};

function classify(p: Plugin): string {
  return (p.kind || "other").toLowerCase();
}

function hueFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 64%)`;
}

function isOfficial(p: Plugin): boolean {
  return (p.repo ?? "").toLowerCase().startsWith("launchapp-dev/");
}

function repoUrlFor(plugin: Plugin): string | null {
  if (!plugin.repo) return null;
  if (plugin.repo.startsWith("http")) return plugin.repo;
  if (plugin.repo.includes("/")) return `https://github.com/${plugin.repo}`;
  return null;
}

function pluginsForRole(role: RoleSpec, all: Plugin[]): Plugin[] {
  return all.filter((p) => role.kinds.includes(classify(p)));
}

interface RoleStatus {
  role: RoleSpec;
  installed: Plugin[];
  matchedExamples: Plugin[];
  ok: boolean;
}

function evaluateRoles(all: Plugin[]): RoleStatus[] {
  return ROLES.map((role) => {
    const inThisKind = pluginsForRole(role, all);
    const installed = inThisKind.filter((p) => p.installed);
    let roleInstalled = installed;
    if (role.exampleIds.length > 0) {
      const matched = installed.filter((p) => role.exampleIds.includes(p.name));
      // For task / requirement subjects we filter by the canonical kind id —
      // we can't read the plugin's runtime kind from listing alone, so we
      // approximate via the well-known plugin name.
      if (
        role.key === "subject_task" ||
        role.key === "subject_requirement"
      ) {
        roleInstalled = matched;
      }
    }
    const ok = roleInstalled.length >= role.minimum;
    const matchedExamples = inThisKind.filter((p) =>
      role.exampleIds.includes(p.name),
    );
    return { role, installed: roleInstalled, matchedExamples, ok };
  });
}

const AVATAR_PALETTE = ["#eee8e0", "#d97757", "#e6b34c", "#8ee29a", "#7fa9ff", "#c992d4"];

function PluginCard({
  plugin,
  expanded,
  onToggle,
  onInstall,
  installing,
  blurb,
}: {
  plugin: Plugin;
  expanded: boolean;
  onToggle: () => void;
  onInstall: () => void;
  installing: boolean;
  blurb?: string;
}) {
  const kind = classify(plugin);
  const url = repoUrlFor(plugin);
  const text = blurb ?? KIND_BLURB[kind] ?? `${kind} plugin.`;
  return (
    <article
      className={`plugin-card ${expanded ? "plugin-card--expanded" : ""} ${plugin.installed ? "plugin-card--installed" : ""}`}
    >
      <header className="plugin-card__head" onClick={onToggle}>
        <span className="plugin-card__avatar plugin-card__avatar--boring" aria-hidden>
          <Avatar
            size={30}
            name={plugin.name}
            variant="marble"
            colors={AVATAR_PALETTE}
            square
          />
        </span>
        <div className="plugin-card__id-block">
          <h3 className="plugin-card__name">{plugin.name}</h3>
          <p className="plugin-card__short">{text}</p>
        </div>
        <div className="plugin-card__chips">
          <span className="team-member__chip team-member__chip--brain">
            {KIND_LABEL[kind] ?? kind}
          </span>
          {plugin.version && (
            <span className="team-member__chip">v{plugin.version}</span>
          )}
          {isOfficial(plugin) && (
            <span
              className="team-member__chip"
              title="Maintained by launchapp-dev"
              style={{ color: "var(--brass)" }}
            >
              official
            </span>
          )}
        </div>
        <div className="plugin-card__action">
          {plugin.installed ? (
            <span className="plugin-card__installed">Installed</span>
          ) : (
            <button
              type="button"
              className="workflow-row__run"
              disabled={installing}
              onClick={(e) => {
                e.stopPropagation();
                onInstall();
              }}
            >
              {installing ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <span className="team-member__expand">{expanded ? "▼" : "▶"}</span>
      </header>

      {expanded && (
        <div className="plugin-card__body">
          <p className="plugin-card__desc">
            {text}
            {KIND_BLURB[kind] && text !== KIND_BLURB[kind] ? (
              <>
                <br />
                <span style={{ color: "var(--text-faint)" }}>
                  {KIND_BLURB[kind]}
                </span>
              </>
            ) : null}
          </p>
          {url ? (
            <a
              className="plugin-card__link"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {plugin.repo} ↗
            </a>
          ) : (
            <span className="plugin-card__link plugin-card__link--muted">
              No repo metadata
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function RoleStrip({ status }: { status: RoleStatus }) {
  return (
    <div
      className={`role-strip ${status.ok ? "role-strip--ok" : status.role.required ? "role-strip--gap" : "role-strip--open"}`}
    >
      <div className="role-strip__head">
        <span
          aria-hidden
          className={`role-strip__dot role-strip__dot--${status.ok ? "ok" : status.role.required ? "gap" : "open"}`}
        />
        <span className="role-strip__label">{status.role.label}</span>
        <span className="role-strip__short">{status.role.short}</span>
        <span className="role-strip__count">
          {status.installed.length} / {status.role.minimum > 0 ? `${status.role.minimum}+` : "—"}
        </span>
      </div>
      {status.installed.length === 0 ? (
        <p className="role-strip__empty">
          {status.role.required
            ? "Required — daemon refuses to start without this."
            : "Optional — add when you need it."}
        </p>
      ) : (
        <ul className="role-strip__list">
          {status.installed.map((p) => (
            <li key={p.name} className="role-strip__chip">
              <span
                aria-hidden
                className="role-strip__chip-dot"
                style={{ background: hueFor(p.name) }}
              />
              {p.name}
              {p.version && (
                <span className="role-strip__chip-version">v{p.version}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PluginsView() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [showAvailable, setShowAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await pluginList();
      setPlugins(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function installOne(name: string) {
    setInstalling(name);
    try {
      await pluginInstall(name);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
    }
  }

  async function installDefaults() {
    setBulkBusy(true);
    try {
      const list = await pluginInstallDefaults();
      setPlugins(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setBulkBusy(false);
    }
  }

  const merged = useMemo(() => {
    const byName = new Map<string, Plugin>();
    // Start with the full registry — every published launchapp-dev plugin.
    for (const reg of PLUGIN_REGISTRY) {
      byName.set(reg.name, { ...reg });
    }
    // Overlay daemon-reported plugins (installed flag, real version, kind).
    for (const p of plugins) {
      const existing = byName.get(p.name);
      byName.set(p.name, existing ? { ...existing, ...p } : p);
    }
    return Array.from(byName.values()).sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [plugins]);

  const blurbFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of PLUGIN_REGISTRY) map.set(r.name, r.blurb);
    return map;
  }, []);

  const roleStatuses = useMemo(() => evaluateRoles(merged), [merged]);

  const totals = useMemo(() => {
    const installed = merged.filter((p) => p.installed).length;
    const required = roleStatuses.filter((r) => r.role.required);
    const gapsRequired = required.filter((r) => !r.ok).length;
    return {
      installed,
      total: merged.length,
      requiredCount: required.length,
      requiredOk: required.length - gapsRequired,
      gapsRequired,
    };
  }, [merged, roleStatuses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged
      .filter((p) => kind === "all" || classify(p) === kind)
      .filter((p) => (showAvailable ? true : p.installed))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.kind ?? "").toLowerCase().includes(q) ||
          (p.repo ?? "").toLowerCase().includes(q) ||
          (KIND_BLURB[classify(p)] ?? "").toLowerCase().includes(q)
        );
      });
  }, [merged, search, kind, showAvailable]);

  const kindOptions = useMemo(() => {
    const counts = new Map<string, { total: number; installed: number }>();
    for (const p of merged) {
      const k = classify(p);
      const cur = counts.get(k) ?? { total: 0, installed: 0 };
      cur.total += 1;
      if (p.installed) cur.installed += 1;
      counts.set(k, cur);
    }
    const arr = Array.from(counts.entries()).sort(
      ([, a], [, b]) => b.total - a.total,
    );
    return [
      {
        key: "all",
        label: "All",
        total: merged.length,
        installed: totals.installed,
      },
      ...arr.map(([k, v]) => ({
        key: k,
        label: KIND_LABEL[k] ?? k,
        total: v.total,
        installed: v.installed,
      })),
    ];
  }, [merged, totals.installed]);

  return (
    <div className="plugins-pane">
      <header className="plugins-pane__head">
        <div>
          <h2 className="workflows-pane__title">Runtime</h2>
          <p className="workflows-pane__subtitle">
            {totals.installed} of {totals.total} plugins installed ·{" "}
            {totals.requiredOk} of {totals.requiredCount} required roles
            satisfied
            {totals.gapsRequired > 0 && (
              <span style={{ color: "var(--crimson)", marginLeft: 6 }}>
                · {totals.gapsRequired} gap
                {totals.gapsRequired === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
        <div className="plugins-pane__head-actions">
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => void installDefaults()}
            disabled={bulkBusy || loading}
          >
            {bulkBusy ? "Installing…" : "Install defaults"}
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="workflow-error">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Plugin error</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
        </div>
      )}

      <section className="role-grid">
        {roleStatuses.map((s) => (
          <RoleStrip key={s.role.key} status={s} />
        ))}
      </section>

      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 8,
          borderTop: "var(--hairline) solid var(--border)",
        }}
      >
        <div>
          <h3 className="workflows-pane__group-title">Catalog</h3>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            Every plugin the daemon can see, plus the recommended set we ship
            with.
          </p>
        </div>
      </header>

      <div className="plugins-pane__toolbar">
        <input
          className="plugins-pane__search"
          placeholder="Search name, kind, repo, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="plugins-pane__toggle">
          <input
            type="checkbox"
            checked={!showAvailable}
            onChange={(e) => setShowAvailable(!e.target.checked)}
          />
          <span>Installed only</span>
        </label>
        <button
          type="button"
          className="plugins-pane__ghost"
          onClick={() =>
            setExpanded(
              expanded.size === filtered.length
                ? new Set()
                : new Set(filtered.map((p) => p.name)),
            )
          }
        >
          {expanded.size === filtered.length ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <nav className="plugins-pane__kinds" aria-label="Filter by kind">
        {kindOptions.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`plugins-pane__kind-chip ${kind === k.key ? "plugins-pane__kind-chip--active" : ""}`}
            onClick={() => setKind(k.key)}
          >
            <span>{k.label}</span>
            <span className="plugins-pane__kind-count">
              {k.installed}/{k.total}
            </span>
          </button>
        ))}
      </nav>

      <ul className="plugin-card-list">
        {filtered.length === 0 ? (
          <li style={{ color: "var(--text-faint)", fontSize: 12 }}>
            No plugins match.
          </li>
        ) : (
          filtered.map((p) => (
            <li key={p.name}>
              <PluginCard
                plugin={p}
                expanded={expanded.has(p.name)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.name)) next.delete(p.name);
                    else next.add(p.name);
                    return next;
                  })
                }
                onInstall={() => void installOne(p.name)}
                installing={installing === p.name}
                blurb={blurbFor.get(p.name)}
              />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
