import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Markdown.tsx imports this for external links; stub it so jsdom doesn't touch Tauri.
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { TurnTimeline } from "./TurnTimeline";
import type { TurnBlock } from "../views/project/chatProtocol";

const noop = () => {};

function renderTimeline(blocks: TurnBlock[]) {
  return render(
    <TurnTimeline blocks={blocks} running={false} interactive onAnswer={noop} />,
  );
}

describe("TurnTimeline", () => {
  it("renders assistant prose", () => {
    renderTimeline([{ kind: "text", text: "Hello world" }]);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("thinking is a disclosure: reasoning hidden until expanded", async () => {
    renderTimeline([{ kind: "thinking", text: "secret reasoning" }]);
    expect(screen.getByText("thought")).toBeInTheDocument();
    expect(screen.queryByText("secret reasoning")).toBeNull();
    await userEvent.click(screen.getByText("thought"));
    expect(screen.getByText("secret reasoning")).toBeInTheDocument();
  });

  it("tool block hides its detail until expanded (diff body)", async () => {
    renderTimeline([
      {
        kind: "tool_result",
        toolName: "Edit",
        success: true,
        output: "-old line\n+new line\n-x\n+y",
      },
    ]);
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-view")).toBeNull();
    await userEvent.click(screen.getByText("Edit"));
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });

  it("routes an AskUserQuestion tool_call to the interactive AskCard", () => {
    const spec = JSON.stringify({
      questions: [{ question: "Pick one", options: [{ label: "Yes" }] }],
    });
    renderTimeline([
      { kind: "tool_call", toolName: "AskUserQuestion", arguments: spec },
    ]);
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("renders a plain tool_call with its name", () => {
    renderTimeline([
      { kind: "tool_call", toolName: "Read", arguments: '{"path":"a.ts"}' },
    ]);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });
});
