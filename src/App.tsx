import { useEffect, useState } from "react";
import {
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { WindowTitlebar } from "tauri-controls";
import { useDaemonStore } from "./state/daemon";
import { useAuthStore } from "./state/auth";
import { ProjectList } from "./views/ProjectList";
import { ProjectDetail } from "./views/ProjectDetail";
import { CycleDetail } from "./views/CycleDetail";
import { Settings } from "./views/Settings";
import { AddProjectFlow } from "./views/AddProjectFlow";
import { PopupView } from "./views/PopupView";
import { CommandPalette } from "./components/CommandPalette";

function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const daemon = useDaemonStore((s) => s.status);
  const auth = useAuthStore((s) => s.status);
  const location = useLocation();

  const daemonTone: "ok" | "warn" | "off" = daemon?.running
    ? "ok"
    : daemon?.installed
      ? "warn"
      : "off";
  const daemonLabel = daemon?.running
    ? "Running"
    : daemon?.installed
      ? "Stopped"
      : "Not installed";

  return (
    <aside className="sidebar">
      <div className="sidebar__titlebar" data-tauri-drag-region>
        <WindowTitlebar
          controlsOrder="left"
          windowControlsProps={{ platform: "macos", className: "titlebar-controls" }}
        />
      </div>
      <Link to="/" className="sidebar__brand">
        <span className="brand-mark">●</span>
        <span className="brand-text">Animus</span>
      </Link>

      <nav className="sidebar__nav">
        <NavLink to="/" end className="nav-link">
          Projects
        </NavLink>
        <NavLink
          to="/projects/new"
          className={`nav-link ${
            location.pathname.startsWith("/projects/new") ? "active" : ""
          }`}
        >
          Add project
        </NavLink>
        <NavLink to="/settings" className="nav-link">
          Settings
        </NavLink>
        <button
          type="button"
          onClick={onOpenPalette}
          className="nav-link"
          style={{
            background: "transparent",
            border: "none",
            textAlign: "left",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Command palette</span>
          <span className="mono small" style={{ color: "var(--text-faint)" }}>
            ⌘K
          </span>
        </button>
      </nav>

      <div className="sidebar__footer">
        <div className="status-pill">
          <span className={`status-dot status-dot--${daemonTone}`} />
          <span className="status-pill__label">Daemon</span>
          <span className="status-pill__value">{daemonLabel}</span>
        </div>
        <div className="status-pill">
          <span
            className={`status-dot status-dot--${auth?.logged_in ? "ok" : "off"}`}
          />
          <span className="status-pill__label">GitHub</span>
          <span className="status-pill__value">
            {auth?.logged_in ? `@${auth.login}` : "signed out"}
          </span>
        </div>
      </div>
    </aside>
  );
}

function AppShell() {
  const refreshDaemon = useDaemonStore((s) => s.refresh);
  const refreshAuth = useAuthStore((s) => s.refresh);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    void refreshDaemon();
    void refreshAuth();
  }, [refreshDaemon, refreshAuth]);

  // ⌘K / Ctrl+K toggles the global command palette.
  useHotkeys(
    "mod+k",
    (event) => {
      event.preventDefault();
      setPaletteOpen((o) => !o);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [],
  );

  // Popup window loads index.html#/popup and skips the main app chrome.
  if (location.pathname.startsWith("/popup")) {
    return (
      <Routes>
        <Route path="/popup" element={<PopupView />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
      <main className="content">
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/new" element={<AddProjectFlow />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route
            path="/projects/:id/cycles/:cycleId"
            element={<CycleDetail />}
          />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
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
