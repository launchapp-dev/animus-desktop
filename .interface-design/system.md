# Animus Desktop — Interface Design System

## Direction

**Operations bridge** — a command deck for a small crew of AI specialists.
Not a dashboard, not an IDE, not a chat app. The metaphor is air-traffic
control / trading floor / command tent: one operator overseeing many
parallel specialists, glanceable status everywhere, conversational +
structured info coexisting.

## Palette

Industrial control-room: slate housings, copper warning lamps, phosphor
"all clear," brass affordance, bone paper-and-leather text.

| Token | Hex | Role |
|---|---|---|
| `--slate` | `#0c0f14` | Deep canvas behind vibrancy |
| `--copper` | `#d97757` | Accent — active selections, primary CTAs, user's own journal entries |
| `--phosphor` | `#8ee29a` | Healthy-pass states (desaturated green that reads on glass) |
| `--brass` | `#e6b34c` | Action affordance, secondary CTAs |
| `--crimson` | `#f0533a` | Alerts, failed states |
| `--bone` | `#eee8e0` | Body text (warm-tinged white) |

**Status colors:** keep the existing greens/reds/yellows for cycle state,
add `phosphor` as a softer "ok" for glass surfaces.

## Typography

Two families. Mono is signature.

| Role | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Display (watchstrip title, screen header) | JetBrains Mono | 13 | 600 | 0 |
| H1 (mode label) | JetBrains Mono | 12 | 600 | 0.04em |
| Body | SF Pro Text | 12.5 | 400 | 0 |
| Body emphasis | SF Pro Text | 12.5 | 600 | 0 |
| Metadata | SF Pro Text | 11 | 400 | 0 |
| Section label (uppercase) | SF Pro Text | 10 | 600 | 0.08em |
| Data / IDs / paths | SF Mono | 11 | 400 | 0 |
| Watchstrip glyph | SF Mono | 9 | 600 | 0.05em |

Mono for headers is the typographic signature — operations consoles use
stencil/mono labels, not humanist sans.

## Spacing

Base `4px`. Scale: `2 / 4 / 6 / 8 / 12 / 16 / 24 / 32 / 48`. Most padding
at `6` (control internal), `10` (row), `16` (card), `24` (section).

## Depth — borders-only

Hairline `0.5px solid rgba(255,255,255,0.08)`. No shadows except on
modals/command-palette (subtle). The squint test passes via translucency
+ hairline alone.

## Surface elevation

5 levels of translucency. Each step ~5% lightness. Quiet hierarchy that
emerges only when surfaces stack.

| Level | rgba | Use |
|---|---|---|
| 0 | `transparent` | Canvas |
| 1 | `rgba(13,17,23,0.55)` | Watchstrip, rail, status bar |
| 2 | `rgba(13,17,23,0.85)` | Bridge content |
| 3 | `rgba(48,54,61,0.40)` | Cards |
| 4 | `rgba(64,71,79,0.45)` | Popovers, dropdowns |
| 5 | shadow + `rgba(28,33,42,0.95)` | Modals, command palette |

## Border radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `4px` | Inputs, small buttons, segments |
| `--radius` | `5px` | Cards, popovers (Mac Sequoia sheet radius) |
| `--radius-lg` | `8px` | Modals |

## Signature: the Watchstrip

A 14px-tall horizontal status ribbon at the top of the window. One
~36×12 segment per project, 2px gap. Segment fill = current cycle status
color. Active project gets a 2px copper inset border on the bottom.

- Hover → tiny popover above with project name + last cycle ago
- Click → swap active project
- `+` segment at far right = add project
- Overflow projects collapse to `···` segment
- Bottom edge = hairline border separating from rail/bridge

**Glanceable wall-of-monitors awareness without losing context.** Nobody
else does this — Codex's three-pane and Hermes's left-sidebar both bury
per-project status one click away.

## Layout — three zones plus chrome

```
+========== watchstrip (14) ===================================+
+-----+--------------------------------+-----------------------+
| rail| bridge                          | command pane         |
| 180 |  +--Journal+Workflows+Secrets+Plugins+                 |
|     |                                  | (contextual:        |
|     | content streams here             |  cycle progress     |
|     |                                  |  YAML editor        |
|     | +--composer (when Journal)----+ |  log stream)        |
|     | | Ask my-saas-app…           | |                     |
|     | +----------------------------+ | (collapsible, ⌘J)   |
+-----+--------------------------------+-----------------------+
| status bar (22) — daemon · queue · auth · ⌘K · now serving   |
+==============================================================+
```

- Watchstrip top, 14px
- Projects rail left, 180px — identity only (no nav, no status pills)
- Bridge center, flex — mode tabs switch what's shown
- Command pane right, 320px collapsible — verb-mode contents (cycle drill / YAML / log stream)
- Status bar bottom, 22px

## Bridge modes

Per-project mode tabs. Journal is default.

| Mode | Surface | Right pane default |
|---|---|---|
| Journal | Chronological feed: chat + cycle events + agent verdicts + log lines. Composer-at-bottom. | Closed; opens to a cycle when clicked |
| Workflows | Agents list + Workflows list + YAML reference | YAML editor (Monaco) |
| Secrets | Secrets (keychain) + Env vars | Add-new form |
| Plugins | Installed + Marketplace (FilterBar) | Plugin detail / install progress |

## Projects rail

Identity only. No nav links inside the rail itself.

```
PROJECTS                 5
  ● my-saas-app
  ● trading-firm
  ● docs-site
  ● landing-page
  ● internal-cms

PSEUDO                  (no label)
  ◇ All agents
  ◇ Plugins

+ Add project
```

Active project: 2px copper inset stripe on the left edge, no fill.

## FilterBar pattern

Sticky top of any list view. Three columns:
- Left: ⌕ search (focuses on ⌘F)
- Middle: Group by dropdown
- Right: filter pills + saved-views star

Filter pill labels show match-count, not selected-value-count.
(`State: 12` means 12 rows match.)

View state URL-encoded for deep links + persisted to localStorage per
`storageKey`.

## Component patterns

- **Cards** — `--radius`, hairline border, `--bg-elevated`, 16px padding, no shadow
- **Buttons primary** — `--copper` bg, `--slate` text, `--radius-sm`, no shadow, hover `--copper-hover`
- **Buttons secondary** — transparent bg, hairline border, `--text-muted`, hover `--bg-hover`
- **Status dot** — 7×7px circle, inset shadow `inset 0 0 0 1px rgba(0,0,0,0.25)`, no outer glow
- **Section labels** — 10px uppercase 0.08em letter-spacing `--text-faint`, right-aligned numeric badge in mono 10px
- **Active selection** — 2px inset accent stripe (`box-shadow: inset 2px 0 0 var(--copper)`), no fill

## Rejected defaults

1. GitHub-dark / Linear navy palette → operations-bridge slate + copper
2. Vertical sidebar with project list + nav links + status pills at bottom → watchstrip on top + identity-only rail
3. Chat threads grouped under each project (Codex pattern) → one persistent journal per project where chat + cycle events + verdicts interleave by time

## Inspiration / not-default

- Codex Desktop three-pane shape (✓) but reorient with watchstrip
- Hermes Desktop chat-first center (✓) — direct take
- Both apps' native chrome + vibrancy (✓)
- Both apps' cool-blue accent (✗) → copper
- Both apps' sans headers (✗) → mono headers
- Both apps' per-project status buried in sidebar (✗) → watchstrip across top
