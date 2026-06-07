# Plugin ecosystem

Animus ships with 348 plugins. This is the structural moat.

## Counts at v1

| Kind | Count | What they do |
|---|---|---|
| **Subject backends** | 307 | Data sources/sinks — each one can be both a trigger and a destination |
| **Workflow packs** | 11 | Pre-built team templates (task, requirement, review, customer-support, sales, recruiting, marketing, ecommerce, meetings, engineering-backlog, core-skills) |
| **Providers** | 7 | claude, codex, gemini, oai, oai-agent, ollama, opencode |
| **Triggers** | 8 | webhook, github_webhook, slack, file_watcher, plus 4 more |
| **Transports** | 2 | http, graphql |
| **Other** | 13 | TUI, web-server, log storage, notifier, queue, step (durable), registry, protocol, plugin SDKs (py/ts), template, testkit, release-automation |
| **Total** | **348** | |

Repository for the registry: `animus-plugin-registry/plugins.json`.

## The 11 workflow packs (v1 team templates)

Each pack is an installable team template. Animus Desktop's AddProjectFlow
surfaces these alongside CI/CD as the v1 launch lighthouse.

| Pack | Use case |
|---|---|
| `animus.task` | Task delivery workflows (standard, ui-ux, quick-fix, gated, triage, refine) |
| `animus.requirement` | Requirement refinement → acceptance gates |
| `animus.review` | Review cycles — the gating discipline |
| `animus.core-skills` | Foundational skills bundled into other packs |
| `animus.engineering-backlog` | Eng backlog burndown (the original maintenance lighthouse) |
| `animus.customer-support` | Triage incoming tickets, draft responses, escalate |
| `animus.sales-pipeline` | Pipeline orchestration, lead enrichment |
| `animus.marketing-outreach` | Outbound campaigns, personalization |
| `animus.recruiting-pipeline` | Candidate triage, interview scheduling |
| `animus.ecommerce-fulfillment` | Order, inventory, fulfillment ops |
| `animus.organization-meetings` | Meeting prep, notes, follow-ups |

## Subject backend highlights (top 30 of 307)

These are 30 of the 307 staged subject backends, picked for direct relevance
to the v1 launch persona (dev teams + indie builders).

**Dev infrastructure**
- `animus-subject-buildkite` — Buildkite builds
- `animus-subject-bitbucket` — Bitbucket repos/PRs
- `animus-subject-gitea` — Gitea
- `animus-subject-argocd-applications` — ArgoCD
- `animus-subject-sonarqube` — SonarQube
- `animus-subject-alertmanager` — Prometheus Alertmanager
- `animus-subject-azure-devops` — Azure DevOps

**Package + dependency intelligence**
- `animus-subject-npm-versions` — npm version bumps
- `animus-subject-npm-downloads` — npm download trends
- `animus-subject-nuget-versions` — NuGet versions
- `animus-subject-archlinux-packages` — Arch Linux packages
- `animus-subject-artifacthub-packages` — Helm/Falco/etc.
- `animus-subject-depsdev-project-package-versions` — deps.dev
- `animus-subject-nodejs-releases` — Node.js releases

**Security**
- `animus-subject-secret-scanning` — secret scanning results
- `animus-subject-nvd-cpes` — NVD CPEs
- `animus-subject-nvd-cpe-matches` — vulnerability matching
- `animus-subject-capec-attack-patterns` — CAPEC

**Productivity / project mgmt**
- `animus-subject-trello` — Trello boards
- `animus-subject-asana` — Asana tasks
- `animus-subject-airtable` — Airtable bases
- `animus-subject-youtrack` — YouTrack tickets
- `animus-subject-bugzilla` — Bugzilla bugs

**Research / data**
- `animus-subject-arxiv-papers` — arXiv papers
- `animus-subject-biorxiv-preprints` — bioRxiv preprints
- `animus-subject-huggingface-models` — HF models
- `animus-subject-clinicaltrials-studies` — ClinicalTrials.gov
- `animus-subject-stackexchange-tags` — Stack Exchange tags

**Social / monitoring**
- `animus-subject-bluesky-author-posts` — Bluesky author posts
- `animus-subject-gdelt-documents` — GDELT news

## Why this matters for positioning

Most incumbent agentic CI/CD tools bind to a single source — git commits in
GitHub. Animus binds to **anything with a feed**: 307 data sources, all
swappable, all OSS-shipped, all available through `animus plugin install`.

The category claim this enables:

> **"Trigger an AI team on anything that changes. 307 data sources.
> 11 workflow templates. Local-first. Free."**

Examples that write themselves into demos:

- A new arXiv paper drops on AI safety → research team summarizes,
  files an issue in your Linear inbox
- npm version bump on a package you depend on → dep-audit team runs
  the upgrade in a worktree, opens a PR
- Bluesky author you follow posts about a domain → content monitor
  team logs it, drafts a follow-up
- Buildkite build fails three times in a row → forensic team digs
  into the logs, drafts the root cause analysis
- OpenFDA enforcement update → regulatory tracking team logs it,
  pings the right owner
- ClinicalTrials.gov status changes on a trial you track → research
  team updates the dossier

Each subject backend is also a potential **trigger**. That's 307 entry
points to autonomous workflows — versus one (git push) for Cursor,
Devin Desktop, GitHub Actions, BuildKite, etc.

## How the Desktop app exposes this at v1

The AddProjectFlow wizard's "template" step surfaces the 11 packs as
visual cards. CI/CD is the default; the others are visible from
day one even if their setup flows are minimal in v1.

The Settings → Plugins view (already shipped in the v1 frontend
scaffold) lists installed plugins and lets the user `animus plugin
install` more from the registry. The plugin marketplace surface
(browse + filter + install) is a fast follow.

## How to extend

New plugins live in their own repos under `launchapp-dev/` and ship
via `animus plugin install owner/repo`. The plugin SDK comes in
Python (`animus-plugin-sdk-py`) and TypeScript (`animus-plugin-sdk-ts`)
flavors, plus a Rust template (`animus-plugin-template`).

A new subject backend, trigger, provider, or pack is a single repo
release away from being installable across every Animus deployment.
The kernel doesn't change; the ecosystem grows.
