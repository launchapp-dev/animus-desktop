import { useEffect, useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import {
  pluginInstall,
  pluginInstallDefaults,
  pluginList,
  settingsGetTunnelUrl,
  settingsSetTunnelUrl,
} from "../api/_invoke";
import { useAuthStore } from "../state/auth";
import { useDaemonStore } from "../state/daemon";
import type { Plugin } from "../types/contracts";

export function Settings() {
  const daemon = useDaemonStore();
  const auth = useAuthStore();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelSaved, setTunnelSaved] = useState(false);

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
    await pluginInstall(name);
    await loadPlugins();
  }

  async function saveTunnel() {
    await settingsSetTunnelUrl(tunnelUrl);
    setTunnelSaved(true);
    window.setTimeout(() => setTunnelSaved(false), 1800);
  }

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
        {pluginsLoading ? (
          <Spinner label="Loading plugins…" />
        ) : (
          <div className="plugin-list">
            {plugins.map((p) => (
              <div key={p.name} className="plugin-row">
                <div>
                  <div className="plugin-row__name">{p.name}</div>
                  <div className="muted small mono">
                    {p.kind} · v{p.version}
                  </div>
                </div>
                {p.installed ? (
                  <Badge tone="passed" dot>
                    Installed
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void installOne(p.name)}
                  >
                    Install
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
