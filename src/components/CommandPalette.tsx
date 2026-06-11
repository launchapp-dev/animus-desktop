import { useEffect, useState } from "react";
import {
  FolderGit2,
  GitBranch,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command";
import { pluginList } from "../api/_invoke";
import { useDaemonStore } from "../state/daemon";
import { useProjectsStore } from "../state/projects";
import { useActiveProject } from "../state/activeProject";
import type { Plugin } from "../types/contracts";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddProject: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onAddProject,
}: CommandPaletteProps) {
  const setActiveProject = useActiveProject((s) => s.setActiveProject);
  const projects = useProjectsStore((s) => s.projects);
  const daemon = useDaemonStore();
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void pluginList()
      .then((list) => {
        if (!cancelled) setPlugins(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  function runAndClose(fn: () => void | Promise<void>) {
    void Promise.resolve(fn()).finally(() => onOpenChange(false));
  }

  const recentCycles = projects
    .filter((p) => p.last_cycle)
    .slice(0, 8)
    .map((p) => ({ project: p, cycle: p.last_cycle! }));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects, cycles, plugins, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="add-project new project"
            onSelect={() => runAndClose(onAddProject)}
          >
            <Plus className="text-text-muted" />
            <span>Add project</span>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="open-settings"
            onSelect={() => runAndClose(() => setActiveProject("plugins"))}
          >
            <SettingsIcon className="text-text-muted" />
            <span>Open Settings</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="refresh-projects"
            onSelect={() =>
              runAndClose(() => useProjectsStore.getState().refresh())
            }
          >
            <RefreshCw className="text-text-muted" />
            <span>Refresh projects</span>
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          {daemon.status?.running ? (
            <CommandItem
              value="stop-daemon"
              onSelect={() => runAndClose(() => daemon.stop())}
            >
              <Power className="text-text-muted" />
              <span>Stop daemon</span>
            </CommandItem>
          ) : (
            <CommandItem
              value="start-daemon"
              onSelect={() => runAndClose(() => daemon.start())}
            >
              <Power className="text-text-muted" />
              <span>Start daemon</span>
            </CommandItem>
          )}
          <CommandItem
            value="restart-daemon"
            onSelect={() =>
              runAndClose(async () => {
                if (daemon.status?.running) await daemon.stop();
                await daemon.start();
              })
            }
          >
            <RefreshCw className="text-text-muted" />
            <span>Restart daemon</span>
          </CommandItem>
          <CommandItem
            value="daemon-logs"
            onSelect={() => runAndClose(() => setActiveProject("plugins"))}
          >
            <Terminal className="text-text-muted" />
            <span>Open daemon logs</span>
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`project ${p.repo_full_name} ${p.language}`}
                  onSelect={() =>
                    runAndClose(() => setActiveProject(p.id))
                  }
                >
                  <FolderGit2 className="text-text-muted" />
                  <span className="flex-1 truncate">{p.repo_full_name}</span>
                  <span className="ml-2 font-mono text-[11px] text-text-faint">
                    {p.language}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {recentCycles.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent cycles">
              {recentCycles.map(({ project, cycle }) => (
                <CommandItem
                  key={cycle.id}
                  value={`cycle ${project.repo_full_name} ${cycle.id} ${cycle.status}`}
                  onSelect={() =>
                    runAndClose(() => setActiveProject(project.id))
                  }
                >
                  <GitBranch className="text-text-muted" />
                  <span className="flex-1 truncate">
                    {project.repo_full_name}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-text-faint">
                    {cycle.status}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {plugins.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Plugins">
              {plugins.slice(0, 12).map((p) => (
                <CommandItem
                  key={p.name}
                  value={`plugin ${p.name} ${p.kind}`}
                  onSelect={() => runAndClose(() => setActiveProject("plugins"))}
                >
                  <Plug className="text-text-muted" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-text-faint">
                    {p.kind}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
