import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types/contracts";

export interface LocalFolderInspection {
  path: string;
  exists: boolean;
  isDir: boolean;
  isGitRepo: boolean;
  hasRemote: boolean;
  defaultBranch: string | null;
  detectedLanguage: string | null;
  animusDirExists: boolean;
  isAnimusProject: boolean;
  animusWorkflowNames: string[];
}

export function localFolderInspect(path: string): Promise<LocalFolderInspection> {
  return invoke<LocalFolderInspection>("local_folder_inspect", { path });
}

export function localFolderGitInit(path: string): Promise<LocalFolderInspection> {
  return invoke<LocalFolderInspection>("local_folder_git_init", { path });
}

export function projectAdoptLocal(path: string): Promise<Project> {
  return invoke<Project>("project_adopt_local", { path });
}

// --- File / folder viewer (worktree-aware) ---

export interface WorktreeRoot {
  id: string;
  path: string;
  branch: string | null;
}

export interface DirEntryInfo {
  name: string;
  rel: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
}

export interface FileContent {
  text: string | null;
  isBinary: boolean;
  truncated: boolean;
  size: number;
}

export function localWorktreesList(projectRoot: string): Promise<WorktreeRoot[]> {
  return invoke<WorktreeRoot[]>("local_worktrees_list", { projectRoot });
}

export function localDirList(base: string, rel: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("local_dir_list", { base, rel });
}

export function localFileRead(base: string, rel: string): Promise<FileContent> {
  return invoke<FileContent>("local_file_read", { base, rel });
}
