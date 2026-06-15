import type { CycleStatus } from "../types/contracts";
import type { WispExpression } from "../components/Wisp";

export interface WispStateInput {
  installed: boolean;
  running: boolean;
  /** Status of the active project's most relevant cycle, if any. */
  activeCycleStatus?: CycleStatus;
  /** True while inside the brief post-pass "done" celebration window. */
  recentlyPassed?: boolean;
}

/**
 * Single source of truth: daemon + cycle state -> Wisp's face. Mirrored by the
 * tray, which is driven from the value this returns (see useWispState).
 */
export function wispExpressionFromDaemon(s: WispStateInput): WispExpression {
  if (!s.installed) return "needs-you";
  if (!s.running) return "resting";
  switch (s.activeCycleStatus) {
    case "running":
      return "working";
    case "failed":
      return "needs-you";
    case "passed":
      return s.recentlyPassed ? "done" : "awake";
    default:
      return "awake";
  }
}
