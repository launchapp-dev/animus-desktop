import { create } from "zustand";
import type { AgentState } from "../components/AgentFace";

export interface DaemonLogEvent {
  ts: string | null;
  level: string | null;
  cat: string | null;
  msg: string | null;
  meta: unknown;
  raw: string;
  project_id: string | null;
}

export interface CycleEvent {
  project_id: string | null;
  ts: string | null;
  level: string | null;
  cat: string;
  msg: string | null;
  run_id: string | null;
  workflow_ref: string | null;
  phase_id: string | null;
  subject_id: string | null;
  schedule_id: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  error: string | null;
  model: string | null;
  tool: string | null;
  plugin: string | null;
  agent: string | null;
  role: string | null;
  content: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  tool_params: string | null;
  tool_result: string | null;
  tool_success: boolean | null;
  verdict: string | null;
  command_program: string | null;
  command_args: string[];
  // Legacy fields kept for back-compat with the existing reducers.
  status: string;
  phase: string | null;
  cycle_id: string | null;
}

export interface PerProjectEvents {
  logs: DaemonLogEvent[];
  cycles: CycleEvent[];
  agentLiveStates: Record<string, AgentState>;
  agentByPhase: Record<string, string>;
  daemonStatus: string | null;
}

const LOG_CAP = 500;
const CYCLE_CAP = 200;
const DECAY_MS = 6_000;
const GLOBAL_BUCKET = "__global__";

type DecayTimers = Map<string, Map<string, ReturnType<typeof setTimeout>>>;

interface ProjectEventsStore {
  events: Record<string, PerProjectEvents>;
  pushLog: (e: DaemonLogEvent) => void;
  pushCycle: (e: CycleEvent) => void;
  setDaemonStatus: (projectId: string | null, status: string) => void;
  setAgentByPhase: (projectId: string, map: Record<string, string>) => void;
}

const STABLE_EMPTY_AGENT_STATES: Record<string, AgentState> = Object.freeze({});
const STABLE_EMPTY_AGENT_BY_PHASE: Record<string, string> = Object.freeze({});
const STABLE_EMPTY_LOGS: DaemonLogEvent[] = [];
const STABLE_EMPTY_CYCLES: CycleEvent[] = [];

const STABLE_EMPTY_BUCKET: PerProjectEvents = Object.freeze({
  logs: STABLE_EMPTY_LOGS,
  cycles: STABLE_EMPTY_CYCLES,
  agentLiveStates: STABLE_EMPTY_AGENT_STATES,
  agentByPhase: STABLE_EMPTY_AGENT_BY_PHASE,
  daemonStatus: null,
});

function emptyBucket(): PerProjectEvents {
  return {
    logs: [],
    cycles: [],
    agentLiveStates: {},
    agentByPhase: {},
    daemonStatus: null,
  };
}

function statusToAgentState(status: string): AgentState | null {
  switch (status) {
    case "started":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "error";
    default:
      return null;
  }
}

const decayTimers: DecayTimers = new Map();

// Daemon stderr can flood the bridge with hundreds of log lines per second.
// Without batching, each line triggers a full re-render cycle through Zustand.
// We collect logs per project and flush once per animation frame (~16ms),
// so JournalView re-renders at most ~60fps regardless of input volume.
const pendingLogs = new Map<string, DaemonLogEvent[]>();
let flushScheduled = false;

function enqueueLog(
  e: DaemonLogEvent,
  set: (s: Partial<ProjectEventsStore>) => void,
  get: () => ProjectEventsStore,
) {
  const key = e.project_id ?? GLOBAL_BUCKET;
  const queue = pendingLogs.get(key) ?? [];
  queue.push(e);
  pendingLogs.set(key, queue);
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    flushScheduled = false;
    const currentEvents = get().events;
    const nextEvents = { ...currentEvents };
    let touched = false;
    for (const [bucketKey, queued] of pendingLogs.entries()) {
      if (queued.length === 0) continue;
      const bucket = currentEvents[bucketKey] ?? emptyBucket();
      // Newest first; queued is in arrival order, so reverse-prepend.
      const merged = queued
        .slice()
        .reverse()
        .concat(bucket.logs)
        .slice(0, LOG_CAP);
      nextEvents[bucketKey] = { ...bucket, logs: merged };
      touched = true;
    }
    pendingLogs.clear();
    if (touched) set({ events: nextEvents });
  });
}

function clearDecay(projectId: string, agentId: string) {
  const perProject = decayTimers.get(projectId);
  if (!perProject) return;
  const t = perProject.get(agentId);
  if (t) {
    clearTimeout(t);
    perProject.delete(agentId);
  }
}

function scheduleDecay(
  projectId: string,
  agentId: string,
  set: (fn: (s: ProjectEventsStore) => Partial<ProjectEventsStore>) => void,
) {
  let perProject = decayTimers.get(projectId);
  if (!perProject) {
    perProject = new Map();
    decayTimers.set(projectId, perProject);
  }
  const existing = perProject.get(agentId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    set((s) => {
      const bucket = s.events[projectId];
      if (!bucket) return {};
      if (bucket.agentLiveStates[agentId] === undefined) return {};
      const nextStates = { ...bucket.agentLiveStates };
      delete nextStates[agentId];
      return {
        events: {
          ...s.events,
          [projectId]: { ...bucket, agentLiveStates: nextStates },
        },
      };
    });
    perProject!.delete(agentId);
  }, DECAY_MS);
  perProject.set(agentId, timer);
}

export const useProjectEvents = create<ProjectEventsStore>((set, get) => ({
  events: {},

  pushLog: (e) => {
    enqueueLog(e, set, get);
  },

  pushCycle: (e) => {
    const key = e.project_id ?? GLOBAL_BUCKET;
    const bucket = get().events[key] ?? emptyBucket();
    const cycles = [e, ...bucket.cycles].slice(0, CYCLE_CAP);

    let agentLiveStates = bucket.agentLiveStates;
    const phase = e.phase ?? "";
    const agentId = phase ? bucket.agentByPhase[phase] : undefined;
    const nextState = statusToAgentState(e.status);
    if (agentId && nextState) {
      agentLiveStates = { ...agentLiveStates, [agentId]: nextState };
      if (nextState === "running") {
        clearDecay(key, agentId);
      } else {
        scheduleDecay(key, agentId, set);
      }
    }

    set({
      events: {
        ...get().events,
        [key]: { ...bucket, cycles, agentLiveStates },
      },
    });
  },

  setDaemonStatus: (projectId, status) => {
    const key = projectId ?? GLOBAL_BUCKET;
    const bucket = get().events[key] ?? emptyBucket();
    set({
      events: {
        ...get().events,
        [key]: { ...bucket, daemonStatus: status },
      },
    });
  },

  setAgentByPhase: (projectId, map) => {
    const bucket = get().events[projectId] ?? emptyBucket();
    set({
      events: {
        ...get().events,
        [projectId]: { ...bucket, agentByPhase: map },
      },
    });
  },
}));

export function selectProjectEvents(
  projectId: string | null | undefined,
): PerProjectEvents {
  const key = projectId ?? GLOBAL_BUCKET;
  return useProjectEvents.getState().events[key] ?? STABLE_EMPTY_BUCKET;
}

export function useProjectEventsBucket(
  projectId: string | null | undefined,
): PerProjectEvents {
  const key = projectId ?? GLOBAL_BUCKET;
  return useProjectEvents((s) => s.events[key] ?? STABLE_EMPTY_BUCKET);
}

// Narrow selectors — subscribing to the WHOLE bucket re-renders consumers on
// every log line. Consumers should subscribe only to the slice they actually
// read so a flood of unrelated events doesn't cascade through the tree.
export function useProjectAgentLiveStates(
  projectId: string | null | undefined,
): Record<string, AgentState> {
  const key = projectId ?? GLOBAL_BUCKET;
  return useProjectEvents(
    (s) => (s.events[key] ?? STABLE_EMPTY_BUCKET).agentLiveStates,
  );
}

export function useProjectAgentByPhase(
  projectId: string | null | undefined,
): Record<string, string> {
  const key = projectId ?? GLOBAL_BUCKET;
  return useProjectEvents(
    (s) => (s.events[key] ?? STABLE_EMPTY_BUCKET).agentByPhase,
  );
}
