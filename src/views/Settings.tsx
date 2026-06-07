import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { Input } from "../components/ui/input";
import type { Plugin as PluginType } from "../types/contracts";

function PluginCard({
  plugin,
  busy,
  onInstall,
}: {
  plugin: PluginType;
  busy: boolean;
  onInstall: (p: PluginType) => void;
}) {
  return (
    <div className="plugin-card">
      <div className="plugin-card__main">
        <div className="plugin-card__name">{plugin.name}</div>
        <div className="plugin-card__meta">
          <span className="muted small">{plugin.kind}</span>
          <span className="dot-sep">·</span>
          <span className="muted small">v{plugin.version}</span>
        </div>
      </div>
      <div className="plugin-card__action">
        {plugin.installed ? (
          <Badge tone="passed" dot>installed</Badge>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onInstall(plugin)}
          >
            {busy ? "Installing…" : "Install"}
          </Button>
        )}
      </div>
    </div>
  );
}
import {
  pluginInstall,
  pluginInstallDefaults,
  pluginList,
  settingsGetTunnelUrl,
  settingsSetTunnelUrl,
} from "../api/_invoke";
import { useAuthStore } from "../state/auth";
import { useDaemonStore } from "../state/daemon";
import { RECOMMENDED_PACKS } from "../data/packs";
import type { Plugin } from "../types/contracts";

type FilterKey =
  | "all"
  | "provider"
  | "subject_backend"
  | "pack"
  | "trigger"
  | "transport"
  | "other";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "provider", label: "Providers" },
  { key: "subject_backend", label: "Subject backends" },
  { key: "pack", label: "Packs" },
  { key: "trigger", label: "Triggers" },
  { key: "transport", label: "Transports" },
  { key: "other", label: "Other" },
];

const KNOWN_KINDS = new Set([
  "provider",
  "subject_backend",
  "pack",
  "trigger",
  "transport",
]);

function classifyKind(kind: string): FilterKey {
  const k = kind.toLowerCase();
  if (KNOWN_KINDS.has(k)) return k as FilterKey;
  return "other";
}

function kindHeading(kind: string): string {
  switch (kind) {
    case "provider":
      return "Providers";
    case "subject_backend":
      return "Subject backends";
    case "pack":
      return "Packs";
    case "trigger":
      return "Triggers";
    case "transport":
      return "Transports";
    case "workflow_runner":
      return "Workflow runners";
    case "queue":
      return "Queue";
    case "web_ui":
      return "Web UI";
    default:
      return kind || "Other";
  }
}

export function Settings() {
  const daemon = useDaemonStore();
  const auth = useAuthStore();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelSaved, setTunnelSaved] = useState(false);
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginFilter, setPluginFilter] = useState<FilterKey>("all");

  useEffect(() => {
    void daemon.refresh();
    void auth.refresh();
    void loadPlugins();
    void loadTunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPlugins() {
    setPluginsLoading(true);
    try {
      const list = await pluginList();
      setPlugins(list);
    } finally {
      setPluginsLoading(false);
    }
  }

  async function loadTunnel() {
    const url = await settingsGetTunnelUrl();
    setTunnelUrl(url);
  }

  async function installDefaults() {
    setPluginsLoading(true);
    try {
      const list = await pluginInstallDefaults();
      setPlugins(list);
    } finally {
      setPluginsLoading(false);
    }
  }

  async function installOne(name: string) {
    setInstallingName(name);
    try {
      await pluginInstall(name);
      await loadPlugins();
    } finally {
      setInstallingName(null);
    }
  }

  async function saveTunnel() {
    await settingsSetTunnelUrl(tunnelUrl);
    setTunnelSaved(true);
    window.setTimeout(() => setTunnelSaved(false), 1800);
  }

  // Merge installed plugins with recommended packs (deduped by name) so the
  // "Recommended" packs from PLUGIN-ECOSYSTEM.md are visible even before they
  // are installed.
  const allPlugins = useMemo(() => {
    const byName = new Map<string, Plugin>();
    for (const p of plugins) byName.set(p.name, p);
    for (const rec of RECOMMENDED_PACKS) {
      if (!byName.has(rec.name)) byName.set(rec.name, rec);
    }
    return Array.from(byName.values());
  }, [plugins]);

  const filteredPlugins = useMemo(() => {
    const q = pluginSearch.trim().toLowerCase();
    return allPlugins.filter((p) => {
      if (pluginFilter !== "all" && classifyKind(p.kind) !== pluginFilter) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q)
      );
    });
  }, [allPlugins, pluginSearch, pluginFilter]);

  const groupedPlugins = useMemo(() => {
    const groups = new Map<string, Plugin[]>();
    for (const p of filteredPlugins) {
      const key = p.kind || "other";
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(
      ([, a], [, b]) => b.length - a.length,
    );
  }, [filteredPlugins]);

  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: allPlugins.length,
      provider: 0,
      subject_backend: 0,
      pack: 0,
      trigger: 0,
      transport: 0,
      other: 0,
    };
    for (const p of allPlugins) {
      counts[classifyKind(p.kind)] += 1;
    }
    return counts;
  }, [allPlugins]);

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="view__subtitle">
            Daemon, plugins, GitHub auth, and webhook tunnel.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Daemon</h2>
          {daemon.status ? (
            <Badge
              tone={daemon.status.running ? "running" : daemon.status.installed ? "warn" : "neutral"}
              dot
            >
              {daemon.status.running
                ? "Running"
                : daemon.status.installed
                  ? "Installed"
                  : "Not installed"}
            </Badge>
          ) : (
            <Spinner />
          )}
        </div>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{daemon.status?.version ?? "—"}</dd>
          <dt>PID</dt>
          <dd className="mono">{daemon.status?.pid ?? "—"}</dd>
          <dt>Binary</dt>
          <dd className="mono small">{daemon.status?.binary_path ?? "—"}</dd>
          <dt>Plugins installed</dt>
          <dd>{daemon.status?.plugins_installed ?? 0}</dd>
        </dl>
        <div className="card__actions">
          {!daemon.status?.installed && (
            <Button variant="primary" onClick={() => void daemon.install()}>
              Install daemon
            </Button>
          )}
          {daemon.status?.installed && !daemon.status.running && (
            <Button variant="primary" onClick={() => void daemon.start()}>
              Start
            </Button>
          )}
          {daemon.status?.running && (
            <Button variant="secondary" onClick={() => void daemon.stop()}>
              Stop
            </Button>
          )}
          <Button variant="ghost" onClick={() => void daemon.refresh()}>
            Refresh
          </Button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">GitHub</h2>
          {auth.status?.logged_in ? (
            <Badge tone="passed" dot>
              Signed in
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Signed out
            </Badge>
          )}
        </div>
        {auth.status?.logged_in ? (
          <>
            <dl className="kv">
              <dt>Account</dt>
              <dd>@{auth.status.login}</dd>
            </dl>
            <div className="card__actions">
              <Button variant="danger" onClick={() => void auth.logout()}>
                Sign out
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Sign in via GitHub device flow to list and connect repositories.
            </p>
            <div className="card__actions">
              <Button
                variant="primary"
                onClick={() => void auth.startDeviceFlow().then(() => auth.poll())}
              >
                Sign in with GitHub
              </Button>
            </div>
            {auth.deviceCode && (
              <div className="device-code-card">
                <div>
                  Enter code{" "}
                  <code className="mono">{auth.deviceCode.user_code}</code> at{" "}
                  <code className="mono">
                    {auth.deviceCode.verification_uri}
                  </code>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Webhook tunnel</h2>
          {tunnelSaved && (
            <Badge tone="passed" dot>
              Saved
            </Badge>
          )}
        </div>
        <p className="muted small">
          Public URL that GitHub will hit when sending pull-request events.
          Typically a Cloudflare Tunnel pointing at the local daemon.
        </p>
        <div className="form-row">
          <input
            className="input mono"
            type="url"
            placeholder="https://ci.your-domain.dev/webhook"
            value={tunnelUrl}
            onChange={(e) => setTunnelUrl(e.target.value)}
          />
          <Button variant="primary" onClick={() => void saveTunnel()}>
            Save
          </Button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Plugins</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void installDefaults()}
          >
            Install defaults
          </Button>
        </div>
        <p className="muted small">
          Animus ships 348 plugins. Browse what's installed locally and the 11
          recommended workflow packs from the marketplace.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <Input
              className="pl-8"
              placeholder="Search plugins by name or kind…"
              value={pluginSearch}
              onChange={(e) => setPluginSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = pluginFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setPluginFilter(f.key)}
                className={[
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-border bg-bg-elevated text-text-muted hover:border-border-strong hover:text-text",
                ].join(" ")}
              >
                <span>{f.label}</span>
                <span className="font-mono text-[10px] opacity-70">
                  {filterCounts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {pluginsLoading ? (
          <div className="mt-4">
            <Spinner label="Loading plugins…" />
          </div>
        ) : groupedPlugins.length === 0 ? (
          <div className="mt-4 text-sm text-text-muted">
            No plugins match this search.
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {groupedPlugins.map(([kind, list]) => (
              <div key={kind} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 px-0.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    {kindHeading(kind)}
                  </h3>
                  <span className="font-mono text-[11px] text-text-faint">
                    · {list.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {list.map((p) => (
                    <PluginCard
                      key={p.name}
                      plugin={p}
                      busy={installingName === p.name}
                      onInstall={(plugin) => void installOne(plugin.name)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
