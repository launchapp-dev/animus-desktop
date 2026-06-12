import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { PluginCard } from "../components/PluginCard";
import { Input } from "../components/ui/input";
import {
  daemonRestart,
  daemonStart,
  daemonStatus,
  daemonStop,
  pluginInstall,
  pluginInstallDefaults,
  pluginList,
  settingsGetTunnelUrl,
  settingsSetTunnelUrl,
} from "../api/_invoke";
import {
  animusDaemonConfigGet,
  animusDaemonConfigSet,
  type DaemonConfigData,
  type DaemonConfigUpdate,
} from "../api/animus";
import { useAuthStore } from "../state/auth";
import { useDaemonStore } from "../state/daemon";
import { useThemeStore } from "../state/theme";
import { RECOMMENDED_PACKS } from "../data/packs";
import type { DaemonStatus, Plugin, Project } from "../types/contracts";

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
  const theme = useThemeStore();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelSaved, setTunnelSaved] = useState(false);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
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
    setPluginsError(null);
    try {
      const list = await pluginList();
      setPlugins(list);
    } catch (e) {
      setPluginsError(String(e));
    } finally {
      setPluginsLoading(false);
    }
  }

  async function loadTunnel() {
    try {
      const url = await settingsGetTunnelUrl();
      setTunnelUrl(url);
    } catch (e) {
      setTunnelError(String(e));
    }
  }

  async function installDefaults() {
    setPluginsLoading(true);
    setPluginsError(null);
    try {
      const list = await pluginInstallDefaults();
      setPlugins(list);
    } catch (e) {
      setPluginsError(String(e));
    } finally {
      setPluginsLoading(false);
    }
  }

  async function installOne(name: string) {
    setInstallingName(name);
    setPluginsError(null);
    try {
      await pluginInstall(name);
      await loadPlugins();
    } catch (e) {
      setPluginsError(String(e));
    } finally {
      setInstallingName(null);
    }
  }

  async function saveTunnel() {
    setTunnelError(null);
    try {
      await settingsSetTunnelUrl(tunnelUrl);
      setTunnelSaved(true);
      window.setTimeout(() => setTunnelSaved(false), 1800);
    } catch (e) {
      setTunnelError(String(e));
    }
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
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Appearance</h2>
        </div>
        <div className="journal-filters">
          {(["light", "dark", "system"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={[
                "journal-filter",
                theme.mode === m ? "journal-filter--active" : "",
              ].join(" ").trim()}
              onClick={() => theme.setMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </section>

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
                disabled={auth.polling}
                onClick={() => {
                  void auth
                    .startDeviceFlow()
                    .then(() => auth.poll())
                    .catch(() => {
                      // Surfaced via auth.error below.
                    });
                }}
              >
                {auth.polling ? "Waiting for GitHub…" : "Sign in with GitHub"}
              </Button>
              {auth.polling && (
                <Button variant="ghost" onClick={() => auth.cancelPoll()}>
                  Cancel
                </Button>
              )}
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
            {auth.error && <p className="mcp-form__error">{auth.error}</p>}
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
        {tunnelError && <p className="mcp-form__error">{tunnelError}</p>}
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
        {pluginsError && <p className="mcp-form__error">{pluginsError}</p>}
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

function envelopeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err ?? "unknown error");
}

/** Per-project daemon management: lifecycle (start/stop/restart) and
 *  automation config (pool size, max workflows per tick, scheduler interval,
 *  auto-run/PR/merge). Every call passes the project's repo path so daemons
 *  and their configs stay isolated per project root. */
export function DaemonView({ project }: { project: Project }) {
  const path = project.repo_path?.trim() ?? "";
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [config, setConfig] = useState<DaemonConfigData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [poolSize, setPoolSize] = useState("");
  const [maxPerTick, setMaxPerTick] = useState("");
  const [intervalSecs, setIntervalSecs] = useState("");
  const [autoRunReady, setAutoRunReady] = useState(true);
  const [autoPr, setAutoPr] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);

  const seedForm = useCallback((c: DaemonConfigData) => {
    setConfig(c);
    setPoolSize(String(c.pool_size ?? ""));
    setMaxPerTick(c.max_tasks_per_tick != null ? String(c.max_tasks_per_tick) : "");
    setIntervalSecs(String(c.interval_secs ?? ""));
    setAutoRunReady(!!c.auto_run_ready);
    setAutoPr(!!c.auto_pr_enabled);
    setAutoMerge(!!c.auto_merge_enabled);
  }, []);

  const refresh = useCallback(async () => {
    if (!path) {
      setError("This project has no folder path on disk.");
      return;
    }
    setBusy("refresh");
    setError(null);
    try {
      const [st, cfg] = await Promise.all([
        daemonStatus(path),
        animusDaemonConfigGet(path),
      ]);
      setStatus(st);
      if (cfg.ok && cfg.data) {
        seedForm(cfg.data);
      } else {
        setError(
          envelopeError(cfg.error) ||
            `daemon config read failed: ${cfg.rawStderr || "—"}`,
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [path, seedForm]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function lifecycle(action: "start" | "stop" | "restart") {
    if (!path) return;
    setBusy(action);
    setError(null);
    try {
      const st =
        action === "start"
          ? await daemonStart(path)
          : action === "stop"
            ? await daemonStop(path)
            : await daemonRestart(path);
      setStatus(st);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function parsePositive(value: string, label: string): number | null {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`${label} must be a whole number ≥ 1`);
    }
    return n;
  }

  async function saveConfig() {
    if (!path || !config) return;
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const updates: DaemonConfigUpdate = {};
      if (poolSize.trim()) {
        const v = parsePositive(poolSize, "Pool size");
        if (v !== null && v !== config.pool_size) updates.poolSize = v;
      }
      if (maxPerTick.trim()) {
        const v = parsePositive(maxPerTick, "Max workflows per tick");
        if (v !== null && v !== config.max_tasks_per_tick) updates.maxTasksPerTick = v;
      }
      if (intervalSecs.trim()) {
        const v = parsePositive(intervalSecs, "Scheduler interval");
        if (v !== null && v !== config.interval_secs) updates.intervalSecs = v;
      }
      if (autoRunReady !== config.auto_run_ready) updates.autoRunReady = autoRunReady;
      if (autoPr !== config.auto_pr_enabled) updates.autoPr = autoPr;
      if (autoMerge !== config.auto_merge_enabled) updates.autoMerge = autoMerge;
      if (Object.keys(updates).length === 0) {
        setError("Nothing to save — no settings changed.");
        return;
      }
      const res = await animusDaemonConfigSet(path, updates);
      if (res.ok && res.data) {
        seedForm(res.data);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      } else {
        setError(
          envelopeError(res.error) ||
            `daemon config update failed: ${res.rawStderr || "—"}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="view">
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Daemon</h2>
          {status ? (
            <Badge
              tone={status.running ? "running" : status.installed ? "warn" : "neutral"}
              dot
            >
              {status.running
                ? "Running"
                : status.installed
                  ? "Stopped"
                  : "Not installed"}
            </Badge>
          ) : (
            <Spinner />
          )}
        </div>
        <p className="muted small">
          Each project runs its own daemon scoped to{" "}
          <code className="mono">{path || "—"}</code>.
        </p>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{status?.version ?? "—"}</dd>
          <dt>PID</dt>
          <dd className="mono">{status?.pid ?? "—"}</dd>
        </dl>
        <div className="card__actions">
          {status?.installed && !status.running && (
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => void lifecycle("start")}
            >
              {busy === "start" ? "Starting…" : "Start"}
            </Button>
          )}
          {status?.running && (
            <>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void lifecycle("restart")}
              >
                {busy === "restart" ? "Restarting…" : "Restart"}
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => void lifecycle("stop")}
              >
                {busy === "stop" ? "Stopping…" : "Stop"}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Automation</h2>
          {saved && (
            <Badge tone="passed" dot>
              Saved
            </Badge>
          )}
        </div>
        <p className="muted small">
          Pool size, max workflows per tick, and scheduler interval are
          hot-reloaded by a running daemon — no restart needed.
        </p>
        <dl className="kv">
          <dt>Pool size</dt>
          <dd>
            <input
              className="input mono"
              type="number"
              min={1}
              value={poolSize}
              onChange={(e) => setPoolSize(e.target.value)}
              placeholder="3"
              aria-label="Pool size (max concurrent agents)"
              style={{ width: 90 }}
            />
            <span className="muted small" style={{ marginLeft: 8 }}>
              max concurrent agents
            </span>
          </dd>
          <dt>Workflows / tick</dt>
          <dd>
            <input
              className="input mono"
              type="number"
              min={1}
              value={maxPerTick}
              onChange={(e) => setMaxPerTick(e.target.value)}
              placeholder="unlimited"
              aria-label="Max new workflows dispatched per scheduler tick"
              style={{ width: 90 }}
            />
            <span className="muted small" style={{ marginLeft: 8 }}>
              max new workflows dispatched per tick
            </span>
          </dd>
          <dt>Interval (s)</dt>
          <dd>
            <input
              className="input mono"
              type="number"
              min={1}
              value={intervalSecs}
              onChange={(e) => setIntervalSecs(e.target.value)}
              placeholder="10"
              aria-label="Scheduler interval in seconds"
              style={{ width: 90 }}
            />
            <span className="muted small" style={{ marginLeft: 8 }}>
              scheduler housekeeping interval
            </span>
          </dd>
        </dl>
        <label className="plugins-pane__toggle">
          <input
            type="checkbox"
            checked={autoRunReady}
            onChange={(e) => setAutoRunReady(e.target.checked)}
          />
          <span>Auto-dispatch ready tasks</span>
        </label>
        <label className="plugins-pane__toggle">
          <input
            type="checkbox"
            checked={autoPr}
            onChange={(e) => setAutoPr(e.target.checked)}
          />
          <span>Open PRs automatically after a workflow lands</span>
        </label>
        <label className="plugins-pane__toggle">
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => setAutoMerge(e.target.checked)}
          />
          <span>Auto-merge completed task branches</span>
        </label>
        {config?.config_path && (
          <p className="muted small mono" style={{ marginTop: 8 }}>
            {config.config_path}
          </p>
        )}
        {error && <p className="mcp-form__error">{error}</p>}
        <div className="card__actions">
          <Button
            variant="primary"
            disabled={busy !== null || !config}
            onClick={() => void saveConfig()}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>
    </div>
  );
}
