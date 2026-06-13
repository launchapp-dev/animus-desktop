import { invoke } from "@tauri-apps/api/core";

export interface PersonaUpdate {
  style: string | null;
  instructions: string | null;
  traits: string[];
}

export interface CapabilityFlagUpdate {
  key: string;
  value: boolean;
}

export interface AgentUpdate {
  model: string | null;
  tool: string | null;
  systemPrompt: string | null;
  systemPromptFile: string | null;
  description: string | null;
  role: string | null;
  persona: PersonaUpdate;
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
  capabilities: CapabilityFlagUpdate[];
}

export interface AgentUpdateResult {
  written: boolean;
  sourceFile: string;
  agentId: string;
}

export function localAgentUpdate(
  sourceFile: string,
  agentId: string,
  update: AgentUpdate,
): Promise<AgentUpdateResult> {
  return invoke<AgentUpdateResult>("local_agent_update", {
    sourceFile,
    agentId,
    update,
  });
}

/** Create a project-local agent in `.animus/workflows.yaml` (created if absent). */
export function localAgentCreate(
  repoPath: string,
  agentId: string,
  update: AgentUpdate,
): Promise<AgentUpdateResult> {
  return invoke<AgentUpdateResult>("local_agent_create", {
    repoPath,
    agentId,
    update,
  });
}

/** A fully-defaulted AgentUpdate; override only the fields you care about. */
export function emptyAgentUpdate(partial?: Partial<AgentUpdate>): AgentUpdate {
  return {
    model: null,
    tool: null,
    systemPrompt: null,
    systemPromptFile: null,
    description: null,
    role: null,
    persona: { style: null, instructions: null, traits: [] },
    models: [],
    skills: [],
    fallbackModels: [],
    fallbackTools: [],
    extraArgs: [],
    codexConfigOverrides: [],
    mcpServers: [],
    memoryEnabled: null,
    memoryWritePolicy: null,
    memoryScope: null,
    memoryMaxContextChars: null,
    communicationEnabled: null,
    communicationChannels: [],
    communicationCanMessage: [],
    communicationMaxContextChars: null,
    networkAccess: null,
    webSearch: null,
    reasoningEffort: null,
    maxAttempts: null,
    maxContinuations: null,
    timeoutSecs: null,
    toolProfile: null,
    toolAllow: [],
    toolDeny: [],
    capabilities: [],
    ...partial,
  };
}
