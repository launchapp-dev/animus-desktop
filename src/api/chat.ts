import { invoke } from "@tauri-apps/api/core";

export interface ProviderOption {
  tool: string;
  name: string;
  installed: boolean;
  models: string[];
}

export interface ChatStreamLine {
  sessionId: string;
  raw: string;
}

export interface ChatStreamEnd {
  sessionId: string;
  exitCode: number | null;
  error: string | null;
}

export function chatProviders(): Promise<ProviderOption[]> {
  return invoke<ProviderOption[]>("chat_providers");
}

export function chatAgentRun(args: {
  sessionId: string;
  repoPath: string;
  tool: string;
  model?: string;
  prompt: string;
  conversationId?: string;
  timeoutSecs?: number;
  /** "low" | "medium" | "high"; omit for the provider default. */
  reasoningEffort?: string;
}): Promise<void> {
  return invoke<void>("chat_agent_run", {
    args: {
      sessionId: args.sessionId,
      repoPath: args.repoPath,
      tool: args.tool,
      model: args.model ?? null,
      prompt: args.prompt,
      conversationId: args.conversationId ?? null,
      timeoutSecs: args.timeoutSecs ?? null,
      reasoningEffort: args.reasoningEffort ?? null,
    },
  });
}

export function chatCancel(sessionId: string): Promise<void> {
  return invoke<void>("chat_cancel", { sessionId });
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  tool: string;
  model: string | null;
  message_count: number;
  updated_at: string;
}

import type { PersistedBlock, ChatUsage } from "../views/project/chatProtocol";

export interface ConversationMessage {
  content: string;
  recorded_at: string;
  role: "user" | "assistant" | "system";
  seq: number;
  model?: string | null;
  tool?: string | null;
  /** Ordered timeline of the assistant turn (text/thinking/tool calls/results),
   *  persisted by animus v0.5.12+. Absent for older conversations. */
  blocks?: PersistedBlock[];
  /** Provider token usage + cost for an assistant turn, if recorded. */
  usage?: ChatUsage | null;
  cost_usd?: number | null;
}

export interface ConversationTranscript {
  messages: ConversationMessage[];
  meta: {
    id: string;
    title: string | null;
    tool: string;
    model: string | null;
    session_id: string | null;
    message_count: number;
    created_at: string;
    updated_at: string;
  };
}

export function chatList(repoPath: string): Promise<ConversationSummary[]> {
  return invoke<ConversationSummary[]>("chat_list", { repoPath });
}

export interface ProjectConversation {
  projectId: string;
  projectName: string;
  id: string;
  title: string | null;
  tool: string;
  model: string | null;
  messageCount: number;
  updatedAt: string | null;
}

export function chatListAll(
  projects: { id: string; name: string; repoPath: string }[],
): Promise<ProjectConversation[]> {
  return invoke<ProjectConversation[]>("chat_list_all", { projects });
}

export function chatRename(
  repoPath: string,
  conversationId: string,
  title: string,
): Promise<void> {
  return invoke<void>("chat_rename", { repoPath, conversationId, title });
}

export function chatDelete(repoPath: string, conversationId: string): Promise<void> {
  return invoke<void>("chat_delete", { repoPath, conversationId });
}

export function chatGet(
  repoPath: string,
  conversationId: string,
): Promise<ConversationTranscript> {
  return invoke<ConversationTranscript>("chat_get", {
    repoPath,
    conversationId,
  });
}
