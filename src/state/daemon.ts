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
// user started it). A stale refresh must not touch `loading` either — the
// mutation that bumped the seq owns it.
let opSeq = 0;

// Mutations invalidate the in-flight dedup so a refresh() issued after (or
// during) a mutation starts a fresh status call instead of folding onto a
// pre-mutation promise whose result will be discarded.
function beginOp() {
  opSeq++;
  refreshInFlight = null;
}

export const useDaemonStore = create<DaemonState>((set) => ({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {
    if (refreshInFlight) return refreshInFlight;
    const seq = opSeq;
    let promise: Promise<void> | null = null;
    promise = (async () => {
      set({ loading: true, error: null });
      try {
        const status = await daemonStatus();
        if (seq === opSeq) set({ status, loading: false });
      } catch (e) {
        if (seq === opSeq) set({ error: String(e), loading: false });
      } finally {
        if (refreshInFlight === promise) refreshInFlight = null;
      }
    })();
    refreshInFlight = promise;
    return promise;
  },
  install: async () => {
    beginOp();
    set({ loading: true, error: null });
    try {
      const status = await daemonInstall();
      beginOp();
      set({ status, loading: false });
    } catch (e) {
      beginOp();
      set({ error: String(e), loading: false });
    }
  },
  start: async () => {
    beginOp();
    set({ loading: true, error: null });
    try {
      const status = await daemonStart();
      beginOp();
      set({ status, loading: false });
    } catch (e) {
      beginOp();
      set({ error: String(e), loading: false });
    }
  },
  stop: async () => {
    beginOp();
    set({ loading: true, error: null });
    try {
      const status = await daemonStop();
      beginOp();
      set({ status, loading: false });
    } catch (e) {
      beginOp();
      set({ error: String(e), loading: false });
    }
  },
}));
