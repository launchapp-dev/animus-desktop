import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../state/chat";

const SUGGESTIONS = [
  "what failed in the last hour?",
  "show running cycles",
  "what's the daemon health?",
  "what plugins are installed?",
  "restart the trading-firm daemon",
  "what should I review first?",
];

export function Chat() {
  const { messages, pending, error, send } = useChatStore();
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  const submit = async () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    await send(text);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="chat-view">
      <header className="chat-view__header">
        <div>
          <h1 className="view__title">Ask Animus</h1>
          <p className="view__subtitle">
            Ask about projects, cycles, daemon health, plugins, or trigger
            actions. Replies are grounded in your local state.
          </p>
        </div>
      </header>

      <div className="chat-view__scroll" ref={scrollerRef}>
        {empty ? (
          <div className="chat-empty">
            <p className="muted small">Try:</p>
            <div className="chat-empty__suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat-suggestion"
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread">
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                <div className="chat-msg__role">{m.role}</div>
                <div className="chat-msg__body">{m.content}</div>
              </div>
            ))}
            {pending && (
              <div className="chat-msg chat-msg--assistant chat-msg--pending">
                <div className="chat-msg__role">assistant</div>
                <div className="chat-msg__body">
                  <span className="chat-typing">●●●</span>
                </div>
              </div>
            )}
            {error && (
              <div className="chat-msg chat-msg--error">
                <div className="chat-msg__role">error</div>
                <div className="chat-msg__body">{error}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chat-view__composer">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask Animus..."
          rows={1}
          className="chat-input"
          disabled={pending}
        />
        <button
          type="button"
          className="chat-send"
          onClick={() => void submit()}
          disabled={!input.trim() || pending}
        >
          Send
        </button>
      </div>
    </div>
  );
}
