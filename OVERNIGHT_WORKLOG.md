# Overnight Worklog — Animus Desktop + Animus CLI

**Goal:** By morning, make the desktop app (`/Users/samishukri/launchapp-org/animus-desktop`)
and animus (`/Users/samishukri/ao-cli`) meaningfully more powerful and robust.
Autonomous loop fires every 30 min. Each fire: **pull the next item from Animus**
(`animus subject next --kind task --project-root .`), mark it `in_progress`, implement,
**test**, commit, mark it `done`, then append a progress entry below.

## Backlog source (dogfood: the app's own Subjects store)
The backlog now lives in Animus subjects (`.animus/subjects/tasks.db`), NOT in the markdown
list below — the desktop app's own **Subjects** view is the live dashboard for its own
development. Each fire:
1. `animus subject next --kind task --project-root . --no-cache --json` → the item to work.
   If it returns nothing, pick a fresh high-value idea, `animus subject create` it, then work it.
2. `animus subject status --kind task --id <id> --status in_progress --project-root .`
3. Implement + test (protocol below). On green: commit.
4. `animus subject status --kind task --id <id> --status done --project-root .`
5. Append a one-line progress entry to the log at the bottom of this file (timestamp, id, result).
The `### P0…P5` lists below are a FROZEN historical record of completed work — do not pick from them.

## Rules
- **ao-cli (animus CLI): ALWAYS work in a dedicated git worktree off clean main, test there, commit
  on the branch, then `git merge --ff-only` to main + remove worktree. NEVER edit the shared main
  checkout directly — it's raced by many concurrent agents (Sami directive 2026-06-09).**
- **Install+verify gate (ao-cli): if a change touches a CLI surface the desktop depends on, after
  the ff-merge run `cargo install --path crates/orchestrator-cli --bin animus --root ~/.local --force`
  and a live one-line assertion that the new surface exists (e.g. `animus <new-cmd> --help` or a
  `--json` smoke). A change is not `done` until it is LIVE — coding it is not enough.** (This is the
  fix for the tool-call-persistence regression that sat "DONE" in source for ~9h but was never installed.)
- **Desktop: one focused commit per subject** on `main` (`git commit`, no push unless asked). The old
  "leave uncommitted" rule is retired — uncommitted diffs were silently wiped by a concurrent agent's
  `reset`. Small, tested, single-item commits are revertible and race-safe.
- Do NOT add co-author/author lines anywhere.
- Keep ao-cli Rust-only. No new desktop deps unless justified.
- Test every change before marking the subject `done`. Never leave the tree broken.
- If the running `tauri dev` (pid tracked) crashed, restart it: `cd <desktop> && pnpm tauri dev` (background),
  and after any change confirm the app is healthy (task output log shows 0 new panics) before `done`.
- Prefer editing existing files; create files only when necessary (tests, this log).
- Keep changes small and independently shippable so a broken idea is easy to revert.

## Test protocol (run the relevant subset each iteration)
Desktop:
- `cd /Users/samishukri/launchapp-org/animus-desktop && pnpm tsc --noEmit`   (types)
- `pnpm vitest run`                                                          (unit logic)
- `pnpm build`                                                               (full vite build smoke)
- `cd src-tauri && cargo check && cargo test`                               (Rust commands)
Animus (ao-cli):
- `cd /Users/samishukri/ao-cli && cargo test -p orchestrator-cli <filter>`
- `cargo fmt -p <crate> && cargo clippy -p <crate>`
Runtime smoke:
- App runs via `tauri dev`; after a change, check its task output log for panics/errors.
- Validate CLI shapes the app depends on, e.g. `animus chat list --json --project-root <p>`
  should stay fast (<1s) and small RAM (the 12GB metrics bug is fixed; watch for regressions).

## Backlog — FROZEN HISTORY (completed P0–P5; do not pick from here)
> The live backlog moved to Animus subjects (`animus subject list --kind task`). The seeded
> open items (stream-error reconnect, queue component test, chat export usage footer) are now
> subjects TASK-002/004/006. The lists below are kept only as a record of what was shipped.

### P0
1. [DONE] [animus] Persist tool calls + results per chat turn so reloaded conversations show them.
   - Added `TurnBlock` enum + `blocks: Vec<TurnBlock>` to `ChatMessage` (store.rs), populated in
     `drain()` (turn.rs) mirroring foldFrame, persisted on the assistant turn, flows through
     `chat get`. Backward compatible (`#[serde(default)]`). Desktop maps via `blockFromPersisted`
     in `openConversation`. Tests: store round-trip + legacy-compat (rust), blockFromPersisted (vitest).
   - NOTE: requires `cargo install --path crates/orchestrator-cli` to take effect for NEW turns;
     desktop falls back to text for conversations saved by the old binary, so nothing breaks.
2. [DONE] [desktop] Chat conversation list read from disk (no `animus chat list` fan-out).
   - chat.rs: added `scoped_state_root`/`repository_scope_for_path`/`sanitize_identifier`
     (exact mirror of animus, verified: auth-main -> auth-main-5ba84d1bbafc) + `.project-root`
     marker fallback. `chat_list_all` and `chat_get` now read `meta.json`/`messages.jsonl`
     directly (size-guarded, traversal-safe id). Added sha2 dep. 3 rust tests.
   - Verified live: zero `animus chat list` processes after app relaunch; app healthy.
3. [DONE] [desktop] Message queueing + auto-send. While a turn runs, the composer queues the
   message (Enter or the ↵ button) instead of blocking; queued messages render as removable
   chips above the composer and auto-send FIFO the moment the agent is free. send() sets
   activeSession synchronously so the drain effect can't double-fire. Queue clears on new/open
   conversation. ChatView.tsx + styles.css only (HMR). tsc/vitest/build green.

### P1
4. [DONE] [animus+desktop] Surface actual thinking text. animus `TurnBlock::Thinking { text }`
   (serde-default empty for legacy), accumulated in turn.rs drain; desktop foldFrame accumulates
   thinking text, blockFromPersisted carries it, ThinkingInline is now a collapsible disclosure
   that reveals the reasoning. Tests: rust round-trip incl. thinking (8 store pass); vitest 9 pass
   (accumulate + textless-indicator + persisted mapping); tsc/build green.
5. [DONE] [desktop] Turn error UX: failed turns now render an error card (⚠ + "Turn failed" +
   collapsible detail) with a Retry button that resends the turn's prompt via send(turn.prompt);
   disabled while busy. ChatView.tsx + styles.css (HMR). tsc/vitest(9)/build green.
6. [DONE] [animus] `metrics cleanup` doctor + hard size-guard test. New `animus metrics cleanup`
   subcommand sweeps every `~/.animus/<scope>/metrics/` for oversized (>16MiB) or stale (>10min)
   `flushing-*` snapshots and oversized (>8MiB) `pending.jsonl`, reporting scopes/files/bytes.
   recorder.rs `cleanup_metrics_dir` + `CleanupReport`; ops_metrics.rs `handle_cleanup`; CLI docs
   updated. Test: `cleanup_removes_oversized_and_stale_flushing_and_truncates_pending` (14 metrics
   pass), fmt/clippy clean. LIVE: swept 24 scopes, removed 14 orphaned files, reclaimed 229 MB.
7. [DONE] [tests] Extracted pure helpers + unit tests. `parseAskQuestions` moved to chatProtocol.ts
   (AskCard now uses it), `relativeTime` moved to lib/utils.ts (ProjectsRail imports it). New tests:
   parseAskQuestions (valid/empty/invalid) + relativeTime (now/m/h/d/w/mo, null/bad). foldFrame +
   cargo #1 already covered. Desktop vitest 16 pass (2 files), tsc/build green. ALL P1 DONE.

### P2
8. [DONE] [desktop] Conversation rename + delete from the left rail. chat.rs `chat_rename`
   (atomic meta.json title write via `set_meta_title`, blank clears) + `chat_delete`
   (remove_dir_all), both traversal-guarded; registered in lib.rs; api bindings chatRename/
   chatDelete. ProjectsRail `ConversationRow` with hover-reveal Pencil (inline rename: Enter
   commits, Esc cancels) + Trash (inline Delete confirm); refreshes rail on change. Rust test
   set_meta_title_sets_clears_and_preserves_other_fields (24 src-tauri pass). tsc/vitest(16)/build
   green; app rebuilt+relaunched clean (pid 24850, no new panics).
9. [DONE] [desktop] Copy-message + scroll-to-bottom + keyboard shortcut. CopyButton (hover-reveal)
   on user bubble (turn.prompt) and assistant message (blocksToPlainText) via clipboard plugin
   (+ added `clipboard-manager:allow-write-text` capability). Smart auto-scroll: only sticks to
   bottom when already at bottom (atBottom via onScroll, 80px threshold); floating ⬇ scroll-to-
   latest button when scrolled up. ⌘/Ctrl+Shift+N = new conversation (react-hotkeys-hook).
   New pure helper blocksToPlainText + 2 vitest. tsc clean, vitest 18 pass, build green; app
   rebuilt clean pid 29361.

### P3 (fresh ideas — all P0/P1/P2 done)
10. [DONE] [desktop] Esc-to-stop + composer shortcut hints. `useHotkeys("escape", …, {enableOnFormTags})`
    cancels the in-flight turn (no-op when idle, so it never steals Esc); placed after `cancel` is
    declared (hoisting fix). Contextual hint in the composer toolbar: "Esc stops" while busy,
    "↵ send · ⇧↵ newline" when typing, "↵ send" otherwise (hidden under 560px). tsc clean,
    vitest 22 pass, build green, app 0 panics (HMR).
11. [DONE] [desktop] Persist composer draft per project across tab/project switches. Module-level
    `composerDrafts` Map; event-driven save via `setPromptAndDraft` (race-free, no effect/setState
    clobber), lazy-init + restore-on-project-change effect. Cleared on send/queue. (Per-project, not
    per-conversation — covers the tab-switch loss; per-conversation noted as a future refinement.)
    tsc clean, vitest 22 pass, build green, app 0 panics (HMR).
12. [DONE] [animus] `chat rename` + `chat delete` CLI subcommands. chat_types.rs Rename/Delete
    variants (+ ChatRenameArgs `--title`, ChatDeleteArgs); store.rs gains `delete()` on the
    ConversationStore trait (traversal-guarded, idempotent); mod.rs handle_chat_rename (load/set
    title/save, blank clears) + handle_chat_delete (existed flag). Store test
    delete_removes_conversation_and_is_idempotent (23 runtime_chat pass), fmt/clippy clean, CLI docs
    updated. LIVE smoke: new→rename→list(title shown)→delete→list(empty) all correct. Desktop keeps
    its direct disk path (no subprocess); CLI now provides scriptable parity.
13. [DONE] [desktop] Token usage + cost per assistant turn. New `formatUsage(usage, cost)` ("1.2k
    in · 340 out · $0.0123", sub-$0.10 keeps 4 decimals) + ChatUsage type in chatProtocol.ts.
    ChatTurn gains usage/cost; stream handler captures the `metadata` frame (latest non-null);
    openConversation reconstructs from persisted message.usage/cost_usd (already in messages.jsonl,
    works with installed 0.5.11). Footer rendered under each finished assistant turn. 4 vitest
    (formatUsage) — 22 pass, tsc clean, build green, app 0 panics. Data flows live + on reload.
14. [DONE] [tests] jsdom component-test setup. Added jsdom + @testing-library/{react,jest-dom,
    user-event}; vitest.config gains @vitejs/plugin-react + environmentMatchGlobs (*.test.tsx →
    jsdom) + setupFiles; vitest.setup.ts (jest-dom matchers + afterEach cleanup); src/vitest-dom.d.ts
    for tsc matcher types. Extracted CopyButton → components/CopyButton.tsx and AskCard →
    components/AskCard.tsx (self-contained fallback, no ToolBlock dep) and imported back into
    ChatView. Tests: CopyButton (3) + AskCard (5) — 30 vitest pass (4 files), tsc clean, build
    green, app 0 panics. *** ALL P0+P1+P2+P3 DONE. ***

### P4 (fresh ideas — everything above done)
15. [DONE] [desktop] Per-conversation composer drafts. Draft key is now `${project.id}:${convRef
    ?? "new"}` via a `draftKey()` helper; setPromptAndDraft/restoreDraft use it; openConversation
    restores the opened conversation's draft, newConversation restores the "new" bucket, send/queue
    clear the active key. So an unsent message stays with its conversation (no bleed when switching
    conversations within a project). tsc clean, vitest 30 pass, build green, app 0 panics (HMR).
16. [DONE] [desktop] Search/filter conversations in the left rail. New pure `conversationMatches(c,
    query)` (title/projectName/tool, case-insensitive, empty=all) in lib/utils + 4 vitest. ProjectsRail
    gains a `convFilter` state + a Search input (shown when conversations exist); the grouping skips
    non-matches so empty project groups disappear; three-way state: no conversations → "New chat",
    matches → groups, filtered-to-empty → "No matches". tsc clean, vitest 34 pass, build green,
    app 0 panics (HMR).
17. [DONE] [animus] `chat export <id>` (markdown/json). chat_types.rs Export variant + ChatExportArgs
    (`--format markdown|json`, `--output <path>`) + ChatExportFormat ValueEnum; mod.rs render_markdown
    (title, metadata line, role headings, prose, compact "Tools:" summary from blocks) + handle_chat_export
    (stdout raw, or write file + envelope confirmation). 2 rust tests (render_markdown), 25 runtime_chat
    pass, fmt/clippy clean, CLI docs updated. LIVE smoke: markdown + json to stdout + --output to file
    (8364 bytes) all correct.
18. [DONE] [desktop] Richer tool_result rendering: colored diffs. New pure `isDiffText` + `diffLineKind`
    in lib/utils (detects unified/`diff --git`/edit-style +/- blocks; markdown lists & prose excluded)
    + 7 vitest; `DiffView` component (per-line add/del/hunk/ctx coloring) + 2 jsdom tests + cx-diff CSS.
    ToolBlock routes diff-looking output to DiffView, else RichText. tsc clean, vitest 42 pass (5
    files), build green, app 0 panics (HMR). STRETCH (not done): syntax-highlight non-diff file
    contents by extension — needs the tool_call path threaded to the tool_result block.
19. [DONE] [tests] TurnTimeline component test. Extracted MessageMarkdown + ToolBlock + ThinkingInline
    + TurnTimeline from ChatView into components/TurnTimeline.tsx (pulled Markdown/RichText/extractApproval/
    ApprovalCard/AskCard/DiffView/isDiffText out of ChatView with them); ChatView now imports TurnTimeline.
    5 jsdom tests (text render, thinking disclosure hidden-until-expanded, tool block detail hidden-until-
    expanded with diff body, AskUserQuestion→AskCard routing, plain tool_call name) — mock plugin-shell for
    the Markdown chain. vitest 47 pass (6 files), tsc clean, build green, app 0 panics (HMR). (Usage footer
    lives in ChatView's turn render, not TurnTimeline — covered indirectly by formatUsage unit tests.)
20. [DONE] [animus] `chat send --title`. Added `title: Option<String>` to ChatSendArgs; new
    `apply_conversation_title(store, id, title)` helper (set/clear/no-op, lenient on missing) called
    before the turn in handle_chat_send so a freshly-created conversation is named (or an existing one
    renamed) even if the turn crashes mid-stream. 1 rust test (apply_title), 26 runtime_chat pass,
    fmt/clippy clean, CLI docs updated. LIVE smoke: `send --title` set the title (shown by `chat list`)
    even with a failed turn. *** ALL P0+P1+P2+P3+P4 DONE. ***

### P5 (fresh ideas — everything above done)
21. [DONE] [desktop] Auto-derive a conversation title from the first message. New pure
    `deriveConversationTitle(message)` (first non-empty line, whitespace-collapsed, ≤48 chars + …)
    + 3 vitest. ChatView: `pendingTitleRef` set per-send (only when convRef is null = brand-new,
    cleared otherwise so it can't leak forward); on turn completion, if a title is pending and the
    conversation now has an id, `chatRename` persists it client-side (works with installed 0.5.11 —
    no dependency on the new --title CLI flag) then refreshes the rail. tsc clean, vitest 50 pass
    (6 files), build green, app 0 panics (HMR).
22. [DONE] [desktop] Keyboard nav for the rail conversation list. New pure `nextNavIndex(current,
    count, dir)` in lib/utils (+3 vitest: enter-from-outside, clamp both ends, empty). ProjectsRail:
    `onConvKeyDown` on the Conversations SidebarGroupContent moves focus among `button.cx-conv-nav`
    rows (↓ from search box enters the list, ↑ from first row returns to it, clamps at ends); Enter
    opens (native button). Guard skips when focus is elsewhere (e.g. a rename input). tsc clean,
    vitest 53 pass (6 files), build green, app 0 panics (HMR).
23. [DONE] [animus] `chat search <query>` CLI — grep transcripts across the scope. chat_types.rs
    Search variant + ChatSearchArgs (`--limit` default 20, `--case-sensitive`); mod.rs snippet_around
    (ellipsized preview, ASCII-exact / clamped-safe) + search_conversations + handle_chat_search +
    SearchMatch. 2 rust tests (snippet_around, search_conversations). LANDED VIA WORKTREE: built
    chat-search branch off clean main (concurrent agent had reset main + introduced an unrelated
    skill_scoping build break), tested green (28 runtime_chat pass, fmt/clippy clean), live smoke
    found "review" matches, then ff-merged to main (b845f1c2) + removed worktree. NOTE: installed
    ~/.local/bin/animus still lacks search until next rebuild/install.
24. [desktop] Stream-error resilience: surface a reconnect/retry affordance if the chat-stream bridge drops.
25. [tests] Component test for the message-queue + auto-send flow (queue chip render, FIFO drain).
26. [animus] Per-turn `chat get`/`export` include token usage + cost in the markdown footer.

## Done this session (most recent first)
- Set up overnight loop + vitest test harness + this worklog.
- Fixed animus metrics RAM bug: 12GB orphaned flushing file (deleted) + size caps in
  recorder.rs (record/read/recover) + regression test. chat list 34s/11GB -> 0.22s/15MB.
- Chat: timeline blocks (tool calls interleaved in order, not piled at top).
- Chat: harness (provider/agent) locks once a conversation has turns.
- Chat: thinking animates only while active; static "thought" when complete.
- Chat: AskUserQuestion interactive card (single-select sends on click; multi -> Send answer);
  answer delivered as a follow-up turn on the same conversation.
- Left-rail conversations grouped by project + quick "new chat"; removed right-side rail.
- OpenAI/Codex model lists corrected to mid-2026 (gpt-5.5 family).

## Progress log (append each iteration: timestamp, what, test result)
- 2026-06-09 ~AM — *** BUG-FIX SWEEP (3-agent review → 5 fix clusters, all landed) ***
  A chat lifecycle: timeout_secs now ENFORCED (clamp 10-3600s, kill+end on expiry); stderr drained
    concurrently w/ 256KB cap (pipe-deadlock fix); runs map self-cleans (lock held across
    spawn+insert; abort-on-replace); chat_cancel emits synthetic end{error:"cancelled"} → turn
    settles as done+"■ stopped" (never stuck running); queue pauses on stop (▶ resume); Esc scoped
    off rail inputs.
  B project isolation: ProjectModeContent key={project.id} (kills cross-project state bleed for ALL
    views); SessionEntry{turnId,convId,pendingTitle} — stream frames only move convRef if user
    still on owning conversation; auto-title renames the session's own conversation; rail delete
    dispatches animus-conversation-deleted → ChatView resets + drafts pruned; rail refresh seq token.
  C event_log: scope resolution now reuses chat.rs sha256+sanitize mirror (was DefaultHasher +
    raw-basename prefix match = wrong-project data); local_events_read bounded VecDeque;
    64MB per-file caps on runs scans/transcript; started_ms saturating_add; local_file_read
    streams take(1MiB) (was whole-file alloc); ApprovalCard verdict-must-be-string; model.ts
    data!==null guard.
  D bridge/daemon/state: tail-drain on child exit (no lost workflow.complete); oversized lines →
    stub w/ truncated heavy fields instead of dropped; re-attach w/ changed repo_path restarts
    task; pgrep -fl + Rust filter (no more stream-children false positives / regex injection);
    state persist unique tmp; daemon.ts opSeq (stale refresh can't clobber start/stop); App.tsx
    detach-after-cancelled-attach; projectEvents enqueue cap.
  E view races: FilesView roots cancelled-flag + dir/file seq tokens + pure closeTab; SubjectsView
    refresh seq (wrong-backend-write race); JournalView runs seq; WorkflowsView refresh seq;
    workflow_yaml writes confined to .animus/*.ya?ml (no ..) + .bak before rewrite; Bridge
    auto-select once.
  Tests: cargo check clean + 24 pass; tsc clean; vitest 53 pass (6 files); build green; app
  rebuilt pid 85944, 0 panics. NOT fixed (noted): agent-chip is cosmetic until CLI --agent flag
  is installed; pool_size>1 span interleave heuristic; JournalView ts-fallback jitter (cosmetic).
- 2026-06-09 ~08:5x — P5#23 chat search CLI (animus) + *** ADOPTED WORKTREE WORKFLOW ***. A concurrent
  agent reset main mid-fire (wiped my uncommitted search edits) + added an unrelated skill_scoping
  build break. Per Sami's directive, redid search in an isolated worktree (branch chat-search off
  clean main), tested green (28 runtime_chat, fmt/clippy, live smoke), ff-merged to main b845f1c2,
  removed worktree. Saved memory feedback_aocli_worktree_workflow. From now: ALL ao-cli work via
  worktree→merge. Desktop untouched this fire (app still healthy). NEXT: P5#24 stream-error reconnect,
  #25 queue test, #26 export usage footer.
- 2026-06-09 ~08:2x — P5#22 rail conversation keyboard nav (desktop). nextNavIndex helper + 3 vitest;
  ProjectsRail onConvKeyDown (↑/↓/Enter, search-box entry, rename-input guard). tsc clean, vitest 53
  pass (6 files), build green, app 0 panics (HMR). NEXT: P5#23 chat search CLI, #24 stream-error
  reconnect, #25 queue test, #26 export usage footer.
- 2026-06-09 ~07:5x — *** INSTALLED updated animus *** (user asked if tool-call persistence was
  actually fixed). It was coded+tested in source since P0#1 but NEVER LIVE — installed binary was
  0.5.11 from Jun 8 14:20, predating the fix; real conversations had no `blocks` key. Ran
  `cargo install --path crates/orchestrator-cli --bin animus --root ~/.local --force` (3m04s release
  build). New binary (Jun 9 07:56) has all added surfaces (chat rename/delete/export, send --title,
  metrics cleanup) AND the blocks persistence. VERIFIED LIVE: a real codex turn now persists
  assistant `blocks` (keys include 'blocks'; block kinds ['text']). NOTE: only NEW turns get blocks;
  old conversations stay text-only (desktop falls back gracefully). Daemon/desktop spawn the new
  binary on next invocation.
- 2026-06-09 ~07:2x — P5#21 auto-derive conversation title (desktop). deriveConversationTitle helper
  + 3 vitest; pendingTitleRef set per-send, applied via chatRename on turn completion (client-side,
  no CLI dep). tsc clean, vitest 50 pass (6 files), build green, app 0 panics (HMR). NEXT: P5#22
  rail keyboard nav, #23 chat search CLI, #24 stream-error reconnect, #25 queue test, #26 export usage.
- 2026-06-09 ~06:5x — P4#20 chat send --title (animus). ChatSendArgs.title + apply_conversation_title
  helper applied before the turn. Tests: runtime_chat 26 pass (1 new), fmt/clippy clean, CLI docs
  updated; live smoke confirmed title set via send. ALL P0-P4 DONE — seeded P5 (21-26).
- 2026-06-09 ~06:2x — P4#19 TurnTimeline component test (desktop). Extracted MessageMarkdown/ToolBlock/
  ThinkingInline/TurnTimeline → components/TurnTimeline.tsx; ChatView imports it. 5 jsdom tests
  (mock plugin-shell). vitest 47 pass (6 files), tsc clean, build green, app 0 panics (HMR).
  NEXT: P4#20 --title on chat send.
- 2026-06-09 ~05:5x — P4#18 colored diff rendering for tool results (desktop). isDiffText/diffLineKind
  (lib/utils) + DiffView component; ToolBlock routes diffs to DiffView. Tests: vitest 42 pass (5
  files; 7 diff util + 2 DiffView), tsc clean, build green, app 0 panics (HMR). NEXT: P4#19
  TurnTimeline component test, #20 --title on chat send.
- 2026-06-09 ~05:2x — P4#17 chat export markdown/json (animus). Export command + render_markdown +
  --output. Tests: runtime_chat 25 pass (2 new), fmt/clippy clean, CLI docs updated; live smoke
  markdown/json/stdout + --output file all correct. NEXT: P4#18 richer tool_result rendering,
  #19 TurnTimeline component test, #20 --title on chat send.
- 2026-06-09 ~04:5x — P4#16 conversation search in rail (desktop). conversationMatches helper +
  4 vitest; ProjectsRail convFilter state + Search input + no-match state. tsc clean, vitest 34
  pass, build green, app 0 panics (HMR). NEXT: P4#17 chat export (animus), #18 richer tool_result
  rendering, #19 TurnTimeline component test, #20 --title on chat send.
- 2026-06-09 ~04:2x — P4#15 per-conversation composer drafts (desktop, ChatView.tsx). draftKey()
  = project:conversation; restore on open/new; clear on send/queue. tsc clean, vitest 30 pass,
  build green, app 0 panics (HMR). NEXT: P4#16 conversation search in rail, #17 chat export,
  #18 richer tool_result rendering, #19 TurnTimeline component test, #20 --title on chat send.
- 2026-06-09 ~04:0x — P3#14 jsdom component-test setup (desktop). jsdom + testing-library deps;
  vitest.config plugin-react + environmentMatchGlobs + setupFiles; cleanup + matcher types.
  Extracted CopyButton + AskCard to their own files (decoupled from ChatView's Tauri chain) with
  8 component tests. Tests: vitest 30 pass (4 files; CopyButton 3, AskCard 5), tsc clean, build
  green, app 0 panics. ALL P0+P1+P2+P3 DONE — seeded P4 (15-20).
- 2026-06-09 ~03:3x — P3#12 chat rename/delete CLI (animus). chat_types Rename/Delete + args;
  ConversationStore::delete (idempotent, traversal-guarded); mod.rs handlers. Tests: runtime_chat
  23 pass (new delete test), fmt/clippy clean, CLI docs updated; live smoke new→rename→delete all
  correct. NEXT: P3#14 jsdom component-test setup (CopyButton/AskCard rendering).
- 2026-06-09 ~03:0x — P3#11 composer draft persistence (desktop). composerDrafts Map + event-driven
  setPromptAndDraft + restore effect; cleared on send/queue. tsc clean, vitest 22 pass, build green,
  app 0 panics (HMR). NEXT: P3#12 chat rename/delete CLI (animus), #14 jsdom component tests.
- 2026-06-09 ~02:5x — P3#10 Esc-to-stop + composer hints (desktop, ChatView.tsx + styles.css).
  useHotkeys escape→cancel (guarded by activeSession, enableOnFormTags); contextual toolbar hint.
  Hit + fixed a use-before-declaration (moved hotkey after `cancel`). Tests: tsc clean, vitest 22
  pass, build green, app 0 panics (HMR). NEXT: P3#11 draft persistence, #12 chat rename/delete CLI,
  #14 jsdom component tests.
- 2026-06-09 ~02:2x — P3#13 per-turn token usage + cost (desktop). formatUsage + ChatUsage in
  chatProtocol.ts; ChatTurn usage/cost; metadata-frame capture in stream handler; reload via
  persisted usage/cost_usd; footer under finished assistant turns. Tests: vitest 22 pass (4 new
  formatUsage), tsc clean, build green, app 0 panics (HMR, frontend-only). NEXT: P3#10 Esc-to-stop
  + composer hints, #11 draft persistence, #12 chat rename/delete CLI, #14 jsdom component tests.
- 2026-06-09 ~01:5x — P2#9 copy-message + scroll-to-bottom + ⌘⇧N shortcut (desktop). CopyButton on
  user+assistant (clipboard plugin + allow-write-text capability), smart auto-scroll + floating
  scroll-to-latest button, new-conversation hotkey. +blocksToPlainText helper & 2 vitest. Tests:
  tsc clean, vitest 18 pass (2 files), build green; app rebuilt clean pid 29361, no panics.
  *** ALL P0 + P1 + P2 DONE. *** Seeded P3 (10-14) for future fires.
- 2026-06-09 ~01:2x — P2#8 conversation rename + delete (desktop). chat.rs chat_rename/chat_delete
  (+set_meta_title atomic, traversal-guarded) + lib.rs reg + api bindings; ProjectsRail
  ConversationRow hover rename(inline)/delete(confirm). Tests: src-tauri cargo test 24 pass (new
  set_meta_title test), pnpm tsc clean, vitest 16 pass, build green; app rebuilt clean pid 24850.
  NEXT: P2#9 copy-message + scroll-to-bottom + keyboard shortcuts.
- 2026-06-09 ~00:5x — P1#7 extract+test pure helpers (desktop). parseAskQuestions -> chatProtocol.ts,
  relativeTime -> lib/utils.ts; AskCard + ProjectsRail import them. New tests: src/lib/utils.test.ts
  (relativeTime, 4) + parseAskQuestions (3). vitest 16 pass (2 files), tsc clean, build green, app
  0 panics. ALL P0 + P1 DONE. NEXT: P2#8 conversation rename/delete, P2#9 copy/shortcuts/scroll.
- 2026-06-09 ~00:3x — P1#6 metrics cleanup doctor (animus). `animus metrics cleanup` sweeps all
  scopes for orphaned/oversized flushing + oversized pending; recorder.rs cleanup_metrics_dir +
  CleanupReport, ops_metrics handle_cleanup, metrics_types Cleanup, CLI docs. Test: 14 metrics
  pass (new cleanup test), fmt/clippy clean, smoke `metrics cleanup --json` reclaimed 229MB across
  24 scopes live. NEXT: P1#7 (extract+test AskCard parse + relativeTime), then P2.
- 2026-06-09 ~00:0x — P1#5 retry UX (desktop, ChatView.tsx + styles.css). Failed turns show an
  error card with Retry (resends turn.prompt, disabled while busy). tsc clean, vitest 9 pass,
  build green, app 0 panics. NEXT: P1#6 metrics doctor, P1#7 more tests (AskCard parse/relativeTime).
- 2026-06-09 ~00:0x — P1#4 surface thinking text (animus + desktop). animus Thinking variant
  carries text (accumulated in drain, legacy-safe serde default); desktop foldFrame accumulates,
  ThinkingInline collapsible disclosure. Tests: ao-cli runtime_chat 22 pass + store 8 pass,
  fmt/clippy clean; desktop vitest 9 pass, tsc clean, build green; app 0 panics. NEXT: P1#5 retry UX.
- 2026-06-08 ~23:31 — P0#3 message queueing + auto-send (desktop, ChatView.tsx + styles.css).
  Queue while busy, removable chips, FIFO auto-drain when free. Tests: `pnpm tsc --noEmit` clean,
  `pnpm test` 8 passed, `pnpm build` green; app HMR'd, 0 panics. ALL P0 DONE. NEXT: P1#4 surface
  thinking text, P1#5 retry UX, P1#6 metrics doctor.
- 2026-06-08 ~23:1x — P0#2 disk-read conversation list (desktop). chat.rs now resolves the
  scoped chat dir in Rust (sha256 scope mirror, verified vs auth-main) and reads meta/messages
  from disk; `chat_list_all` + `chat_get` no longer spawn `animus chat list`. Added sha2 dep +
  3 rust tests. Tests: `cargo test` (src-tauri) 23 passed; `pnpm tsc --noEmit` clean; `pnpm test`
  8 passed; `pnpm build` green. Live: 0 `animus chat list` procs after relaunch, no panics.
  NEXT: P0#3 message queueing + force-send.
- 2026-06-08 ~22:58 — P0#1 tool-call persistence (animus + desktop). animus: TurnBlock enum +
  blocks field in store.rs, populated in turn.rs drain loop, flows via chat get; +2 rust tests
  (round-trip, legacy-compat) — `cargo test -p orchestrator-cli runtime_chat` 20 passed; fmt+clippy
  clean; ops_cost 8 passed. desktop: blockFromPersisted mapper + openConversation uses persisted
  blocks; +1 vitest — `pnpm test` 8 passed, `pnpm tsc --noEmit` clean. NEXT: rebuild/install animus
  so it takes effect; then P0#2 (disk-read conversation list) and P0#3 (message queue).
