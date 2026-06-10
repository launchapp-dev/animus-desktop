import { type ReactNode } from "react";
import { SidebarTrigger } from "./ui/sidebar";
import { useProjectsStore } from "../state/projects";
import { useActiveProject, type BridgeMode } from "../state/activeProject";
import { useDaemonStore } from "../state/daemon";
import { ProjectList } from "../views/ProjectList";
import { Settings } from "../views/Settings";
import { WorkflowsView } from "../views/project/WorkflowsView";
import { VisualizeView } from "../views/project/VisualizeView";
import { PluginsView } from "../views/project/PluginsView";
import { AgentsView } from "../views/project/AgentsView";
import { McpView } from "../views/project/McpView";
import { FilesView } from "../views/project/FilesView";
import { SubjectsView } from "../views/project/SubjectsView";
import { SecretsView } from "../views/project/SecretsView";
import { JournalView } from "../views/project/JournalView";
import { StreamView } from "../views/project/StreamView";
import { ChatView } from "../views/project/ChatView";
import type { Project } from "../types/contracts";
import { useEffect, useRef, useState } from "react";
import { useBridgeStatus } from "../state/projectEvents";
import {
  bridgeAttachProject,
  bridgeDetachProject,
} from "../api/event_bridge";

const MODE_TABS: { key: BridgeMode; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "journal", label: "Journal" },
  { key: "stream", label: "Stream" },
  { key: "workflows", label: "Workflows" },
  { key: "agents", label: "Team" },
  { key: "mcp", label: "MCP" },
  { key: "files", label: "Files" },
  { key: "subjects", label: "Subjects" },
  { key: "visualize", label: "Visualize" },
  { key: "secrets", label: "Secrets" },
  { key: "plugins", label: "Plugins" },
];

function BridgeFrame({
  title,
  meta,
  tabs,
  children,
  bodyFill,
}: {
  title: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  bodyFill?: boolean;
}) {
  const daemon = useDaemonStore((s) => s.status);
  return (
    <main className="bridge">
      <header className="bridge__header">
        <SidebarTrigger className="size-7 -ml-1" />
        <span className="bridge__header-sep" />
        <h1 className="bridge__title">
          {title}
          {meta}
        </h1>
        {daemon?.installed ? (
          <span className="bridge__header-meta-right">
            <span>{daemon.version ?? "animus"}</span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span>{daemon.plugins_installed ?? 0} plugins</span>
          </span>
        ) : null}
      </header>
      {tabs}
      <div className={`bridge__body ${bodyFill ? "bridge__body--fill" : ""}`}>
        {children}
      </div>
    </main>
  );
}

function EmptyHome({ onAddProject }: { onAddProject: () => void }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        color: "var(--text-muted)",
        textAlign: "center",
        padding: 32,
      }}
    >
      <span
        className="status-dot status-dot--ok"
        style={{ width: 12, height: 12 }}
      />
      <p style={{ fontSize: 13, maxWidth: 360, color: "var(--text)" }}>
        Local-first agentic CI/CD. Add your first project to set up an agent
        crew — point at a local folder or a GitHub repo.
      </p>
      <button
        type="button"
        onClick={onAddProject}
        style={{
          background: "var(--accent)",
          color: "var(--accent-fg)",
          border: "none",
          padding: "8px 16px",
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        + Add project
      </button>
    </div>
  );
}

/** Banner shown over live views when the `animus daemon stream` bridge is
 *  down but the daemon claims to be running — otherwise the Journal/Stream
 *  silently display stale data. "Reconnect now" restarts the bridge task,
 *  which also resets its retry backoff. */
function StreamHealthBanner({ project }: { project: Project }) {
  const status = useBridgeStatus(project.id);
  const daemon = useDaemonStore((s) => s.status);
  const [busy, setBusy] = useState(false);
  if (!daemon?.running || !status || status.connected) return null;
  const retryIn =
    status.retryInMs != null ? Math.round(status.retryInMs / 1000) : null;
  const reconnect = async () => {
    const path = project.repo_path?.trim();
    if (!path) return;
    setBusy(true);
    try {
      await bridgeDetachProject(project.id).catch(() => undefined);
      await bridgeAttachProject(project.id, path);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bridge-streambanner" role="status">
      <span className="bridge-streambanner__dot" aria-hidden />
      <span>
        Live event stream disconnected
        {retryIn != null ? ` — retrying in ~${retryIn}s` : ""}
      </span>
      <button
        type="button"
        className="bridge-streambanner__btn"
        disabled={busy}
        onClick={() => void reconnect()}
      >
        {busy ? "Reconnecting…" : "Reconnect now"}
      </button>
    </div>
  );
}

function ProjectModeContent({
  mode,
  project,
}: {
  mode: BridgeMode;
  project: Project;
}) {
  switch (mode) {
    case "chat":
      return <ChatView project={project} />;
    case "journal":
      return <JournalView project={project} />;
    case "stream":
      return <StreamView project={project} />;
    case "workflows":
      return <WorkflowsView project={project} />;
    case "agents":
      return <AgentsView project={project} />;
    case "mcp":
      return <McpView project={project} />;
    case "files":
      return <FilesView project={project} />;
    case "subjects":
      return <SubjectsView project={project} />;
    case "visualize":
      return <VisualizeView project={project} />;
    case "secrets":
      return <SecretsView project={project} />;
    case "plugins":
      return <PluginsView />;
  }
}

export function Bridge({ onAddProject }: { onAddProject: () => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const refresh = useProjectsStore((s) => s.refresh);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const mode = useActiveProject((s) => s.mode);
  const setMode = useActiveProject((s) => s.setMode);
  const setActive = useActiveProject((s) => s.setActiveProject);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-select the first project once at startup only — re-running on every
  // deselect would make the "all projects" list unreachable.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (!activeId && projects.length > 0 && !autoSelected.current) {
      autoSelected.current = true;
      setActive(projects[0]!.id);
    }
  }, [activeId, projects, setActive]);

  if (!activeId) {
    if (projects.length === 0) {
      return (
        <BridgeFrame title="Animus">
          <EmptyHome onAddProject={onAddProject} />
        </BridgeFrame>
      );
    }
    return (
      <BridgeFrame title="Projects">
        <ProjectList />
      </BridgeFrame>
    );
  }

  if (activeId === "all-agents") {
    return (
      <BridgeFrame title="All agents">
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          Cross-project roster. Group by harness, project, or model.
          (Coming next round — wiring agents_list_all)
        </p>
      </BridgeFrame>
    );
  }

  if (activeId === "plugins") {
    return (
      <BridgeFrame title="Plugins">
        <Settings />
      </BridgeFrame>
    );
  }

  const project = projects.find((p) => p.id === activeId);
  const isRunning = project?.last_cycle?.status === "running";

  return (
    <BridgeFrame
      title={project?.repo_full_name ?? activeId}
      meta={
        isRunning ? (
          <span
            className="bridge__title-meta"
            style={{ color: "var(--blue)" }}
          >
            ●Running
          </span>
        ) : null
      }
      tabs={
        <nav className="bridge__tabs" aria-label="Project modes">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`bridge__tab ${
                mode === tab.key ? "bridge__tab--active" : ""
              }`}
              onClick={() => setMode(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      }
      bodyFill={
        mode === "visualize" ||
        mode === "chat" ||
        mode === "journal" ||
        mode === "stream" ||
        mode === "files"
      }
    >
      {project ? (
        <>
          {(mode === "journal" || mode === "stream") && (
            <StreamHealthBanner project={project} />
          )}
          {/* Keyed by project so EVERY per-project view remounts on switch —
              otherwise component state (turns, subjects, open files, runs,
              filters, half-filled forms) bleeds from one project into the
              next. */}
          <ProjectModeContent key={project.id} mode={mode} project={project} />
        </>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          Project record missing.
        </p>
      )}
    </BridgeFrame>
  );
}
