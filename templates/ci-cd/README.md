# CI/CD team template

The v1 launch lighthouse for Animus Desktop. Drops into any project
to give it Animus-powered CI on a self-hosted daemon, replacing
GitHub Actions for the test/build/lint workload.

## What this template ships

- `workflows.yaml` — Animus workflow definition (install / lint /
  test / build / status-post)
- `scripts/gh-status-post.sh` — posts the PR status check back to
  GitHub via the gh CLI
- `SETUP.md` — operator walkthrough from "I have a Mac mini and a
  Hetzner box" to "first PR check turns green"

## Per-language adaptation

The reference `workflows.yaml` ships TypeScript-shaped (`npm`
commands). Adapt for your stack:

| Stack | Replace |
|---|---|
| Rust | `npm ci` → `cargo fetch`; `npm run lint` → `cargo clippy`; `npm test` → `cargo test`; `npm run build` → `cargo build --release` |
| Python | `npm ci` → `uv sync` (or `pip install -e .`); `npm run lint` → `ruff check`; `npm test` → `pytest`; drop `build` |
| Go | `npm ci` → `go mod download`; `npm run lint` → `golangci-lint run`; `npm test` → `go test ./...`; `npm run build` → `go build ./...` |
| Java | Adapt to your build tool (`mvn` / `gradle`) |

In v1 of Animus Desktop, the template generator auto-detects the
language and writes the right shape. Today, before the app ships,
you adapt by hand from this template.

## Status check posting

The workflow's final phase calls `gh-status-post.sh` with
`success` or `failure`. The script uses the `gh` CLI to post a
status check back to the PR's SHA so the PR shows green/red in the
GitHub UI.

Requires `gh` CLI installed and authenticated as a user with
write permission on the target repo. The Animus daemon runs as a
user; that user needs `gh auth login` done once at setup.
