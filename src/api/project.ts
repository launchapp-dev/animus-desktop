import { invoke } from "@tauri-apps/api/core";

import type { Project } from "../types/project";

export function projectList(): Promise<Project[]> {
  return invoke<Project[]>("project_list");
}

export function projectGet(id: string): Promise<Project> {
  return invoke<Project>("project_get", { id });
}

export interface ProjectCreateInput {
  repoFullName: string;
  language: string;
  template: string;
  tunnelUrl: string;
  webhookId: number;
  webhookSecret: string;
}

export function projectCreate(input: ProjectCreateInput): Promise<Project> {
  return invoke<Project>("project_create", {
    repoFullName: input.repoFullName,
    language: input.language,
    template: input.template,
    tunnelUrl: input.tunnelUrl,
    webhookId: input.webhookId,
    webhookSecret: input.webhookSecret,
  });
}

export function projectDelete(id: string): Promise<void> {
  return invoke<void>("project_delete", { id });
}

export function projectSetupTemplate(
  projectId: string,
  repoPath: string,
): Promise<void> {
  return invoke<void>("project_setup_template", {
    projectId,
    repoPath,
  });
}
