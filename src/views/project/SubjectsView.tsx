import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subjectCreate,
  subjectDelete,
  subjectList,
  subjectSetStatus,
  type Subject,
} from "../../api/subject";
import type { Project } from "../../types/contracts";

// Known subject kinds the daemon ships with. Backends bind to a kind at
// daemon startup; these are the common ones, but the user can route any
// custom kind via the "+ kind" input.
const DEFAULT_KINDS = ["task", "requirement"] as const;

// Normalized status buckets the CLI understands (`--status`).
const STATUSES = ["ready", "in_progress", "blocked", "cancelled", "done"] as const;
const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  // The daemon's stale-run reconcile projects Cancelled (not Blocked) when
  // the terminal workflow died cancelled (animus > 0.5.14).
  cancelled: "Cancelled",
  done: "Done",
};

const PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

function statusModifier(status: string): string {
  switch (status) {
    case "done":
      return "done";
    case "blocked":
    case "cancelled":
      return "blocked";
    case "in_progress":
      return "active";
    default:
      return "ready";
  }
}

export function SubjectsView({ project }: { project: Project }) {
  const [kind, setKind] = useState<string>("task");
  const [customKinds, setCustomKinds] = useState<string[]>([]);
  const [addingKind, setAddingKind] = useState(false);
  const [newKind, setNewKind] = useState("");

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cPriority, setCPriority] = useState("p2");
  const [cLabels, setCLabels] = useState("");
  const [cBody, setCBody] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const path = project.repo_path?.trim() || undefined;

  // Last-issued-wins token: `subjectList` shells out to the animus CLI and a
  // slow `task` listing must not resolve AFTER a fast `requirement` one and
  // display tasks under the requirement chip (whose actions would then write
  // against the wrong backend with the wrong ids).
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    if (!path) {
      setError("This project has no folder path on disk.");
      setSubjects([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await subjectList(kind, path);
      if (seq !== refreshSeq.current) return;
      if (!res.ok) {
        setError(res.error ?? "subject list failed");
        setSubjects([]);
      } else {
        setSubjects(res.data ?? []);
      }
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, [kind, path]);

  // Mutation handlers (status change, delete, create) can resolve after a
  // kind switch; calling through this ref makes the post-mutation refresh use
  // the CURRENT kind instead of a stale closure, so it can't bleed old-kind
  // data into the list (the seq token then settles the race as usual).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kinds = useMemo(
    () => Array.from(new Set([...DEFAULT_KINDS, ...customKinds])),
    [customKinds],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: subjects.length };
    for (const s of subjects) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [subjects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subjects
      .filter((s) => statusFilter === "all" || s.status === statusFilter)
      .filter((s) => {
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.labels.some((l) => l.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.priority - b.priority);
  }, [subjects, search, statusFilter]);

  function addKind() {
    const k = newKind.trim().toLowerCase();
    if (!k) return;
    if (!kinds.includes(k)) setCustomKinds((prev) => [...prev, k]);
    setKind(k);
    setNewKind("");
    setAddingKind(false);
  }

  async function handleCreate() {
    if (!path || !cTitle.trim()) return;
    setCreateBusy(true);
    setError(null);
    try {
      const res = await subjectCreate(
        {
          kind,
          title: cTitle.trim(),
          priority: cPriority,
          labels: cLabels.trim(),
          body: cBody.trim(),
        },
        path,
      );
      if (!res.ok) {
        setError(res.error ?? "subject create failed");
      } else {
        setCTitle("");
        setCLabels("");
        setCBody("");
        setCPriority("p2");
        setShowCreate(false);
        await refreshRef.current();
      }
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleStatus(s: Subject, status: string) {
    if (!path || status === s.status) return;
    setBusyId(s.id);
    setError(null);
    try {
      const res = await subjectSetStatus(kind, s.id, status, path);
      if (!res.ok) setError(res.error ?? "status change failed");
      else await refreshRef.current();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s: Subject) {
    if (!path) return;
    setBusyId(s.id);
    setError(null);
    try {
      const res = await subjectDelete(kind, s.id, path);
      if (!res.ok) setError(res.error ?? "delete failed");
      else {
        setPendingDelete(null);
        await refreshRef.current();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="plugins-pane">
      <header className="plugins-pane__head">
        <div>
          <h2 className="workflows-pane__title">Subjects</h2>
          <p className="workflows-pane__subtitle">
            {loading
              ? "loading…"
              : `${subjects.length} ${kind}${subjects.length === 1 ? "" : "s"}`}{" "}
            · routed through the active <code>{kind}</code> subject backend
          </p>
        </div>
        <div className="plugins-pane__head-actions">
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => setShowCreate((s) => !s)}
            disabled={loading || !path}
          >
            {showCreate ? "Cancel" : "+ New subject"}
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

      {/* Kind selector — which backend / data set we're browsing */}
      <nav className="plugins-pane__kinds" aria-label="Subject kind">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            className={`plugins-pane__kind-chip ${
              kind === k ? "plugins-pane__kind-chip--active" : ""
            }`}
            onClick={() => setKind(k)}
          >
            <span>{k}</span>
          </button>
        ))}
        {addingKind ? (
          <input
            className="subjects-kind-input"
            value={newKind}
            autoFocus
            placeholder="kind…"
            spellCheck={false}
            onChange={(e) =>
              setNewKind(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") addKind();
              if (e.key === "Escape") {
                setAddingKind(false);
                setNewKind("");
              }
            }}
            onBlur={() => (newKind.trim() ? addKind() : setAddingKind(false))}
          />
        ) : (
          <button
            type="button"
            className="plugins-pane__kind-chip plugins-pane__kind-chip--ghost"
            onClick={() => setAddingKind(true)}
            title="Browse a custom subject kind"
          >
            + kind
          </button>
        )}
      </nav>

      {error && (
        <div className="workflow-error">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Subject error</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
          <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
            A <code>subject_backend</code> plugin must be installed and bound to
            kind <code>{kind}</code>. Check the Plugins tab.
          </p>
        </div>
      )}

      {showCreate && (
        <section className="secret-form">
          <label className="secret-form__row">
            <span className="secret-form__label">Title</span>
            <input
              className="plugins-pane__search"
              value={cTitle}
              onChange={(e) => setCTitle(e.target.value)}
              placeholder="What needs doing…"
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="secret-form__row">
            <span className="secret-form__label">Priority</span>
            <select
              className="subjects-select"
              value={cPriority}
              onChange={(e) => setCPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="secret-form__row">
            <span className="secret-form__label">Labels</span>
            <input
              className="plugins-pane__search"
              value={cLabels}
              onChange={(e) => setCLabels(e.target.value)}
              placeholder="comma,separated,labels"
              spellCheck={false}
            />
          </label>
          <label className="secret-form__row">
            <span className="secret-form__label">Body</span>
            <textarea
              className="plugins-pane__search subjects-textarea"
              value={cBody}
              onChange={(e) => setCBody(e.target.value)}
              placeholder="Optional description / body"
              rows={3}
            />
          </label>
          <div className="card__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => setShowCreate(false)}
              disabled={createBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="workflow-row__run"
              onClick={() => void handleCreate()}
              disabled={createBusy || !cTitle.trim()}
            >
              {createBusy ? "Creating…" : `Create ${kind}`}
            </button>
          </div>
        </section>
      )}

      <div className="plugins-pane__toolbar">
        <input
          className="plugins-pane__search"
          placeholder="Search title, id, labels…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <nav className="plugins-pane__kinds" aria-label="Filter by status">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            className={`plugins-pane__kind-chip ${
              statusFilter === s ? "plugins-pane__kind-chip--active" : ""
            }`}
            onClick={() => setStatusFilter(s)}
          >
            <span>{s === "all" ? "All" : STATUS_LABEL[s] ?? s}</span>
            <span className="plugins-pane__kind-count">{counts[s] ?? 0}</span>
          </button>
        ))}
      </nav>

      {filtered.length === 0 && !loading && !error ? (
        <p style={{ color: "var(--text-faint)", fontSize: 12, padding: "12px 0" }}>
          {subjects.length === 0
            ? `No ${kind} subjects yet. Click + New subject to create one.`
            : "No subjects match your filter."}
        </p>
      ) : (
        <ul className="subject-list">
          {filtered.map((s) => {
            const open = expanded.has(s.id);
            const isBusy = busyId === s.id;
            return (
              <li key={s.id} className="subject-row">
                <div
                  className="subject-row__head"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                >
                  <span
                    className={`subject-row__status subject-row__status--${statusModifier(
                      s.status,
                    )}`}
                    title={s.native_status}
                  >
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span className="subject-row__pri">P{s.priority}</span>
                  <span className="subject-row__title">{s.title}</span>
                  <code className="subject-row__id">{s.id}</code>
                  {s.labels.slice(0, 3).map((l) => (
                    <span key={l} className="subject-row__label">
                      {l}
                    </span>
                  ))}
                  <span className="team-member__expand">{open ? "▼" : "▶"}</span>
                </div>

                {open && (
                  <div className="subject-row__body">
                    {s.description && (
                      <p className="subject-row__desc">{s.description}</p>
                    )}
                    <div className="subject-row__meta">
                      <span>
                        native: <code>{s.native_status}</code>
                      </span>
                      <span>
                        updated:{" "}
                        {new Date(s.updated_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <div className="subject-row__actions">
                      <label className="subject-row__set-status">
                        <span>Status</span>
                        <select
                          className="subjects-select"
                          value={s.status}
                          disabled={isBusy}
                          onChange={(e) => void handleStatus(s, e.target.value)}
                        >
                          {STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABEL[st]}
                            </option>
                          ))}
                          {!STATUSES.includes(
                            s.status as (typeof STATUSES)[number],
                          ) && <option value={s.status}>{s.status}</option>}
                        </select>
                      </label>
                      {pendingDelete === s.id ? (
                        <>
                          <button
                            type="button"
                            className="plugins-pane__ghost"
                            onClick={() => setPendingDelete(null)}
                            disabled={isBusy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="secret-row__delete"
                            onClick={() => void handleDelete(s)}
                            disabled={isBusy}
                          >
                            {isBusy ? "Deleting…" : "Confirm delete"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secret-row__delete"
                          onClick={() => setPendingDelete(s.id)}
                          disabled={isBusy}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
