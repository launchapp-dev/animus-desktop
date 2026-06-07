import { invoke } from "@tauri-apps/api/core";

export interface WorkflowRunResult {
  ok: boolean;
  message: string;
  run_id: string | null;
}

export async function workflowRunTask(
  taskId: string,
  projectRoot?: string,
): Promise<WorkflowRunResult> {
  return await invoke<WorkflowRunResult>("workflow_run_task", {
    taskId,
    projectRoot,
  });
}

export async function workflowRunId(
  workflowId: string,
  projectRoot?: string,
): Promise<WorkflowRunResult> {
  return await invoke<WorkflowRunResult>("workflow_run_id", {
    workflowId,
    projectRoot,
  });
}

export async function workflowList(projectRoot?: string): Promise<unknown> {
  return await invoke("workflow_list", { projectRoot });
}
