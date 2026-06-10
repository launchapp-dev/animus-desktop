import { useEffect, useState } from "react";
import { HashRouter, useLocation } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { useDaemonStore } from "./state/daemon";
import { useAuthStore } from "./state/auth";
import { useActiveProject } from "./state/activeProject";
import { useProjectsStore } from "./state/projects";
import { useAddProject } from "./state/useAddProject";
import {
  useProjectEvents,
  type CycleEvent,
  type DaemonLogEvent,
} from "./state/projectEvents";
import {
  bridgeActiveProjects,
  bridgeAttachProject,
  bridgeDetachProject,
} from "./api/event_bridge";
import { PopupView } from "./views/PopupView";
import { ProjectsRail } from "./components/ProjectsRail";
import { Bridge } from "./components/Bridge";
import { CommandPane } from "./components/CommandPane";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";

interface DaemonStatusChangedPayload {
  status: string;
  project_id: string | null;
}

function AppShell() {
  const refreshDaemon = useDaemonStore((s) => s.refresh);
  const refreshAuth = useAuthStore((s) => s.refresh);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commandOpen = useActiveProject((s) => s.commandOpen);
  const toggleCommand = useActiveProject((s) => s.toggleCommand);
  const activeProjectId = useActiveProject((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);
  const location = useLocation();
  const addProject = useAddProject();

  useEffect(() => {
    void refreshDaemon();
    void refreshAuth();
  }, [refreshDaemon, refreshAuth]);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;
    const { pushLog, pushCycle, setDaemonStatus } = useProjectEvents.getState();

    void (async () => {
      const subs = await Promise.all([
        listen<DaemonLogEvent>("daemon-log", (event) => {
          pushLog(event.payload);
        }),
        listen<CycleEvent>("cycle-event", (event) => {
          pushCycle(event.payload);
        }),
        listen<DaemonStatusChangedPayload>(
          "daemon-status-changed",
          (event) => {
            setDaemonStatus(event.payload.project_id, event.payload.status);
          },
        ),
      ]);
      if (cancelled) {
        subs.forEach((u) => u());
        return;
      }
      unlisteners.push(...subs);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    if (activeProjectId === "all-agents" || activeProjectId === "plugins") {
      return;
    }
    const project = projects.find((p) => p.id === activeProjectId);
    const repoPath = project?.repo_path?.trim();
    if (!repoPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const active = await bridgeActiveProjects();
        if (cancelled) return;
        // Detach every project except the one we're switching to. We used to
        // accumulate bridges as the user switched, so N projects = N daemon
        // stream subprocesses respawning in the background even though only
        // one project is visible.
        await Promise.all(
          active
            .filter((id) => id !== activeProjectId)
            .map((id) =>
              bridgeDetachProject(id).catch(() => undefined),
            ),
        );
        if (cancelled) return;
        if (active.includes(activeProjectId)) return;
        await bridgeAttachProject(activeProjectId, repoPath);
        // The user may have switched away while the attach was in flight —
        // a later effect run can't see this bridge yet (it wasn't listed),
        // so detach it ourselves or it leaks a stream subprocess.
        if (cancelled) {
          await bridgeDetachProject(activeProjectId).catch(() => undefined);
        }
      } catch (e) {
        console.warn("[bridge_attach] failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, projects]);

  useHotkeys(
    "mod+k",
    (event) => {
      event.preventDefault();
      setPaletteOpen((o) => !o);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [],
  );

  useHotkeys(
    "mod+j",
    (event) => {
      event.preventDefault();
      toggleCommand();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [toggleCommand],
  );

  if (location.pathname.startsWith("/popup")) {
    return <PopupView />;
  }

  const handleAddProject = () => {
    void addProject.run();
  };

  return (
    <>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "15rem",
            "--sidebar-width-icon": "3rem",
          } as React.CSSProperties
        }
      >
        <ProjectsRail
          onAddProject={handleAddProject}
          addProjectBusy={addProject.busy}
        />
        <SidebarInset className="!bg-transparent !h-screen !max-h-screen overflow-hidden">
          <div className={`bridge-shell ${commandOpen ? "bridge-shell--with-command" : ""}`}>
            <Bridge onAddProject={handleAddProject} />
            <CommandPane />
          </div>
          <StatusBar />
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {addProject.error && (
        <div
          className="alert alert--error"
          style={{
            position: "fixed",
            bottom: 36,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            maxWidth: 480,
          }}
        >
          Add project failed: {addProject.error}
        </div>
      )}
    </>
  );
}

function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

export default App;
