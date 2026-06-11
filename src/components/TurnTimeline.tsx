import { useState, type ReactNode } from "react";
import { Markdown, RichText } from "./Markdown";
import { AskCard } from "./AskCard";
import { DiffView } from "./DiffView";
import { isDiffText } from "../lib/utils";
import { extractApproval, ApprovalCard } from "../views/project/journal/Transcript";
import type { TurnBlock } from "../views/project/chatProtocol";

function MessageMarkdown({ content }: { content: string }) {
  const { approval, prefix, suffix } = extractApproval(content);
  return (
    <div className="cx-md">
      {prefix && <Markdown>{prefix}</Markdown>}
      {approval && <ApprovalCard approval={approval} />}
      {suffix && <Markdown>{suffix}</Markdown>}
    </div>
  );
}

/** A single tool call or result, inline in the turn timeline. Compact by
 *  default; click to reveal the arguments / output (diff-aware). */
function ToolBlock({
  glyph,
  label,
  badge,
  detail,
}: {
  glyph: string;
  label: string;
  badge?: ReactNode;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!detail?.trim();
  return (
    <div className={`cx-tb ${open ? "cx-tb--open" : ""}`}>
      <button
        type="button"
        className="cx-tb__row"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
      >
        <span className="tr-tool__glyph">{glyph}</span>
        <code className="cx-act-tool">{label}</code>
        {badge}
        <span className="cx-tb__spacer" />
        {hasDetail && <span className="cx-tb__chev">{open ? "▲" : "▼"}</span>}
      </button>
      {open && hasDetail && (
        <div className="cx-tb__body">
          {isDiffText(detail!) ? (
            <DiffView text={detail!} />
          ) : (
            <RichText text={detail!} plain />
          )}
        </div>
      )}
    </div>
  );
}

/** Thinking indicator. Animates only while the model is *actively* thinking
 *  (the trailing block of a running turn). A completed/superseded thinking
 *  block is rendered static. When reasoning text is present the row becomes a
 *  collapsible disclosure that reveals it. */
function ThinkingInline({ active, text }: { active: boolean; text?: string }) {
  const [open, setOpen] = useState(false);
  const hasText = !!text?.trim();
  return (
    <div className="cx-think">
      <button
        type="button"
        className="cx-think__row"
        onClick={() => hasText && setOpen((v) => !v)}
        disabled={!hasText}
      >
        <span
          className={`tr-thinking-dots ${active ? "" : "tr-thinking-dots--static"}`}
          aria-hidden
        >
          <span /><span /><span />
        </span>
        <span className="cx-act-label">{active ? "thinking" : "thought"}</span>
        {hasText && <span className="cx-tb__chev">{open ? "▲" : "▼"}</span>}
      </button>
      {open && hasText && <div className="cx-think__body">{text}</div>}
    </div>
  );
}

/** Render a turn's block timeline in arrival order. */
export function TurnTimeline({
  blocks,
  running,
  interactive,
  onAnswer,
}: {
  blocks: TurnBlock[];
  running: boolean;
  interactive: boolean;
  onAnswer: (text: string) => void;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "text":
            return b.text.trim() ? (
              <MessageMarkdown key={i} content={b.text} />
            ) : null;
          case "thinking":
            return (
              <ThinkingInline
                key={i}
                active={running && i === blocks.length - 1}
                text={b.text}
              />
            );
          case "tool_call":
            if (b.toolName === "AskUserQuestion") {
              return (
                <AskCard
                  key={i}
                  raw={b.arguments}
                  interactive={interactive}
                  onAnswer={onAnswer}
                />
              );
            }
            return (
              <ToolBlock
                key={i}
                glyph="⌘"
                label={b.toolName ?? "tool"}
                detail={b.arguments}
              />
            );
          case "tool_result":
            return (
              <ToolBlock
                key={i}
                glyph="←"
                label={b.toolName ?? "result"}
                badge={
                  b.success === false ? (
                    <span className="tr-badge tr-badge--err">failed</span>
                  ) : (
                    <span className="tr-badge tr-badge--ok">ok</span>
                  )
                }
                detail={b.output}
              />
            );
          case "notice":
            return (
              <div key={i} className={`cx-notice cx-notice--${b.level}`}>
                <span aria-hidden>{b.level === "error" ? "⚠" : "ℹ"}</span>
                {b.text}
              </div>
            );
        }
      })}
    </>
  );
}

export default TurnTimeline;
