import type { Plugin } from "../types/contracts";

/**
 * The known launchapp-dev plugin universe — surfaced in the Plugins tab even
 * when not installed locally, so the user can see the full ecosystem and
 * install on demand. Mirrors the plugin repos at https://github.com/launchapp-dev
 * as of v0.5.x. Update this list when a new plugin ships.
 */
export interface RegistryEntry extends Omit<Plugin, "version"> {
  version: string;
  /** One-sentence purpose for the card UI. */
  blurb: string;
  /** Whether this is a default install per default-install.json. */
  recommended: boolean;
  /** Stability tier — "ga" / "beta" / "preview". */
  tier: "ga" | "beta" | "preview";
}

const STUB_VERSION = "";

export const PLUGIN_REGISTRY: RegistryEntry[] = [
  // Providers
  {
    name: "animus-provider-claude",
    kind: "provider",
    repo: "launchapp-dev/animus-provider-claude",
    installed: false, version: STUB_VERSION,
    blurb: "Drives agent work through the Claude CLI.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-provider-codex",
    kind: "provider",
    repo: "launchapp-dev/animus-provider-codex",
    installed: false, version: STUB_VERSION,
    blurb: "Drives agent work through the OpenAI Codex CLI.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-provider-gemini",
    kind: "provider",
    repo: "launchapp-dev/animus-provider-gemini",
    installed: false, version: STUB_VERSION,
    blurb: "Drives agent work through the Gemini CLI.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-provider-opencode",
    kind: "provider",
    repo: "launchapp-dev/animus-provider-opencode",
    installed: false, version: STUB_VERSION,
    blurb: "Drives agent work through OpenCode.",
    recommended: false,
    tier: "beta",
  },
  {
    name: "animus-provider-oai",
    kind: "provider",
    repo: "launchapp-dev/animus-provider-oai",
    installed: false, version: STUB_VERSION,
    blurb: "Direct OpenAI API provider (no CLI in the loop).",
    recommended: false,
    tier: "beta",
  },

  // Subject backends
  {
    name: "animus-subject-default",
    kind: "subject_backend",
    repo: "launchapp-dev/animus-subject-default",
    installed: false, version: STUB_VERSION,
    blurb: "Default file-backed task store (kind=task).",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-subject-requirements",
    kind: "subject_backend",
    repo: "launchapp-dev/animus-subject-requirements",
    installed: false, version: STUB_VERSION,
    blurb: "File-backed requirements store (kind=requirement).",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-subject-linear",
    kind: "subject_backend",
    repo: "launchapp-dev/animus-subject-linear",
    installed: false, version: STUB_VERSION,
    blurb: "Linear-backed subject store. Sync tasks with your Linear org.",
    recommended: false,
    tier: "beta",
  },
  {
    name: "animus-subject-sqlite",
    kind: "subject_backend",
    repo: "launchapp-dev/animus-subject-sqlite",
    installed: false, version: STUB_VERSION,
    blurb: "SQLite-backed subject store for larger workloads.",
    recommended: false,
    tier: "beta",
  },
  {
    name: "animus-subject-markdown",
    kind: "subject_backend",
    repo: "launchapp-dev/animus-subject-markdown",
    installed: false, version: STUB_VERSION,
    blurb: "Markdown-backed subject store: tasks as repo files.",
    recommended: false,
    tier: "beta",
  },

  // Transports
  {
    name: "animus-transport-http",
    kind: "transport",
    repo: "launchapp-dev/animus-transport-http",
    installed: false, version: STUB_VERSION,
    blurb: "HTTP control-plane transport for the daemon.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-transport-graphql",
    kind: "transport",
    repo: "launchapp-dev/animus-transport-graphql",
    installed: false, version: STUB_VERSION,
    blurb: "GraphQL transport — what the web UI consumes.",
    recommended: true,
    tier: "ga",
  },

  // Workflow runner + queue
  {
    name: "animus-workflow-runner-default",
    kind: "workflow_runner",
    repo: "launchapp-dev/animus-workflow-runner-default",
    installed: false, version: STUB_VERSION,
    blurb: "Default phase runner. Required for the daemon to dispatch work.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus-queue-default",
    kind: "queue",
    repo: "launchapp-dev/animus-queue-default",
    installed: false, version: STUB_VERSION,
    blurb: "Default queue backend — pending/assigned/held subjects.",
    recommended: true,
    tier: "ga",
  },

  // Web UI
  {
    name: "animus-web-ui",
    kind: "web_ui",
    repo: "launchapp-dev/animus-web-ui",
    installed: false, version: STUB_VERSION,
    blurb: "Standalone web UI spawned by `animus web serve`.",
    recommended: true,
    tier: "ga",
  },

  // Triggers
  {
    name: "animus-trigger-webhook",
    kind: "trigger",
    repo: "launchapp-dev/animus-trigger-webhook",
    installed: false, version: STUB_VERSION,
    blurb: "Webhook receiver — fires workflows from arbitrary HTTP POSTs.",
    recommended: false,
    tier: "ga",
  },
  {
    name: "animus-trigger-slack",
    kind: "trigger",
    repo: "launchapp-dev/animus-trigger-slack",
    installed: false, version: STUB_VERSION,
    blurb: "Slack trigger — fires workflows from a Slack slash command.",
    recommended: false,
    tier: "beta",
  },

  // Log storage
  {
    name: "animus-log-storage-sqlite",
    kind: "log_storage",
    repo: "launchapp-dev/animus-log-storage-sqlite",
    installed: false, version: STUB_VERSION,
    blurb: "SQLite-backed log archive for completed runs.",
    recommended: false,
    tier: "beta",
  },

  // Packs
  {
    name: "animus.core-skills",
    kind: "pack",
    repo: "launchapp-dev/animus-pack-core-skills",
    installed: false, version: STUB_VERSION,
    blurb: "Bundled skills used by Animus's default workflows.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus.task",
    kind: "pack",
    repo: "launchapp-dev/animus-pack-task",
    installed: false, version: STUB_VERSION,
    blurb: "Standard task workflows — standard, ui-ux, quick-fix, gated, triage.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus.requirement",
    kind: "pack",
    repo: "launchapp-dev/animus-pack-requirement",
    installed: false, version: STUB_VERSION,
    blurb: "Requirement workflows — draft, refine, plan, execute.",
    recommended: true,
    tier: "ga",
  },
  {
    name: "animus.review",
    kind: "pack",
    repo: "launchapp-dev/animus-pack-review",
    installed: false, version: STUB_VERSION,
    blurb: "Reusable code-review-and-test loop for completed work.",
    recommended: true,
    tier: "ga",
  },
];
