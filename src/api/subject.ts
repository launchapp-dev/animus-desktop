import { invoke } from "@tauri-apps/api/core";

// ---- Types ----------------------------------------------------------------

// A single subject record as returned by the `animus.cli.v1` envelope.
export interface Subject {
  id: string;
  kind: string;
  title: string;
  description: string;
  status: string; // normalized: ready | in_progress | blocked | done | …
  native_status: string; // backend-specific raw status
  priority: number; // 0 = highest
  labels: string[];
  created_at: string;
  updated_at: string;
  custom?: Record<string, unknown>;
}

// The `animus.cli.v1` envelope every `--json` invocation emits.
export interface SubjectEnvelope {
  schema: string;
  ok: boolean;
  data?: {
    kind: string;
    verb: string;
    method?: string;
    plugin_count?: number;
    result?: unknown;
  };
  error?: unknown;
}

// Normalized result the views consume.
export interface SubjectResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

function errText(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// Run a subject command and unwrap the envelope into a SubjectResult.
async function run<T>(
  cmd: string,
  args: Record<string, unknown>,
  pick: (result: unknown) => T,
): Promise<SubjectResult<T>> {
  try {
    const env = await invoke<SubjectEnvelope>(cmd, args);
    if (!env || env.ok === false) {
      return { ok: false, data: null, error: errText(env?.error) };
    }
    return { ok: true, data: pick(env.data?.result), error: null };
  } catch (e) {
    return { ok: false, data: null, error: errText(e) };
  }
}

// ---- Typed wrappers -------------------------------------------------------

export function subjectList(
  kind: string,
  projectRoot?: string,
): Promise<SubjectResult<Subject[]>> {
  return run("subject_list", { kind, projectRoot }, (r) => {
    const subjects = (r as { subjects?: Subject[] } | undefined)?.subjects;
    return Array.isArray(subjects) ? subjects : [];
  });
}

export function subjectGet(
  kind: string,
  id: string,
  projectRoot?: string,
): Promise<SubjectResult<Subject | null>> {
  return run("subject_get", { kind, id, projectRoot }, (r) => (r as Subject) ?? null);
}

export function subjectNext(
  kind: string,
  projectRoot?: string,
): Promise<SubjectResult<Subject | null>> {
  return run("subject_next", { kind, projectRoot }, (r) => (r as Subject) ?? null);
}

export function subjectCreate(
  args: {
    kind: string;
    title: string;
    status?: string;
    priority?: string;
    labels?: string;
    body?: string;
  },
  projectRoot?: string,
): Promise<SubjectResult<Subject | null>> {
  return run("subject_create", { ...args, projectRoot }, (r) => (r as Subject) ?? null);
}

export function subjectUpdate(
  args: {
    kind: string;
    id: string;
    status?: string;
    priority?: string;
    labels?: string;
  },
  projectRoot?: string,
): Promise<SubjectResult<Subject | null>> {
  return run("subject_update", { ...args, projectRoot }, (r) => (r as Subject) ?? null);
}

export function subjectSetStatus(
  kind: string,
  id: string,
  status: string,
  projectRoot?: string,
): Promise<SubjectResult<Subject | null>> {
  return run(
    "subject_set_status",
    { kind, id, status, projectRoot },
    (r) => (r as Subject) ?? null,
  );
}

export function subjectDelete(
  kind: string,
  id: string,
  projectRoot?: string,
): Promise<SubjectResult<{ deleted: boolean; id: string }>> {
  return run(
    "subject_delete",
    { kind, id, projectRoot },
    (r) => (r as { deleted: boolean; id: string }) ?? { deleted: false, id },
  );
}

// Non-subject animus helpers kept here for backwards-compat.
export async function animusStatus(projectRoot?: string): Promise<unknown> {
  return await invoke("animus_status", { projectRoot });
}

export async function animusHistory(
  limit?: number,
  projectRoot?: string,
): Promise<unknown> {
  return await invoke("animus_history", { limit, projectRoot });
}

export async function logsTail(
  limit?: number,
  projectRoot?: string,
): Promise<unknown> {
  return await invoke("logs_tail", { limit, projectRoot });
}

export interface DaemonHealth {
  healthy: boolean;
  status: string;
  runner_connected: boolean;
  runner_pid: number | null;
  provider_plugins_healthy: boolean;
  active_agents: number;
  pool_size: number;
  project_root?: string;
  daemon_pid: number | null;
  process_alive: boolean;
  pool_utilization_percent: number;
  queued_tasks: number;
  flavor: string;
  runtime_paused: boolean;
}

interface HealthEnvelope {
  ok?: boolean;
  data?: DaemonHealth;
  error?: unknown;
}

export async function daemonHealth(
  projectRoot?: string,
): Promise<DaemonHealth | null> {
  const res = (await invoke("daemon_health", { projectRoot })) as HealthEnvelope;
  if (res && res.ok && res.data) return res.data;
  return null;
}
