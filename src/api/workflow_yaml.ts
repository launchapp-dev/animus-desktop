import { invoke } from "@tauri-apps/api/core";

export type FileKind = "root" | "workflow";
export type PhaseRefKind = "phase" | "workflow-ref";

export interface FileCounts {
  workflows: number;
  phases: number;
  agents: number;
  schedules: number;
  triggers: number;
  mcpServers: number;
}

export interface WorkflowFileReport {
  path: string;
  kind: FileKind;
  ok: boolean;
  error: string | null;
  counts: FileCounts;
}

export interface PhaseRef {
  kind: PhaseRefKind;
  value: string;
  maxReworkAttempts: number | null;
  reworkTarget: string | null;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  phases: PhaseRef[];
  sourceFile: string;
}

export interface PhaseSummary {
  id: string;
  mode: string | null;
  agent: string | null;
  directive: string | null;
  command: string | null;
  commandArgs: string[];
  commandCwdMode: string | null;
  commandTimeoutSecs: number | null;
  commandSuccessExitCodes: number[];
  worktree: boolean | null;
  capabilities: CapabilityFlag[];
  decisionVerdicts: string[];
  sourceFile: string;
}

export interface PersonaSummary {
  style: string | null;
  instructions: string | null;
  traits: string[];
}

export interface CapabilityFlag {
  key: string;
  value: boolean;
}

export interface AgentSummary {
  id: string;
  model: string | null;
  tool: string | null;
  systemPrompt: string | null;
  systemPromptFile: string | null;
  description: string | null;
  role: string | null;
  persona: PersonaSummary;
  models: string[];
  skills: string[];
  fallbackModels: string[];
  fallbackTools: string[];
  extraArgs: string[];
  codexConfigOverrides: string[];
  mcpServers: string[];
  memoryEnabled: boolean | null;
  memoryWritePolicy: string | null;
  memoryScope: string | null;
  memoryMaxContextChars: number | null;
  communicationEnabled: boolean | null;
  communicationChannels: string[];
  communicationCanMessage: string[];
  communicationMaxContextChars: number | null;
  networkAccess: boolean | null;
  webSearch: boolean | null;
  reasoningEffort: string | null;
  maxAttempts: number | null;
  maxContinuations: number | null;
  timeoutSecs: number | null;
  toolProfile: string | null;
  toolAllow: string[];
  toolDeny: string[];
  capabilities: CapabilityFlag[];
  sourceFile: string;
}

export interface OauthSummary {
  flow: string | null;
  tokenUrl: string | null;
  clientIdEnv: string | null;
  clientSecretEnv: string | null;
  refreshTokenEnv: string | null;
  bearerEnv: string | null;
  scopes: string[];
  audience: string | null;
  cache: boolean | null;
}

export interface McpServerSummary {
  id: string;
  transport: string | null;
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  tools: string[];
  oauth: OauthSummary | null;
  sourceFile: string;
}

export interface ScheduleSummary {
  id: string | null;
  workflow: string | null;
  cron: string | null;
  timezone: string | null;
  enabled: boolean | null;
  sourceFile: string;
}

export interface TriggerSummary {
  kind: string | null;
  workflow: string | null;
  path: string | null;
  sourceFile: string;
}

export interface WorkflowYamlReport {
  projectRoot: string;
  files: WorkflowFileReport[];
  workflows: WorkflowSummary[];
  phases: PhaseSummary[];
  agents: AgentSummary[];
  schedules: ScheduleSummary[];
  triggers: TriggerSummary[];
  mcpServers: McpServerSummary[];
  defaultWorkflowRef: string | null;
  toolsAllowlist: string[];
  errors: string[];
}

// Dedup + short TTL cache. Five tabs (Workflows, Agents, Team, MCP,
// Visualize) all read the same YAML; tab-bouncing without this fires the
// same Rust command back-to-back. The cache TTL is short enough that user
// edits flow through quickly, but long enough to coalesce a tab switch.
const READ_CACHE_TTL_MS = 2_000;
const readCache = new Map<
  string,
  { at: number; promise: Promise<WorkflowYamlReport> }
>();

export function localWorkflowsRead(path: string): Promise<WorkflowYamlReport> {
  const now = Date.now();
  const cached = readCache.get(path);
  if (cached && now - cached.at < READ_CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = invoke<WorkflowYamlReport>("local_workflows_read", { path });
  readCache.set(path, { at: now, promise });
  // Clear on rejection so the next call retries fresh.
  promise.catch(() => readCache.delete(path));
  return promise;
}

export function invalidateLocalWorkflowsCache(path?: string): void {
  if (path) readCache.delete(path);
  else readCache.clear();
}

export function localWorkflowFileRead(
  projectRoot: string,
  path: string,
): Promise<string> {
  return invoke<string>("local_workflow_file_read", { projectRoot, path });
}

export interface EnvPair {
  key: string;
  value: string;
}

export interface OauthInput {
  flow: string | null;
  tokenUrl: string | null;
  clientIdEnv: string | null;
  clientSecretEnv: string | null;
  refreshTokenEnv: string | null;
  bearerEnv: string | null;
  scopes: string[];
  audience: string | null;
  cache: boolean | null;
}

export interface McpServerInput {
  transport: string | null;
  command: string | null;
  args: string[];
  url: string | null;
  env: EnvPair[];
  tools: string[];
  oauth: OauthInput | null;
}

export function localMcpServerUpsert(
  sourceFile: string,
  id: string,
  input: McpServerInput,
): Promise<string> {
  return invoke<string>("local_mcp_server_upsert", { sourceFile, id, input });
}

export function localMcpLink(
  sourceFile: string,
  agentId: string,
  serverId: string,
  linked: boolean,
): Promise<void> {
  return invoke<void>("local_mcp_link", {
    sourceFile,
    agentId,
    serverId,
    linked,
  });
}
