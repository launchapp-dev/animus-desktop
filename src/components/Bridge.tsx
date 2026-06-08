import { useEffect } from "react";
import { useProjectsStore } from "../state/projects";
import { useActiveProject, type BridgeMode } from "../state/activeProject";
import { Chat } from "../views/Chat";
import { ProjectList } from "../views/ProjectList";
import { Settings } from "../views/Settings";

const MODE_TABS: { key: BridgeMode; label: string }[] = [
  { key: "journal", label: "Journal" },
  { key: "workflows", label: "Workflows" },
  { key: "secrets", label: "Secrets" },
  { key: "plugins", label: "Plugins" },
];

function EmptyHome() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: "var(--text-muted)",
        textAlign: "center",
        padding: 32,
      }}
    >
      <span
        className="status-dot status-dot--ok"
        style={{ width: 12, height: 12 }}
      />
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        Animus
      </h1>
      <p style={{ fontSize: 12.5, maxWidth: 320 }}>
        Local-first agentic CI/CD. Pick a project from the rail, or add your
        first one to set up an agent crew.
      </p>
    </div>
  );
}

function AllAgentsView() {
  return (
    <div className="bridge__body">
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        All agents
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Cross-project roster. Group by harness, project, or model.
        (Coming next round — wiring agents_list_all)
      </p>
    </div>
  );
}

function PluginsView() {
  return <Settings />;
}

function ProjectModeContent({ mode }: { mode: BridgeMode }) {
  switch (mode) {
    case "journal":
      return <Chat />;
    case "workflows":
      return (
        <div className="bridge__body">
          <p style={{ color: "var(--text-muted)" }}>
            Workflows mode — agents + workflows YAML editor lands here.
          </p>
        </div>
      );
    case "secrets":
      return (
        <div className="bridge__body">
          <p style={{ color: "var(--text-muted)" }}>
            Secrets &amp; env — keychain-backed UI lands here.
          </p>
        </div>
      );
    case "plugins":
      return <PluginsView />;
  }
}

export function Bridge() {
  const projects = useProjectsStore((s) => s.projects);
  const refresh = useProjectsStore((s) => s.refresh);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const mode = useActiveProject((s) => s.mode);
  const setMode = useActiveProject((s) => s.setMode);
  const setActive = useActiveProject((s) => s.setActiveProject);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-select first project on first load if nothing selected.
  useEffect(() => {
    if (!activeId && projects.length > 0) {
      setActive(projects[0]!.id);
    }
  }, [activeId, projects, setActive]);

  // Welcome empty state when no projects yet
  if (!activeId) {
    if (projects.length === 0) {
      return (
        <main className="bridge">
          <EmptyHome />
        </main>
      );
    }
    return (
      <main className="bridge">
        <ProjectList />
      </main>
    );
  }

  if (activeId === "all-agents") {
    return (
      <main className="bridge">
        <AllAgentsView />
      </main>
    );
  }

  if (activeId === "plugins") {
    return (
      <main className="bridge">
        <Settings />
      </main>
    );
  }

  const project = projects.find((p) => p.id === activeId);

  return (
    <main className="bridge">
      <header className="bridge__header">
        <h1 className="bridge__title">
          {project?.repo_full_name ?? activeId}
          {project?.last_cycle?.status === "running" && (
            <span
              className="bridge__title-meta"
              style={{ color: "var(--blue)" }}
            >
              ●Running
            </span>
          )}
        </h1>
      </header>
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
      <ProjectModeContent mode={mode} />
    </main>
  );
}
