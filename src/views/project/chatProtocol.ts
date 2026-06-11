// Pure logic for the `animus chat send --stream --json` protocol.
// Kept free of React/Tauri imports so it is unit-testable in isolation.

// A turn is an ordered timeline of blocks, so tool calls, results, thinking,
// and prose interleave in the order the model produced them — instead of all
// tool activity being piled into one block above the text.
export type TurnBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text?: string }
  | { kind: "tool_call"; toolName?: string; arguments?: string }
  | { kind: "tool_result"; toolName?: string; success?: boolean; output?: string }
  | { kind: "notice"; level: "warning" | "error"; text: string };

// Provider-reported token usage for one assistant turn.
export interface ChatUsage {
  input: number;
  output: number;
  reasoning?: number | null;
  cache_read?: number | null;
  cache_write?: number | null;
}

// One streamed JSON frame from `animus chat send --stream --json`.
export interface ChatProtoEvent {
  type: string;
  conversation_id?: string;
  tool?: string;
  model?: string;
  text?: string;
  tool_name?: string;
  arguments?: unknown;
  success?: boolean;
  output?: unknown;
  message?: string;
  session_id?: string;
  cost_usd?: number | null;
  tokens?: ChatUsage | null;
}

/** Compact token count: 999, 1.2k, 15k, 1.5M. */
function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Compact token+cost summary for a turn footer, e.g.
 *  "1.2k in · 340 out · $0.0123". Empty string when nothing to show. */
export function formatUsage(usage?: ChatUsage | null, cost?: number | null): string {
  const parts: string[] = [];
  if (usage) {
    parts.push(`${compactNum(usage.input)} in`, `${compactNum(usage.output)} out`);
  }
  if (cost != null && cost > 0) {
    parts.push(`$${cost < 0.1 ? cost.toFixed(4) : cost.toFixed(2)}`);
  }
  return parts.join(" · ");
}

// A block as persisted by `animus chat` (snake_case, raw JSON args/output),
// returned inside each assistant message by `chat get`.
export type PersistedBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text?: string }
  | { kind: "tool_call"; tool_name?: string; arguments?: unknown }
  | { kind: "tool_result"; tool_name?: string; success?: boolean; output?: unknown };

function stringifyArg(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Convert a persisted block (from `chat get`) into the UI timeline shape,
 *  matching how `foldFrame` renders a live stream so reload looks identical. */
export function blockFromPersisted(p: PersistedBlock): TurnBlock {
  switch (p.kind) {
    case "text":
      return { kind: "text", text: p.text };
    case "thinking":
      return p.text ? { kind: "thinking", text: p.text } : { kind: "thinking" };
    case "tool_call":
      return { kind: "tool_call", toolName: p.tool_name, arguments: stringifyArg(p.arguments) };
    case "tool_result":
      return {
        kind: "tool_result",
        toolName: p.tool_name,
        success: p.success,
        output: stringifyArg(p.output),
      };
  }
}

/** Derive a short conversation title from the first user message: the first
 *  non-empty line, whitespace-collapsed and truncated to ~48 chars with an
 *  ellipsis. Empty input yields an empty string (caller should skip naming). */
export function deriveConversationTitle(message: string): string {
  const firstLine =
    message
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  const MAX = 48;
  return collapsed.length > MAX
    ? `${collapsed.slice(0, MAX - 1).trimEnd()}…`
    : collapsed;
}

/** Join an assistant turn's prose for copying — keeps text segments (separated
 *  by tool calls) and drops tool/thinking blocks. */
export function blocksToPlainText(blocks: TurnBlock[]): string {
  return blocks
    .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
    .map((b) => b.text)
    .filter((t) => t.trim())
    .join("\n\n")
    .trim();
}

// --- AskUserQuestion (interactive agent prompt) ----------------------------

export interface AskOption {
  label: string;
  description?: string;
}
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskOption[];
}

/** Parse an `AskUserQuestion` tool-call's raw arguments into questions, or null
 *  if the payload isn't a recognizable spec. Defensive: never throws. */
export function parseAskQuestions(raw?: string): AskQuestion[] | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && Array.isArray(o.questions) && o.questions.length > 0) {
      return o.questions as AskQuestion[];
    }
  } catch {
    /* not a recognizable spec */
  }
  return null;
}

/** Fold one streamed frame into a turn's block timeline. Consecutive text
 *  deltas merge into the trailing text block; consecutive thinking frames
 *  collapse into a single indicator; everything else appends in order. */
export function foldFrame(blocks: TurnBlock[], frame: ChatProtoEvent): TurnBlock[] {
  const last = blocks[blocks.length - 1];
  switch (frame.type) {
    case "text_delta": {
      const chunk = frame.text ?? "";
      if (last && last.kind === "text") {
        return [...blocks.slice(0, -1), { kind: "text", text: last.text + chunk }];
      }
      return [...blocks, { kind: "text", text: chunk }];
    }
    case "thinking": {
      const chunk = frame.text ?? "";
      if (last && last.kind === "thinking") {
        if (!chunk) return blocks;
        const merged = last.text ? `${last.text}\n${chunk}` : chunk;
        return [...blocks.slice(0, -1), { kind: "thinking", text: merged }];
      }
      return [...blocks, chunk ? { kind: "thinking", text: chunk } : { kind: "thinking" }];
    }
    case "tool_call":
      return [
        ...blocks,
        {
          kind: "tool_call",
          toolName: frame.tool_name,
          arguments:
            frame.arguments != null
              ? JSON.stringify(frame.arguments, null, 2)
              : undefined,
        },
      ];
    case "tool_result":
      return [
        ...blocks,
        {
          kind: "tool_result",
          toolName: frame.tool_name,
          success: frame.success,
          output:
            frame.output != null
              ? typeof frame.output === "string"
                ? frame.output
                : JSON.stringify(frame.output, null, 2)
              : undefined,
        },
      ];
    case "warning":
    case "error": {
      const msg = frame.message ?? frame.text;
      if (!msg) return blocks;
      return [
        ...blocks,
        {
          kind: "notice",
          level: frame.type === "error" ? "error" : "warning",
          text: msg,
        },
      ];
    }
    default:
      return blocks;
  }
}
