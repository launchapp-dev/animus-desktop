import { AgentFace } from "../../../components/AgentFace";
import { Markdown, RichText } from "../../../components/Markdown";
import {
  clockTime,
  formatDuration,
  statusColor,
  statusFromCat,
  type NormalizedEvent,
} from "./model";

export interface ApprovalPayload {
  verdict: string;
  reason?: string;
  evidence?: Array<{ kind?: string; summary?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

// Find a JSON object containing "verdict" anywhere in the text by locating
// the key, walking back to its opening brace, and brace-matching forward.
// Handles fenced ```json blocks, bare single-line objects, and trailing
// objects with no surrounding newline — all the shapes agents emit.
export function extractApproval(content: string): {
  approval: ApprovalPayload | null;
  prefix: string;
  suffix: string;
} {
  const key = content.indexOf('"verdict"');
  if (key < 0) return { approval: null, prefix: content, suffix: "" };

  // Walk back to the opening brace of the object holding "verdict".
  let start = -1;
  for (let i = key; i >= 0; i--) {
    if (content[i] === "{") {
      start = i;
      break;
    }
    if (content[i] === "}") break; // crossed a sibling object — bail
  }
  if (start < 0) return { approval: null, prefix: content, suffix: "" };

  // Brace-match forward (ignoring braces inside strings).
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return { approval: null, prefix: content, suffix: "" };

  const jsonStr = content.slice(start, end);
  try {
    const parsed = JSON.parse(jsonStr) as ApprovalPayload;
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      // Trim a wrapping ```json fence if present around the object.
      let prefix = content.slice(0, start);
      let suffix = content.slice(end);
      prefix = prefix.replace(/```(?:json)?\s*$/, "");
      suffix = suffix.replace(/^\s*```/, "");
      return { approval: parsed, prefix, suffix };
    }
  } catch {
    /* not valid JSON */
  }
  return { approval: null, prefix: content, suffix: "" };
}

export function ApprovalCard({ approval }: { approval: ApprovalPayload }) {
  const v = approval.verdict.toLowerCase();
  const tone =
    v === "approve" || v === "approved"
      ? "good"
      : v === "reject" || v === "rejected"
        ? "bad"
        : v === "rework"
          ? "warn"
          : "neutral";
  return (
    <div className={`tr-approval tr-approval--${tone}`}>
      <div className="tr-approval__head">
        <span className={`tr-approval__verdict tr-approval__verdict--${tone}`}>
          {approval.verdict}
        </span>
        {typeof approval.kind === "string" && approval.kind && (
          <span className="tr-approval__kindtag">
            {approval.kind.replace(/_/g, " ")}
          </span>
        )}
        <span className="tr-approval__label">verdict</span>
      </div>
      {approval.reason && (
        <div className="tr-approval__reason">
          <Markdown>{approval.reason}</Markdown>
        </div>
      )}
      {approval.evidence && approval.evidence.length > 0 && (
        <div className="tr-approval__evidence">
          <h5>Evidence ({approval.evidence.length})</h5>
          <ul>
            {approval.evidence.map((ev, i) => (
              <li key={i}>
                {ev.kind && <code className="tr-approval__kind">{ev.kind}</code>}
                {ev.summary && <span>{ev.summary}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ToolParams({ raw }: { raw: string }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return <pre className="tr-tool__params">{raw}</pre>;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const command = typeof obj.command === "string" ? obj.command : null;
    const description = typeof obj.description === "string" ? obj.description : null;
    const filePath = typeof obj.file_path === "string" ? obj.file_path : null;
    const pattern = typeof obj.pattern === "string" ? obj.pattern : null;
    const url = typeof obj.url === "string" ? obj.url : null;
    if (command) {
      return (
        <div>
          {description && <p className="tr-tool__desc">{description}</p>}
          <pre className="tr-tool__cmd">$ {command}</pre>
        </div>
      );
    }
    if (filePath) {
      return (
        <div className="tr-tool__kv">
          <span>path</span>
          <code>{filePath}</code>
          {pattern && (
            <>
              <span>pattern</span>
              <code>{pattern}</code>
            </>
          )}
        </div>
      );
    }
    if (url) {
      return (
        <div className="tr-tool__kv">
          <span>url</span>
          <code>{url}</code>
        </div>
      );
    }
    return <pre className="tr-tool__params">{JSON.stringify(parsed, null, 2)}</pre>;
  }
  return <pre className="tr-tool__params">{JSON.stringify(parsed, null, 2)}</pre>;
}

function ToolResultBody({ text }: { text: string }) {
  // `plain` = tool output is program stdout, not markdown — so `---`, `#`,
  // `hint:` etc. render literally (monospace) instead of being mangled.
  return (
    <div className="tr-md">
      <RichText text={text} plain />
    </div>
  );
}

function MessageBubble({ evt, label }: { evt: NormalizedEvent; label: string }) {
  const content = evt.content ?? evt.msg ?? "";
  if (!content) return null;
  const { approval, prefix, suffix } = extractApproval(content);
  return (
    <div className="tr-row tr-row--message">
      <div className="tr-row__gutter">
        {evt.agent ? (
          <AgentFace seed={evt.agent} size={26} state="done" title={`@${evt.agent}`} />
        ) : (
          <span className="tr-row__dot" style={{ background: "var(--green)" }} />
        )}
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          {evt.agent && <span className="tr-row__agent">@{evt.agent}</span>}
          {evt.model && <code className="tr-row__model">{evt.model}</code>}
          <span className="tr-row__label">{label}</span>
          <span className="tr-row__time">{clockTime(evt.ts)}</span>
        </div>
        <div className="tr-bubble">
          {prefix && <Markdown>{prefix}</Markdown>}
          {approval && <ApprovalCard approval={approval} />}
          {suffix && <Markdown>{suffix}</Markdown>}
        </div>
      </div>
    </div>
  );
}

function ThinkingLine({ evt }: { evt: NormalizedEvent }) {
  return (
    <div className="tr-row tr-row--aux">
      <div className="tr-row__gutter">
        <span className="tr-thinking-dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className="tr-row__main">
        <span className="tr-aux-label">thinking…</span>
        <span className="tr-row__time">{clockTime(evt.ts)}</span>
      </div>
    </div>
  );
}

function ToolCallLine({ evt }: { evt: NormalizedEvent }) {
  const tool = evt.toolName ?? evt.msg ?? evt.tool ?? "tool";
  return (
    <div className="tr-row tr-row--tool">
      <div className="tr-row__gutter">
        <span className="tr-tool__glyph">⌘</span>
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          <span className="tr-tool__name">{tool}</span>
          <span className="tr-row__time">{clockTime(evt.ts)}</span>
        </div>
        {evt.toolParams && <ToolParams raw={evt.toolParams} />}
      </div>
    </div>
  );
}

function ToolResultLine({ evt }: { evt: NormalizedEvent }) {
  const result = evt.toolResult ?? "";
  if (!result) return null;
  return (
    <div className="tr-row tr-row--tool-result">
      <div className="tr-row__gutter">
        <span className="tr-tool__glyph tr-tool__glyph--result">←</span>
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          {evt.toolSuccess === true && (
            <span className="tr-badge tr-badge--ok">ok</span>
          )}
          {evt.toolSuccess === false && (
            <span className="tr-badge tr-badge--err">failed</span>
          )}
          {evt.durationMs != null && evt.durationMs > 0 && (
            <span className="tr-row__time">{formatDuration(evt.durationMs)}</span>
          )}
          <span className="tr-aux-label">result</span>
        </div>
        {/* Full result — RichText handles JSON cards, command output, and
            collapse/scroll for big blobs. No char truncation. */}
        <ToolResultBody text={result} />
      </div>
    </div>
  );
}

function PhaseDivider({ evt }: { evt: NormalizedEvent }) {
  const isStart = evt.cat === "phase.start";
  const status = statusFromCat(evt.cat, evt.level, evt.exitCode);
  return (
    <div className="tr-divider tr-divider--phase">
      <span className="tr-divider__line" />
      <span className="tr-divider__chip">
        {evt.agent && (
          <span className="tr-divider__avatar">
            <AgentFace seed={evt.agent} size={16} state={isStart ? "running" : "done"} />
          </span>
        )}
        <code>{evt.phaseId}</code>
        {!isStart && (
          <span style={{ color: statusColor(status) }}>
            {status}
            {evt.durationMs != null ? ` · ${formatDuration(evt.durationMs)}` : ""}
          </span>
        )}
        {isStart && <span style={{ color: "var(--text-faint)" }}>phase start</span>}
      </span>
      <span className="tr-divider__line" />
    </div>
  );
}

function WorkflowDivider({ evt }: { evt: NormalizedEvent }) {
  const isStart = evt.cat === "workflow.start";
  const status = statusFromCat(evt.cat, evt.level, evt.exitCode);
  return (
    <div className={`tr-divider tr-divider--workflow tr-divider--${status}`}>
      <span
        className="tr-divider__dot"
        style={{ background: statusColor(status) }}
      />
      <span className="tr-divider__title">
        {isStart ? "▶ workflow started" : `■ workflow ${status}`}
      </span>
      {evt.durationMs != null && (
        <span className="tr-divider__dur">{formatDuration(evt.durationMs)}</span>
      )}
      <span className="tr-row__time">{clockTime(evt.ts)}</span>
    </div>
  );
}

function DispatchLine({ evt }: { evt: NormalizedEvent }) {
  const isStart = evt.cat === "plugin.dispatch.start";
  const status = statusFromCat(evt.cat, evt.level, evt.exitCode);
  return (
    <div className="tr-row tr-row--aux">
      <div className="tr-row__gutter">
        <span
          className="tr-row__dot"
          style={{ background: statusColor(status) }}
        />
      </div>
      <div className="tr-row__main tr-dispatch">
        <code className="tr-dispatch__model">
          {evt.model ?? evt.plugin ?? "dispatch"}
        </code>
        {evt.tool && <span className="tr-dispatch__tool">{evt.tool}</span>}
        <span className="tr-aux-label">
          {isStart ? "dispatch start" : status}
        </span>
        {evt.durationMs != null && evt.durationMs > 0 && (
          <span className="tr-row__time">{formatDuration(evt.durationMs)}</span>
        )}
      </div>
    </div>
  );
}

function ErrorLine({ evt }: { evt: NormalizedEvent }) {
  return (
    <div className="tr-row tr-row--error">
      <div className="tr-row__gutter">
        <span className="tr-row__dot" style={{ background: "var(--crimson)" }} />
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          {evt.phaseId && <code className="tr-row__model">{evt.phaseId}</code>}
          <span className="tr-aux-label" style={{ color: "var(--crimson)" }}>
            error
          </span>
          <span className="tr-row__time">{clockTime(evt.ts)}</span>
        </div>
        <pre className="tr-error">{evt.error ?? evt.msg}</pre>
      </div>
    </div>
  );
}

function DecisionLine({ evt }: { evt: NormalizedEvent }) {
  const verdict = evt.verdict ?? evt.msg ?? "decision";
  const v = verdict.toLowerCase();
  const tone =
    v.includes("advance") || v.includes("approve") || v.includes("pass")
      ? "good"
      : v.includes("rework") || v.includes("retry")
        ? "warn"
        : v.includes("fail") || v.includes("reject")
          ? "bad"
          : "neutral";
  const reason = evt.content ?? null;
  return (
    <div className="tr-row tr-row--message">
      <div className="tr-row__gutter">
        <span className="tr-decision__glyph">⚖</span>
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          {evt.phaseId && <code className="tr-row__model">{evt.phaseId}</code>}
          <span className="tr-row__label">verdict</span>
          <span className="tr-row__time">{clockTime(evt.ts)}</span>
        </div>
        <div className={`tr-decision tr-decision--${tone}`}>
          <span className={`tr-decision__badge tr-decision__badge--${tone}`}>
            {verdict}
          </span>
          {reason && <span className="tr-decision__reason">{reason}</span>}
        </div>
      </div>
    </div>
  );
}

function CommandLine({ evt }: { evt: NormalizedEvent }) {
  const cmd = [evt.commandProgram, ...(evt.commandArgs ?? [])]
    .filter(Boolean)
    .join(" ");
  const failed = evt.exitCode != null && evt.exitCode !== 0;
  const stdout = evt.content ?? "";
  return (
    <div className="tr-row tr-row--tool">
      <div className="tr-row__gutter">
        <span className="tr-tool__glyph">$</span>
      </div>
      <div className="tr-row__main">
        <div className="tr-row__meta">
          {evt.phaseId && <code className="tr-row__model">{evt.phaseId}</code>}
          {failed ? (
            <span className="tr-badge tr-badge--err">exit {evt.exitCode}</span>
          ) : (
            <span className="tr-badge tr-badge--ok">ok</span>
          )}
          {evt.durationMs != null && (
            <span className="tr-row__time">{formatDuration(evt.durationMs)}</span>
          )}
        </div>
        {cmd && <pre className="tr-tool__cmd">$ {cmd}</pre>}
        {stdout && <pre className="tr-tool__output">{stdout}</pre>}
      </div>
    </div>
  );
}

function GenericLine({ evt }: { evt: NormalizedEvent }) {
  return (
    <div className="tr-row tr-row--aux">
      <div className="tr-row__gutter">
        <span className="tr-row__dot" style={{ background: "var(--gray)" }} />
      </div>
      <div className="tr-row__main tr-generic">
        <code className="tr-generic__cat">{evt.cat}</code>
        <span className="tr-generic__msg">{evt.msg}</span>
        <span className="tr-row__time">{clockTime(evt.ts)}</span>
      </div>
    </div>
  );
}

export function TranscriptRow({ evt }: { evt: NormalizedEvent }) {
  if (evt.error && evt.cat !== "llm.tool_result") return <ErrorLine evt={evt} />;
  switch (evt.cat) {
    case "workflow.start":
    case "workflow.complete":
      return <WorkflowDivider evt={evt} />;
    case "phase.start":
    case "phase.complete":
      return <PhaseDivider evt={evt} />;
    case "phase.decision":
      return <DecisionLine evt={evt} />;
    case "command.complete":
      return <CommandLine evt={evt} />;
    case "plugin.dispatch.start":
    case "plugin.dispatch.complete":
    case "plugin.dispatch.timeout":
    case "plugin.cancel":
      return <DispatchLine evt={evt} />;
    case "llm.thinking":
      return <ThinkingLine evt={evt} />;
    case "llm.tool_call":
      return <ToolCallLine evt={evt} />;
    case "llm.tool_result":
      return <ToolResultLine evt={evt} />;
    case "llm.output":
      return <MessageBubble evt={evt} label="message" />;
    case "llm.complete":
      return <MessageBubble evt={evt} label="final" />;
    default:
      return <GenericLine evt={evt} />;
  }
}

export function Transcript({ events }: { events: NormalizedEvent[] }) {
  return (
    <div className="tr">
      {events.map((e, i) => (
        <TranscriptRow key={`${e.tsRaw ?? e.ts}-${e.cat}-${i}`} evt={e} />
      ))}
    </div>
  );
}
