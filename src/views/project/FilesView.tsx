import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  localWorktreesList,
  localDirList,
  localFileRead,
  type WorktreeRoot,
  type DirEntryInfo,
  type FileContent,
} from "../../api/local_folder";
import type { Project } from "../../types/contracts";

// Highlighting beyond this size is skipped — the file still renders, just plain.
const HIGHLIGHT_CHAR_CAP = 200_000;

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  jsonc: "json",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
};

const LANG_BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "bash",
  ".env": "bash",
};

function langForFile(name: string): string | null {
  const lower = name.toLowerCase();
  if (LANG_BY_NAME[lower]) return LANG_BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return null;
  return LANG_BY_EXT[lower.slice(dot + 1)] ?? null;
}

interface Root {
  key: string;
  label: string;
  path: string;
  branch: string | null;
  kind: "repo" | "worktree";
}

interface OpenTab {
  rel: string;
  name: string;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function FilesView({ project }: { project: Project }) {
  const repoPath = project.repo_path?.trim() ?? "";
  const [roots, setRoots] = useState<Root[]>([]);
  const [activeRootKey, setActiveRootKey] = useState<string>("repo");
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<DirEntryInfo[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const activeRoot = useMemo(
    () => roots.find((r) => r.key === activeRootKey) ?? roots[0] ?? null,
    [roots, activeRootKey],
  );
  const base = activeRoot?.path ?? "";

  // Load roots: the repo plus any Animus task worktrees.
  useEffect(() => {
    if (!repoPath) {
      setRoots([]);
      return;
    }
    const repoRoot: Root = {
      key: "repo",
      label: "Repo",
      path: repoPath,
      branch: null,
      kind: "repo",
    };
    setRoots([repoRoot]);
    setActiveRootKey("repo");
    // Cancellation guard: the worktree listing shells out to git and can
    // resolve AFTER the repo path changed — landing the old project's roots
    // (and base path) under the new project.
    let cancelled = false;
    localWorktreesList(repoPath)
      .then((wts: WorktreeRoot[]) => {
        if (cancelled) return;
        setRoots([
          repoRoot,
          ...wts.map((w) => ({
            key: w.path,
            label: w.id,
            path: w.path,
            branch: w.branch,
            kind: "worktree" as const,
          })),
        ]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // Switching root resets navigation and open tabs (they belong to a base).
  useEffect(() => {
    setCwd("");
    setTabs([]);
    setActiveTab(null);
    setContent(null);
  }, [base]);

  // Last-issued-wins tokens: two slow listings/reads in flight must not let
  // the OLDER one resolve last and display under the newer selection.
  const dirSeq = useRef(0);
  const fileSeq = useRef(0);

  const loadDir = useCallback(
    async (dir: string) => {
      if (!base) return;
      const seq = ++dirSeq.current;
      setLoadingDir(true);
      setListError(null);
      try {
        const list = await localDirList(base, dir);
        if (seq !== dirSeq.current) return;
        setEntries(list);
      } catch (e) {
        if (seq !== dirSeq.current) return;
        setListError(String(e));
        setEntries([]);
      } finally {
        if (seq === dirSeq.current) setLoadingDir(false);
      }
    },
    [base],
  );

  useEffect(() => {
    void loadDir(cwd);
  }, [loadDir, cwd]);

  const openFile = useCallback(
    async (rel: string, name: string) => {
      const seq = ++fileSeq.current;
      setActiveTab(rel);
      setTabs((prev) => (prev.some((t) => t.rel === rel) ? prev : [...prev, { rel, name }]));
      setContentLoading(true);
      setContentError(null);
      setContent(null);
      try {
        const c = await localFileRead(base, rel);
        if (seq !== fileSeq.current) return;
        setContent(c);
      } catch (e) {
        if (seq !== fileSeq.current) return;
        setContentError(String(e));
      } finally {
        if (seq === fileSeq.current) setContentLoading(false);
      }
    },
    [base],
  );

  const closeTab = useCallback(
    (rel: string) => {
      // Keep the state updater pure (StrictMode/concurrent rendering may run
      // it twice); do the follow-up effects outside.
      const next = tabs.filter((t) => t.rel !== rel);
      setTabs(next);
      if (activeTab === rel) {
        const fallback = next[next.length - 1] ?? null;
        if (fallback) void openFile(fallback.rel, fallback.name);
        else {
          setActiveTab(null);
          setContent(null);
        }
      }
    },
    [tabs, activeTab, openFile],
  );

  const crumbs = cwd ? cwd.split("/").filter(Boolean) : [];

  // Syntax-highlight the active file (skipped for very large files).
  const highlighted = useMemo(() => {
    const text = content?.text;
    if (text == null || activeTab == null) return null;
    if (text.length > HIGHLIGHT_CHAR_CAP) return null;
    try {
      const lang = langForFile(basename(activeTab));
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(text).value;
    } catch {
      return null;
    }
  }, [content, activeTab]);

  if (!repoPath) {
    return (
      <div className="workflow-error" style={{ background: "var(--bg-elevated)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No folder on disk</div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          This project has no local repo path, so there are no files to browse.
        </p>
      </div>
    );
  }

  return (
    <div className="files-view">
      <header className="files-view__bar">
        <div className="files-view__root">
          <label className="files-view__root-label">Root</label>
          <select
            className="files-view__root-select"
            value={activeRootKey}
            onChange={(e) => setActiveRootKey(e.target.value)}
          >
            {roots.map((r) => (
              <option key={r.key} value={r.key}>
                {r.kind === "repo" ? "Repo" : `worktree · ${r.label}`}
                {r.branch ? ` (${r.branch})` : ""}
              </option>
            ))}
          </select>
          {activeRoot?.kind === "worktree" && (
            <span className="files-view__wt-badge" title={activeRoot.path}>
              {activeRoot.branch ?? "detached"}
            </span>
          )}
        </div>
        <button
          type="button"
          className="plugins-pane__ghost"
          onClick={() => void loadDir(cwd)}
          disabled={loadingDir}
        >
          {loadingDir ? "…" : "Refresh"}
        </button>
      </header>

      <div className="files-view__body">
        <aside className="files-view__sidebar">
          <nav className="files-view__crumbs" aria-label="Path">
            <button type="button" className="files-crumb" onClick={() => setCwd("")}>
              {activeRoot?.kind === "worktree" ? activeRoot.label : basename(base)}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="files-crumb-wrap">
                <span className="files-crumb-sep">/</span>
                <button
                  type="button"
                  className="files-crumb"
                  onClick={() => setCwd(crumbs.slice(0, i + 1).join("/"))}
                >
                  {c}
                </button>
              </span>
            ))}
          </nav>

          {listError ? (
            <p className="files-view__error">{listError}</p>
          ) : (
            <ul className="files-tree">
              {cwd && (
                <li>
                  <button
                    type="button"
                    className="files-tree__row files-tree__row--up"
                    onClick={() =>
                      setCwd(crumbs.slice(0, crumbs.length - 1).join("/"))
                    }
                  >
                    <span className="files-tree__icon">↩</span>
                    <span className="files-tree__name">..</span>
                  </button>
                </li>
              )}
              {entries.map((e) => (
                <li key={e.rel}>
                  <button
                    type="button"
                    className={`files-tree__row ${
                      activeTab === e.rel ? "files-tree__row--active" : ""
                    }`}
                    onClick={() => (e.isDir ? setCwd(e.rel) : void openFile(e.rel, e.name))}
                    title={e.name}
                  >
                    <span className={`files-tree__icon ${e.isDir ? "is-dir" : "is-file"}`}>
                      {e.isDir ? "▸" : "·"}
                    </span>
                    <span className="files-tree__name">
                      {e.name}
                      {e.isSymlink && <span className="files-tree__link"> ↪</span>}
                    </span>
                    {!e.isDir && <span className="files-tree__size">{fmtSize(e.size)}</span>}
                  </button>
                </li>
              ))}
              {entries.length === 0 && !loadingDir && (
                <li className="files-tree__empty">empty folder</li>
              )}
            </ul>
          )}
        </aside>

        <main className="files-view__main">
          {tabs.length > 0 && (
            <div className="files-tabs" role="tablist">
              {tabs.map((t) => (
                <div
                  key={t.rel}
                  className={`files-tab ${activeTab === t.rel ? "files-tab--active" : ""}`}
                >
                  <button
                    type="button"
                    className="files-tab__label"
                    onClick={() => void openFile(t.rel, t.name)}
                    title={t.rel}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    className="files-tab__close"
                    onClick={() => closeTab(t.rel)}
                    aria-label={`Close ${t.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="files-content">
            {activeTab === null ? (
              <div className="files-content__empty">
                <p>Select a file to view it.</p>
                <p className="mcp-hint">
                  Switch the <strong>Root</strong> selector to browse an Animus
                  task worktree instead of the main repo.
                </p>
              </div>
            ) : contentLoading ? (
              <p className="files-content__status">Reading…</p>
            ) : contentError ? (
              <p className="files-content__status files-content__status--err">{contentError}</p>
            ) : content?.isBinary ? (
              <p className="files-content__status">
                Binary file ({fmtSize(content.size)}) — not shown.
              </p>
            ) : (
              <>
                {content?.truncated && (
                  <div className="files-content__trunc">
                    Showing the first 1 MB of {fmtSize(content.size)}.
                  </div>
                )}
                {highlighted ? (
                  <pre className="files-content__pre">
                    <code
                      className="hljs"
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  </pre>
                ) : (
                  <pre className="files-content__pre">{content?.text}</pre>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
