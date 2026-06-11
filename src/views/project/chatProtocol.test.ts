import { describe, it, expect } from "vitest";
import {
  foldFrame,
  blockFromPersisted,
  parseAskQuestions,
  blocksToPlainText,
  formatUsage,
  deriveConversationTitle,
  type TurnBlock,
} from "./chatProtocol";

function fold(frames: Parameters<typeof foldFrame>[1][]): TurnBlock[] {
  return frames.reduce<TurnBlock[]>((blocks, f) => foldFrame(blocks, f), []);
}

describe("foldFrame", () => {
  it("merges consecutive text deltas into one text block", () => {
    const blocks = fold([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: ", " },
      { type: "text_delta", text: "world" },
    ]);
    expect(blocks).toEqual([{ kind: "text", text: "Hello, world" }]);
  });

  it("interleaves tool calls between text in arrival order", () => {
    const blocks = fold([
      { type: "text_delta", text: "let me check" },
      { type: "tool_call", tool_name: "Read", arguments: { path: "a.ts" } },
      { type: "tool_result", tool_name: "Read", success: true, output: "ok" },
      { type: "text_delta", text: "done" },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
    ]);
    // a tool call splits the text, so the trailing text is its own block
    expect(blocks[3]).toEqual({ kind: "text", text: "done" });
  });

  it("accumulates consecutive thinking text into a single block", () => {
    const blocks = fold([
      { type: "thinking", text: "a" },
      { type: "thinking", text: "b" },
      { type: "thinking", text: "c" },
    ]);
    expect(blocks).toEqual([{ kind: "thinking", text: "a\nb\nc" }]);
  });

  it("keeps a textless thinking frame as a bare indicator", () => {
    const blocks = fold([{ type: "thinking" }, { type: "thinking" }]);
    expect(blocks).toEqual([{ kind: "thinking" }]);
  });

  it("starts a fresh text block after a non-text frame", () => {
    const blocks = fold([
      { type: "text_delta", text: "one" },
      { type: "thinking" },
      { type: "text_delta", text: "two" },
    ]);
    expect(blocks).toEqual([
      { kind: "text", text: "one" },
      { kind: "thinking" },
      { kind: "text", text: "two" },
    ]);
  });

  it("pretty-prints object tool arguments and passes string output through", () => {
    const blocks = fold([
      { type: "tool_call", tool_name: "Grep", arguments: { q: "x" } },
      { type: "tool_result", tool_name: "Grep", success: false, output: "no match" },
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "tool_call",
      toolName: "Grep",
      arguments: JSON.stringify({ q: "x" }, null, 2),
    });
    expect(blocks[1]).toMatchObject({
      kind: "tool_result",
      success: false,
      output: "no match",
    });
  });

  it("ignores unknown frame types", () => {
    const blocks = fold([
      { type: "text_delta", text: "hi" },
      { type: "turn_started", conversation_id: "c1" },
      { type: "metadata" },
      { type: "something_else", message: "heads up" },
    ]);
    expect(blocks).toEqual([{ kind: "text", text: "hi" }]);
  });

  it("renders warning/error frames as notices", () => {
    const blocks = fold([
      { type: "text_delta", text: "hi" },
      { type: "warning", message: "heads up" },
      { type: "error", message: "boom" },
      { type: "warning" },
    ]);
    expect(blocks).toEqual([
      { kind: "text", text: "hi" },
      { kind: "notice", level: "warning", text: "heads up" },
      { kind: "notice", level: "error", text: "boom" },
    ]);
  });

  it("maps persisted blocks back to the UI timeline shape (reload parity)", () => {
    expect(blockFromPersisted({ kind: "text", text: "hi" })).toEqual({
      kind: "text",
      text: "hi",
    });
    expect(blockFromPersisted({ kind: "thinking" })).toEqual({ kind: "thinking" });
    expect(blockFromPersisted({ kind: "thinking", text: "reasoning" })).toEqual({
      kind: "thinking",
      text: "reasoning",
    });
    expect(
      blockFromPersisted({ kind: "tool_call", tool_name: "Read", arguments: { path: "a.ts" } }),
    ).toEqual({
      kind: "tool_call",
      toolName: "Read",
      arguments: JSON.stringify({ path: "a.ts" }, null, 2),
    });
    expect(
      blockFromPersisted({ kind: "tool_result", tool_name: "Read", success: true, output: "ok" }),
    ).toEqual({ kind: "tool_result", toolName: "Read", success: true, output: "ok" });
  });

  it("preserves the AskUserQuestion tool name for UI detection", () => {
    const blocks = fold([
      {
        type: "tool_call",
        tool_name: "AskUserQuestion",
        arguments: { questions: [{ question: "Pick one", options: [{ label: "A" }] }] },
      },
    ]);
    expect(blocks[0]).toMatchObject({ kind: "tool_call", toolName: "AskUserQuestion" });
  });
});

describe("deriveConversationTitle", () => {
  it("uses the first non-empty line, whitespace-collapsed", () => {
    expect(deriveConversationTitle("\n  fix   the  auth bug \nmore")).toBe(
      "fix the auth bug",
    );
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "a".repeat(80);
    const out = deriveConversationTitle(long);
    expect(out.length).toBe(48);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for blank input", () => {
    expect(deriveConversationTitle("")).toBe("");
    expect(deriveConversationTitle("   \n  ")).toBe("");
  });
});

describe("blocksToPlainText", () => {
  it("joins text segments and drops tool/thinking blocks", () => {
    const blocks: TurnBlock[] = [
      { kind: "thinking", text: "reason" },
      { kind: "text", text: "looking" },
      { kind: "tool_call", toolName: "Read" },
      { kind: "tool_result", toolName: "Read", success: true, output: "x" },
      { kind: "text", text: "done" },
    ];
    expect(blocksToPlainText(blocks)).toBe("looking\n\ndone");
  });

  it("returns empty string when there is no prose", () => {
    expect(blocksToPlainText([{ kind: "tool_call", toolName: "Read" }])).toBe("");
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("formatUsage", () => {
  it("renders tokens (compact) and cost", () => {
    expect(formatUsage({ input: 1200, output: 340 }, 0.0123)).toBe(
      "1.2k in · 340 out · $0.0123",
    );
    expect(formatUsage({ input: 15000, output: 2_000_000 }, 1.5)).toBe(
      "15k in · 2.0M out · $1.50",
    );
  });

  it("renders tokens alone when there is no cost", () => {
    expect(formatUsage({ input: 500, output: 50 }, null)).toBe("500 in · 50 out");
    expect(formatUsage({ input: 500, output: 50 }, 0)).toBe("500 in · 50 out");
  });

  it("renders cost alone when there is no usage", () => {
    expect(formatUsage(null, 0.5)).toBe("$0.50");
  });

  it("returns empty string when there is nothing to show", () => {
    expect(formatUsage(null, null)).toBe("");
    expect(formatUsage(undefined, undefined)).toBe("");
  });
});

describe("parseAskQuestions", () => {
  it("parses a valid AskUserQuestion spec", () => {
    const raw = JSON.stringify({
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          multiSelect: false,
          options: [
            { label: "A", description: "first" },
            { label: "B" },
          ],
        },
      ],
    });
    const qs = parseAskQuestions(raw);
    expect(qs).toHaveLength(1);
    expect(qs![0].question).toBe("Which approach?");
    expect(qs![0].options.map((o) => o.label)).toEqual(["A", "B"]);
  });

  it("returns null for an empty questions array", () => {
    expect(parseAskQuestions(JSON.stringify({ questions: [] }))).toBeNull();
  });

  it("returns null for invalid / missing / non-spec input", () => {
    expect(parseAskQuestions(undefined)).toBeNull();
    expect(parseAskQuestions("")).toBeNull();
    expect(parseAskQuestions("not json")).toBeNull();
    expect(parseAskQuestions(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseAskQuestions(JSON.stringify(["a"]))).toBeNull();
  });
});
