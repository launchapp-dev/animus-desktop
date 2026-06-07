# CI/CD template — operator walkthrough

End state: every PR you open triggers Animus on your Mac mini, runs
lint + test + build locally, and posts a status check back to GitHub
that shows green or red in the PR UI. Zero GitHub Actions minutes
spent.

This is the manual setup. Animus Desktop v1 collapses every step
below into "click click click."

## Prerequisites

- Mac mini (or any always-on Mac) on the same network you trust
- UPS recommended — small APC BE600M1 (~$80) is plenty
- A domain you control (any cheap `.dev` works) for the Cloudflare
  Tunnel route
- Free Cloudflare account
- `gh` CLI installed on the Mac mini and authenticated as a user
  with push access to your repos
- Animus v0.5.3 or later on the Mac mini

## Step 1 — install Animus

```bash
curl -fsSL https://raw.githubusercontent.com/launchapp-dev/animus-cli/main/scripts/install.sh | bash
animus plugin install-defaults --include-subjects --include-transports
animus --version          # confirm v0.5.3+
```

## Step 2 — Mac mini settings

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 0 womp 1
sudo systemsetup -setrestartfreeze on -setrestartpowerfailure on
```

This stops the Mac from sleeping and auto-restarts after a power blip.

## Step 3 — Cloudflare Tunnel

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login              # browser auth to Cloudflare
cloudflared tunnel create animus-ci
cloudflared tunnel route dns animus-ci ci.your-domain.dev
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: animus-ci
credentials-file: /Users/YOU/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: ci.your-domain.dev
    service: http://localhost:8090     # Animus daemon webhook port
  - service: http_status:404
```

Start the tunnel as a launchd service so it survives reboots:

```bash
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

Verify:

```bash
curl https://ci.your-domain.dev/health
```

You should get a response from the Animus daemon (404 is fine — it
means the tunnel works; the daemon just doesn't know `/health` yet).

## Step 4 — start the Animus daemon

```bash
animus daemon preflight                 # confirm all plugins installed
animus daemon start --autonomous        # daemon runs in the background
animus daemon status                    # verify
```

Daemon is now listening for webhooks at
`https://ci.your-domain.dev/webhook`.

## Step 5 — copy the template into your project

In each project you want CI on:

```bash
cd ~/path/to/your-project
mkdir -p .animus scripts
cp /path/to/animus-desktop/templates/ci-cd/workflows.yaml .animus/workflows.yaml
cp /path/to/animus-desktop/templates/ci-cd/scripts/gh-status-post.sh scripts/
chmod +x scripts/gh-status-post.sh
```

Adapt `workflows.yaml` to your language if it's not TypeScript (see
`../README.md` for the swap table).

## Step 6 — register the GitHub webhook

On the project's GitHub page → Settings → Webhooks → Add webhook:

- Payload URL: `https://ci.your-domain.dev/webhook`
- Content type: `application/json`
- Secret: generate one (`openssl rand -hex 32`), keep it
- Events: Pull requests (and pushes if you want CI on every commit)
- Active: ✓

Drop the secret into the daemon's environment so signature
verification works:

```bash
# Edit your shell rc to export ANIMUS_GITHUB_WEBHOOK_SECRET=...
# Then restart the daemon
animus daemon stop
ANIMUS_GITHUB_WEBHOOK_SECRET=<secret> animus daemon start --autonomous
```

(In Animus Desktop v1, this is a settings field.)

## Step 7 — first PR test

Open a PR on the configured repo. Within a few seconds:

```bash
animus daemon stream                    # live event feed
animus logs tail --limit 100            # recent activity
```

You should see:
1. `webhook_received` from GitHub
2. `workflow_started` for `pr-ci`
3. Each phase running in order
4. `workflow_completed` with success
5. PR status check in the GitHub UI flipping from pending to green

## Step 8 — disconnect GitHub Actions

Once you've verified Animus CI is reliable for one or two PR cycles,
disable the matching workflow in `.github/workflows/`. Your bill stops
growing immediately.

## Troubleshooting

| Symptom | Check |
|---|---|
| Webhook doesn't fire | Cloudflare Tunnel is up (`cloudflared tunnel list`); webhook delivery log on GitHub side; daemon's `webhook_received` event in `animus logs` |
| Workflow starts but stalls | `animus queue list`; check daemon resources (CPU / disk full?) |
| Tests pass locally but fail in Animus | Working directory issue — Animus runs in a worktree at a known path; check that `cwd_mode` is set correctly on command phases |
| Status check doesn't appear in PR | `gh-status-post.sh` needs `gh` CLI installed AND authenticated for the user the daemon runs as |

## What this template doesn't do (yet)

- Multi-runner — all phases run on the Mac mini. For Linux/Windows
  builds, add SSH command-phase variants pointing to a Hetzner box.
  See the kernel `runner_backend` plugin kind work for the productized
  multi-runner future.
- Containers — for environment isolation, wrap commands in
  `docker run`. The kernel `mode: container` feature ships in v0.5.5.
- AI code review — the v1.1 enhancement adds a `code-review` phase
  using Claude. Not in this v1 template.

## When Animus Desktop v1 ships

All of the above collapses to:

1. Install Animus Desktop (drag .dmg to Applications)
2. App installs the daemon
3. Click "Add CI Team"
4. GitHub OAuth → pick repo → confirm template → done

Then the daemon, plugins, workflow YAML, webhook, and status posting
are all set up automatically. The manual walkthrough above stays in
the docs as the "what the app is doing under the hood" reference.
