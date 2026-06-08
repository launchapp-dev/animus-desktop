import { useProjectsStore } from "../state/projects";
import { useActiveProject } from "../state/activeProject";

type SegmentTone =
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "warn"
  | "idle";

function toneFor(status: string | undefined): SegmentTone {
  switch (status) {
    case "running":
      return "running";
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "idle";
  }
}

export function Watchstrip({ onAddProject }: { onAddProject: () => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const setActive = useActiveProject((s) => s.setActiveProject);

  return (
    <div className="watchstrip">
      {projects.map((p) => {
        const tone = toneFor(p.last_cycle?.status);
        const active = activeId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            title={p.repo_full_name ?? p.id}
            className={`watchstrip__segment watchstrip__segment--${tone} ${
              active ? "watchstrip__segment--active" : ""
            }`}
            onClick={() => setActive(p.id)}
          />
        );
      })}
      <button
        type="button"
        className="watchstrip__add"
        title="Add project"
        onClick={onAddProject}
      >
        +
      </button>
    </div>
  );
}
