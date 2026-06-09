import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Sparkles, Paperclip, ArrowDown } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentFace, type AgentState } from "../../components/AgentFace";
import { ProviderLogo } from "../../components/ProviderLogo";
import { CopyButton } from "../../components/CopyButton";
import { TurnTimeline } from "../../components/TurnTimeline";
import {
  chatAgentRun,
  chatCancel,
  chatProviders,
  chatGet,
  chatRename,
  type ChatStreamEnd,
  type ChatStreamLine,
  type ProviderOption,
} from "../../api/chat";
import { localWorkflowsRead } from "../../api/workflow_yaml";
import type { AgentSummary } from "../../api/workflow_yaml";
import type { Project } from "../../types/contracts";
import { useActiveProject } from "../../state/activeProject";
import {
  foldFrame,
  blockFromPersisted,
  blocksToPlainText,
  formatUsage,
  deriveConversationTitle,
  type TurnBlock,
  type ChatProtoEvent,
  type ChatUsage,
} from "./chatProtocol";

interface ChatTurn {
  id: string;
  prompt: string;
  tool: string;
  model: string | null;
  agentId: string | null;
  blocks: TurnBlock[];
  status: "running" | "done" | "error";
  error: string | null;
  usage?: ChatUsage | null;
  cost?: number | null;
}

let sessionCounter = 0;
function nextSessionId(): string {
  sessionCounter += 1;
  return `chat-${Date.now()}-${sessionCounter}`;
}

// Unsent composer text, kept per project across tab/project switches (ChatView
// updates its `project` prop without always remounting, so component state
// alone would lose the draft). Session-lifetime, in-memory.
const composerDrafts = new Map<string, string>();

/** The master/orchestrator gets an intentional gradient orb with a glyph,
 *  not a random generated face. Real agents keep their AgentFace. */
function ChatAvatar({
  agentId,
  size,
  state = "idle",
}: {
  agentId: string | null;
  size: number;
  state?: AgentState;
}) {
  if (agentId) {
    return <AgentFace seed={agentId} size={size} state={state} title={`@${agentId}`} />;
  }
  return (
    <span
      className="cx-master"
      style={{ width: size, height: size }}
      aria-label="Animus Agent"
    >
      <Sparkles size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}

/** The rich input card — model/agent pickers live in its bottom toolbar. */
function Composer({
  prompt,
  setPrompt,
  onSend,
  onStop,
  busy,
  agents,
  providers,
  agentId,
  pickAgent,
  tool,
  setTool,
  model,
  setModel,
  currentProvider,
  autofocus,
  lockHarness,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  agents: AgentSummary[];
  providers: ProviderOption[];
  agentId: string;
  pickAgent: (id: string) => void;
  tool: string;
  setTool: (t: string) => void;
  model: string;
  setModel: (m: string) => void;
  currentProvider: ProviderOption | undefined;
  autofocus?: boolean;
  /** Once a conversation has turns it's bound to one provider; lock the
   *  agent + provider pickers so the session stays coherent. */
  lockHarness?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autofocus) taRef.current?.focus();
  }, [autofocus]);
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }
  const name = agentId ? `@${agentId}` : "Animus";
  return (
    <div className="cx-composer">
      <textarea
        ref={taRef}
        className="cx-composer__input"
        placeholder={`Message ${name}…`}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={1}
      />
      <div className="cx-toolbar">
        {/* attach */}
        <button
          type="button"
          className="cx-iconbtn"
          title="Attach files (the agent can read them)"
          onClick={async () => {
            const picked = await openDialog({ multiple: true, title: "Attach files" });
            if (!picked) return;
            const paths = Array.isArray(picked) ? picked : [picked];
            const refs = paths.map((p) => `@${p}`).join(" ");
            setPrompt(prompt ? `${prompt}\n${refs}` : refs);
          }}
        >
          <Paperclip size={15} />
        </button>
        {/* agent chip */}
        <label
          className={`cx-chip ${lockHarness ? "cx-chip--locked" : ""}`}
          title={
            lockHarness
              ? "Locked for this conversation — start a new chat to switch"
              : undefined
          }
        >
          <span className="cx-chip__avatar">
            <ChatAvatar agentId={agentId || null} size={18} />
          </span>
          <select
            className="cx-chip__select"
            value={agentId}
            onChange={(e) => pickAgent(e.target.value)}
            disabled={lockHarness}
          >
            <option value="">Animus Agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.id}
              </option>
            ))}
          </select>
        </label>
        {/* provider chip with brand logo */}
        <label
          className={`cx-chip ${lockHarness ? "cx-chip--locked" : ""}`}
          title={
            lockHarness
              ? "Locked for this conversation — start a new chat to switch"
              : undefined
          }
        >
          <span className="cx-chip__logo">
            <ProviderLogo tool={tool} size={15} />
          </span>
          <select
            className="cx-chip__select"
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              const p = providers.find((x) => x.tool === e.target.value);
              setModel(p?.models[0] ?? "");
            }}
            disabled={lockHarness}
          >
            {providers.map((p) => (
              <option key={p.tool} value={p.tool}>
                {p.name}
                {p.installed ? "" : " ⚠"}
              </option>
            ))}
          </select>
        </label>
        {/* model chip */}
        <label className="cx-chip cx-chip--model">
          {currentProvider && currentProvider.models.length > 0 ? (
            <select
              className="cx-chip__select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {currentProvider.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="">default</option>
            </select>
          ) : (
            <input
              className="cx-chip__input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model"
            />
          )}
        </label>

        <span className="cx-toolbar__spacer" />

        <span className="cx-hint">
          {busy
            ? "Esc stops"
            : prompt.trim()
              ? "↵ send · ⇧↵ newline"
              : "↵ send"}
        </span>

        {busy ? (
          <>
            {prompt.trim() && (
              <button
                type="button"
                className="cx-composer__btn cx-composer__btn--queue"
                onClick={onSend}
                title="Queue — sends when the agent is free (Enter)"
              >
                ↵
              </button>
            )}
            <button
              type="button"
              className="cx-composer__btn cx-composer__btn--stop"
              onClick={onStop}
              title="Stop"
            >
              ■
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cx-composer__btn"
            onClick={onSend}
            disabled={!prompt.trim()}
            title="Send (Enter)"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatView({ project }: { project: Project }) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [tool, setTool] = useState("claude");
  const [model, setModel] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [prompt, setPrompt] = useState(
    () => composerDrafts.get(`${project.id}:new`) ?? "",
  );
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const turnsRef = useRef<Map<string, string>>(new Map());
  const convRef = useRef<string | null>(null);
  // Title to apply once a brand-new conversation gets its id (auto-naming from
  // the first message). Set per-send; consumed on turn completion.
  const pendingTitleRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const pendingConversation = useActiveProject((s) => s.pendingConversation);
  const clearPendingConversation = useActiveProject(
    (s) => s.clearPendingConversation,
  );

  // Persist the composer draft on every edit, keyed per (project, conversation)
  // — an unsent message stays with its conversation across project/tab and
  // conversation switches. The "new" bucket holds the not-yet-started draft.
  const draftKey = useCallback(
    () => `${project.id}:${convRef.current ?? "new"}`,
    [project.id],
  );
  const setPromptAndDraft = useCallback(
    (v: string) => {
      setPrompt(v);
      const k = draftKey();
      if (v) composerDrafts.set(k, v);
      else composerDrafts.delete(k);
    },
    [draftKey],
  );
  const restoreDraft = useCallback(() => {
    setPrompt(composerDrafts.get(draftKey()) ?? "");
  }, [draftKey]);
  // Restore on project change (the component may not remount).
  useEffect(() => {
    restoreDraft();
  }, [restoreDraft]);

  const openConversation = useCallback(
    async (id: string) => {
      const path = project.repo_path?.trim();
      if (!path) return;
      try {
        const t = await chatGet(path, id);
        // Reconstruct turns: pair each user message with the following
        // assistant reply. Loaded history shows final messages (no live
        // tool activity — that wasn't persisted per-turn).
        const out: ChatTurn[] = [];
        let cur: ChatTurn | null = null;
        for (const m of t.messages) {
          if (m.role === "user") {
            cur = {
              id: `hist-${id}-${m.seq}`,
              prompt: m.content,
              tool: t.meta.tool,
              model: t.meta.model,
              agentId: null,
              blocks: [],
              status: "done",
              error: null,
            };
            out.push(cur);
          } else if (m.role === "assistant" && cur) {
            // Prefer the persisted timeline (tool calls + results + prose) so a
            // reloaded turn looks like it did live; fall back to plain text for
            // conversations saved before blocks were persisted.
            cur.blocks =
              m.blocks && m.blocks.length > 0
                ? m.blocks.map(blockFromPersisted)
                : [{ kind: "text", text: m.content }];
            cur.model = m.model ?? cur.model;
            cur.tool = m.tool ?? cur.tool;
            cur.usage = m.usage ?? cur.usage;
            cur.cost = m.cost_usd ?? cur.cost;
          }
        }
        setTurns(out);
        setQueue([]);
        convRef.current = id;
        setPrompt(composerDrafts.get(`${project.id}:${id}`) ?? "");
        if (t.meta.tool) setTool(t.meta.tool);
        if (t.meta.model) setModel(t.meta.model);
      } catch (e) {
        console.warn("[chat] open conversation failed", e);
      }
    },
    [project.repo_path, project.id],
  );

  const newConversation = useCallback(() => {
    setTurns([]);
    setQueue([]);
    convRef.current = null;
    setPrompt(composerDrafts.get(`${project.id}:new`) ?? "");
  }, [project.id]);

  // The left rail can request a conversation to open (or a fresh one). Honor it
  // once, then clear the signal so it doesn't re-fire on re-render.
  useEffect(() => {
    if (!pendingConversation) return;
    if (pendingConversation === "new") {
      newConversation();
    } else {
      void openConversation(pendingConversation);
    }
    clearPendingConversation();
  }, [pendingConversation, newConversation, openConversation, clearPendingConversation]);

  useEffect(() => {
    chatProviders()
      .then((p) => {
        setProviders(p);
        const firstInstalled = p.find((x) => x.installed) ?? p[0];
        if (firstInstalled) {
          setTool(firstInstalled.tool);
          setModel(firstInstalled.models[0] ?? "");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) return;
    localWorkflowsRead(path)
      .then((r) => setAgents(r.agents))
      .catch(() => {});
  }, [project.repo_path]);

  useEffect(() => {
    const unsub: UnlistenFn[] = [];
    let cancelled = false;
    void (async () => {
      const subs = await Promise.all([
        listen<ChatStreamLine>("chat-stream", (ev) => {
          const { sessionId, raw } = ev.payload;
          const turnId = turnsRef.current.get(sessionId);
          if (!turnId) return;
          let frame: ChatProtoEvent;
          try {
            frame = JSON.parse(raw) as ChatProtoEvent;
          } catch {
            return;
          }
          if (frame.type === "turn_started" && frame.conversation_id) {
            convRef.current = frame.conversation_id;
            return;
          }
          if (frame.type === "turn_completed") {
            if (frame.conversation_id) {
              convRef.current = frame.conversation_id;
            }
            return;
          }
          if (frame.type === "metadata") {
            // Provider usage/cost frame (may arrive cumulatively) — keep the
            // latest non-null values on the turn.
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      usage: frame.tokens ?? t.usage,
                      cost: frame.cost_usd ?? t.cost,
                    }
                  : t,
              ),
            );
            return;
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, blocks: foldFrame(t.blocks, frame) } : t,
            ),
          );
        }),
        listen<ChatStreamEnd>("chat-stream-end", (ev) => {
          const { sessionId, exitCode, error } = ev.payload;
          const turnId = turnsRef.current.get(sessionId);
          if (!turnId) return;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status:
                      error || (exitCode != null && exitCode !== 0)
                        ? "error"
                        : "done",
                    error,
                  }
                : t,
            ),
          );
          setActiveSession((s) => (s === sessionId ? null : s));
          turnsRef.current.delete(sessionId);
        }),
      ]);
      if (cancelled) {
        subs.forEach((u) => u());
        return;
      }
      unsub.push(...subs);
    })();
    return () => {
      cancelled = true;
      unsub.forEach((u) => u());
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  // Auto-scroll on new content only when the user is already at the bottom, so
  // scrolling up to read history isn't yanked back down mid-stream.
  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns, atBottom]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  // ⌘/Ctrl+Shift+N starts a fresh conversation from anywhere in the chat.
  useHotkeys(
    "mod+shift+n",
    (e) => {
      e.preventDefault();
      newConversation();
    },
    { enableOnFormTags: true },
    [newConversation],
  );

  // When a turn finishes (active session clears), auto-name a brand-new
  // conversation from its first message, then tell the left rail to re-aggregate
  // so the new (named) conversation appears / counts update.
  useEffect(() => {
    if (activeSession) return;
    const title = pendingTitleRef.current;
    const id = convRef.current;
    const path = project.repo_path?.trim();
    if (title && id && path) {
      pendingTitleRef.current = null;
      void chatRename(path, id, title)
        .catch(() => {})
        .finally(() => window.dispatchEvent(new Event("animus-chat-updated")));
    } else {
      window.dispatchEvent(new Event("animus-chat-updated"));
    }
  }, [activeSession, project.repo_path]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.tool === tool),
    [providers, tool],
  );
  const selectedAgent = agents.find((a) => a.id === agentId) ?? null;
  const busy = !!activeSession;
  const isEmpty = turns.length === 0;

  const send = useCallback(async (override?: string) => {
    const path = project.repo_path?.trim();
    const text = (override ?? prompt).trim();
    if (!path || !text || busy) return;
    // Auto-name a brand-new conversation from its first message; clear the
    // pending title when continuing an existing one so it can't leak forward.
    pendingTitleRef.current =
      convRef.current == null ? deriveConversationTitle(text) || null : null;
    const sessionId = nextSessionId();
    const turnId = `turn-${sessionId}`;
    turnsRef.current.set(sessionId, turnId);
    const turn: ChatTurn = {
      id: turnId,
      prompt: text,
      tool,
      model: model || null,
      agentId: agentId || null,
      blocks: [],
      status: "running",
      error: null,
      usage: null,
      cost: null,
    };
    setTurns((prev) => [...prev, turn]);
    setActiveSession(sessionId);
    if (override === undefined) {
      setPrompt("");
      composerDrafts.delete(`${project.id}:${convRef.current ?? "new"}`);
    }
    try {
      await chatAgentRun({
        sessionId,
        repoPath: path,
        tool,
        model: model || undefined,
        prompt: turn.prompt,
        conversationId: convRef.current ?? undefined,
        timeoutSecs: 600,
      });
    } catch (e) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, status: "error", error: String(e) } : t,
        ),
      );
      setActiveSession(null);
      turnsRef.current.delete(sessionId);
    }
  }, [project.repo_path, prompt, busy, tool, model, agentId]);

  const cancel = useCallback(async () => {
    if (!activeSession) return;
    await chatCancel(activeSession).catch(() => {});
    setActiveSession(null);
  }, [activeSession]);

  // Esc stops the in-flight turn (works while focused in the composer). No-op
  // when nothing is running, so it never steals Esc from other uses.
  useHotkeys(
    "escape",
    () => {
      if (activeSession) void cancel();
    },
    { enableOnFormTags: true },
    [activeSession, cancel],
  );

  // Composer submit: send now when the agent is free, otherwise queue the
  // message to auto-send the moment the current turn finishes (type-ahead).
  const submit = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    if (busy) {
      setQueue((q) => [...q, text]);
      setPrompt("");
      composerDrafts.delete(`${project.id}:${convRef.current ?? "new"}`);
    } else {
      void send(); // send() reads + clears `prompt` itself
    }
  }, [prompt, busy, send, project.id]);

  // Drain the queue: as soon as no turn is active, fire the next queued
  // message. send() sets activeSession synchronously, so this can't double-fire.
  useEffect(() => {
    if (!activeSession && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      void send(next);
    }
  }, [activeSession, queue, send]);

  function pickAgent(id: string) {
    setAgentId(id);
    if (!id) return;
    const a = agents.find((x) => x.id === id);
    if (a?.tool) setTool(a.tool);
    if (a?.model) setModel(a.model);
  }

  const headName = agentId ? `@${agentId}` : "Animus Agent";

  const composer = (
    <Composer
      prompt={prompt}
      setPrompt={setPromptAndDraft}
      onSend={submit}
      onStop={() => void cancel()}
      busy={busy}
      agents={agents}
      providers={providers}
      agentId={agentId}
      pickAgent={pickAgent}
      tool={tool}
      setTool={setTool}
      model={model}
      setModel={setModel}
      currentProvider={currentProvider}
      autofocus={isEmpty}
      lockHarness={!isEmpty}
    />
  );

  return (
    <div className={`cx ${isEmpty ? "cx--empty" : "cx--active"}`}>
      <div className="cx-ambient" aria-hidden>
        <span className="chat-blob chat-blob--1" />
        <span className="chat-blob chat-blob--2" />
        <span className="chat-blob chat-blob--3" />
      </div>

      {isEmpty ? (
        /* ---------- EMPTY / NEW: centered hero + composer ---------- */
        <div className="cx-hero">
          <span className="cx-hero__avatar">
            <ChatAvatar agentId={agentId || null} size={72} />
          </span>
          <h2 className="cx-hero__title">{headName}</h2>
          <p className="cx-hero__sub">
            {selectedAgent?.description ??
              selectedAgent?.role ??
              "Ask anything. Runs against this project with the same tools it uses in workflows."}
          </p>
          <div className="cx-hero__composer">{composer}</div>
          <div className="cx-hero__chips">
            {[
              "Summarize what this project does",
              "What's failing in CI right now?",
              "List open tasks and their status",
            ].map((s) => (
              <button
                key={s}
                type="button"
                className="cx-hero__chip"
                onClick={() => setPromptAndDraft(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ---------- ACTIVE: header + scroll + docked composer ---------- */
        <>
          <header className="cx-activehead">
            <span className={`cx-activehead__avatar ${busy ? "cx-activehead__avatar--busy" : ""}`}>
              <ChatAvatar agentId={agentId || null} size={24} state={busy ? "running" : "idle"} />
            </span>
            <span className="cx-activehead__name">{headName}</span>
            <code className="cx-activehead__model">
              {currentProvider?.name ?? tool}
              {model ? ` · ${model}` : ""}
            </code>
            <button
              type="button"
              className="cx-activehead__new"
              onClick={newConversation}
              title="New conversation"
            >
              + New
            </button>
          </header>
          <div className="cx-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="cx-col">
              {turns.map((turn, ti) => (
                <div key={turn.id} className="cx-turn">
                  <div className="cx-msg cx-msg--user cx-msg--copyable">
                    <div className="cx-msg__bubble">{turn.prompt}</div>
                    <CopyButton text={turn.prompt} className="cx-copy--user" />
                  </div>
                  <div className="cx-msg cx-msg--agent">
                    <span
                      className={`cx-msg__avatar ${turn.status === "running" ? "cx-msg__avatar--busy" : ""}`}
                    >
                      <ChatAvatar
                        agentId={turn.agentId}
                        size={30}
                        state={
                          turn.status === "running"
                            ? "running"
                            : turn.status === "error"
                              ? "error"
                              : "done"
                        }
                      />
                    </span>
                    <div className="cx-msg__body cx-msg--copyable">
                      <div className="cx-msg__name">
                        {turn.agentId ? `@${turn.agentId}` : turn.tool}
                        {turn.model && (
                          <code className="cx-msg__model">{turn.model}</code>
                        )}
                        {turn.status !== "running" && (
                          <CopyButton
                            text={blocksToPlainText(turn.blocks)}
                            className="cx-copy--agent"
                          />
                        )}
                      </div>
                      <TurnTimeline
                        blocks={turn.blocks}
                        running={turn.status === "running"}
                        interactive={ti === turns.length - 1 && !busy}
                        onAnswer={(t) => void send(t)}
                      />
                      {turn.status === "running" &&
                        !turn.blocks.some(
                          (b) => b.kind === "text" && b.text.trim(),
                        ) && (
                          <div className="cx-typing">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                      {turn.status === "error" && (
                        <div className="cx-error">
                          <div className="cx-error__head">
                            <span className="cx-error__icon" aria-hidden>
                              ⚠
                            </span>
                            <span className="cx-error__title">Turn failed</span>
                            <button
                              type="button"
                              className="cx-error__retry"
                              disabled={busy}
                              title={
                                busy
                                  ? "Wait for the current turn to finish"
                                  : "Resend this message"
                              }
                              onClick={() => void send(turn.prompt)}
                            >
                              ↻ Retry
                            </button>
                          </div>
                          {turn.error && (
                            <pre className="cx-error__detail">{turn.error}</pre>
                          )}
                        </div>
                      )}
                      {turn.status !== "running" &&
                        (() => {
                          const meta = formatUsage(turn.usage, turn.cost);
                          return meta ? (
                            <div className="cx-msg__usage" title="Token usage · cost">
                              {meta}
                            </div>
                          ) : null;
                        })()}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className="cx-composer-wrap">
            {!atBottom && (
              <button
                type="button"
                className="cx-scrollbtn"
                onClick={scrollToBottom}
                title="Scroll to latest"
                aria-label="Scroll to latest"
              >
                <ArrowDown size={16} />
              </button>
            )}
            <div className="cx-col">
              {queue.length > 0 && (
                <div className="cx-queue">
                  <span className="cx-queue__label">
                    Queued · sends when the agent is free
                  </span>
                  {queue.map((q, i) => (
                    <div key={i} className="cx-queue__item">
                      <span className="cx-queue__text">{q}</span>
                      <button
                        type="button"
                        className="cx-queue__rm"
                        title="Remove"
                        onClick={() =>
                          setQueue((cur) => cur.filter((_, j) => j !== i))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {composer}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ChatView;
