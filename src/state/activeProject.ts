import { create } from "zustand";

export type BridgeMode = "journal" | "workflows" | "secrets" | "plugins";

// "all-agents" and "plugins" are pseudo-projects — they live in the rail
// but don't have a backing repo. They map to special bridge content.
export type ActiveProjectId = string | "all-agents" | "plugins" | null;

interface ActiveProjectStore {
  activeProjectId: ActiveProjectId;
  mode: BridgeMode;
  commandOpen: boolean;
  commandTitle: string | null;
  // an opaque payload the bridge sets for the command pane to render
  commandContext: unknown;

  setActiveProject: (id: ActiveProjectId) => void;
  setMode: (mode: BridgeMode) => void;
  openCommand: (title: string, context?: unknown) => void;
  closeCommand: () => void;
  toggleCommand: () => void;
}

export const useActiveProject = create<ActiveProjectStore>((set) => ({
  activeProjectId: null,
  mode: "journal",
  commandOpen: false,
  commandTitle: null,
  commandContext: null,

  setActiveProject: (id) =>
    set({
      activeProjectId: id,
      mode: id === "plugins" ? "plugins" : "journal",
      commandOpen: false,
      commandTitle: null,
      commandContext: null,
    }),

  setMode: (mode) => set({ mode }),

  openCommand: (title, context) =>
    set({ commandOpen: true, commandTitle: title, commandContext: context }),

  closeCommand: () => set({ commandOpen: false, commandTitle: null, commandContext: null }),

  toggleCommand: () =>
    set((s) => ({
      commandOpen: !s.commandOpen,
      commandTitle: s.commandOpen ? null : s.commandTitle,
      commandContext: s.commandOpen ? null : s.commandContext,
    })),
}));
