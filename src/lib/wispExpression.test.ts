import { describe, it, expect } from "vitest";
import { wispExpressionFromDaemon } from "./wispExpression";

describe("wispExpressionFromDaemon", () => {
  it("not installed -> needs-you", () => {
    expect(wispExpressionFromDaemon({ installed: false, running: false })).toBe("needs-you");
  });
  it("installed but stopped -> resting", () => {
    expect(wispExpressionFromDaemon({ installed: true, running: false })).toBe("resting");
  });
  it("running, idle -> awake", () => {
    expect(wispExpressionFromDaemon({ installed: true, running: true })).toBe("awake");
  });
  it("running with a cycle in progress -> working", () => {
    expect(
      wispExpressionFromDaemon({ installed: true, running: true, activeCycleStatus: "running" }),
    ).toBe("working");
  });
  it("recently passed -> done", () => {
    expect(
      wispExpressionFromDaemon({ installed: true, running: true, activeCycleStatus: "passed", recentlyPassed: true }),
    ).toBe("done");
  });
  it("failed cycle -> needs-you", () => {
    expect(
      wispExpressionFromDaemon({ installed: true, running: true, activeCycleStatus: "failed" }),
    ).toBe("needs-you");
  });
  it("passed but past the done window -> awake", () => {
    expect(
      wispExpressionFromDaemon({ installed: true, running: true, activeCycleStatus: "passed", recentlyPassed: false }),
    ).toBe("awake");
  });
});
