import { useCallback, useEffect, useMemo, useState } from "react";
import {
  animusSkillDelete,
  animusSkillInfo,
  animusSkillInstall,
  animusSkillList,
  animusSkillSave,
  animusSkillUninstall,
  animusSkillUpdate,
  type SkillDetail,
  type SkillSummary,
} from "../../api/animus";
import type { Project } from "../../types/contracts";

const CATEGORIES = [
  "",
  "implementation",
  "testing",
  "review",
  "research",
  "documentation",
  "operations",
  "planning",
];

const SCOPE_ORDER = ["project", "user", "installed", "pack", "builtin", "agent-host", "other"];

const SCOPE_LABEL: Record<string, string> = {
  project: "Project",
  user: "User",
  installed: "Installed",
  pack: "Packs",
  builtin: "Built-in",
  "agent-host": "Agent hosts",
  other: "Other",
};

const SCOPE_BLURB: Record<string, string> = {
  project: "Defined in this repo (.animus/config/skill_definitions/) — highest priority, editable here.",
  user: "Your user-level skills, shared across projects.",
  installed: "Installed from a skill registry.",
  pack: "Shipped by an installed pack plugin.",
  builtin: "Bundled with the animus CLI.",
  "agent-host": "Markdown skills discovered from coding-agent homes (Claude, Cursor, …) — read-only mirrors.",
};

function scopeOf(source: string): string {
  if (source === "project" || source === "user" || source === "installed") return source;
  if (source.startsWith("pack")) return "pack";
  if (source.startsWith("builtin") || source.startsWith("built-in")) return "builtin";
  if (source.startsWith("agent-host")) return "agent-host";
  return "other";
}

function validSlug(s: string): boolean {
  return /^[a-z0-9_-]+$/.test(s);
}

interface EditorState {
  /** null name = creating a new skill. */
  name: string | null;
  nameInput: string;
  description: string;
  category: string;
  version: string;
  systemPrompt: string;
  mcpServers: string;
  tags: string;
}

function emptyEditor(): EditorState {
  return {
    name: null,
    nameInput: "",
    description: "",
    category: "",
    version: "1.0.0",
    systemPrompt: "",
    mcpServers: "",
    tags: "",
  };
}

function editorFrom(detail: SkillDetail): EditorState {
  return {
    name: detail.name,
    nameInput: detail.name,
    description: detail.description ?? "",
    category: (detail.category ?? "").toLowerCase(),
    version: detail.version ?? "",
    systemPrompt: detail.prompt?.system ?? "",
    mcpServers: (detail.mcp_servers ?? []).join(", "),
    tags: (detail.tags ?? []).join(", "),
  };
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function envelopeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err ?? "unknown error");
}

function SkillDetailBody({ detail }: { detail: SkillDetail }) {
  const directives = detail.prompt?.directives ?? [];
  return (
    <div className="sk-detail">
      <div className="sk-detail__chips">
        {detail.version && <span className="aj-tag">v{detail.version}</span>}
        {(detail.mcp_servers ?? []).map((s) => (
          <span key={s} className="aj-tag" title="MCP server">
            ⇄ {s}
          </span>
        ))}
        {(detail.tags ?? []).map((t) => (
          <span key={t} className="sk-tag">
            {t}
          </span>
        ))}
      </div>
      {detail.prompt?.system && (
        <div className="sk-detail__section">
          <div className="sk-detail__label">System prompt</div>
          <pre className="sk-detail__prompt">{detail.prompt.system}</pre>
        </div>
      )}
      {directives.length > 0 && (
        <div className="sk-detail__section">
          <div className="sk-detail__label">Directives</div>
          <ul className="sk-detail__directives">
            {directives.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SkillsView({ project }: { project: Project }) {
  const path = project.repo_path?.trim() ?? "";
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, SkillDetail>>(new Map());
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Install form
  const [showInstall, setShowInstall] = useState(false);
  const [installName, setInstallName] = useState("");
  const [installVersion, setInstallVersion] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!path) {
      setError("This project has no folder path on disk.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await animusSkillList(path);
      if (!res.ok || !res.data) {
        setError(envelopeError(res.error) || res.rawStderr || "skill list failed");
      } else {
        setSkills(res.data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadDetail = useCallback(
    async (name: string) => {
      if (details.has(name)) return details.get(name)!;
      setDetailBusy(name);
      try {
        const res = await animusSkillInfo(path, name);
        if (res.ok && res.data) {
          setDetails((prev) => new Map(prev).set(name, res.data!));
          return res.data;
        }
        setError(envelopeError(res.error) || `could not load skill '${name}'`);
      } catch (e) {
        setError(String(e));
      } finally {
        setDetailBusy(null);
      }
      return null;
    },
    [path, details],
  );

  const toggle = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    void loadDetail(name);
  };

  const startEdit = async (name: string) => {
    const detail = await loadDetail(name);
    if (detail) setEditor(editorFrom(detail));
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name ?? editor.nameInput.trim();
    if (!validSlug(name)) {
      setError("Skill name must be lowercase letters, digits, '-' or '_'.");
      return;
    }
    setSaveBusy(true);
    setError(null);
    try {
      await animusSkillSave({
        path,
        name,
        description: editor.description,
        category: editor.category,
        version: editor.version.trim() || undefined,
        systemPrompt: editor.systemPrompt,
        mcpServers: splitList(editor.mcpServers),
        tags: splitList(editor.tags),
      });
      setEditor(null);
      setDetails((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const remove = async (name: string) => {
    setError(null);
    try {
      await animusSkillDelete(path, name);
      setPendingDelete(null);
      setExpanded(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const envOk = (res: { ok: boolean; error: unknown; rawStderr: string }) => {
    if (res.ok) return true;
    setError(envelopeError(res.error) || res.rawStderr || "skill operation failed");
    return false;
  };

  const install = async () => {
    const name = installName.trim();
    const local = installPath.trim();
    if (!name && !local) return;
    setInstallBusy(true);
    setError(null);
    setInstallMsg(null);
    try {
      const res = await animusSkillInstall({
        path,
        name: name || undefined,
        version: installVersion.trim() || undefined,
        localPath: local || undefined,
      });
      if (envOk(res)) {
        setInstallMsg(`Installed ${name || local}.`);
        setInstallName("");
        setInstallVersion("");
        setInstallPath("");
        setShowInstall(false);
        await refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setInstallBusy(false);
    }
  };

  const updateInstalled = async (name: string) => {
    setRowBusy(name);
    setError(null);
    try {
      const res = await animusSkillUpdate(path, name);
      if (envOk(res)) {
        setDetails((prev) => {
          const next = new Map(prev);
          next.delete(name);
          return next;
        });
        await refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const uninstall = async (name: string) => {
    setRowBusy(name);
    setError(null);
    try {
      const res = await animusSkillUninstall(path, name);
      if (envOk(res)) {
        setPendingDelete(null);
        setExpanded(null);
        await refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = skills.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q),
    );
    const by = new Map<string, SkillSummary[]>();
    for (const s of filtered) {
      const scope = scopeOf(s.source);
      by.set(scope, [...(by.get(scope) ?? []), s]);
    }
    return SCOPE_ORDER.filter((k) => by.has(k)).map((k) => ({
      scope: k,
      items: by.get(k)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [skills, search]);

  const projectCount = skills.filter((s) => scopeOf(s.source) === "project").length;

  return (
    <div className="sk-pane">
      <header className="plugins-pane__head">
        <div>
          <h2 className="workflows-pane__title">Skills</h2>
          <p className="workflows-pane__subtitle">
            {skills.length} skills visible to this project · {projectCount} project-scope
          </p>
        </div>
        <div className="plugins-pane__head-actions">
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => {
              setShowInstall((v) => !v);
              setEditor(null);
              setInstallMsg(null);
            }}
          >
            Install skill
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => {
              setEditor(emptyEditor());
              setShowInstall(false);
            }}
          >
            New skill
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {showInstall && (
        <section className="sk-editor">
          <h3 className="workflows-pane__group-title">Install a skill</h3>
          <p className="sk-group__blurb">
            Resolve by name from a configured registry/source, or install a
            local Markdown skill file or folder by path.
          </p>
          <div className="sk-editor__grid">
            <label className="sk-editor__field">
              <span>Skill name</span>
              <input
                value={installName}
                placeholder="acceptance-criteria"
                onChange={(e) => setInstallName(e.target.value)}
              />
            </label>
            <label className="sk-editor__field">
              <span>Version (optional)</span>
              <input
                value={installVersion}
                placeholder="^1.0.0"
                onChange={(e) => setInstallVersion(e.target.value)}
              />
            </label>
            <label className="sk-editor__field">
              <span>…or local path</span>
              <input
                value={installPath}
                placeholder="/path/to/skill"
                onChange={(e) => setInstallPath(e.target.value)}
              />
            </label>
          </div>
          <div className="sk-editor__actions">
            <button
              type="button"
              className="workflow-row__run"
              disabled={installBusy || (!installName.trim() && !installPath.trim())}
              onClick={() => void install()}
            >
              {installBusy ? "Installing…" : "Install"}
            </button>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => setShowInstall(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {installMsg && (
        <div className="sk-install-ok">{installMsg}</div>
      )}

      {error && (
        <div className="workflow-error">
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
        </div>
      )}

      {editor && (
        <section className="sk-editor">
          <h3 className="workflows-pane__group-title">
            {editor.name ? `Edit ${editor.name}` : "New project skill"}
          </h3>
          {editor.name === "animus-copilot" && (
            <p className="sk-editor__warn">
              animus-copilot is managed by the desktop app — manual edits are
              overwritten when the app updates the skill.
            </p>
          )}
          <div className="sk-editor__grid">
            {editor.name === null && (
              <label className="sk-editor__field">
                <span>Name</span>
                <input
                  value={editor.nameInput}
                  placeholder="my-skill"
                  onChange={(e) => setEditor({ ...editor, nameInput: e.target.value })}
                />
              </label>
            )}
            <label className="sk-editor__field">
              <span>Description</span>
              <input
                value={editor.description}
                onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              />
            </label>
            <label className="sk-editor__field">
              <span>Category</span>
              <select
                value={editor.category}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c || "—"}
                  </option>
                ))}
              </select>
            </label>
            <label className="sk-editor__field">
              <span>Version</span>
              <input
                value={editor.version}
                placeholder="1.0.0"
                onChange={(e) => setEditor({ ...editor, version: e.target.value })}
              />
            </label>
            <label className="sk-editor__field">
              <span>MCP servers (comma-separated)</span>
              <input
                value={editor.mcpServers}
                placeholder="animus"
                onChange={(e) => setEditor({ ...editor, mcpServers: e.target.value })}
              />
            </label>
            <label className="sk-editor__field">
              <span>Tags (comma-separated)</span>
              <input
                value={editor.tags}
                onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
              />
            </label>
          </div>
          <label className="sk-editor__field sk-editor__field--wide">
            <span>System prompt</span>
            <textarea
              rows={10}
              value={editor.systemPrompt}
              onChange={(e) => setEditor({ ...editor, systemPrompt: e.target.value })}
            />
          </label>
          <div className="sk-editor__actions">
            <button
              type="button"
              className="workflow-row__run"
              disabled={saveBusy || (editor.name === null && !validSlug(editor.nameInput.trim()))}
              onClick={() => void save()}
            >
              {saveBusy ? "Saving…" : "Save to project"}
            </button>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => setEditor(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="plugins-pane__toolbar">
        <input
          className="plugins-pane__search"
          placeholder="Search skills…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {groups.length === 0 && !loading ? (
        <p style={{ color: "var(--text-faint)", fontSize: 12 }}>No skills match.</p>
      ) : (
        groups.map((g) => (
          <section key={g.scope} className="sk-group">
            <h3 className="workflows-pane__group-title">
              {SCOPE_LABEL[g.scope]}{" "}
              <span className="sk-group__count">{g.items.length}</span>
            </h3>
            {SCOPE_BLURB[g.scope] && (
              <p className="sk-group__blurb">{SCOPE_BLURB[g.scope]}</p>
            )}
            <ul className="sk-list">
              {g.items.map((s) => {
                const open = expanded === s.name;
                const detail = details.get(s.name);
                const editable = g.scope === "project";
                const installed = g.scope === "installed";
                return (
                  <li key={`${s.source}:${s.name}`} className="sk-row">
                    <div className="sk-row__head" onClick={() => toggle(s.name)}>
                      <span className="sk-row__name">{s.name}</span>
                      {s.category && <span className="sk-tag">{s.category.toLowerCase()}</span>}
                      {s.name === "animus-copilot" && editable && (
                        <span className="sk-tag sk-tag--managed" title="Materialized by the desktop app; updated automatically">
                          desktop-managed
                        </span>
                      )}
                      <span className="sk-row__desc">{s.description}</span>
                      <span className="team-member__expand">{open ? "▼" : "▶"}</span>
                    </div>
                    {open && (
                      <div className="sk-row__body">
                        {detail ? (
                          <SkillDetailBody detail={detail} />
                        ) : (
                          <p className="aj-muted">
                            {detailBusy === s.name ? "Loading…" : "No detail available."}
                          </p>
                        )}
                        {editable && (
                          <div className="sk-row__actions">
                            <button
                              type="button"
                              className="plugins-pane__ghost"
                              onClick={() => void startEdit(s.name)}
                            >
                              Edit
                            </button>
                            {pendingDelete === s.name ? (
                              <>
                                <button
                                  type="button"
                                  className="sk-danger"
                                  onClick={() => void remove(s.name)}
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  className="plugins-pane__ghost"
                                  onClick={() => setPendingDelete(null)}
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="plugins-pane__ghost"
                                onClick={() => setPendingDelete(s.name)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                        {installed && (
                          <div className="sk-row__actions">
                            <button
                              type="button"
                              className="plugins-pane__ghost"
                              disabled={rowBusy === s.name}
                              onClick={() => void updateInstalled(s.name)}
                            >
                              {rowBusy === s.name ? "Working…" : "Update"}
                            </button>
                            {pendingDelete === s.name ? (
                              <>
                                <button
                                  type="button"
                                  className="sk-danger"
                                  disabled={rowBusy === s.name}
                                  onClick={() => void uninstall(s.name)}
                                >
                                  Confirm uninstall
                                </button>
                                <button
                                  type="button"
                                  className="plugins-pane__ghost"
                                  onClick={() => setPendingDelete(null)}
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="plugins-pane__ghost"
                                onClick={() => setPendingDelete(s.name)}
                              >
                                Uninstall
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
