import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { useDaemonStore } from "../state/daemon";
import { useProjectsStore } from "../state/projects";
import type { CycleStatus, Project } from "../types/contracts";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - then);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusLabel(s: CycleStatus | undefined): string {
  if (!s) return "No cycles";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ProjectRow({ project }: { project: Project }) {
  const last = project.last_cycle;
  return (
    <Link to={`/projects/${project.id}`} className="project-row">
      <div className="project-row__main">
        <div className="project-row__name">{project.repo_full_name}</div>
        <div className="project-row__meta">
          <span className="lang-tag">{project.language}</span>
          <span className="dot-sep">·</span>
          <span>template: {project.template}</span>
        </div>
      </div>
      <div className="project-row__status">
        <Badge tone={last?.status ?? "neutral"} dot>
          {statusLabel(last?.status)}
        </Badge>
        <span className="muted small">
          {last ? formatRelative(last.started_at) : "—"}
        </span>
      </div>
    </Link>
  );
}

export function ProjectList() {
  const navigate = useNavigate();
  const { projects, loading, error, refresh } = useProjectsStore();
  const daemon = useDaemonStore((s) => s.status);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const noDaemon = daemon && !daemon.installed;

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Projects</h1>
          <p className="view__subtitle">
            {projects.length === 0
              ? "No projects yet — add a repository to start running CI."
              : `${projects.length} project${projects.length === 1 ? "" : "s"} configured`}
          </p>
        </div>
        <div className="view__actions">
          <Button
            variant="primary"
            onClick={() => navigate("/projects/new")}
            disabled={!!noDaemon}
          >
            + Add Project
          </Button>
        </div>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      {loading && projects.length === 0 ? (
        <div className="loading-pane">
          <Spinner label="Loading projects…" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description={
            noDaemon
              ? "Install the Animus daemon first, then connect a GitHub repository."
              : "Connect a GitHub repository to get CI/CD running in under a minute."
          }
          action={
            noDaemon ? (
              <Button variant="primary" onClick={() => navigate("/settings")}>
                Open settings
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => navigate("/projects/new")}
              >
                Add your first project
              </Button>
            )
          }
        />
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
