import { useDaemonStore } from "../state/daemon";
import { useAuthStore } from "../state/auth";
import { useProjectsStore } from "../state/projects";
import { useActiveProject } from "../state/activeProject";

export function StatusBar() {
  const daemon = useDaemonStore((s) => s.status);
  const auth = useAuthStore((s) => s.status);
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useActiveProject((s) => s.activeProjectId);

  const active = projects.find((p) => p.id === activeId);
  const activeLabel = active
    ? active.repo_full_name ?? active.id
    : activeId === "all-agents"
      ? "all agents"
      : activeId === "plugins"
        ? "settings"
        : "no project";

  return (
    <footer className="statusbar">
      <span className="statusbar__group">
        <span
          className={`status-dot status-dot--${
            daemon?.installed ? "ok" : "off"
          }`}
        />
        <span>
          {daemon?.installed
            ? `animus ${daemon.version ?? ""}`.trim()
            : "animus not installed"}
        </span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span>{daemon?.plugins_installed ?? 0} plugins</span>
      </span>
      <span className="statusbar__separator" />
      <span className="statusbar__group">
        <span
          className={`status-dot status-dot--${auth?.logged_in ? "ok" : "off"}`}
        />
        <span>{auth?.logged_in ? `@${auth.login}` : "github not connected"}</span>
      </span>
      <span className="statusbar__separator" />
      <span className="statusbar__group">
        <span>{activeLabel}</span>
      </span>
      <span className="statusbar__hint">⌘K  ·  ⌘J right pane</span>
    </footer>
  );
}
