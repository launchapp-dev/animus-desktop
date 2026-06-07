import { invoke } from "@tauri-apps/api/core";

export async function bridgeAttachProject(
  projectId: string,
  repoPath: string,
): Promise<void> {
  await invoke("bridge_attach_project", { projectId, repoPath });
}

export async function bridgeDetachProject(projectId: string): Promise<void> {
  await invoke("bridge_detach_project", { projectId });
}

export async function bridgeActiveProjects(): Promise<string[]> {
  return await invoke<string[]>("bridge_active_projects");
}
