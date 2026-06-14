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

// --- Workflow authoring (CLI upsert → generated overlay) ---------------------

/** Create or replace a workflow definition. `def` = { id, name, description,
 *  phases: string[] (phase ids) | { workflow_ref }[], budget? }. */
export function animusWorkflowDefinitionUpsert(
  path: string,
  def: unknown,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_workflow_definition_upsert", {
    path,
    inputJson: JSON.stringify(def),
  });
}

/** Get a phase's full definition for editing: { phase_id, runtime, ui }. */
export function animusWorkflowPhaseGet(
  path: string,
  phaseId: string,
): Promise<AnimusCliResult<{ phase_id: string; runtime: Record<string, unknown> }>> {
  return invoke<AnimusCliResult<{ phase_id: string; runtime: Record<string, unknown> }>>(
    "animus_workflow_phase_get",
    { path, phaseId },
  );
}

/** Create or replace a phase. `runtime` = { mode, agent_id?, directive?,
 *  command?, decision_contract?, ... }. */
export function animusWorkflowPhaseUpsert(
  path: string,
  phaseId: string,
  runtime: unknown,
): Promise<AnimusCliResult<unknown>> {
  // The CLI expects the PhaseExecutionDefinition (the runtime object) directly.
  return invoke<AnimusCliResult<unknown>>("animus_workflow_phase_upsert", {
    path,
    phaseId,
    inputJson: JSON.stringify(runtime),
  });
}

export function animusWorkflowPhaseRemove(
  path: string,
  phaseId: string,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_workflow_phase_remove", {
    path,
    phaseId,
  });
}

// --- Flavor (project runtime composition) ------------------------------------

export interface FlavorRoleSet {
  required: string[];
  recommended: string[];
}

export interface FlavorManifest {
  id: string;
  version: string;
  title: string;
  description: string;
  providers?: FlavorRoleSet;
  subjects?: FlavorRoleSet;
  transports?: FlavorRoleSet;
  ui?: FlavorRoleSet;
  triggers?: FlavorRoleSet;
  workflow_runner?: FlavorRoleSet;
  queue?: FlavorRoleSet;
  durable_store?: FlavorRoleSet;
  memory_store?: FlavorRoleSet;
  packs?: FlavorRoleSet;
}

export interface FlavorCurrent {
  name: string;
  source: string;
  installed: boolean;
  drift: { plugin: string; role: string; installed: boolean }[];
  manifest: FlavorManifest;
}

export function animusFlavorCurrent(
  path: string,
): Promise<AnimusCliResult<FlavorCurrent>> {
  return invoke<AnimusCliResult<FlavorCurrent>>("animus_flavor_current", { path });
}

// --- Skills ------------------------------------------------------------------

export interface SkillSummary {
  name: string;
  description: string;
  category: string | null;
  /** "project" | "user" | "installed" | "builtin" | "pack:<id>" | "agent-host:<host>/<scope>" */
  source: string;
  type: string;
}

export interface SkillDetail {
  name: string;
  description: string;
  category: string | null;
  version?: string | null;
  source: string;
  prompt?: {
    system?: string | null;
    prefix?: string | null;
    suffix?: string | null;
    directives?: string[];
  };
  mcp_servers?: string[];
  tags?: string[];
  capabilities?: Record<string, boolean>;
  adapters?: string[];
  timeout_secs?: number | null;
}

export function animusSkillList(path: string): Promise<AnimusCliResult<SkillSummary[]>> {
  return invoke<AnimusCliResult<SkillSummary[]>>("animus_skill_list", { path });
}

export function animusSkillInfo(
  path: string,
  name: string,
): Promise<AnimusCliResult<SkillDetail>> {
  return invoke<AnimusCliResult<SkillDetail>>("animus_skill_info", { path, name });
}

export interface SkillSaveArgs {
  path: string;
  name: string;
  description?: string;
  category?: string;
  version?: string;
  systemPrompt?: string;
  mcpServers?: string[];
  tags?: string[];
}

export function animusSkillSave(args: SkillSaveArgs): Promise<void> {
  return invoke<void>("animus_skill_save", { args });
}

export function animusSkillDelete(path: string, name: string): Promise<void> {
  return invoke<void>("animus_skill_delete", { path, name });
}

export interface SkillInstallArgs {
  path: string;
  name?: string;
  version?: string;
  /** Local Markdown skill file/folder to install. */
  localPath?: string;
  source?: string;
}

export function animusSkillInstall(
  args: SkillInstallArgs,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_skill_install", {
    path: args.path,
    name: args.name ?? null,
    version: args.version ?? null,
    localPath: args.localPath ?? null,
    source: args.source ?? null,
  });
}

/** Re-resolve one installed skill, or all when `name` is omitted. */
export function animusSkillUpdate(
  path: string,
  name?: string,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_skill_update", {
    path,
    name: name ?? null,
  });
}

/** Uninstall a registry/installed skill (not project-scope YAML). */
export function animusSkillUninstall(
  path: string,
  name: string,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_skill_uninstall", { path, name });
}

// --- Phase gates --------------------------------------------------------------

export function animusPhaseGate(args: {
  path: string;
  workflowId: string;
  phaseId: string;
  decision: "approve" | "reject";
  note?: string;
}): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_phase_gate", {
    path: args.path,
    workflowId: args.workflowId,
    phaseId: args.phaseId,
    decision: args.decision,
    note: args.note ?? null,
  });
}

/** Resume a paused / crash-recovered workflow run (respawns its runner). */
export function animusWorkflowResume(
  path: string,
  workflowId: string,
  force = false,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_workflow_resume", {
    path,
    workflowId,
    force,
  });
}

/** Per-phase token + USD cost for a workflow run id. */
export function animusCostWorkflow(
  path: string,
  runId: string,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_cost_workflow", { path, runId });
}

// --- Interactions (questions + approvals; animus >= 0.5.15) ------------------

export interface InteractionQuestionOption {
  label: string;
  description?: string | null;
}

export interface InteractionQuestion {
  question: string;
  header?: string | null;
  options: InteractionQuestionOption[];
  multi_select?: boolean;
}

export interface InteractionRecord {
  id: string;
  kind: "question" | "approval";
  agent_id: string;
  workflow_id?: string | null;
  task_id?: string | null;
  created_at: string;
  question?: string | null;
  action?: string | null;
  options?: string[];
  tool_name?: string | null;
  arguments?: unknown;
  questions?: InteractionQuestion[];
  timeout_secs?: number | null;
  suspended?: boolean;
  status: "pending" | "answered" | "expired";
  answer?: string | null;
  answer_message?: string | null;
  answers?: Record<string, string | string[]> | null;
  answered_at?: string | null;
  answered_by?: string | null;
}

export function animusInteractionsList(
  path: string,
  all: boolean,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_interactions_list", { path, all });
}

export interface InteractionsAnswerArgs {
  path: string;
  id: string;
  decision?: "allow" | "deny";
  text?: string;
  /** Structured selections, each "<question text>=label[,label…]". */
  selects?: string[];
  message?: string;
}

export function animusInteractionsAnswer(
  args: InteractionsAnswerArgs,
): Promise<AnimusCliResult<unknown>> {
  return invoke<AnimusCliResult<unknown>>("animus_interactions_answer", { args });
}
