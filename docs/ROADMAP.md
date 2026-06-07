# Roadmap

The build sequence, with scope bounded per phase.

## v1 — CI/CD lighthouse (Mac only)

**Goal:** A Mac user can install Animus Desktop, click "Add CI Team,"
authenticate with GitHub, pick a repo, and have CI running on their
own machine within 5 minutes. That's the v1 success criterion.

### Features

| Feature | Scope |
|---|---|
| **Daemon supervisor** | App downloads, installs, starts, stops, and restarts the Animus daemon. Surfaces daemon status in UI. |
| **Plugin management** | App calls `animus plugin install-defaults` on first run. Lets user inspect installed plugins and install additional ones. |
| **GitHub OAuth** | Standard OAuth flow. App stores token in macOS keychain. |
| **Repo picker** | After auth, app lists user's repos. User selects one to enable CI on. |
| **CI/CD team template** | App writes `.animus/workflows.yaml` to the selected repo with lint / test / build phases. Auto-detects TypeScript / Rust / Python and picks the right command shapes. |
| **Webhook registration** | App registers a `pull_request` webhook on the repo, pointing at the local daemon (via Cloudflare Tunnel URL the user configured separately). |
| **PR status posting** | A `gh-status-post.sh` script runs as the final phase of each workflow, posts a check back to GitHub. |
| **Project list view** | Main app window shows all projects with current state and last-cycle status. |
| **Cycle drill-down** | Click a project → see recent cycles. Click a cycle → see phase outputs with logs streaming. |
| **System tray** | Status dot, recent builds, quick open. |
| **Mac packaging** | `.dmg` installer, code-signed with Developer ID. |

### Out of scope for v1

- Linux / Windows packaging (defer)
- Multi-runner support (CLI-only via SSH command phases for now)
- `mode: container` phases (defer — depends on kernel feature in v0.5.5)
- Trading / Content / Maintenance team templates (defer to v1.1+)
- Custom team builder (defer to v2)
- Stream / Cloud paid tier (separate product motion)
- Built-in Cloudflare Tunnel setup (assume user has it)

### Effort estimate

| Slice | Effort |
|---|---|
| Tauri scaffold + Rust backend skeleton | 3-4 days |
| Daemon supervisor (install / start / stop / status) | 4-5 days |
| Plugin management UI + Rust commands | 3-4 days |
| GitHub OAuth flow + keychain storage | 3-4 days |
| Repo listing + picker UI | 2-3 days |
| Language detection + template generator | 3-4 days |
| Webhook registration via Octokit / gh API | 2 days |
| Project list view (React) | 3-4 days |
| Cycle drill-down + log streaming | 4-5 days |
| System tray + notifications | 2-3 days |
| Mac packaging + code signing setup | 3-4 days |
| Polish, error states, recovery flows | 4-5 days |
| **Total focused engineering** | **~5-7 weeks** |

With parallel agents working on independent slices, compressible to
~2-3 weeks of calendar time.

## v1.1 — Trading team template

Port the `agent-trading-firm` workflow into an in-app template. User
picks "Trading team," app guides them through Robinhood MCP setup,
generates the org's agent prompts + workflow YAML, sets up the
journal directory, configures schedules.

Time estimate: ~1 week once v1 ships.

## v1.2 — Content team template

Port the blog-automation workflow Rafael ran for his mom's site.
Picks a CMS plugin (Ghost / WordPress / Notion / custom), generates
the research → draft → review → publish pipeline.

Time estimate: ~1 week.

## v2 — Custom team builder

In-app composer for arbitrary teams. Add agents, define phases,
configure triggers and schedules, all from the UI. The "ship your
own team" power-user surface.

Time estimate: ~3-4 weeks.

## v2 — Linux + Windows packaging

Cross-platform support. Tauri makes this mostly mechanical — the
real work is testing on all three platforms and fixing edge cases.

Time estimate: ~2 weeks.

## v2 — Stream paid tier

Hosted dashboard for teams that need shared visibility. App connects
to a Stream backend (separate service) for team-wide team
observation. First paid tier of the product.

Time estimate: ~6-8 weeks for a clean v1 of Stream.

## What we are explicitly NOT building

These show up in conversation but are deliberately deferred or
declined:

- **In-app Cloudflare Tunnel setup wizard** — the user sets up Tunnel
  themselves. Maybe v2 if it's a friction point.
- **Hosted runners (Cloud tier)** — different company motion. Defer
  to year 2.
- **Multi-org / RBAC / enterprise features** — wait for a paying
  enterprise customer to ask by name.
- **Container builds in the app** — gated on kernel `mode: container`
  shipping in v0.5.5.
- **In-app secrets manager UI** — v1 uses environment variables and
  the user's existing secret management. Polish later.
