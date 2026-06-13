import { create } from "zustand";

export type BridgeMode =
  | "chat"
  | "inbox"
  | "journal"
  | "stream"
  | "workflows"
  | "agents"
  | "mcp"
  | "files"
  | "visualize"
  | "subjects"
  | "secrets"
  | "skills"
  | "plugins"
  | "daemon";

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
  // Cross-component request to open a specific saved conversation (or "new")
  // in the Chat tab. The rail sets it; ChatView consumes + clears it.
  pendingConversation: string | "new" | null;

  setActiveProject: (id: ActiveProjectId) => void;
  setMode: (mode: BridgeMode) => void;
  openConversation: (projectId: ActiveProjectId, conversationId: string | "new") => void;
  clearPendingConversation: () => void;
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
  pendingConversation: null,

  setActiveProject: (id) =>
    set({
      activeProjectId: id,
      mode: id === "plugins" ? "plugins" : "journal",
      commandOpen: false,
      commandTitle: null,
      commandContext: null,
    }),

  setMode: (mode) => set({ mode }),

  openConversation: (projectId, conversationId) =>
    set({
      activeProjectId: projectId,
      mode: "chat",
      pendingConversation: conversationId,
    }),

  clearPendingConversation: () => set({ pendingConversation: null }),

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
