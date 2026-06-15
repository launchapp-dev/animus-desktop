# Animus Wisp Design System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Wisp flame mascot into animus-desktop — a reusable `<Wisp>` component with five expressions + a motion library + reduced-motion flat fallbacks, wired into the sidebar header and the macOS tray icon (both reactive to daemon state), plus an in-app showcase page.

**Architecture:** A single `<Wisp>` React component owns the mark's geometry, expressions, motion, and theming (teal in both modes; knockout eyes bound to a `--wisp-eye` surface variable). A pure `wispExpressionFromDaemon()` function is the single source of truth for state→expression. The sidebar header renders `<Wisp>` driven by that function. The tray is driven from the **frontend** via a new `set_wisp_expression` Tauri command (the frontend already holds full daemon + cycle state, so this is DRY and avoids fragile Rust status parsing — this supersedes the spec's "new cycle-started event" idea). A build script rasterizes the mono master into per-expression tray PNGs.

**Tech Stack:** Tauri 2 (Rust), React 18 + TypeScript, Vite, Tailwind + CSS-variable tokens, Vitest + Testing Library.

---

## File structure

- Create `src/components/Wisp.tsx` — the component (geometry, expressions, motion, knockout eyes).
- Create `src/components/Wisp.test.tsx` — component tests.
- Create `src/lib/wispExpression.ts` — pure state→expression mapping + motion table.
- Create `src/lib/wispExpression.test.ts` — mapping tests.
- Create `src/lib/useWispState.ts` — hook deriving the live expression from stores (+ the ~4s `done` window).
- Create `src/views/WispShowcase.tsx` — the nine-section showcase page.
- Create `scripts/gen-wisp-tray-icons.mjs` — rasterizes the mono master to tray PNGs.
- Create `src-tauri/icons/wisp/*.png` — generated tray icons (committed).
- Modify `src/styles.css` — add Wisp tokens + keyframes + reduced-motion block.
- Modify `src/components/ProjectsRail.tsx` (~371–381) — swap copper dot + wordmark for `<Wisp>`.
- Modify `src/components/Bridge.tsx` (~274–280) — add the `wisp` pseudo-view.
- Modify `src/components/CommandPalette.tsx` (~84–88) — add a "Wisp design system" entry.
- Modify `src/api/_invoke.ts` — typed wrapper for `set_wisp_expression`.
- Modify `src/App.tsx` — mount the tray-sync effect.
- Modify `src-tauri/src/tray.rs` — `WispExpression`, `set_wisp_expression` command, `set_icon`, drop the word.
- Modify `src-tauri/src/lib.rs` (~89–128) — register the new command.

---

## Task 1: Wisp design tokens, keyframes, and reduced-motion in `styles.css`

**Files:**
- Modify: `src/styles.css` (token block near `:root` ~5–172 and `:root[data-theme="light"]` ~174–284; keyframes appended near the existing `@keyframes` ~990)

- [ ] **Step 1: Add Wisp tokens to the dark `:root` block**

Find the `:root {` design-token block (where `--copper` is defined) and add, just after the `--copper*` lines:

```css
  /* Wisp mascot — teal flame, independent of the app copper accent. */
  --wisp-flame: #3ed3a4;
  --wisp-flame-deep: #1d9e75;
  --wisp-core: #aef2da;
  --wisp-amber: #d9a93f;
  --wisp-red: #f0533a;
  --wisp-mono: var(--text);        /* mono-knockout flame fill */
  --wisp-eye: var(--bg);           /* eyes = punch-through to the surface */
```

- [ ] **Step 2: Add the light-mode overrides**

In the `:root[data-theme="light"] {` block, add:

```css
  --wisp-flame: #1d9e75;
  --wisp-flame-deep: #0c8f68;
  --wisp-core: #aef2da;
  --wisp-amber: #b8860b;
  --wisp-red: #f0533a;
  --wisp-mono: var(--text);
  --wisp-eye: var(--bg-canvas);
```

- [ ] **Step 3: Append the Wisp keyframes + classes** (near the other `@keyframes`, e.g. after the `pulse` block ~998)

```css
/* ---- Wisp motion library ------------------------------------------------ */
@keyframes wispBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.055); } }
@keyframes wispFlicker {
  0%, 100% { transform: translateY(0) scaleX(1); }
  50% { transform: translateY(-0.4px) scaleX(1.015); }
}
@keyframes wispLean { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-5deg); } }
@keyframes wispIgnite {
  0% { transform: scale(0) rotate(-12deg); opacity: 0; }
  60% { transform: scale(1.08) rotate(2deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes wispHop {
  0%, 38%, 100% { transform: translateY(0) scaleY(1); }
  12% { transform: translateY(-8%) scaleY(1.04); }
  24% { transform: translateY(0) scaleY(0.94); }
}
@keyframes wispBlink { 0%, 92%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes wispOrbit { to { transform: rotate(360deg); } }
@keyframes wispAlertNudge {
  0%, 60%, 100% { transform: translateX(0); }
  70% { transform: translateX(-2%); }
  80% { transform: translateX(2%); }
  90% { transform: translateX(-1%); }
}
@keyframes wispAlertPulse { 0%, 100% { transform: scale(1); opacity: 0; } 50% { transform: scale(1.5); opacity: 0.55; } }

.wisp-svg { transform-origin: center; overflow: visible; }
.wisp--breathe { animation: wispBreathe 3s ease-in-out infinite; }
.wisp--flicker { animation: wispFlicker 1.6s ease-in-out infinite; }
.wisp--working { animation: wispLean 1.4s ease-in-out infinite; transform-origin: 50% 75%; }
.wisp--ignite  { animation: wispIgnite 0.7s cubic-bezier(0.34,1.56,0.64,1) 1; }
.wisp--celebrate { animation: wispHop 1.8s ease-in-out infinite; transform-origin: 50% 78%; }
.wisp--blink   { animation: wispBlink 4.2s ease-in-out infinite; }
.wisp--alert   { animation: wispAlertNudge 1.4s ease-in-out infinite; }
.wisp__orbit   { animation: wispOrbit 1.3s linear infinite; transform-origin: 32px 31px; }
.wisp__glow    { animation: wispAlertPulse 1.4s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .wisp--breathe, .wisp--flicker, .wisp--working, .wisp--ignite,
  .wisp--celebrate, .wisp--blink, .wisp--alert, .wisp__orbit, .wisp__glow {
    animation: none !important;
  }
}
```

- [ ] **Step 4: Verify the app still builds (CSS only, no runtime check needed)**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no TS errors; CSS is not type-checked but this confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "feat(wisp): add teal flame tokens + motion keyframes with reduced-motion fallback"
```

---

## Task 2: The `<Wisp>` component (TDD)

**Files:**
- Create: `src/components/Wisp.tsx`
- Test: `src/components/Wisp.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Wisp } from "./Wisp";

function svg(container: HTMLElement) {
  return container.querySelector("svg.wisp-svg") as SVGSVGElement;
}

describe("Wisp", () => {
  it("renders an svg with the flame body", () => {
    const { container } = render(<Wisp />);
    const path = container.querySelector("path.wisp__body");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("fill")).toBe("var(--wisp-flame)");
  });

  it("knockout eyes use the surface variable, never a painted hex", () => {
    const { container } = render(<Wisp expression="awake" />);
    const eyes = container.querySelectorAll(".wisp__eye");
    expect(eyes.length).toBeGreaterThan(0);
    eyes.forEach((e) => {
      const fill = e.getAttribute("fill");
      const stroke = e.getAttribute("stroke");
      const paint = fill && fill !== "none" ? fill : stroke;
      expect(paint).toBe("var(--wisp-eye)");
    });
  });

  it("needs-you shows the amber exclamation", () => {
    const { container } = render(<Wisp expression="needs-you" />);
    expect(container.querySelector(".wisp__alert-mark")).not.toBeNull();
  });

  it("auto motion picks breathe for awake and lean for working", () => {
    const a = render(<Wisp expression="awake" motion="auto" />);
    expect(svg(a.container).classList.contains("wisp--breathe")).toBe(true);
    const w = render(<Wisp expression="working" motion="auto" />);
    expect(svg(w.container).querySelector(".wisp__lean")?.classList.contains("wisp--working")).toBe(true);
  });

  it("motion=none renders no animation class", () => {
    const { container } = render(<Wisp expression="awake" motion="none" />);
    const cls = svg(container).getAttribute("class") ?? "";
    expect(cls).not.toMatch(/wisp--/);
  });

  it("mono forces the knockout flame fill", () => {
    const { container } = render(<Wisp mono size={16} />);
    expect(container.querySelector("path.wisp__body")!.getAttribute("fill")).toBe("var(--wisp-mono)");
  });

  it("exposes an accessible label when title is given", () => {
    const { getByRole } = render(<Wisp title="Animus" />);
    expect(getByRole("img", { name: "Animus" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/Wisp.test.tsx`
Expected: FAIL — `Failed to resolve import "./Wisp"`.

- [ ] **Step 3: Implement `src/components/Wisp.tsx`**

```tsx
export type WispExpression =
  | "awake"
  | "working"
  | "done"
  | "resting"
  | "needs-you";

export type WispMotion =
  | "auto"
  | "breathe"
  | "blink"
  | "flicker"
  | "working"
  | "ignite"
  | "celebrate"
  | "thinking"
  | "alert"
  | "none";

interface WispProps {
  expression?: WispExpression;
  size?: number;
  motion?: WispMotion;
  /** Force the mono-knockout flame (tray / favicons / tiny sizes). */
  mono?: boolean;
  /** Accessible label. When omitted the mark is aria-hidden. */
  title?: string;
  className?: string;
}

// Locked geometry. Standard form (>=24px) and a fattened small form whose eyes
// stay open at tiny sizes (the spec's sizing ladder).
const BODY_STD =
  "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";
const BODY_SM =
  "M39 6 C52 13 55 33 46 46 C36 56 18 53 14 40 C10 27 23 24 27 15 C30 7 34 3 39 6 Z";

// expression -> the motion that reads as that state
const MOTION_FOR: Record<WispExpression, Exclude<WispMotion, "auto">> = {
  awake: "breathe",
  working: "working",
  done: "celebrate",
  resting: "breathe",
  "needs-you": "alert",
};

const EYE = "var(--wisp-eye)";
const FLAME = "var(--wisp-flame)";
const AMBER = "var(--wisp-amber)";
const CORE = "var(--wisp-core)";

/** Eye / accent overlay for the standard geometry, per expression. */
function StdEyes({ expression }: { expression: WispExpression }) {
  switch (expression) {
    case "working":
      return (
        <>
          <path
            d="M12 24 h6 M10 33 h6"
            stroke={FLAME}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.5}
          />
          <ellipse className="wisp__eye" cx={32.5} cy={30} rx={2.9} ry={1.7} fill={EYE} />
          <ellipse className="wisp__eye" cx={41.5} cy={30} rx={2.9} ry={1.7} fill={EYE} />
        </>
      );
    case "done":
      return (
        <path
          className="wisp__eye"
          d="M28.5 31 q3 -4.5 6 0 M37.5 31 q3 -4.5 6 0"
          stroke={EYE}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
        />
      );
    case "resting":
      return (
        <>
          <path
            className="wisp__eye"
            d="M28.5 30 q3 2.5 6 0 M37.5 30 q3 2.5 6 0"
            stroke={EYE}
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="none"
          />
          <text x={49} y={19} fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} fill={FLAME} opacity={0.8}>z</text>
          <text x={55} y={11} fontFamily="'JetBrains Mono', monospace" fontSize={8} fontWeight={700} fill={FLAME} opacity={0.5}>z</text>
        </>
      );
    case "needs-you":
      return (
        <>
          <path
            className="wisp__eye"
            d="M28.5 30 h6 M37.5 30 h6"
            stroke={EYE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <g className="wisp__alert-mark">
            <path d="M53 12 v9" stroke={AMBER} strokeWidth={3.5} strokeLinecap="round" />
            <circle cx={53} cy={27} r={2} fill={AMBER} />
          </g>
        </>
      );
    case "awake":
    default:
      return (
        <>
          <circle className="wisp__eye" cx={31.5} cy={30} r={2.7} fill={EYE} />
          <circle className="wisp__eye" cx={40.5} cy={30} r={2.7} fill={EYE} />
        </>
      );
  }
}

export function Wisp({
  expression = "awake",
  size = 24,
  motion = "auto",
  mono = false,
  title,
  className,
}: WispProps) {
  const small = mono || size < 24;
  const flameFill = mono ? "var(--wisp-mono)" : FLAME;
  const resolved: WispMotion = motion === "auto" ? MOTION_FOR[expression] : motion;

  // Root-level motions transform the whole mark; "working" leans an inner group
  // so the streaming motion-lines stay put; "thinking" adds an orbiting spark.
  const rootMotion =
    resolved === "none" || resolved === "working" || resolved === "thinking"
      ? ""
      : `wisp--${resolved}`;
  const leaning = resolved === "working";

  const body = (
    <>
      <path className="wisp__body" d={small ? BODY_SM : BODY_STD} fill={flameFill} />
      {small ? (
        <>
          <circle className="wisp__eye" cx={29} cy={33} r={4.2} fill={EYE} />
          <circle className="wisp__eye" cx={40} cy={33} r={4.2} fill={EYE} />
        </>
      ) : (
        <StdEyes expression={expression} />
      )}
    </>
  );

  return (
    <svg
      className={`wisp-svg ${rootMotion} ${className ?? ""}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {leaning ? <g className="wisp__lean wisp--working">{body}</g> : body}
      {resolved === "thinking" && (
        <g className="wisp__orbit">
          <circle cx={32} cy={6} r={2.3} fill={CORE} />
        </g>
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/components/Wisp.test.tsx`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/Wisp.tsx src/components/Wisp.test.tsx
git commit -m "feat(wisp): Wisp component with five expressions, motion library, knockout eyes"
```

---

## Task 3: `wispExpressionFromDaemon` pure mapping (TDD)

**Files:**
- Create: `src/lib/wispExpression.ts`
- Test: `src/lib/wispExpression.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/wispExpression.test.ts`
Expected: FAIL — cannot resolve `./wispExpression`.

- [ ] **Step 3: Implement `src/lib/wispExpression.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/wispExpression.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wispExpression.ts src/lib/wispExpression.test.ts
git commit -m "feat(wisp): pure daemon-state -> expression mapping"
```

---

## Task 4: `useWispState` hook (live expression from stores)

**Files:**
- Create: `src/lib/useWispState.ts`

- [ ] **Step 1: Implement the hook**

```ts
import { useEffect, useRef, useState } from "react";
import { useDaemonStore } from "../state/daemon";
import { useActiveProject } from "../state/activeProject";
import { useProjectsStore } from "../state/projects";
import { wispExpressionFromDaemon } from "./wispExpression";
import type { WispExpression } from "../components/Wisp";

const DONE_WINDOW_MS = 4000;

/**
 * Derives the live Wisp expression from daemon + active-project cycle status,
 * holding "done" for a short celebration window after a green finish.
 */
export function useWispState(): WispExpression {
  const status = useDaemonStore((s) => s.status);
  const activeId = useActiveProject((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);

  const project = projects.find((p) => p.id === activeId);
  const cycleStatus = project?.last_cycle?.status;

  const [recentlyPassed, setRecentlyPassed] = useState(false);
  const prev = useRef<typeof cycleStatus>(undefined);

  useEffect(() => {
    if (prev.current === "running" && cycleStatus === "passed") {
      setRecentlyPassed(true);
      const t = setTimeout(() => setRecentlyPassed(false), DONE_WINDOW_MS);
      prev.current = cycleStatus;
      return () => clearTimeout(t);
    }
    prev.current = cycleStatus;
  }, [cycleStatus]);

  return wispExpressionFromDaemon({
    installed: status?.installed ?? false,
    running: status?.running ?? false,
    activeCycleStatus: cycleStatus,
    recentlyPassed,
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. If `last_cycle`/`status` shape differs, open `src/types/contracts.ts`, confirm `Project.last_cycle?.status: CycleStatus`, and adjust the accessor.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useWispState.ts
git commit -m "feat(wisp): useWispState hook with the done celebration window"
```

---

## Task 5: Sidebar header — render Wisp, drop the wordmark

**Files:**
- Modify: `src/components/ProjectsRail.tsx` (imports near top; header ~371–381)

- [ ] **Step 1: Add imports** (near the other component imports, ~line 14–26)

```tsx
import { Wisp } from "./Wisp";
import { useWispState } from "../lib/useWispState";
```

- [ ] **Step 2: Compute the expression inside the `ProjectsRail` component body** (just after the existing hook calls, before the `return`)

```tsx
  const wispExpression = useWispState();
```

- [ ] **Step 3: Replace the copper dot + wordmark** (current `ProjectsRail.tsx:373–381`)

Replace:

```tsx
            <span
              aria-hidden
              className="inline-block size-[9px] rounded-full bg-[var(--copper)] shrink-0 shadow-[0_0_8px_rgba(217,119,87,0.55)]"
            />
            <span className="font-[var(--font-display)] text-[15px] font-semibold tracking-[-0.02em] text-sidebar-foreground">
              Animus
            </span>
```

With (the mark alone, no wordmark; `--wisp-eye` set to the sidebar surface so the eyes knock out correctly):

```tsx
            <span
              className="inline-flex shrink-0"
              style={{ ["--wisp-eye" as string]: "var(--sidebar-bg)" }}
            >
              <Wisp expression={wispExpression} size={22} title="Animus" />
            </span>
```

- [ ] **Step 4: Verify typecheck + existing rail tests**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components`
Expected: PASS. If a `--sidebar-bg` token doesn't exist, grep `styles.css` for the sidebar surface var (e.g. `--sidebar-background`) and use that.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProjectsRail.tsx
git commit -m "feat(wisp): sidebar header shows the Wisp mark, reactive to daemon state"
```

---

## Task 6: Showcase page + route + palette entry

**Files:**
- Create: `src/views/WispShowcase.tsx`
- Modify: `src/components/Bridge.tsx` (~274–280, add the pseudo-view; import at top)
- Modify: `src/components/CommandPalette.tsx` (~84–88, add an action)

- [ ] **Step 1: Create `src/views/WispShowcase.tsx`**

```tsx
import { Wisp, type WispExpression } from "../components/Wisp";

const EXPRESSIONS: { key: WispExpression; label: string; note: string }[] = [
  { key: "awake", label: "AWAKE", note: "daemon idle · ready" },
  { key: "working", label: "WORKING", note: "cycle running · focused" },
  { key: "done", label: "DONE", note: "cycle green · pleased" },
  { key: "resting", label: "RESTING", note: "nothing scheduled" },
  { key: "needs-you", label: "NEEDS YOU", note: "blocked · waiting" },
];

const MOTIONS = ["breathe", "flicker", "working", "ignite", "celebrate", "blink", "thinking", "alert"] as const;

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--wisp-flame)" }}>{id} · {title}</span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{blurb}</span>
      </div>
      {children}
    </section>
  );
}

const tile: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--line, rgba(255,255,255,0.08))",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  // eyes knock out to the tile surface
  ["--wisp-eye" as string]: "var(--surface-1)",
};

export function WispShowcase() {
  return (
    <div style={{ padding: "24px 28px 80px", color: "var(--text)", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Wisp</h1>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 28px", maxWidth: 760, lineHeight: 1.6 }}>
        The spirit that does the work. One character — five faces, a motion library with flat fallbacks, and the rules that keep it consistent from a 16px tray glyph to a hero.
      </p>

      <Section id="01" title="THE MARK" blurb="The hero, breathing.">
        <div style={{ ...tile, padding: 40, alignSelf: "flex-start", width: 220 }}>
          <Wisp expression="awake" size={140} title="Wisp" />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--wisp-flame)" }}>FLAME · #3ed3a4 / #1d9e75</span>
        </div>
      </Section>

      <Section id="04" title="EXPRESSION SYSTEM" blurb="The daemon's state is Wisp's face.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 11 }}>
          {EXPRESSIONS.map((e) => (
            <div key={e.key} style={tile}>
              <Wisp expression={e.key} size={84} motion="none" />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: "var(--wisp-flame)" }}>{e.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>{e.note}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="05" title="MOTION LIBRARY" blurb="Live animation · flat fallback under reduced motion.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {MOTIONS.map((m) => (
            <div key={m} style={tile}>
              <Wisp expression={m === "alert" ? "needs-you" : m === "working" ? "working" : m === "celebrate" ? "done" : "awake"} size={66} motion={m} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: "var(--text)" }}>{m.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="07" title="SIZING" blurb="512 → 16px. Eyes thicken as it shrinks.">
        <div style={{ ...tile, flexDirection: "row", alignItems: "flex-end", gap: 28, alignSelf: "flex-start" }}>
          {[96, 48, 32, 22, 16].map((s) => (
            <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <Wisp expression="awake" size={s} motion="none" mono={s <= 16} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--text-faint)" }}>{s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="08" title="LOCKUPS" blurb="Wisp + wordmark.">
        <div style={{ ...tile, flexDirection: "row", gap: 11, alignSelf: "flex-start", padding: "18px 22px" }}>
          <Wisp expression="awake" size={30} motion="none" />
          <span style={{ fontSize: 20, fontWeight: 700 }}>animus</span>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Wire the pseudo-view in `Bridge.tsx`**

Add the import near the other view imports (~line 7–20):

```tsx
import { WispShowcase } from "../views/WispShowcase";
```

Add the branch just after the `activeId === "plugins"` block (~280):

```tsx
  if (activeId === "wisp") {
    return (
      <BridgeFrame title="Wisp design system">
        <WispShowcase />
      </BridgeFrame>
    );
  }
```

- [ ] **Step 3: Add a Command Palette entry in `CommandPalette.tsx`**

After the "Open Settings" `CommandItem` (~84–88), add:

```tsx
          <CommandItem
            onSelect={() => runAndClose(() => setActiveProject("wisp"))}
          >
            <SettingsIcon className="text-text-muted" />
            <span>Wisp design system</span>
          </CommandItem>
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components`
Expected: PASS. (`ActiveProjectId` is `string | …`, so `"wisp"` is already an accepted id — no type change needed.)

- [ ] **Step 5: Commit**

```bash
git add src/views/WispShowcase.tsx src/components/Bridge.tsx src/components/CommandPalette.tsx
git commit -m "feat(wisp): in-app Wisp design-system showcase page + palette entry"
```

---

## Task 7: Generate tray icon assets

**Files:**
- Create: `scripts/gen-wisp-tray-icons.mjs`
- Create (generated): `src-tauri/icons/wisp/{awake,working,done,resting,needs-you}{,@2x}.png`

- [ ] **Step 1: Check for a rasterizer**

Run: `pnpm ls sharp 2>/dev/null; which rsvg-convert resvg 2>/dev/null`
Expected: note which is available. If `sharp` is not installed, run `pnpm add -D sharp` (it ships prebuilt binaries) — this is the most portable choice.

- [ ] **Step 2: Write `scripts/gen-wisp-tray-icons.mjs`**

Renders the **mono-knockout** flame (black flame, transparent knockout eyes) per expression at 16 and 32px. macOS template images are black-on-transparent; the OS recolors for light/dark menu bars.

```js
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "wisp");
const BODY = "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";

// Eyes/accents as transparent knockout cut from the black body via an SVG mask.
const EYES = {
  awake: `<circle cx="31.5" cy="30" r="2.7"/><circle cx="40.5" cy="30" r="2.7"/>`,
  working: `<ellipse cx="32.5" cy="30" rx="2.9" ry="1.7"/><ellipse cx="41.5" cy="30" rx="2.9" ry="1.7"/>`,
  done: `<path d="M28.5 31 q3 -4.5 6 0 M37.5 31 q3 -4.5 6 0" stroke="#000" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  resting: `<path d="M28.5 30 q3 2.5 6 0 M37.5 30 q3 2.5 6 0" stroke="#000" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  "needs-you": `<path d="M28.5 30 h6 M37.5 30 h6" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>`,
};

function svg(expr) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="#000" stroke="#000">${EYES[expr]}</g></mask>
    <path d="${BODY}" fill="#000" mask="url(#m)"/>
  </svg>`;
}

await mkdir(OUT, { recursive: true });
for (const expr of Object.keys(EYES)) {
  for (const [suffix, px] of [["", 16], ["@2x", 32]]) {
    await sharp(Buffer.from(svg(expr))).resize(px, px).png().toFile(join(OUT, `${expr}${suffix}.png`));
  }
}
console.log("wisp tray icons written to", OUT);
```

- [ ] **Step 3: Run the generator**

Run: `node scripts/gen-wisp-tray-icons.mjs`
Expected: prints the output path; `ls src-tauri/icons/wisp` shows 10 PNGs.

- [ ] **Step 4: Add an npm script for regeneration** (in `package.json` `scripts`)

```json
    "gen:wisp-icons": "node scripts/gen-wisp-tray-icons.mjs",
```

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-wisp-tray-icons.mjs src-tauri/icons/wisp package.json
git commit -m "feat(wisp): generate mono-knockout tray icons per expression"
```

---

## Task 8: Tray command + reactive icon (Rust)

**Files:**
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs` (~89–128 invoke_handler)

- [ ] **Step 1: Add the `WispExpression` enum + icon bytes in `tray.rs`** (near the top, after the `DaemonStatus` enum)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WispExpression {
    Awake,
    Working,
    Done,
    Resting,
    NeedsYou,
}

impl WispExpression {
    fn icon_bytes(self) -> &'static [u8] {
        match self {
            WispExpression::Awake => include_bytes!("../icons/wisp/awake@2x.png"),
            WispExpression::Working => include_bytes!("../icons/wisp/working@2x.png"),
            WispExpression::Done => include_bytes!("../icons/wisp/done@2x.png"),
            WispExpression::Resting => include_bytes!("../icons/wisp/resting@2x.png"),
            WispExpression::NeedsYou => include_bytes!("../icons/wisp/needs-you@2x.png"),
        }
    }
}
```

- [ ] **Step 2: Add the command** (anywhere in `tray.rs` after `setup`)

Drops the "Animus" word (icon-only title) and swaps the template icon.

```rust
#[tauri::command]
pub fn set_wisp_expression(handle: AppHandle, expression: WispExpression) -> Result<(), String> {
    let tray = handle
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray not found".to_string())?;
    let image = tauri::image::Image::from_bytes(expression.icon_bytes())
        .map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(true).map_err(|e| e.to_string())?;
    tray.set_title(None::<&str>).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Set a sensible default icon at startup** — in `setup`, after the tray is built (~99), add:

```rust
    if let Some(tray) = app.handle().tray_by_id(TRAY_ID) {
        if let Ok(image) = tauri::image::Image::from_bytes(WispExpression::Resting.icon_bytes()) {
            let _ = tray.set_icon(Some(image));
            let _ = tray.set_icon_as_template(true);
            let _ = tray.set_title(None::<&str>);
        }
    }
```

- [ ] **Step 4: Register the command in `lib.rs`** — add to the `generate_handler!` list (~128, after `tray` is already a module):

```rust
            tray::set_wisp_expression,
```

- [ ] **Step 5: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS. If `Image::from_bytes` path differs by Tauri minor version, use `tauri::image::Image::from_path` against the icon files instead (they're in the bundle).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/lib.rs
git commit -m "feat(wisp): tray exposes set_wisp_expression, swaps template icon, drops the word"
```

---

## Task 9: Drive the tray from the frontend

**Files:**
- Modify: `src/api/_invoke.ts` (add a typed wrapper)
- Modify: `src/App.tsx` (mount a sync effect)

- [ ] **Step 1: Add the invoke wrapper in `_invoke.ts`** (near the other `export async function` wrappers)

```ts
export async function setWispExpression(expression: string): Promise<void> {
  // No-ops outside Tauri (vitest/browser) and if the command isn't built yet.
  await safeInvoke<void>("set_wisp_expression", undefined, { expression });
}
```

If `safeInvoke`'s signature differs, match it: open `_invoke.ts`, read the `safeInvoke<T>(cmd, fallback?, args?)` shape, and pass `{ expression }` as the args object Tauri expects.

- [ ] **Step 2: Add a `useWispTray` effect** — create `src/lib/useWispTray.ts`:

```ts
import { useEffect } from "react";
import { setWispExpression } from "../api/_invoke";
import { useWispState } from "./useWispState";

/** Pushes the canonical Wisp expression to the macOS tray whenever it changes. */
export function useWispTray(): void {
  const expression = useWispState();
  useEffect(() => {
    void setWispExpression(expression);
  }, [expression]);
}
```

- [ ] **Step 3: Mount it in `App.tsx`** — inside `AppShell`, after the existing hooks (e.g. after the `useHotkeys` calls, before the early `popup` return):

```tsx
  useWispTray();
```

And import at the top:

```tsx
import { useWispTray } from "./lib/useWispTray";
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: PASS (all unit tests green; tray invoke is a no-op under vitest).

- [ ] **Step 5: Commit**

```bash
git add src/api/_invoke.ts src/lib/useWispTray.ts src/App.tsx
git commit -m "feat(wisp): sync tray icon to live daemon state from the frontend"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Lint** (if configured)

Run: `pnpm run lint` (skip if no lint script exists)
Expected: PASS / no new errors.

- [ ] **Step 3: Unit tests**

Run: `pnpm exec vitest run`
Expected: PASS — including `Wisp.test.tsx` (7) and `wispExpression.test.ts` (7).

- [ ] **Step 4: Rust check**

Run: `cd src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 5: Frontend build**

Run: `pnpm run build`
Expected: PASS (Vite + tsc build succeeds).

- [ ] **Step 6: Manual smoke (optional, requires a desktop session)**

Run: `pnpm tauri dev`
Confirm: sidebar header shows the teal flame (no "Animus" word); the menu-bar item is the flame icon with no "Animus" word; toggling the daemon stopped/running flips the face resting↔awake; the command palette → "Wisp design system" opens the showcase; macOS reduced-motion freezes the flat form.

- [ ] **Step 7: Final commit (only if anything was tidied in this task)**

```bash
git add -A && git commit -m "chore(wisp): verification pass"
```

---

## Self-review notes

- **Spec coverage:** component (T2), tokens/motion/reduced-motion (T1), mapping (T3) + live hook (T4), sidebar header no-wordmark reactive (T5), showcase nine-ish sections (T6), tray reactive icon-only (T7–T9), tests (T2/T3) + full verify (T10). All spec sections map to a task.
- **Deviation from spec:** the tray is driven from the frontend via `set_wisp_expression` rather than a new Rust `cycle-started` event — same user-visible outcome (full five-state tray incl. `working`), DRY (one mapping), less plumbing, and works while the window is hidden. Flagged to the user at plan handoff.
- **Type consistency:** `WispExpression` is defined once in `Wisp.tsx` and imported by `wispExpression.ts`, `useWispState.ts`, `WispShowcase.tsx`; the Rust `WispExpression` serializes kebab-case to match the TS string union (`"needs-you"`).
- **Knockout-eye law:** every consumer sets `--wisp-eye` to its own surface; the component never paints eyes with a hex.
