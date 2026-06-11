import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { Sparkles, Paperclip, ArrowDown, Brain } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentFace, type AgentState } from "../../components/AgentFace";
import { ProviderLogo } from "../../components/ProviderLogo";
import { CopyButton } from "../../components/CopyButton";
import { TurnTimeline } from "../../components/TurnTimeline";
import { QueuePanel } from "../../components/QueuePanel";
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
  /** True when the user stopped this turn mid-stream. */
  stopped?: boolean;
}

/** Per-session bookkeeping for an in-flight `chat send`. `convKey` is the
 *  bucket of the conversation that OWNS the session ("new" until the CLI
 *  reports the id of a freshly-created one) — stream frames must never
 *  clobber the viewed conversation the user has since opened. `pendingTitle`
 *  rides with the session so auto-naming can only ever rename its own
 *  conversation. */
interface SessionEntry {
  projectId: string;
  repoPath: string;
  turnId: string;
  convKey: string;
  pendingTitle: string | null;
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

interface ChatHarness {
  tool: string;
  model: string;
  agentId: string;
  effort: string;
}

interface ProjectChat {
  /** Conversation being viewed: a conversation id, or "new". */
  viewing: string;
  /** Turn lists per conversation key — frames keep landing in the owning
   *  bucket even when the user is viewing a different conversation. */
  buckets: Record<string, ChatTurn[]>;
  queue: string[];
  queuePaused: boolean;
  activeSession: string | null;
  harness: ChatHarness | null;
}

// Chat state lives OUTSIDE the component: Bridge remounts ChatView on every
// project/tab switch, and an in-flight `chat send` must survive that — the
// turn keeps streaming, stays stoppable, and queued messages aren't lost.
const useChatStore = create<{ projects: Record<string, ProjectChat> }>(() => ({
  projects: {},
}));

const EMPTY_PROJECT_CHAT: ProjectChat = {
  viewing: "new",
  buckets: {},
  queue: [],
  queuePaused: false,
  activeSession: null,
  harness: null,
};
const EMPTY_TURNS: ChatTurn[] = [];

function patchChat(
  projectId: string,
  patch: (pc: ProjectChat) => Partial<ProjectChat>,
) {
  useChatStore.setState((s) => {
    const pc = s.projects[projectId] ?? EMPTY_PROJECT_CHAT;
    return {
      projects: { ...s.projects, [projectId]: { ...pc, ...patch(pc) } },
    };
  });
}

function patchTurn(
  projectId: string,
  convKey: string,
  turnId: string,
  patch: (t: ChatTurn) => ChatTurn,
) {
  patchChat(projectId, (pc) => {
    const turns = pc.buckets[convKey];
    if (!turns) return {};
    return {
      buckets: {
        ...pc.buckets,
        [convKey]: turns.map((t) => (t.id === turnId ? patch(t) : t)),
      },
    };
  });
}

// Live sessions keyed by sessionId — module-global so frames route to the
// right project/conversation even while no ChatView is mounted.
const sessions = new Map<string, SessionEntry>();

function handleStreamLine({ sessionId, raw }: ChatStreamLine) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  let frame: ChatProtoEvent;
  try {
    frame = JSON.parse(raw) as ChatProtoEvent;
  } catch {
    return;
  }
  if (frame.type === "turn_started" || frame.type === "turn_completed") {
    // Adopt the CLI-reported conversation id: rename the session's bucket
    // (and follow with the user's view + draft only if they are still on it
    // — otherwise a finishing background turn would yank the target of the
    // user's NEXT message back to an old conversation).
    if (frame.conversation_id && frame.conversation_id !== entry.convKey) {
      const oldKey = entry.convKey;
      const newKey = frame.conversation_id;
      entry.convKey = newKey;
      const draft = composerDrafts.get(`${entry.projectId}:${oldKey}`);
      if (draft !== undefined) {
        composerDrafts.set(`${entry.projectId}:${newKey}`, draft);
        composerDrafts.delete(`${entry.projectId}:${oldKey}`);
      }
      patchChat(entry.projectId, (pc) => {
        const buckets = { ...pc.buckets };
        const moved = buckets[oldKey];
        if (moved) {
          delete buckets[oldKey];
          buckets[newKey] = moved;
        }
        return {
          buckets,
          viewing: pc.viewing === oldKey ? newKey : pc.viewing,
        };
      });
    }
    if (frame.type === "turn_completed" && entry.pendingTitle) {
      // Auto-name the session's OWN conversation (never whatever the user
      // happens to be viewing now).
      const title = entry.pendingTitle;
      entry.pendingTitle = null;
      if (entry.convKey !== "new") {
        void chatRename(entry.repoPath, entry.convKey, title)
          .catch(() => {})
          .finally(() =>
            window.dispatchEvent(new Event("animus-chat-updated")),
          );
      }
    }
    return;
  }
  if (frame.type === "metadata") {
    patchTurn(entry.projectId, entry.convKey, entry.turnId, (t) => ({
      ...t,
      usage: frame.tokens ?? t.usage,
      cost: frame.cost_usd ?? t.cost,
    }));
    return;
  }
  patchTurn(entry.projectId, entry.convKey, entry.turnId, (t) => ({
    ...t,
    blocks: foldFrame(t.blocks, frame),
  }));
}

function handleStreamEnd({ sessionId, exitCode, error }: ChatStreamEnd) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  // A user-initiated stop is not a failure: settle the turn as done (with a
  // "stopped" marker) instead of leaving it spinning or red.
  const wasCancelled = error === "cancelled";
  patchTurn(entry.projectId, entry.convKey, entry.turnId, (t) =>
    wasCancelled
      ? { ...t, status: "done", error: null, stopped: true }
      : {
          ...t,
          status:
            error || (exitCode != null && exitCode !== 0) ? "error" : "done",
          error,
        },
  );
  patchChat(entry.projectId, (pc) =>
    pc.activeSession === sessionId ? { activeSession: null } : {},
  );
  window.dispatchEvent(new Event("animus-chat-updated"));
}

let streamListenersStarted = false;
function ensureStreamListeners() {
  if (streamListenersStarted) return;
  streamListenersStarted = true;
  void listen<ChatStreamLine>("chat-stream", (ev) =>
    handleStreamLine(ev.payload),
  );
  void listen<ChatStreamEnd>("chat-stream-end", (ev) =>
    handleStreamEnd(ev.payload),
  );
}

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
  effort,
  setEffort,
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
  /** Reasoning effort: "" = provider default, else low|medium|high. Tunable
   *  per turn, so it is never harness-locked. */
  effort: string;
  setEffort: (e: string) => void;
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
        {/* reasoning-effort chip — per-turn tunable, never locked */}
        <label
          className={`cx-chip cx-chip--effort ${effort ? "cx-chip--effort-on" : ""}`}
          title="Reasoning effort for the next turn"
        >
          <Brain size={13} className="cx-chip__effort-icon" />
          <select
            className="cx-chip__select"
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
          >
            <option value="">effort: auto</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
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
  const pc = useChatStore((s) => s.projects[project.id]) ?? EMPTY_PROJECT_CHAT;
  const { viewing, queue, queuePaused, activeSession } = pc;
  const turns = pc.buckets[viewing] ?? EMPTY_TURNS;
  const tool = pc.harness?.tool ?? "claude";
  const model = pc.harness?.model ?? "";
  const agentId = pc.harness?.agentId ?? "";
  // Reasoning effort for the NEXT turn ("" = provider default).
  const effort = pc.harness?.effort ?? "";
  const setHarness = useCallback(
    (patch: Partial<ChatHarness>) =>
      patchChat(project.id, (cur) => ({
        harness: {
          tool: "claude",
          model: "",
          agentId: "",
          effort: "",
          ...cur.harness,
          ...patch,
        },
      })),
    [project.id],
  );
  const [prompt, setPrompt] = useState(() => {
    const v = useChatStore.getState().projects[project.id]?.viewing ?? "new";
    return composerDrafts.get(`${project.id}:${v}`) ?? "";
  });
  // Guards openConversation against out-of-order responses: only the latest
  // open (or "+ New") may apply its transcript.
  const openSeqRef = useRef(0);
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
    () => `${project.id}:${viewing}`,
    [project.id, viewing],
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
  // Restore on project/conversation change (the component may not remount).
  useEffect(() => {
    restoreDraft();
  }, [restoreDraft]);

  const openConversation = useCallback(
    async (id: string) => {
      const path = project.repo_path?.trim();
      if (!path) return;
      const seq = ++openSeqRef.current;
      try {
        const t = await chatGet(path, id);
        if (seq !== openSeqRef.current) return;
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
        patchChat(project.id, (pcur) => {
          // Keep any still-running live turn of this conversation on top of
          // the reloaded history (its prompt isn't persisted yet — drop the
          // bare history stub if one exists).
          const live = (pcur.buckets[id] ?? []).filter(
            (x) => x.status === "running",
          );
          const hist = live.length
            ? out.filter(
                (o) =>
                  !(o.blocks.length === 0 &&
                    live.some((l) => l.prompt === o.prompt)),
              )
            : out;
          return {
            buckets: { ...pcur.buckets, [id]: [...hist, ...live] },
            viewing: id,
            queue: [],
          };
        });
        if (t.meta.tool || t.meta.model) {
          setHarness({
            ...(t.meta.tool ? { tool: t.meta.tool } : {}),
            ...(t.meta.model ? { model: t.meta.model } : {}),
          });
        }
      } catch (e) {
        console.warn("[chat] open conversation failed", e);
      }
    },
    [project.repo_path, project.id, setHarness],
  );

  const newConversation = useCallback(() => {
    openSeqRef.current += 1;
    patchChat(project.id, (pcur) => ({
      viewing: "new",
      queue: [],
      buckets: {
        ...pcur.buckets,
        new: (pcur.buckets["new"] ?? EMPTY_TURNS).filter(
          (t) => t.status === "running",
        ),
      },
    }));
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
    ensureStreamListeners();
  }, []);

  useEffect(() => {
    chatProviders()
      .then((p) => {
        setProviders(p);
        const firstInstalled = p.find((x) => x.installed) ?? p[0];
        // Defaults only apply before the user (or a reopened conversation)
        // has picked a harness for this project.
        if (
          firstInstalled &&
          !useChatStore.getState().projects[project.id]?.harness
        ) {
          setHarness({
            tool: firstInstalled.tool,
            model: firstInstalled.models[0] ?? "",
          });
        }
      })
      .catch(() => {});
  }, [project.id, setHarness]);

  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) return;
    localWorkflowsRead(path)
      .then((r) => setAgents(r.agents))
      .catch(() => {});
  }, [project.repo_path]);

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

  // When a turn finishes (active session clears), tell the left rail to
  // re-aggregate so a brand-new conversation appears / counts update.
  // (Auto-titling is handled per-session in the stream handler so it can
  // never rename a conversation the session doesn't own.)
  useEffect(() => {
    if (!activeSession) {
      window.dispatchEvent(new Event("animus-chat-updated"));
    }
  }, [activeSession]);

  // If the conversation we're pointed at is deleted from the rail, reset to a
  // fresh one instead of sending future turns at a dead id; always prune its
  // composer draft and turn bucket.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { projectId?: string; conversationId?: string }
        | undefined;
      if (!d?.conversationId) return;
      composerDrafts.delete(`${d.projectId}:${d.conversationId}`);
      if (d.projectId !== project.id) return;
      patchChat(project.id, (pcur) => {
        const buckets = { ...pcur.buckets };
        delete buckets[d.conversationId!];
        return { buckets };
      });
      if (
        useChatStore.getState().projects[project.id]?.viewing ===
        d.conversationId
      ) {
        newConversation();
      }
    };
    window.addEventListener("animus-conversation-deleted", handler);
    return () =>
      window.removeEventListener("animus-conversation-deleted", handler);
  }, [project.id, newConversation]);

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
    const sessionId = nextSessionId();
    const turnId = `turn-${sessionId}`;
    sessions.set(sessionId, {
      projectId: project.id,
      repoPath: path,
      turnId,
      convKey: viewing,
      // Auto-name a brand-new conversation from its first message; an
      // existing conversation gets no pending title so nothing can leak.
      pendingTitle:
        viewing === "new" ? deriveConversationTitle(text) || null : null,
    });
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
    patchChat(project.id, (pcur) => ({
      buckets: {
        ...pcur.buckets,
        [viewing]: [...(pcur.buckets[viewing] ?? EMPTY_TURNS), turn],
      },
      activeSession: sessionId,
    }));
    if (override === undefined) {
      setPrompt("");
      composerDrafts.delete(`${project.id}:${viewing}`);
    }
    try {
      await chatAgentRun({
        sessionId,
        repoPath: path,
        tool,
        model: model || undefined,
        prompt: turn.prompt,
        conversationId: viewing === "new" ? undefined : viewing,
        timeoutSecs: 600,
        reasoningEffort: effort || undefined,
        agentId: agentId || undefined,
      });
    } catch (e) {
      const entry = sessions.get(sessionId);
      sessions.delete(sessionId);
      patchTurn(project.id, entry?.convKey ?? viewing, turnId, (t) => ({
        ...t,
        status: "error",
        error: String(e),
      }));
      patchChat(project.id, (pcur) =>
        pcur.activeSession === sessionId ? { activeSession: null } : {},
      );
    }
  }, [project.repo_path, project.id, prompt, busy, tool, model, agentId, effort, viewing]);

  const cancel = useCallback(async () => {
    if (!activeSession) return;
    const sid = activeSession;
    // Pause the queue FIRST (same batch as the optimistic session clear) so
    // stopping a turn doesn't instantly auto-fire the next queued message at
    // an agent the user just halted.
    patchChat(project.id, () => ({ queuePaused: true }));
    await chatCancel(sid).catch(() => {});
    patchChat(project.id, (pcur) =>
      pcur.activeSession === sid ? { activeSession: null } : {},
    );
  }, [activeSession, project.id]);

  // Esc stops the in-flight turn. No-op when nothing is running, and ignored
  // when focus is in some OTHER text field (rail rename/search) — only the
  // composer textarea or non-form focus may trigger it.
  useHotkeys(
    "escape",
    () => {
      if (!activeSession) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLInputElement) return;
      if (
        ae instanceof HTMLTextAreaElement &&
        !ae.classList.contains("cx-composer__input")
      ) {
        return;
      }
      void cancel();
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
      patchChat(project.id, (pcur) => ({
        queuePaused: false,
        queue: [...pcur.queue, text],
      }));
      setPrompt("");
      composerDrafts.delete(`${project.id}:${viewing}`);
    } else {
      patchChat(project.id, () => ({ queuePaused: false }));
      void send(); // send() reads + clears `prompt` itself
    }
  }, [prompt, busy, send, project.id, viewing]);

  // Drain the queue: as soon as no turn is active (and the queue isn't
  // paused by a stop), fire the next queued message. send() sets
  // activeSession synchronously, so this can't double-fire. The repo-path
  // guard mirrors send()'s — dequeue only what send() will actually take.
  useEffect(() => {
    if (activeSession || queuePaused || queue.length === 0) return;
    if (!project.repo_path?.trim()) return;
    const [next, ...rest] = queue;
    patchChat(project.id, () => ({ queue: rest }));
    void send(next);
  }, [activeSession, queuePaused, queue, send, project.id, project.repo_path]);

  function pickAgent(id: string) {
    const a = id ? agents.find((x) => x.id === id) : undefined;
    setHarness({
      agentId: id,
      ...(a?.tool ? { tool: a.tool } : {}),
      ...(a?.model ? { model: a.model } : {}),
    });
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
      setTool={(t) => setHarness({ tool: t })}
      model={model}
      setModel={(m) => setHarness({ model: m })}
      effort={effort}
      setEffort={(e) => setHarness({ effort: e })}
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
                      {turn.stopped && (
                        <div className="cx-msg__stopped" title="Turn stopped by you">
                          ■ stopped
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
              <QueuePanel
                queue={queue}
                paused={queuePaused}
                onRemove={(i) =>
                  patchChat(project.id, (pcur) => ({
                    queue: pcur.queue.filter((_, j) => j !== i),
                  }))
                }
                onResume={() =>
                  patchChat(project.id, () => ({ queuePaused: false }))
                }
              />
              {composer}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ChatView;
