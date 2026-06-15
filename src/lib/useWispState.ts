import { useEffect, useRef, useState } from "react";
import { useDaemonStore } from "../state/daemon";
import { useActiveProject } from "../state/activeProject";
import { useProjectsStore } from "../state/projects";
import { wispExpressionFromDaemon } from "./wispExpression";
import type { WispExpression } from "../components/Wisp";

const DONE_WINDOW_MS = 4000;

/**
 * Derives the live Wisp expression from daemon + active-project cycle status,
 * holding "done" for a short celebration window after a green finish.
 */
export function useWispState(): WispExpression {
  const status = useDaemonStore((s) => s.status);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);

  const project = projects.find((p) => p.id === activeId);
  const cycleStatus = project?.last_cycle?.status;

  const [recentlyPassed, setRecentlyPassed] = useState(false);
  const prev = useRef<typeof cycleStatus>(undefined);

  useEffect(() => {
    if (prev.current === "running" && cycleStatus === "passed") {
      setRecentlyPassed(true);
      const t = setTimeout(() => setRecentlyPassed(false), DONE_WINDOW_MS);
      prev.current = cycleStatus;
      return () => clearTimeout(t);
    }
    prev.current = cycleStatus;
  }, [cycleStatus]);

  return wispExpressionFromDaemon({
    installed: status?.installed ?? false,
    running: status?.running ?? false,
    activeCycleStatus: cycleStatus,
    recentlyPassed,
  });
}
