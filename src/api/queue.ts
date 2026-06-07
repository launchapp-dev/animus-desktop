import { invoke } from "@tauri-apps/api/core";

export async function queueList(projectRoot?: string): Promise<unknown> {
  return await invoke("queue_list", { projectRoot });
}

export async function queueStats(projectRoot?: string): Promise<unknown> {
  return await invoke("queue_stats", { projectRoot });
}

export async function queueHold(
  taskId: string,
  projectRoot?: string,
): Promise<void> {
  await invoke("queue_hold", { taskId, projectRoot });
}

export async function queueRelease(
  taskId: string,
  projectRoot?: string,
): Promise<void> {
  await invoke("queue_release", { taskId, projectRoot });
}

export async function queueDrop(
  taskId: string,
  projectRoot?: string,
): Promise<void> {
  await invoke("queue_drop", { taskId, projectRoot });
}
