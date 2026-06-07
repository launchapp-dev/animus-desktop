# Animus

The app for setting up AI teams to do your work.

Set up CI/CD that runs on your laptop. Trading firms that wake up to
market open. Content teams that write while you sleep. Maintenance
teams that burn down your backlog overnight.

One app. One kernel. Your hardware. Your code.

---

## What this is

Animus Desktop is a Mac app that manages
[Animus](https://github.com/launchapp-dev/animus-cli) — installing the
daemon, managing plugins, scaffolding AI teams from templates, and
giving you a window into what they're doing.

CI/CD is the v1 launch lighthouse. Trading firms, content teams, and
other team templates follow as the platform proves out.

## Why it exists

CI/CD shouldn't cost $1,700/month. Trading firms shouldn't take 16
hours of YAML to scaffold. Content teams shouldn't require a
Kubernetes cluster.

Animus already solved the substrate. This app makes it click-click-
click instead of CLI-only.

## V1 scope (in development)

- Install + manage the Animus daemon from inside the app
- Install + manage Animus plugins
- One built-in team template: **CI/CD** (lint / test / build + AI code review)
- Set up a CI/CD team in under 5 minutes (GitHub OAuth → repo picker → template → webhook registration)
- Watch cycles run with logs streaming
- System tray with current build status

**Mac only for v1.** Linux + Windows follow after the experience is
proven.

## V1.1+ (planned templates)

- **Trading** team — multi-agent firm with broker MCP integration
- **Content** team — research + draft + publish pipeline
- **Maintenance** team — autonomous P3 backlog burner
- **Custom** team builder — compose your own agents, phases, schedules

## Architecture at a glance

```
┌──────────────────────────────────────────────┐
│  Animus Desktop (Tauri, Rust + TypeScript)   │
│  - Installs and supervises the daemon        │
│  - Manages plugins                            │
│  - Scaffolds teams from templates             │
│  - Streams cycle logs                         │
│  - System tray                                │
└────────────────────┬─────────────────────────┘
                     │ control protocol
                     ▼
┌──────────────────────────────────────────────┐
│  Animus daemon (Rust, v0.5.4+)                │
│  - Plugin host, workflows, decision contracts │
│  - github_webhook trigger, command phases     │
│  - Worktree isolation, queue, scheduler       │
└──────────────────────────────────────────────┘
```

## Development (coming)

```bash
pnpm install
pnpm tauri dev
```

Tauri 2 + Rust + React + Vite + TypeScript.

## License

To be locked at v1 release — Elastic License 2.0 likely, matching the
kernel.

## Repo layout

```
README.md                     this file
docs/
  ROADMAP.md                  v1 → v1.1 → v2 build sequence
src/                          React frontend
src-tauri/                    Rust backend (Tauri)
templates/
  ci-cd/                      v1 CI/CD team template (workflows.yaml + SETUP.md + scripts)
```
