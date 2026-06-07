import { useEffect } from "react";
import {
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useDaemonStore } from "./state/daemon";
import { useAuthStore } from "./state/auth";
import { ProjectList } from "./views/ProjectList";
import { ProjectDetail } from "./views/ProjectDetail";
import { CycleDetail } from "./views/CycleDetail";
import { Settings } from "./views/Settings";
import { AddProjectFlow } from "./views/AddProjectFlow";

function Sidebar() {
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

  useEffect(() => {
    void refreshDaemon();
    void refreshAuth();
  }, [refreshDaemon, refreshAuth]);

  return (
    <div className="app-shell">
      <Sidebar />
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
