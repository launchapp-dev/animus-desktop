export type Language =
  | "typescript"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "other";

export type Template = "ci-cd";

export type CycleStatus = "running" | "passed" | "failed" | "cancelled";

export type PhaseStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export interface Phase {
  name: string;
  status: PhaseStatus;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
}

export interface Cycle {
  id: string;
  project_id: string;
  status: CycleStatus;
  started_at: string;
  finished_at: string | null;
  phases: Phase[];
}

export interface Project {
  id: string;
  repo_full_name: string;
  repo_path: string;
  language: Language | string;
  template: Template | string;
  webhook_id: number | null;
  webhook_secret: string;
  tunnel_url: string;
  created_at: string;
  last_cycle: Cycle | null;
}

export interface TemplateRender {
  workflows_yaml: string;
  script: string;
}
