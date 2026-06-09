import { useMemo, useState } from "react";
import { parseAskQuestions } from "../views/project/chatProtocol";

/** Interactive card for an agent's `AskUserQuestion`. A single-select, single
 *  question sends on click; otherwise the user toggles selections and hits
 *  "Send answer". The choice is delivered to `onAnswer` (the caller turns it
 *  into a follow-up turn on the same conversation). */
export function AskCard({
  raw,
  interactive,
  onAnswer,
}: {
  raw?: string;
  interactive: boolean;
  onAnswer: (text: string) => void;
}) {
  const questions = useMemo(() => parseAskQuestions(raw), [raw]);
  const [sel, setSel] = useState<Record<number, string[]>>({});

  if (!questions) {
    // Malformed / unrecognized payload — show the raw arguments rather than
    // pretending it's an answerable question.
    return (
      <div className="cx-ask cx-ask--fallback">
        <span className="cx-ask__chip">AskUserQuestion</span>
        {raw && <pre className="cx-ask__raw">{raw}</pre>}
      </div>
    );
  }
  const single = questions.length === 1 && !questions[0].multiSelect;

  const compose = (s: Record<number, string[]>) =>
    questions
      .map((q, i) => `${q.header || q.question}: ${(s[i] ?? []).join(", ")}`)
      .join("\n");

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

  const ready = questions.every((_, i) => (sel[i] ?? []).length > 0);

  return (
    <div className="cx-ask">
      {questions.map((q, qi) => (
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
                  className={`cx-ask__opt ${picked ? "cx-ask__opt--on" : ""}`}
                  disabled={!interactive}
                  title={o.description}
                  onClick={() => {
                    if (single) {
                      onAnswer(compose({ [qi]: [o.label] }));
                      return;
                    }
                    toggle(qi, o.label, !!q.multiSelect);
                  }}
                >
                  <span className="cx-ask__opt-label">{o.label}</span>
                  {o.description && (
                    <span className="cx-ask__opt-desc">{o.description}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!single && (
        <button
          type="button"
          className="cx-ask__send"
          disabled={!interactive || !ready}
          onClick={() => onAnswer(compose(sel))}
        >
          Send answer
        </button>
      )}
    </div>
  );
}

export default AskCard;
