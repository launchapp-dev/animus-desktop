// STUB types for parallel dev — will be replaced by the other agents' files in
// src/types/{daemon,plugin,github}.ts when they land. Delete this file if those
// files exist at integration time.

export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  pid: number | null;
  plugins_installed: number;
  binary_path: string | null;
}

export interface InstallProgress {
  stage: string;
  percent: number | null;
  message: string;
}

export interface Plugin {
  name: string;
  kind: string;
  version: string;
  repo: string;
  installed: boolean;
}

export interface DeviceCodeResponse {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

export interface AuthStatus {
  logged_in: boolean;
  login: string | null;
  avatar_url: string | null;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  updated_at: string;
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  active: boolean;
}

// App-level domain types — not from Rust backend.
export type CycleStatus = "running" | "passed" | "failed" | "cancelled";
export type PhaseStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export interface Project {
  id: string;
  repo_full_name: string;
  repo_path?: string;
  language: string;
  template: string;
  webhook_id: number | null;
  created_at: string;
  last_cycle: Cycle | null;
}

export interface Cycle {
  id: string;
  project_id: string;
  status: CycleStatus;
  started_at: string;
  finished_at: string | null;
  phases: Phase[];
}

export interface Phase {
  name: string;
  status: PhaseStatus;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
}
