import { create } from "zustand";
import type { ChatMessage } from "../api/chat";
import { chatSend } from "../api/chat";

interface ChatStore {
  messages: ChatMessage[];
  pending: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

function makeUserMessage(text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    created_at: new Date().toISOString(),
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  pending: false,
  error: null,
  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().pending) return;
    const userMsg = makeUserMessage(trimmed);
    set((s) => ({
      messages: [...s.messages, userMsg],
      pending: true,
      error: null,
    }));
    try {
      const reply = await chatSend(trimmed);
      set((s) => ({
        messages: [...s.messages, reply],
        pending: false,
      }));
    } catch (err) {
      set({
        pending: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  clear: () => set({ messages: [], error: null }),
}));
