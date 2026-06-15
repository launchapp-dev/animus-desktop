# Animus Wisp Design System — Implementation Spec

_Date: 2026-06-15 · Branch: `wisp-design-system`_

## Source

`Animus Wisp Design System.dc.html` from the Claude Design handoff bundle
(`ai-agent-ui/`). Wisp is the **teal flame-spirit mascot** for Animus: a single
SVG character with **knockout eyes** (always the background color punched
through the body, never painted), five canonical expressions, a motion library
with flat fallbacks, a sizing ladder, lockups, and misuse rules. The design
footer's stated next step — repeated across the chat transcripts — is to *wire
Wisp into the masthead + menu-bar with expression states bound to daemon status*.

This spec implements that into the live app (Tauri 2 + React 18 + TypeScript +
Tailwind + CSS-variable tokens).

## Goals

1. A reusable `<Wisp>` React component that is the single source of truth for the
   mark's geometry, expressions, motion, and theming.
2. The **in-app sidebar header** shows the Wisp flame (no wordmark), reactive to
   daemon state.
3. The **macOS menu-bar / tray item** shows the Wisp flame (no "Animus" word),
   reactive to daemon state via per-expression template icons.
4. An in-app **showcase page** reproducing the spec's nine sections, built from
   the real component so the documentation cannot drift from the implementation.
5. Tests covering expression rendering, the knockout-eye law, reduced-motion
   fallback, and the state→expression mapping.

## Non-goals

- No app-wide retheme from copper to teal. Wisp is teal; the rest of the app's
  copper accent and status colors are untouched. (The broader Animus design
  system's "never use copper" guidance is a separate, larger effort.)
- No new product features beyond surfacing daemon state through the mark.

## Decisions (locked)

- **Color:** Wisp is teal in both themes — `#3ed3a4` (dark) / `#1d9e75` (light),
  optional core glow `#aef2da`. Expression accents: amber `#d9a93f`
  (needs-you / working motion lines), red `#f0533a` (failure, rare). New
  Wisp-only CSS tokens; copper is not touched.
- **Sidebar header:** replace the copper dot AND the "Animus" wordmark with the
  Wisp flame mark alone. Reactive.
- **Menu-bar item:** drop the "Animus" word; swap the tray icon per expression.
  Reactive. macOS template images so the OS handles light/dark menu bars.
- **Both surfaces are reactive** (not static — this reversed an earlier call).
- **Tray "working" signal:** emit a new `cycle-started` event to the tray so the
  menu-bar reaches full five-state parity with the sidebar.

## Expression → daemon-state mapping

A single shared derivation drives both surfaces for consistency.

| Daemon / cycle state                  | Wisp expression                 |
|---------------------------------------|---------------------------------|
| Not installed                         | `needs-you`                     |
| Installed, daemon stopped             | `resting`                       |
| Running, no active cycle              | `awake`                         |
| A cycle running                       | `working`                       |
| Cycle just finished green             | `done` (transient → `awake`)    |
| Blocked / awaiting input / failed     | `needs-you`                     |

- `done` lingers ~4s after a green finish, then settles to the resolved steady
  state (`awake` if still running).
- The React side derives from `useDaemonStore` (installed/running) plus the
  active project's cycle status. The Rust/tray side derives from its
  `DaemonStatus` enum (Running/Down/Missing) plus `cycle-started` /
  `cycle-completed` events.

## Architecture

### 1. `<Wisp>` component — `src/components/Wisp.tsx`

The single source of truth for the mark. Real JSX SVG (matching the
`ProviderLogo.tsx` pattern), not a `dangerouslySetInnerHTML` blob, so eyes and
flame can bind to CSS variables.

```tsx
export type WispExpression =
  | "awake" | "working" | "done" | "resting" | "needs-you";

export type WispMotion =
  | "auto"      // pick the motion that matches the expression
  | "breathe" | "blink" | "flicker" | "working"
  | "ignite" | "celebrate" | "thinking" | "alert"
  | "none";     // flat / static

interface WispProps {
  expression?: WispExpression;   // default "awake"
  size?: number;                 // px, default 24
  motion?: WispMotion;           // default "auto"
  mono?: boolean;                // force mono-knockout (tray/small)
  title?: string;                // a11y label; aria-hidden when absent
  className?: string;
}
```

Behavior:

- **Geometry:** the locked flame path
  `M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z`
  on a 64-unit viewBox. Eyes at `(31.5,30)` / `(40.5,30)`, r 2.7.
- **Small-size variant:** below ~24px, use the thickened-eye / fattened-body
  path from the spec's sizing section so the face never closes; at/below 16px
  the mono-knockout form is the only legal one.
- **Knockout eyes:** filled with `var(--wisp-eye)`, which resolves to the
  surface the mark sits on (passed via the consuming context / a wrapper var),
  never a painted color. This is the spec's central law.
- **Expressions** change eye shape + accents per the spec (round eyes; narrowed
  ellipses + motion lines; happy arcs; closed arcs + `z z`; flat eyes + amber
  `!`).
- **Motion** via CSS classes (`wisp wisp--breathe`, etc.). `motion="auto"` maps
  expression→motion (awake→breathe, working→working-lean, done→celebrate,
  resting→breathe-slow, needs-you→alert).
- **Reduced motion:** all keyframes are gated by
  `@media (prefers-reduced-motion: reduce)` → the flat fallback (no animation).

### 2. Styles — `src/styles.css`

- New tokens under `:root` and `:root[data-theme="light"]`:
  `--wisp-flame`, `--wisp-flame-deep`, `--wisp-core`, `--wisp-amber`,
  `--wisp-red`. Mirror the design file's values.
- New keyframes: `wispBreathe`, `wispBlink`, `wispFlicker`, `wispWorkingLean`,
  `wispIgnite`, `wispHop`, `wispThinkOrbit`, `wispAlertPulse`, `wispAlertNudge`
  (ported from the design file's `breathe / ignite / hop / lean / alertPulse /
  alertNudge`). Durations per spec (breathe 3s, working lean 1.4s, etc.).
- All Wisp motion wrapped in a `@media (prefers-reduced-motion: reduce)` block
  that disables animation.

### 3. State derivation — `src/lib/wispExpression.ts`

```ts
export function wispExpressionFromDaemon(args: {
  installed: boolean;
  running: boolean;
  activeCycleStatus?: CycleStatus;   // of the active project
  recentlyPassed?: boolean;          // within the ~4s done window
}): WispExpression
```

Pure function implementing the mapping table. Unit-tested in isolation. Consumed
by the sidebar header; the tray mirrors the same logic in Rust.

### 4. Sidebar header — `src/components/ProjectsRail.tsx` (~374–380)

Replace the static copper dot + "Animus" wordmark with:

```tsx
<Wisp expression={wispExpression} size={20} title="Animus" />
```

`wispExpression` is computed from `useDaemonStore((s) => s.status)` plus the
active project's cycle status via `wispExpressionFromDaemon(...)`, with a ~4s
`done` window managed by a small local timer/hook. The collapse button on the
right is unchanged.

### 5. Menu-bar / tray — `src-tauri/src/tray.rs` + assets

- Add a `WispExpression` enum (awake / working / done / resting / needs-you) and
  a derivation from the existing `DaemonStatus` + cycle events.
- Add `set_icon()` to the tray rebuild path, selecting a pre-rendered
  **mono-knockout** template PNG per expression (16px @1x/@2x), stored under
  `src-tauri/icons/wisp/`.
- Generate those PNGs from the component's mono master via a small build script
  (`scripts/gen-wisp-tray-icons.*`) — verify a rasterizer is available
  (`rsvg-convert` / `sharp` / `resvg`); otherwise commit the generated PNGs.
- Drop the `"Animus"` word from the tray title (icon-only). Keep a tooltip/aria
  label for accessibility.
- **`cycle-started` event:** emit from the bridge/daemon path where cycle events
  originate (mirror of `cycle-completed`) so the tray can enter `working`.
  Wire it in `tray.rs::setup` alongside the existing listeners.

### 6. Showcase page — `src/views/WispShowcase.tsx` + route

- A new pseudo-view selected via `activeProjectId === "wisp"` (mirroring the
  `plugins` / `all-agents` special ids in `Bridge.tsx`), reachable from the
  command palette and/or a sidebar entry.
- Reproduces the spec's nine sections (the mark, construction, color,
  expressions, motion library w/ flat fallbacks, flat set, sizing, lockups,
  misuse) using the real `<Wisp>` component, in both theme contexts.

### 7. Tests — `src/components/Wisp.test.tsx`, `src/lib/wispExpression.test.ts`

- Each expression renders the expected eye/accent markup.
- Knockout eyes resolve to the surface variable, never a painted hex.
- `motion="none"` / reduced-motion yields no animation class.
- `wispExpressionFromDaemon` returns the correct expression for every row of the
  mapping table.

## Risks / open implementation details

- **Rasterizer availability** for tray PNGs — resolved in the plan (detect, else
  commit generated assets).
- **`cycle-started` event source** — confirm the exact Rust/bridge site that
  already emits `cycle-completed` and add the symmetric start emit there.
- **`--wisp-eye` resolution** — the knockout color must equal whatever surface
  the mark sits on (sidebar header bg vs. tile bg in the showcase). Implemented
  by setting `--wisp-eye` on the immediate wrapper.

## Step-by-step build order

1. `<Wisp>` component + tokens + keyframes + reduced-motion (the foundation).
2. `wispExpressionFromDaemon` pure mapping + its test.
3. Sidebar header swap, wired to daemon state.
4. Showcase page + route/palette entry.
5. Tray: `cycle-started` event, Rust expression derivation, `set_icon`,
   generated icon assets, drop the word.
6. Tests + full verification (typecheck, lint, unit tests, build).
