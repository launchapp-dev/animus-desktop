import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Markdown.tsx imports this for external links; stub it so jsdom doesn't touch Tauri.
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { AnimusStub } from "./AnimusStubs";
import { Markdown } from "./Markdown";
import { TurnTimeline } from "./TurnTimeline";

const fence = (lang: string, body: string) =>
  "```" + lang + "\n" + body + "\n```";

describe("AnimusStub", () => {
  it("renders a team with member roles and status pills", () => {
    render(
      <AnimusStub
        type="team"
        raw={JSON.stringify({
          name: "Core Eng",
          members: [
            { id: "swe", role: "software_engineer", tool: "claude", status: "running" },
            { id: "po", role: "product_owner" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Core Eng")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("swe")).toBeInTheDocument();
    expect(screen.getByText("software_engineer")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders an org tree and caps depth", () => {
    const deep = { name: "L5" };
    const node = {
      name: "Daemon",
      meta: "orchestrator",
      children: [
        { name: "L2", children: [{ name: "L3", children: [{ name: "L4", children: [deep] }] }] },
      ],
    };
    render(<AnimusStub type="org" raw={JSON.stringify(node)} />);
    expect(screen.getByText("Daemon")).toBeInTheDocument();
    expect(screen.getByText("L4")).toBeInTheDocument();
    expect(screen.queryByText("L5")).toBeNull();
  });

  it("renders mcp server cards", () => {
    render(
      <AnimusStub
        type="mcp"
        raw={JSON.stringify({
          servers: [{ name: "animus", transport: "stdio", status: "connected", tools: 42 }],
        })}
      />,
    );
    expect(screen.getByText("animus")).toBeInTheDocument();
    expect(screen.getByText("stdio")).toBeInTheDocument();
    expect(screen.getByText("42 tools")).toBeInTheDocument();
  });

  it("renders progress with value/max", () => {
    render(
      <AnimusStub
        type="progress"
        raw={JSON.stringify({ label: "Queue drain", value: 7, max: 10 })}
      />,
    );
    expect(screen.getByText("Queue drain")).toBeInTheDocument();
    expect(screen.getByText("7 / 10")).toBeInTheDocument();
  });

  it("renders a scorecard with stats, level and streak", () => {
    render(
      <AnimusStub
        type="scorecard"
        raw={JSON.stringify({
          title: "This week",
          stats: [{ label: "Runs", value: 12, delta: "+4" }],
          level: { name: "Operator II", xp: 120, next: 200 },
          streak: 3,
        })}
      />,
    );
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("Operator II")).toBeInTheDocument();
    expect(screen.getByText("120 / 200 XP")).toBeInTheDocument();
    // Streak renders a Flame icon followed by the count.
    expect(
      document.querySelector(".ast-streak")?.textContent?.trim(),
    ).toBe("3");
  });

  it("renders status tiles", () => {
    render(
      <AnimusStub
        type="status"
        raw={JSON.stringify({
          tiles: [{ label: "Daemon", value: "running", state: "ok", hint: "pid 4211" }],
        })}
      />,
    );
    expect(screen.getByText("Daemon")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("pid 4211")).toBeInTheDocument();
  });

  it("falls back to a code block on malformed JSON, unknown type, or non-object", () => {
    const { container, rerender } = render(
      <AnimusStub type="team" raw='{"name": "broken' />,
    );
    expect(container.querySelector("pre.ast-fallback")).not.toBeNull();

    rerender(<AnimusStub type="leaderboard" raw='{"a":1}' />);
    expect(container.querySelector("pre.ast-fallback")).not.toBeNull();

    rerender(<AnimusStub type="team" raw="[1,2,3]" />);
    expect(container.querySelector("pre.ast-fallback")).not.toBeNull();
  });

  it("survives missing optional fields", () => {
    const { container } = render(<AnimusStub type="team" raw="{}" />);
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("Markdown stub fences", () => {
  it("renders an animus:team fence as a card, not a <pre>", () => {
    const { container } = render(
      <Markdown>
        {fence("animus:team", JSON.stringify({ name: "Squad", members: [{ id: "swe" }] }))}
      </Markdown>,
    );
    expect(screen.getByText("Squad")).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("accepts dash/case variants of the fence tag", () => {
    render(
      <Markdown>
        {fence("animus-status", JSON.stringify({ tiles: [{ label: "Daemon", value: "up" }] }))}
      </Markdown>,
    );
    expect(screen.getByText("Daemon")).toBeInTheDocument();
  });

  it("leaves an unterminated fence as a code block while streaming", () => {
    const { container } = render(
      <Markdown>{'```animus:team\n{"name": "Squa'}</Markdown>,
    );
    expect(container.querySelector("pre")).not.toBeNull();
    expect(screen.queryByText("Squa")).toBeNull();
  });

  it("still highlights regular code fences", () => {
    const { container } = render(
      <Markdown>{fence("js", "const x = 1;")}</Markdown>,
    );
    const code = container.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("language-js");
  });
});

describe("TurnTimeline stub integration", () => {
  it("renders a stub inside an assistant text block", () => {
    render(
      <TurnTimeline
        blocks={[
          {
            kind: "text",
            text:
              "Here's the team:\n\n" +
              fence("animus:team", JSON.stringify({ name: "Ops", members: [] })),
          },
        ]}
        running={false}
        interactive
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });
});
