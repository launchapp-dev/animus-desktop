import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { useActiveProject } from "../state/activeProject";
import { useDaemonStore } from "../state/daemon";
import { useProjectsStore } from "../state/projects";
import type { CycleStatus, Project } from "../types/contracts";

const TOP_PROJECTS_LIMIT = 5;

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - then);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function statusLabel(s: CycleStatus | undefined): string {
  if (!s) return "no cycles";
  return s;
}

function lastActivityMs(p: Project): number {
  const t = p.last_cycle?.started_at;
  return t ? new Date(t).getTime() : 0;
}

function ProjectRow({ project }: { project: Project }) {
  const setActiveProject = useActiveProject((s) => s.setActiveProject);
  const last = project.last_cycle;
  return (
    <button
      type="button"
      onClick={() => setActiveProject(project.id)}
      className="project-row"
    >
      <div className="project-row__main">
        <div className="project-row__name">{project.repo_full_name}</div>
        <div className="project-row__meta">
          <span className="lang-tag">{project.language}</span>
          <span className="dot-sep">·</span>
          <span>{project.template}</span>
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
    </button>
  );
}

function ProjectSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="project-section">
      <header className="project-section__header">
        <h2 className="section__title">{title}</h2>
        <span className="project-section__count">{count}</span>
      </header>
      <div className="project-list">{children}</div>
    </section>
  );
}

export function ProjectList({
  onAddProject,
}: {
  onAddProject?: () => void;
}) {
  const setActiveProject = useActiveProject((s) => s.setActiveProject);
  const { projects, loading, error, refresh } = useProjectsStore();
  const daemon = useDaemonStore((s) => s.status);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { needsYou, running, top, rest } = useMemo(() => {
    const sorted = [...projects].sort(
      (a, b) => lastActivityMs(b) - lastActivityMs(a),
    );
    const needsYou = sorted.filter(
      (p) =>
        p.last_cycle?.status === "failed" ||
        p.last_cycle?.status === "cancelled",
    );
    const running = sorted.filter((p) => p.last_cycle?.status === "running");
    const healthy = sorted.filter(
      (p) =>
        !needsYou.includes(p) &&
        !running.includes(p) &&
        (p.last_cycle?.status === "passed" || !p.last_cycle),
    );
    const top = healthy.slice(0, TOP_PROJECTS_LIMIT);
    const rest = healthy.slice(TOP_PROJECTS_LIMIT);
    return { needsYou, running, top, rest };
  }, [projects]);

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
            onClick={() => onAddProject?.()}
            disabled={!!noDaemon || !onAddProject}
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
              <Button
                variant="primary"
                onClick={() => setActiveProject("plugins")}
              >
                Open settings
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => onAddProject?.()}
                disabled={!onAddProject}
              >
                Add your first project
              </Button>
            )
          }
        />
      ) : (
        <>
          <ProjectSection title="Needs you" count={needsYou.length}>
            {needsYou.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ProjectSection>

          <ProjectSection title="Running" count={running.length}>
            {running.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ProjectSection>

          <ProjectSection title="Top projects" count={top.length}>
            {top.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ProjectSection>

          {rest.length > 0 && (
            <section className="project-section">
              <button
                type="button"
                className="project-section__expand"
                onClick={() => setShowAll((s) => !s)}
              >
                <span>{showAll ? "Hide" : "Show"} {rest.length} more</span>
                <span className="muted small">
                  {showAll ? "▴" : "▾"}
                </span>
              </button>
              {showAll && (
                <div className="project-list">
                  {rest.map((p) => (
                    <ProjectRow key={p.id} project={p} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
