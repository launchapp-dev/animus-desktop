import { useCallback, useEffect, useMemo, useState } from "react";
import {
  animusInteractionsAnswer,
  animusInteractionsList,
  type InteractionRecord,
} from "../../api/animus";
import type { Project } from "../../types/contracts";

const POLL_MS = 5_000;

/** `animus agent interactions` shipped after v0.5.14 — an older CLI rejects
 *  the subcommand, which surfaces as a spawn error rather than an envelope. */
function isUnsupported(err: string): boolean {
  return /unrecognized subcommand|no stdout|unexpected argument/i.test(err);
}

function extractRecords(data: unknown): InteractionRecord[] {
  if (Array.isArray(data)) return data as InteractionRecord[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["interactions", "items", "records"]) {
      if (Array.isArray(obj[key])) return obj[key] as InteractionRecord[];
    }
  }
  return [];
}

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function QuestionCard({
  record,
  onAnswer,
  busy,
}: {
  record: InteractionRecord;
  onAnswer: (args: { text?: string; selects?: string[] }) => void;
  busy: boolean;
}) {
  const structured = (record.questions ?? []).filter((q) => q.question);
  const flatOptions = record.options ?? [];
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [text, setText] = useState("");

  const toggle = (qi: number, label: string, multi: boolean) =>
    setSel((prev) => {
      const cur = prev[qi] ?? [];
      const next = multi
        ? cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label]
        : [label];
      return { ...prev, [qi]: next };
    });

  if (structured.length > 0) {
    const ready = structured.every((_, i) => (sel[i] ?? []).length > 0);
    return (
      <div className="cx-ask">
        {structured.map((q, qi) => (
          <div key={qi} className="cx-ask__q">
            {q.header && <span className="cx-ask__chip">{q.header}</span>}
            <div className="cx-ask__qtext">{q.question}</div>
            <div className="cx-ask__opts">
              {q.options.map((o) => {
                const picked = (sel[qi] ?? []).includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    className={`cx-ask__opt ${picked ? "cx-ask__opt--picked" : ""}`}
                    title={o.description ?? undefined}
                    onClick={() => toggle(qi, o.label, q.multi_select ?? false)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="workflow-row__run"
          disabled={!ready || busy}
          onClick={() =>
            onAnswer({
              selects: structured.map((q, i) => `${q.question}=${(sel[i] ?? []).join(",")}`),
            })
          }
        >
          {busy ? "Sending…" : "Send answer"}
        </button>
      </div>
    );
  }

  return (
    <div className="cx-ask">
      <div className="cx-ask__q">
        <div className="cx-ask__qtext">{record.question ?? "Question"}</div>
        {flatOptions.length > 0 && (
          <div className="cx-ask__opts">
            {flatOptions.map((o) => (
              <button
                key={o}
                type="button"
                className="cx-ask__opt"
                disabled={busy}
                onClick={() => onAnswer({ text: o })}
              >
                {o}
              </button>
            ))}
          </div>
        )}
        <div className="ix-answer">
          <input
            placeholder="Type an answer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) onAnswer({ text: text.trim() });
            }}
          />
          <button
            type="button"
            className="workflow-row__run"
            disabled={!text.trim() || busy}
            onClick={() => onAnswer({ text: text.trim() })}
          >
            {busy ? "Sending…" : "Answer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  record,
  onDecision,
  busy,
}: {
  record: InteractionRecord;
  onDecision: (decision: "allow" | "deny", message?: string) => void;
  busy: boolean;
}) {
  const [message, setMessage] = useState("");
  const args =
    record.arguments != null ? JSON.stringify(record.arguments, null, 2) : null;
  return (
    <div className="ix-approval">
      <div className="ix-approval__action">
        {record.action ?? (record.tool_name ? `use tool ${record.tool_name}` : "approval requested")}
      </div>
      {args && args !== "{}" && <pre className="ix-approval__args">{args}</pre>}
      <div className="ix-answer">
        <input
          placeholder="Optional message to the agent…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="button"
          className="ix-allow"
          disabled={busy}
          onClick={() => onDecision("allow", message.trim() || undefined)}
        >
          Allow
        </button>
        <button
          type="button"
          className="ix-deny"
          disabled={busy}
          onClick={() => onDecision("deny", message.trim() || undefined)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function InboxView({ project }: { project: Project }) {
  const path = project.repo_path?.trim() ?? "";
  const [records, setRecords] = useState<InteractionRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      const res = await animusInteractionsList(path, showAll);
      if (res.ok) {
        setRecords(extractRecords(res.data));
        setError(null);
        setUnsupported(false);
      } else {
        const msg = res.rawStderr || JSON.stringify(res.error);
        if (isUnsupported(msg)) setUnsupported(true);
        else setError(msg);
      }
    } catch (e) {
      const msg = String(e);
      if (isUnsupported(msg)) setUnsupported(true);
      else setError(msg);
    } finally {
      setLoaded(true);
    }
  }, [path, showAll]);

  useEffect(() => {
    void refresh();
    if (unsupported) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh, unsupported]);

  const answer = async (
    record: InteractionRecord,
    args: { decision?: "allow" | "deny"; text?: string; selects?: string[]; message?: string },
  ) => {
    setBusy(record.id);
    setError(null);
    try {
      const res = await animusInteractionsAnswer({ path, id: record.id, ...args });
      if (!res.ok) {
        setError(res.rawStderr || JSON.stringify(res.error));
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const { pending, resolved } = useMemo(() => {
    const pending = records.filter((r) => r.status === "pending");
    const resolved = records.filter((r) => r.status !== "pending");
    return { pending, resolved };
  }, [records]);

  if (unsupported) {
    return (
      <div className="ix-pane">
        <div className="journal-empty">
          <p style={{ fontWeight: 600, marginBottom: 6 }}>
            Agent inbox needs a newer animus CLI
          </p>
          <p>
            Questions and approvals from agents land here once the installed
            animus supports <code>animus agent interactions</code> (after
            v0.5.14). Update the CLI and revisit this tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ix-pane">
      <header className="plugins-pane__head">
        <div>
          <h2 className="workflows-pane__title">Inbox</h2>
          <p className="workflows-pane__subtitle">
            {pending.length} pending — agent questions and approval requests
          </p>
        </div>
        <div className="plugins-pane__head-actions">
          <label className="plugins-pane__toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            <span>Show resolved</span>
          </label>
          <button type="button" className="plugins-pane__ghost" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="workflow-error">
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
        </div>
      )}

      {loaded && pending.length === 0 && !showAll && (
        <div className="journal-empty">
          No pending interactions. Agents that ask questions or request
          approval will show up here.
        </div>
      )}

      <ul className="ix-list">
        {pending.map((r) => (
          <li key={r.id} className="ix-card">
            <div className="ix-card__head">
              <span className={`aj-pill aj-pill--${r.kind === "approval" ? "brass" : "blue"}`}>
                {r.kind}
              </span>
              <span className="ix-card__agent">{r.agent_id}</span>
              {r.workflow_id && <code className="aj-tag">{r.workflow_id}</code>}
              {r.suspended && (
                <span className="aj-tag" title="The workflow is paused until this is answered">
                  suspended
                </span>
              )}
              <span className="ix-card__age">{age(r.created_at)}</span>
            </div>
            {r.kind === "approval" ? (
              <ApprovalCard
                record={r}
                busy={busy === r.id}
                onDecision={(decision, message) => void answer(r, { decision, message })}
              />
            ) : (
              <QuestionCard
                record={r}
                busy={busy === r.id}
                onAnswer={(a) => void answer(r, a)}
              />
            )}
          </li>
        ))}
        {showAll &&
          resolved.map((r) => (
            <li key={r.id} className="ix-card ix-card--resolved">
              <div className="ix-card__head">
                <span className={`aj-pill aj-pill--${r.status === "answered" ? "green" : "gray"}`}>
                  {r.status}
                </span>
                <span className="ix-card__agent">{r.agent_id}</span>
                <span className="ix-card__age">{age(r.created_at)}</span>
              </div>
              <div className="ix-card__summary">
                {r.question ?? r.action ?? r.questions?.[0]?.question ?? r.id}
                {r.answer && <span className="ix-card__answer"> → {r.answer}</span>}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}
