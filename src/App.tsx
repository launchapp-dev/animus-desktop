import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { WindowTitlebar } from "tauri-controls";
import { useDaemonStore } from "./state/daemon";
import { useAuthStore } from "./state/auth";
import { useActiveProject } from "./state/activeProject";
import { PopupView } from "./views/PopupView";
import { ProjectsRail } from "./components/ProjectsRail";
import { Bridge } from "./components/Bridge";
import { CommandPane } from "./components/CommandPane";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { AddProjectFlow } from "./views/AddProjectFlow";

function AppShell() {
  const refreshDaemon = useDaemonStore((s) => s.refresh);
  const refreshAuth = useAuthStore((s) => s.refresh);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commandOpen = useActiveProject((s) => s.commandOpen);
  const toggleCommand = useActiveProject((s) => s.toggleCommand);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void refreshDaemon();
    void refreshAuth();
  }, [refreshDaemon, refreshAuth]);

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

  if (location.pathname.startsWith("/projects/new")) {
    return (
      <Routes>
        <Route path="/projects/new" element={<AddProjectFlow />} />
      </Routes>
    );
  }

  return (
    <>
      <WindowTitlebar
        controlsOrder="left"
        windowControlsProps={{ platform: "macos" }}
        className="app-titlebar"
      />
      <div className={`mac-shell ${commandOpen ? "mac-shell--with-command" : ""}`}>
        <ProjectsRail onAddProject={() => navigate("/projects/new")} />
        <Bridge />
        <CommandPane />
        <StatusBar />
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
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
