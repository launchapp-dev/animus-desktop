import { invoke } from "@tauri-apps/api/core";

export async function subjectList(
  kind: string,
  projectRoot?: string,
): Promise<unknown> {
  return await invoke("subject_list", { kind, projectRoot });
}

export async function subjectGet(
  kind: string,
  id: string,
  projectRoot?: string,
): Promise<unknown> {
  return await invoke("subject_get", { kind, id, projectRoot });
}

export async function subjectNext(
  kind: string,
  projectRoot?: string,
): Promise<unknown> {
  return await invoke("subject_next", { kind, projectRoot });
}

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

export async function daemonHealth(projectRoot?: string): Promise<unknown> {
  return await invoke("daemon_health", { projectRoot });
}
