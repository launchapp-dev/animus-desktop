// Custom renderers for well-known Animus JSON shapes that show up in tool
// results (queue listings, subject/task lists, status, secrets, plugin lists).
// Anything we don't recognize falls through to a pretty JSON code block.

interface Props {
  value: unknown;
  /** Fallback renderer for unrecognized shapes (pretty JSON). */
  fallback: (pretty: string) => React.ReactNode;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function statusTone(s: string): string {
  const l = s.toLowerCase();
  if (["pending", "ready", "queued"].includes(l)) return "blue";
  if (["assigned", "running", "in-progress", "in_progress"].includes(l)) return "brass";
  if (["done", "completed", "passed", "held"].includes(l)) return "green";
  if (["failed", "blocked", "cancelled", "error"].includes(l)) return "crimson";
  return "gray";
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`aj-pill aj-pill--${statusTone(status)}`}>{status}</span>
  );
}

/** Pull a human title out of a queue entry's nested subject_dispatch. */
function subjectTitle(entry: Record<string, unknown>): {
  title: string;
  description?: string;
} {
  const sid = typeof entry.subject_id === "string" ? entry.subject_id : "";
  const dispatch = isObj(entry.subject_dispatch) ? entry.subject_dispatch : null;
  const subject = dispatch && isObj(dispatch.subject) ? dispatch.subject : null;
  // subject may be { Custom: { title, description } } or { Task: {...} } etc.
  if (subject) {
    for (const k of Object.keys(subject)) {
      const inner = subject[k];
      if (isObj(inner)) {
        const title = typeof inner.title === "string" ? inner.title : sid;
        const description =
          typeof inner.description === "string" ? inner.description : undefined;
        return { title, description };
      }
    }
  }
  return { title: sid || "—" };
}

function QueueTable({ entries }: { entries: Record<string, unknown>[] }) {
  return (
    <div className="aj">
      <div className="aj__head">
        <span className="aj__icon">▤</span>
        <span className="aj__title">Queue</span>
        <span className="aj__count">{entries.length} entries</span>
      </div>
      <ul className="aj-list">
        {entries.map((e, i) => {
          const { title, description } = subjectTitle(e);
          const status = typeof e.status === "string" ? e.status : "";
          const dispatch = isObj(e.subject_dispatch) ? e.subject_dispatch : null;
          const wf =
            dispatch && typeof dispatch.workflow_ref === "string"
              ? dispatch.workflow_ref
              : null;
          const trigger =
            dispatch && typeof dispatch.trigger_source === "string"
              ? dispatch.trigger_source
              : null;
          return (
            <li key={i} className="aj-row">
              <div className="aj-row__main">
                <div className="aj-row__title">{title}</div>
                {description && (
                  <div className="aj-row__desc">{description}</div>
                )}
                <div className="aj-row__meta">
                  {wf && <code className="aj-tag">{wf}</code>}
                  {trigger && <span className="aj-muted">{trigger}</span>}
                </div>
              </div>
              {status && <StatusPill status={status} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubjectList({ items }: { items: Record<string, unknown>[] }) {
  return (
    <div className="aj">
      <div className="aj__head">
        <span className="aj__icon">☰</span>
        <span className="aj__title">Subjects</span>
        <span className="aj__count">{items.length}</span>
      </div>
      <ul className="aj-list">
        {items.map((it, i) => {
          const id =
            (typeof it.id === "string" && it.id) ||
            (typeof it.subject_id === "string" && it.subject_id) ||
            "";
          const title = typeof it.title === "string" ? it.title : id;
          const status = typeof it.status === "string" ? it.status : "";
          const priority =
            typeof it.priority === "string" ? it.priority : null;
          return (
            <li key={i} className="aj-row">
              <div className="aj-row__main">
                <div className="aj-row__title">{title}</div>
                <div className="aj-row__meta">
                  {id && id !== title && <code className="aj-tag">{id}</code>}
                  {priority && <span className="aj-prio">{priority}</span>}
                </div>
              </div>
              {status && <StatusPill status={status} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Generic flat array-of-objects → compact table. */
function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  ).slice(0, 6);
  const cell = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "object") return Array.isArray(v) ? `[${v.length}]` : "{…}";
    return String(v);
  };
  return (
    <div className="aj">
      <div className="aj__head">
        <span className="aj__icon">▦</span>
        <span className="aj__count">{rows.length} rows</span>
      </div>
      <div className="aj-table-wrap">
        <table className="aj-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>{cell(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 50 && (
          <div className="aj-muted" style={{ padding: "6px 0" }}>
            +{rows.length - 50} more rows
          </div>
        )}
      </div>
    </div>
  );
}

export function AnimusJson({ value, fallback }: Props) {
  // Queue listing: { entries: [...], total, stats }
  if (isObj(value) && Array.isArray(value.entries)) {
    const entries = (value.entries as unknown[]).filter(isObj);
    if (entries.length > 0 && "subject_id" in entries[0]!) {
      return <QueueTable entries={entries as Record<string, unknown>[]} />;
    }
  }

  // Array of subjects/tasks: [{ id|subject_id, title, status, ... }]
  if (Array.isArray(value) && value.length > 0 && value.every(isObj)) {
    const rows = value as Record<string, unknown>[];
    const first = rows[0]!;
    const looksSubject =
      ("title" in first || "subject_id" in first) &&
      ("status" in first || "priority" in first || "subject_id" in first);
    if (looksSubject) return <SubjectList items={rows} />;
    // flat-ish array of objects → generic table
    const flat = rows.every((r) =>
      Object.values(r).every((v) => typeof v !== "object" || v === null),
    );
    if (flat) return <GenericTable rows={rows} />;
  }

  // Unknown shape → pretty JSON
  return <>{fallback(JSON.stringify(value, null, 2))}</>;
}

export default AnimusJson;
