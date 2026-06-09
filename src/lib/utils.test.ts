import { describe, it, expect } from "vitest";
import {
  relativeTime,
  conversationMatches,
  isDiffText,
  diffLineKind,
  nextNavIndex,
} from "./utils";

// Build an ISO timestamp `ms` in the past relative to now, so assertions stay
// deterministic without mocking the clock.
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("returns empty string for null or unparseable input", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime("not a date")).toBe("");
  });

  it("renders sub-minute as 'now'", () => {
    expect(relativeTime(ago(5 * SEC))).toBe("now");
  });

  it("renders minutes / hours / days", () => {
    expect(relativeTime(ago(5 * MIN))).toBe("5m");
    expect(relativeTime(ago(3 * HOUR))).toBe("3h");
    expect(relativeTime(ago(2 * DAY))).toBe("2d");
  });

  it("renders weeks then months at the high end", () => {
    expect(relativeTime(ago(3 * 7 * DAY))).toBe("3w");
    expect(relativeTime(ago(60 * DAY))).toBe("2mo");
  });
});

describe("conversationMatches", () => {
  const c = { title: "Fix the auth bug", projectName: "auth-main", tool: "codex" };

  it("matches everything on an empty/whitespace query", () => {
    expect(conversationMatches(c, "")).toBe(true);
    expect(conversationMatches(c, "   ")).toBe(true);
  });

  it("matches title, project name, and tool case-insensitively", () => {
    expect(conversationMatches(c, "AUTH BUG")).toBe(true);
    expect(conversationMatches(c, "auth-main")).toBe(true);
    expect(conversationMatches(c, "codex")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(conversationMatches(c, "deploy")).toBe(false);
  });

  it("handles a null title", () => {
    expect(conversationMatches({ ...c, title: null }, "fix")).toBe(false);
    expect(conversationMatches({ ...c, title: null }, "auth-main")).toBe(true);
  });
});

describe("isDiffText", () => {
  it("detects a unified diff with hunk headers", () => {
    const diff = `@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;`;
    expect(isDiffText(diff)).toBe(true);
  });

  it("detects a `diff --git` header", () => {
    expect(isDiffText("diff --git a/x.ts b/x.ts\n+added\n-removed")).toBe(true);
  });

  it("detects edit-style +/- blocks without hunk headers", () => {
    expect(isDiffText("-old line\n+new line\n-another\n+another2")).toBe(true);
  });

  it("does not flag a markdown list (only one sign)", () => {
    expect(isDiffText("- item one\n- item two\n- item three")).toBe(false);
  });

  it("does not flag prose", () => {
    expect(isDiffText("This is a normal sentence.\nAnd another line.")).toBe(false);
  });
});

describe("nextNavIndex", () => {
  it("enters the list from outside (down → first, up → stays out)", () => {
    expect(nextNavIndex(-1, 5, 1)).toBe(0);
    expect(nextNavIndex(-1, 5, -1)).toBe(-1);
  });

  it("moves and clamps at both ends", () => {
    expect(nextNavIndex(0, 5, 1)).toBe(1);
    expect(nextNavIndex(2, 5, -1)).toBe(1);
    expect(nextNavIndex(0, 5, -1)).toBe(0);
    expect(nextNavIndex(4, 5, 1)).toBe(4);
  });

  it("returns -1 for an empty list", () => {
    expect(nextNavIndex(0, 0, 1)).toBe(-1);
  });
});

describe("diffLineKind", () => {
  it("classifies hunk, add, del, and context lines", () => {
    expect(diffLineKind("@@ -1 +1 @@")).toBe("hunk");
    expect(diffLineKind("diff --git a b")).toBe("hunk");
    expect(diffLineKind("+added")).toBe("add");
    expect(diffLineKind("-removed")).toBe("del");
    expect(diffLineKind(" context")).toBe("ctx");
    expect(diffLineKind("+++ b/file")).toBe("ctx");
    expect(diffLineKind("--- a/file")).toBe("ctx");
  });
});
