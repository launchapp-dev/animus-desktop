import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { useProjectsStore } from "../state/projects";
import type { Cycle } from "../types/contracts";

function formatDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function CycleRow({ projectId, cycle }: { projectId: string; cycle: Cycle }) {
  return (
    <Link
      to={`/projects/${projectId}/cycles/${cycle.id}`}
      className="cycle-row"
    >
      <div className="cycle-row__id">
        <span className="mono small muted">#{cycle.id.slice(-6)}</span>
      </div>
      <div className="cycle-row__phases">
        {cycle.phases.map((p) => (
          <span
            key={p.name}
            className={`phase-pip phase-pip--${p.status}`}
            title={`${p.name}: ${p.status}`}
          />
        ))}
      </div>
      <div className="cycle-row__meta">
        <Badge tone={cycle.status} dot>
          {cycle.status}
        </Badge>
        <span className="muted small">
          {formatDuration(cycle.started_at, cycle.finished_at)}
        </span>
      </div>
    </Link>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selected, cycles, loading, error, select, loadCycles } =
    useProjectsStore();

  useEffect(() => {
    if (!id) return;
    void select(id);
    void loadCycles(id);
  }, [id, select, loadCycles]);

  if (loading && !selected) {
    return (
      <div className="view">
        <div className="loading-pane">
          <Spinner label="Loading project…" />
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="view">
        <EmptyState
          title="Project not found"
          description={error ?? "The project may have been deleted."}
          action={
            <Button variant="secondary" onClick={() => navigate("/")}>
              Back to projects
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="view">
      <div className="breadcrumb">
        <Link to="/" className="breadcrumb__link">
          ← Projects
        </Link>
      </div>

      <header className="view__header">
        <div>
          <h1 className="view__title">{selected.repo_full_name}</h1>
          <p className="view__subtitle">
            <span className="lang-tag">{selected.language}</span>
            <span className="dot-sep">·</span>
            <span>template: {selected.template}</span>
            <span className="dot-sep">·</span>
            <span>
              webhook:{" "}
              {selected.webhook_id !== null
                ? `#${selected.webhook_id}`
                : "not registered"}
            </span>
          </p>
        </div>
        <div className="view__actions">
          <Button variant="secondary">Run cycle</Button>
        </div>
      </header>

      <section className="section">
        <h2 className="section__title">Recent cycles</h2>
        {cycles.length === 0 ? (
          <EmptyState
            title="No cycles yet"
            description="Open a pull request on this repo to trigger your first cycle."
          />
        ) : (
          <div className="cycle-list">
            {cycles.map((c) => (
              <CycleRow key={c.id} projectId={selected.id} cycle={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
