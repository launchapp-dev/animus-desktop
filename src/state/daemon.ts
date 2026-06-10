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

// Monotonic op counter: a slow background `refresh` that started BEFORE an
// install/start/stop must not land afterwards and overwrite the fresh
// post-mutation status with a stale snapshot ("daemon down" right after the
// user started it).
let opSeq = 0;

export const useDaemonStore = create<DaemonState>((set) => ({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {
    if (refreshInFlight) return refreshInFlight;
    const seq = opSeq;
    refreshInFlight = (async () => {
      set({ loading: true, error: null });
      try {
        const status = await daemonStatus();
        if (seq === opSeq) set({ status, loading: false });
        else set({ loading: false });
      } catch (e) {
        if (seq === opSeq) set({ error: String(e), loading: false });
        else set({ loading: false });
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },
  install: async () => {
    opSeq++;
    set({ loading: true, error: null });
    try {
      const status = await daemonInstall();
      opSeq++;
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  start: async () => {
    opSeq++;
    set({ loading: true, error: null });
    try {
      const status = await daemonStart();
      opSeq++;
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  stop: async () => {
    opSeq++;
    set({ loading: true, error: null });
    try {
      const status = await daemonStop();
      opSeq++;
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
