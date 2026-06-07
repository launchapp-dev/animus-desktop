import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface ChatContext {
  project_id?: string | null;
  cycle_id?: string | null;
}

export async function chatSend(
  userMessage: string,
  context?: ChatContext,
): Promise<ChatMessage> {
  return await invoke<ChatMessage>("chat_send", {
    userMessage,
    context,
  });
}
