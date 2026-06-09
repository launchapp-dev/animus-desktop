import { useCallback, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useProjectsStore } from "./projects";
import { useActiveProject } from "./activeProject";
import {
  localFolderInspect,
  projectAdoptLocal,
} from "../api/local_folder";
import { daemonStart } from "../api/_invoke";
import { bridgeAttachProject } from "../api/event_bridge";

export interface AddProjectStatus {
  busy: boolean;
  error: string | null;
}

/**
 * One-shot folder-pick-to-project flow. Replaces the old multi-step wizard:
 * the user picks (or creates) a folder via the native macOS dialog, we adopt
 * whatever's there, start the per-project daemon, and select it.
 */
export function useAddProject(): AddProjectStatus & { run: () => Promise<void> } {
  const addProject = useProjectsStore((s) => s.addProject);
  const setActive = useActiveProject((s) => s.setActiveProject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose or create a project folder",
      });
      if (typeof picked !== "string" || picked.length === 0) {
        return;
      }

      // Inspect just to surface useful diagnostics in the console; adoption
      // works regardless of what we find.
      try {
        const info = await localFolderInspect(picked);
        if (info.isAnimusProject) {
          console.log(
            `[add-project] adopting existing Animus project at ${picked} ` +
              `(workflows: ${info.animusWorkflowNames.join(", ")})`,
          );
        }
      } catch (e) {
        console.warn("[add-project] inspect failed (continuing):", e);
      }

      const project = await projectAdoptLocal(picked);
      addProject(project);
      setActive(project.id);

      try {
        await daemonStart(picked);
      } catch (e) {
        console.warn("[add-project] daemon_start failed:", e);
      }
      try {
        await bridgeAttachProject(project.id, picked);
      } catch (e) {
        console.warn("[add-project] bridge_attach_project failed:", e);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [addProject, setActive]);

  return { busy, error, run };
}
