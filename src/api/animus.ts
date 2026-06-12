import { invoke } from "@tauri-apps/api/core";

export interface AnimusCliResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: unknown | null;
  rawStderr: string;
}

export interface WorkflowPhaseRef {
  workflow_ref: string;
}
export interface WorkflowPhaseInline {
  id: string;
  max_rework_attempts?: number;
  on_verdict?: unknown;
}
export type WorkflowPhase = string | WorkflowPhaseInline | WorkflowPhaseRef;

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  phases: WorkflowPhase[];
  budget: unknown | null;
}

export interface PhaseCatalogEntry {
  label: string;
  category: string;
  description: string;
  tags: string[];
  visible: boolean;
  docs_url: string | null;
  icon: string | null;
}

export interface PhaseDefinition {
  mode: string;
  agent_id: string | null;
  directive: string | null;
  command: {
    program: string;
    args: string[];
  } | null;
}

export interface AgentProfile {
  model: string | null;
  tool: string | null;
  system_prompt: string;
  description: string;
  fallback_models: string[];
  fallback_tools: string[];
}

export interface WorkflowConfig {
  schema: string;
  version: number;
  default_workflow_ref: string;
  workflows: WorkflowDef[];
  phase_catalog: Record<string, PhaseCatalogEntry>;
  phase_definitions: Record<string, PhaseDefinition>;
  agent_profiles: Record<string, AgentProfile>;
  tools_allowlist: string[];
}

export interface WorkflowConfigEnvelope {
  schema: string;
  hash: string;
  path: string;
  source: "yaml" | "error" | string;
  version: number;
  workflow_config: WorkflowConfig | null;
  errors?: string[];
}

export interface DaemonStatus {
  available: boolean;
  status: string;
  running: boolean;
  runner_connected: boolean;
  runner_pid: number | null;
}

export interface AnimusStatus {
  schema: string;
  project_root: string;
  generated_at: string;
  flavor: string;
  daemon: DaemonStatus;
  active_agents: {
    available: boolean;
    count: number;
    assignments: unknown[];
  };
  task_summary: {
    available: boolean;
    total: number;
    done: number;
    in_progress: number;
    ready: number;
    blocked: number;
  };
  recent_completions: { available: boolean; entries: unknown[] };
  recent_failures: { available: boolean; entries: unknown[] };
  ci?: { provider: string; available: boolean; error?: string };
}

// Per-project daemon automation config (animus daemon config --json).
export interface DaemonConfigData {
  config_path: string;
  pool_size: number;
  interval_secs: number;
  max_tasks_per_tick: number | null;
  auto_run_ready: boolean;
  auto_pr_enabled: boolean;
  auto_merge_enabled: boolean;
  auto_commit_before_merge: boolean;
  auto_prune_worktrees_after_merge: boolean;
  stale_threshold_hours: number | null;
  phase_timeout_secs: number | null;
  idle_timeout_secs: number | null;
  updated: boolean;
}

export interface DaemonConfigUpdate {
  poolSize?: number;
  intervalSecs?: number;
  maxTasksPerTick?: number;
  autoRunReady?: boolean;
  autoPr?: boolean;
  autoMerge?: boolean;
}

export function animusDaemonConfigGet(
  path: string,
): Promise<AnimusCliResult<DaemonConfigData>> {
  return invoke<AnimusCliResult<DaemonConfigData>>("animus_daemon_config_get", { path });
}

export function animusDaemonConfigSet(
  path: string,
  updates: DaemonConfigUpdate,
): Promise<AnimusCliResult<DaemonConfigData>> {
  return invoke<AnimusCliResult<DaemonConfigData>>("animus_daemon_config_set", {
    path,
    ...updates,
  });
}

export function animusWorkflowConfig(
  path: string,
): Promise<AnimusCliResult<WorkflowConfigEnvelope>> {
  return invoke<AnimusCliResult<WorkflowConfigEnvelope>>("animus_workflow_config", { path });
}

export function animusStatusGet(path: string): Promise<AnimusCliResult<AnimusStatus>> {
  return invoke<AnimusCliResult<AnimusStatus>>("animus_status_get", { path });
}

export function animusWorkflowRun(
  path: string,
  workflowId: string,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_workflow_run", {
    path,
    workflowId,
  });
}

export function animusQueueList(path: string): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_queue_list", { path });
}
