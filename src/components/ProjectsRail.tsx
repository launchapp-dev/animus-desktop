import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";
import { useEffect, useState, useCallback, useRef } from "react";
import { useProjectsStore } from "../state/projects";
import { useActiveProject } from "../state/activeProject";
import { Wisp } from "./Wisp";
import { useWispState } from "../lib/useWispState";
import {
  chatListAll,
  chatRename,
  chatDelete,
  type ProjectConversation,
} from "../api/chat";
import { relativeTime, conversationMatches, nextNavIndex } from "../lib/utils";
import { useConversationStreaming } from "../views/project/ChatView";
import type { CycleStatus } from "../types/contracts";
import {
  Plus,
  Boxes,
  Settings2,
  FolderGit2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Trash2,
  Search,
  PanelLeftClose,
} from "lucide-react";

/** Drag-to-resize handle pinned to the sidebar's right edge. shadcn's
 *  SidebarRail only toggles; this sets `--sidebar-width` on the provider
 *  wrapper live during drag (transitions suppressed) and persists on release. */
function SidebarResizer() {
  const MIN = 240;
  const MAX = 460;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrapper = (e.currentTarget as HTMLElement).closest(
      '[class*="sidebar-wrapper"]',
    ) as HTMLElement | null;
    document.body.setAttribute("data-sidebar-resizing", "");
    const clamp = (x: number) => Math.min(MAX, Math.max(MIN, Math.round(x)));
    const move = (ev: PointerEvent) => {
      wrapper?.style.setProperty("--sidebar-width", `${clamp(ev.clientX)}px`);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.removeAttribute("data-sidebar-resizing");
      const w = `${clamp(ev.clientX)}px`;
      try {
        localStorage.setItem("animus.sidebarWidth", w);
      } catch {
        /* non-fatal */
      }
      window.dispatchEvent(new CustomEvent("animus-sidebar-width", { detail: w }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        try {
          localStorage.removeItem("animus.sidebarWidth");
        } catch {
          /* non-fatal */
        }
        window.dispatchEvent(
          new CustomEvent("animus-sidebar-width", { detail: "17rem" }),
        );
      }}
      title="Drag to resize · double-click to reset"
      className="sidebar-resizer"
    />
  );
}

function dotToneFor(status: CycleStatus | undefined): "ok" | "warn" | "off" {
  if (status === "passed") return "ok";
  if (status === "failed" || status === "cancelled") return "warn";
  return "off";
}

/** One conversation row in the left rail with hover-reveal rename (inline edit)
 *  and delete (inline confirm) actions. */
function ConversationRow({
  c,
  repoPath,
  onOpen,
  onChanged,
}: {
  c: ProjectConversation;
  repoPath: string | undefined;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.title ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const streaming = useConversationStreaming(c.projectId, c.id);

  const commitRename = async () => {
    setEditing(false);
    if (!repoPath || draft.trim() === (c.title ?? "")) return;
    setBusy(true);
    try {
      await chatRename(repoPath, c.id, draft.trim());
      onChanged();
    } catch {
      /* leave the rail as-is on failure */
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!repoPath) return;
    setBusy(true);
    try {
      await chatDelete(repoPath, c.id);
      // Let ChatView reset if it's pointed at this conversation (and prune
      // its composer draft) — otherwise its next send targets a dead id.
      window.dispatchEvent(
        new CustomEvent("animus-conversation-deleted", {
          detail: { projectId: c.projectId, conversationId: c.id },
        }),
      );
      onChanged();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (editing) {
    return (
      <SidebarMenuItem>
        <div className="flex items-center gap-1.5 px-2 py-1">
          <MessageSquare className="size-3 shrink-0 text-sidebar-foreground/40" />
          <input
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={() => void commitRename()}
            className="flex-1 min-w-0 bg-transparent border-b border-[var(--accent)] text-[12px] text-sidebar-foreground outline-none"
          />
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="group/conv">
      <SidebarMenuButton
        onClick={onOpen}
        tooltip={c.title ?? "Untitled chat"}
        className="cx-conv-nav h-auto py-1 items-center pr-12"
      >
        <MessageSquare className="size-3 shrink-0 text-sidebar-foreground/40" />
        <span className="truncate text-[12px] leading-tight text-sidebar-foreground/85">
          {c.title ?? "Untitled chat"}
        </span>
        {streaming ? (
          <span
            className="conv-live ml-auto shrink-0"
            title="Streaming"
            aria-label="Streaming"
          />
        ) : (
          c.updatedAt && (
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-sidebar-foreground/35 group-hover/conv:opacity-0">
              {relativeTime(c.updatedAt)}
            </span>
          )
        )}
      </SidebarMenuButton>
      {confirming ? (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void doDelete()}
            className="rounded px-1.5 text-[10px] font-medium text-[var(--crimson,#f0533a)] hover:underline disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded px-1 text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 group-hover/conv:flex">
          <button
            type="button"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(c.title ?? "");
              setEditing(true);
            }}
            className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-[var(--crimson,#f0533a)]"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      )}
    </SidebarMenuItem>
  );
}

export function ProjectsRail({
  onAddProject,
  addProjectBusy,
}: {
  onAddProject: () => void;
  addProjectBusy?: boolean;
}) {
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const setActive = useActiveProject((s) => s.setActiveProject);
  const openConversation = useActiveProject((s) => s.openConversation);
  const { toggleSidebar } = useSidebar();
  const wispExpression = useWispState();
  const wispTooltip = {
    awake: "Animus is awake — the daemon is running and idle, ready for work.",
    working: "Animus is working — a cycle is running right now.",
    done: "Animus is pleased — the last cycle just passed.",
    resting: "Animus is resting — no active daemons.",
    "needs-you":
      "Animus needs you — the daemon isn't installed, or a cycle is blocked or failed.",
  }[wispExpression];

  const [conversations, setConversations] = useState<ProjectConversation[]>([]);
  const [convFilter, setConvFilter] = useState("");
  const [expandedConvs, setExpandedConvs] = useState<Set<string>>(new Set());
  const convSearchRef = useRef<HTMLInputElement | null>(null);
  const toggleConvGroup = (id: string) =>
    setExpandedConvs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ↑/↓ move focus through the conversation rows; ↓ from the search box enters
  // the list, ↑ from the first row returns to it. Enter opens (native button).
  const onConvKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const active = document.activeElement as HTMLElement | null;
    const isSearch = active === convSearchRef.current;
    const isNavBtn = !!active?.classList.contains("cx-conv-nav");
    if (!isSearch && !isNavBtn) return; // ignore e.g. a rename input
    const btns = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>("button.cx-conv-nav"),
    );
    if (btns.length === 0) return;
    const idx = isNavBtn ? btns.indexOf(active as HTMLButtonElement) : -1;
    if (idx === 0 && e.key === "ArrowUp" && convSearchRef.current) {
      e.preventDefault();
      convSearchRef.current.focus();
      return;
    }
    const next = nextNavIndex(idx, btns.length, e.key === "ArrowDown" ? 1 : -1);
    if (next >= 0 && next !== idx) {
      e.preventDefault();
      btns[next]?.focus();
    }
  }, []);

  // Monotonic sequence so a slow, older chatListAll can never overwrite a
  // newer result (e.g. a just-renamed title flickering back).
  const refreshSeq = useRef(0);
  const refreshConversations = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const adopted = projects
      .filter((p) => p.repo_path)
      .map((p) => ({
        id: p.id,
        name: p.repo_full_name ?? p.id,
        repoPath: p.repo_path as string,
      }));
    if (adopted.length === 0) {
      setConversations([]);
      return;
    }
    try {
      const list = await chatListAll(adopted);
      if (seq === refreshSeq.current) setConversations(list);
    } catch {
      // leave prior list in place on transient error
    }
  }, [projects]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // ChatView dispatches this after each completed turn so the rail stays live.
  useEffect(() => {
    const handler = () => void refreshConversations();
    window.addEventListener("animus-chat-updated", handler);
    return () => window.removeEventListener("animus-chat-updated", handler);
  }, [refreshConversations]);

  // Start a fresh conversation in the most relevant project: the active one if
  // it's a real project, otherwise the first adopted project.
  const startNewChat = () => {
    const realActive =
      typeof activeId === "string" &&
      activeId !== "all-agents" &&
      activeId !== "plugins" &&
      projects.some((p) => p.id === activeId)
        ? activeId
        : projects[0]?.id;
    if (!realActive) return;
    openConversation(realActive, "new");
  };

  // Conversations grouped under their project, newest-first. Each group shows
  // the most-recent few with an expand-to-see-all toggle, so the rail stays
  // short without losing the cross-project view.
  const convGroups = (() => {
    const order: string[] = [];
    const byProject = new Map<
      string,
      { name: string; items: ProjectConversation[] }
    >();
    for (const c of conversations) {
      if (!conversationMatches(c, convFilter)) continue;
      let g = byProject.get(c.projectId);
      if (!g) {
        g = { name: c.projectName, items: [] };
        byProject.set(c.projectId, g);
        order.push(c.projectId);
      }
      g.items.push(c);
    }
    return order.map((id) => ({ projectId: id, ...byProject.get(id)! }));
  })();

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader className="flex-col gap-2.5 px-3 pt-3 pb-1.5">
        <div className="flex items-center justify-between">
          {/* Horizontal lockup: Wisp mark + wordmark (design §08 · PRIMARY). */}
          <span
            className="inline-flex items-center gap-2"
            style={{ ["--wisp-eye" as string]: "var(--sidebar-bg)" }}
            title={wispTooltip}
          >
            <Wisp expression={wispExpression} size={40} title={wispTooltip} />
            <span className="font-[var(--font-display)] text-[22px] font-bold leading-none tracking-[0.005em] text-sidebar-foreground">
              animus
            </span>
          </span>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            title="Collapse sidebar (⌘B)"
            className="flex items-center justify-center size-6 rounded-md text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onAddProject}
          disabled={addProjectBusy}
          className="flex items-center justify-center gap-1.5 h-8 rounded-full text-[12.5px] font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-60 transition-[background,transform] active:scale-[0.985]"
        >
          <Plus className="size-4" />
          <span>{addProjectBusy ? "Choosing folder…" : "Add project"}</span>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between text-[10px] uppercase tracking-wider">
            <span>Projects</span>
            <span className="font-mono text-[10px] opacity-60">
              {projects.length}
            </span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled className="text-sidebar-foreground/50">
                    <FolderGit2 />
                    <span>None yet</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                projects.map((p) => {
                  const tone = dotToneFor(p.last_cycle?.status as CycleStatus | undefined);
                  const isActive = activeId === p.id;
                  const label = p.repo_full_name ?? p.id;
                  return (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setActive(p.id)}
                        tooltip={label}
                      >
                        <span
                          aria-hidden
                          className={
                            "inline-block size-[7px] rounded-full shrink-0 " +
                            (tone === "ok"
                              ? "bg-[var(--green)]"
                              : tone === "warn"
                                ? "bg-[var(--yellow)]"
                                : "bg-[var(--gray)]")
                          }
                        />
                        <span className="truncate">{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between text-[10px] uppercase tracking-wider">
            <span>Conversations</span>
            <button
              type="button"
              onClick={startNewChat}
              disabled={projects.length === 0}
              aria-label="New conversation"
              title="New conversation"
              className="flex items-center justify-center size-4 rounded text-sidebar-foreground/50 hover:text-[var(--copper)] disabled:opacity-40 transition-colors"
            >
              <MessageSquarePlus className="size-3.5" />
            </button>
          </SidebarGroupLabel>
          <SidebarGroupContent onKeyDown={onConvKeyDown}>
            {conversations.length > 0 && (
              <div className="px-2 pb-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-sidebar-foreground/40" />
                  <input
                    ref={convSearchRef}
                    value={convFilter}
                    onChange={(e) => setConvFilter(e.target.value)}
                    placeholder="Search chats…"
                    aria-label="Search conversations"
                    className="h-6 w-full rounded border border-transparent bg-sidebar-accent/50 pl-6 pr-2 text-[11px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/35 focus:border-[var(--copper)]"
                  />
                </div>
              </div>
            )}
            {conversations.length === 0 ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={startNewChat}
                    disabled={projects.length === 0}
                    className="text-sidebar-foreground/50"
                    tooltip="Start a conversation"
                  >
                    <MessageSquarePlus />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : convGroups.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-sidebar-foreground/40">
                No matches
              </div>
            ) : (
              convGroups.map((g) => {
                const expanded = expandedConvs.has(g.projectId);
                const COLLAPSED = 2;
                const shown = expanded ? g.items : g.items.slice(0, COLLAPSED);
                const repoPath = projects.find(
                  (p) => p.id === g.projectId,
                )?.repo_path;
                return (
                  <div key={g.projectId} className="mb-1.5">
                    <div className="flex items-center justify-between gap-1 px-2 h-5">
                      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/40">
                        {g.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => openConversation(g.projectId, "new")}
                        aria-label={`New conversation in ${g.name}`}
                        title={`New conversation in ${g.name}`}
                        className="flex items-center justify-center size-4 rounded text-sidebar-foreground/40 hover:text-[var(--copper)] transition-colors shrink-0"
                      >
                        <MessageSquarePlus className="size-3" />
                      </button>
                    </div>
                    <SidebarMenu>
                      {shown.map((c) => (
                        <ConversationRow
                          key={c.id}
                          c={c}
                          repoPath={repoPath}
                          onOpen={() => openConversation(c.projectId, c.id)}
                          onChanged={refreshConversations}
                        />
                      ))}
                    </SidebarMenu>
                    {g.items.length > COLLAPSED && (
                      <button
                        type="button"
                        onClick={() => toggleConvGroup(g.projectId)}
                        className="ml-2 mt-0.5 text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
                      >
                        {expanded
                          ? "Show less"
                          : `Show all ${g.items.length}`}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
            Roster
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeId === "all-agents"}
                  onClick={() => setActive("all-agents")}
                  tooltip="All agents"
                >
                  <Boxes />
                  <span>All agents</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="gap-1 border-t border-[var(--border)] px-2 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeId === "plugins"}
              onClick={() => setActive("plugins")}
              tooltip="Settings"
            >
              <Settings2 />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <span className="px-2 font-mono text-[10px] text-sidebar-foreground/40">
          ⌘B to hide
        </span>
      </SidebarFooter>

      <SidebarResizer />
    </Sidebar>
  );
}
