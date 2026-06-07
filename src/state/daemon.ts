import { create } from "zustand";
import {
  daemonInstall,
  daemonStart,
  daemonStatus,
  daemonStop,
} from "../api/_invoke";
import type { DaemonStatus } from "../types/contracts";

interface DaemonState {
  status: DaemonStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useDaemonStore = create<DaemonState>((set) => ({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await daemonStatus();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  install: async () => {
    set({ loading: true, error: null });
    try {
      const status = await daemonInstall();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  start: async () => {
    set({ loading: true, error: null });
    try {
      const status = await daemonStart();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  stop: async () => {
    set({ loading: true, error: null });
    try {
      const status = await daemonStop();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
