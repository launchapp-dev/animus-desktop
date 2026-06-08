import { useProjectsStore } from "../state/projects";
import { useActiveProject } from "../state/activeProject";
import type { CycleStatus } from "../types/contracts";

function dotToneFor(status: CycleStatus | undefined): "ok" | "warn" | "off" {
  if (status === "passed") return "ok";
  if (status === "failed" || status === "cancelled") return "warn";
  return "off";
}

export function ProjectsRail({ onAddProject }: { onAddProject: () => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const setActive = useActiveProject((s) => s.setActiveProject);

  return (
    <nav className="rail" aria-label="Projects">
      <section className="rail__section">
        <header className="rail__section-label">
          <span>Projects</span>
          <span className="rail__section-badge">{projects.length}</span>
        </header>

        {projects.length === 0 ? (
          <p className="rail__item" style={{ color: "var(--text-faint)", cursor: "default" }}>
            None yet
          </p>
        ) : (
          projects.map((p) => {
            const tone = dotToneFor(p.last_cycle?.status as CycleStatus | undefined);
            const isActive = activeId === p.id;
            const label = p.repo_full_name ?? p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`rail__item ${isActive ? "rail__item--active" : ""}`}
                onClick={() => setActive(p.id)}
              >
                <span className={`status-dot status-dot--${tone}`} />
                <span className="rail__item-name">{label}</span>
              </button>
            );
          })
        )}
      </section>

      <section className="rail__section">
        <header className="rail__section-label">
          <span>Roster</span>
        </header>
        <button
          type="button"
          className={`rail__item ${activeId === "all-agents" ? "rail__item--active" : ""}`}
          onClick={() => setActive("all-agents")}
        >
          <span className="rail__item-name">All agents</span>
        </button>
        <button
          type="button"
          className={`rail__item ${activeId === "plugins" ? "rail__item--active" : ""}`}
          onClick={() => setActive("plugins")}
        >
          <span className="rail__item-name">Plugins</span>
        </button>
      </section>

      <button type="button" className="rail__add" onClick={onAddProject}>
        + Add project
      </button>
    </nav>
  );
}
