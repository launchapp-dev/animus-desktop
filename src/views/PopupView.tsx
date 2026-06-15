import { useCallback, useEffect, useState } from "react";
import { daemonStart, daemonStatus, daemonStop, projectList } from "../api/_invoke";
import { relativeTime } from "../lib/utils";
import type { CycleStatus, DaemonStatus, Project } from "../types/contracts";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function openMainWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const [{ WebviewWindow }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/webviewWindow"),
      import("@tauri-apps/api/window"),
    ]);
    const main = await WebviewWindow.getByLabel("main");
    if (main) {
      await main.show();
      await main.unminimize().catch(() => {});
      await main.setFocus();
    }
    await getCurrentWindow().hide();
  } catch (e) {
    console.warn("[popup] openMainWindow failed:", e);
  }
}

function daemonTone(d: DaemonStatus | null): "ok" | "warn" | "off" {
  if (!d) return "off";
  if (d.running) return "ok";
  if (d.installed) return "warn";
  return "off";
}

function daemonLabel(d: DaemonStatus | null): string {
  if (!d) return "Checking…";
  if (d.running) return "Running";
  if (d.installed) return "Stopped";
  return "Not installed";
}

function cycleTone(status: CycleStatus | undefined): "ok" | "warn" | "off" | "info" {
  if (status === "passed") return "ok";
  if (status === "failed" || status === "cancelled") return "warn";
  if (status === "running") return "info";
  return "off";
}

export function PopupView() {
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [d, p] = await Promise.all([
      daemonStatus().catch(() => null),
      projectList().catch(() => [] as Project[]),
    ]);
    setDaemon(d);
    setProjects(p);
  }, []);

  useEffect(() => {
    void refresh();
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("daemon-status-changed", () => void refresh()).then((u) => {
        unlisten = u;
      }),
    );
    return () => unlisten?.();
  }, [refresh]);

  const toggleDaemon = useCallback(async () => {
    if (!daemon) return;
    setBusy(true);
    try {
      const next = daemon.running ? await daemonStop() : await daemonStart();
      setDaemon(next);
    } catch (e) {
      console.warn("[popup] toggle daemon failed:", e);
    } finally {
      setBusy(false);
    }
  }, [daemon]);

  const recent = [...projects]
    .filter((p) => p.last_cycle)
    .sort(
      (a, b) =>
        Date.parse(b.last_cycle!.started_at) -
        Date.parse(a.last_cycle!.started_at),
    )
    .slice(0, 5);

  const canToggle = !!daemon?.installed;

  return (
    <div className="popup-view">
      <header className="popup-view__header">
        <span className={`status-dot status-dot--${daemonTone(daemon)}`} />
        <span className="popup-view__title">Animus</span>
        <button
          type="button"
          className="popup-view__open"
          onClick={() => void openMainWindow()}
        >
          Open
        </button>
      </header>

      <div className="popup-row">
        <span className="popup-row__label">Daemon</span>
        <span className="popup-row__value">{daemonLabel(daemon)}</span>
        {canToggle && (
          <button
            type="button"
            className="popup-row__action"
            disabled={busy}
            onClick={() => void toggleDaemon()}
          >
            {busy ? "…" : daemon?.running ? "Stop" : "Start"}
          </button>
        )}
      </div>

      <div className="popup-section__label">Recent activity</div>
      <ul className="popup-list">
        {recent.length === 0 ? (
          <li className="popup-list__empty">No builds yet</li>
        ) : (
          recent.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="popup-list__row"
                onClick={() => void openMainWindow()}
                title={`${p.repo_full_name} — ${p.last_cycle!.status}`}
              >
                <span
                  className={`status-dot status-dot--${cycleTone(p.last_cycle?.status)}`}
                />
                <span className="popup-list__name">{p.repo_full_name}</span>
                <span className="popup-list__time">
                  {relativeTime(p.last_cycle!.started_at)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default PopupView;
