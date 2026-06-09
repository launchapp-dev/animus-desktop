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

// Single in-flight promise so concurrent callers fold into one Tauri call.
// Each daemon_status() shells out to 3 animus subprocesses (--version,
// plugin list, daemon status) — without dedup, 5 components mounting at the
// same time = 15 subprocess spawns. With dedup they share one call.
let refreshInFlight: Promise<void> | null = null;

export const useDaemonStore = create<DaemonState>((set) => ({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      set({ loading: true, error: null });
      try {
        const status = await daemonStatus();
        set({ status, loading: false });
      } catch (e) {
        set({ error: String(e), loading: false });
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
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
