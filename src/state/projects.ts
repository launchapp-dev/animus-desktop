import { create } from "zustand";
import {
  projectGet,
  projectGetCycle,
  projectList,
  projectListCycles,
} from "../api/_invoke";
import type { Cycle, Project } from "../types/contracts";

interface ProjectsState {
  projects: Project[];
  selected: Project | null;
  cycles: Cycle[];
  selectedCycle: Cycle | null;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  loadCycles: (projectId: string) => Promise<void>;
  selectCycle: (projectId: string, cycleId: string) => Promise<void>;
  addProject: (p: Project) => void;
  clearSelection: () => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  selected: null,
  cycles: [],
  selectedCycle: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await projectList();
      set({ projects, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  select: async (id: string) => {
    set({ loading: true, error: null, selected: null });
    try {
      const project = await projectGet(id);
      set({ selected: project, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadCycles: async (projectId: string) => {
    try {
      const cycles = await projectListCycles(projectId);
      set({ cycles });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectCycle: async (projectId: string, cycleId: string) => {
    set({ loading: true, error: null, selectedCycle: null });
    try {
      const cycle = await projectGetCycle({ projectId, cycleId });
      set({ selectedCycle: cycle, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addProject: (p: Project) =>
    set((s) => ({ projects: [...s.projects, p], selected: p })),

  clearSelection: () =>
    set({ selected: null, selectedCycle: null, cycles: [] }),
}));
