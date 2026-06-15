import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  Cycle,
  DaemonStatus,
  DeviceCodeResponse,
  Plugin,
  Project,
  Repo,
  Webhook,
} from "../types/contracts";

/**
 * Typed wrapper around Tauri's `invoke`. Falls back to a provided default value
 * only when the backend command does not exist yet (or we're not running
 * inside Tauri at all, e.g. vitest/browser), so the UI is testable before
 * backend integration completes. Real errors from existing commands propagate.
 */
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isMissingCommandError(cmd: string, e: unknown): boolean {
  const msg =
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  return msg.includes(`Command ${cmd} not found`);
}

export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (
      fallback !== undefined &&
      (!isTauriRuntime() || isMissingCommandError(cmd, e))
    ) {
      console.warn(`[_invoke] ${cmd} unavailable, using fallback:`, e);
      return fallback;
    }
    throw e;
  }
}

// ---- Mock data ------------------------------------------------------------

const MOCK_PLUGINS: Plugin[] = [
  {
    name: "animus-subject-default",
    kind: "subject_backend",
    version: "0.4.1",
    repo: "launchapp-dev/animus-subject-default",
    installed: true,
  },
  {
    name: "animus-provider-claude",
    kind: "provider",
    version: "0.4.0",
    repo: "launchapp-dev/animus-provider-claude",
    installed: true,
  },
  {
    name: "animus-workflow-runner-default",
    kind: "workflow_runner",
    version: "0.4.0",
    repo: "launchapp-dev/animus-workflow-runner-default",
    installed: true,
  },
  {
    name: "animus-queue-default",
    kind: "queue",
    version: "0.2.0",
    repo: "launchapp-dev/animus-queue-default",
    installed: true,
  },
  {
    name: "animus-trigger-webhook",
    kind: "trigger",
    version: "0.3.1",
    repo: "launchapp-dev/animus-trigger-webhook",
    installed: false,
  },
];

const MOCK_REPOS: Repo[] = [
  {
    id: 1,
    name: "shipyard",
    full_name: "acme/shipyard",
    private: false,
    default_branch: "main",
    description: "Container build orchestrator",
    language: "Rust",
    updated_at: "2026-06-01T10:00:00Z",
  },
  {
    id: 2,
    name: "lighthouse-web",
    full_name: "acme/lighthouse-web",
    private: true,
    default_branch: "main",
    description: "Marketing site",
    language: "TypeScript",
    updated_at: "2026-05-29T18:23:00Z",
  },
  {
    id: 3,
    name: "etl-runner",
    full_name: "acme/etl-runner",
    private: true,
    default_branch: "main",
    description: "Nightly ETL pipeline",
    language: "Python",
    updated_at: "2026-05-30T08:11:00Z",
  },
  {
    id: 4,
    name: "kit-go",
    full_name: "acme/kit-go",
    private: false,
    default_branch: "main",
    description: null,
    language: "Go",
    updated_at: "2026-05-12T13:42:00Z",
  },
];

function mockCycle(projectId: string, idx: number): Cycle {
  const base = Date.now() - idx * 1000 * 60 * 60;
  const statuses: Cycle["status"][] = ["passed", "failed", "passed", "running"];
  const status = statuses[idx % statuses.length];
  const phaseNames = ["lint", "test", "build", "status-post"];
  return {
    id: `cycle_${projectId}_${idx}`,
    project_id: projectId,
    status,
    started_at: new Date(base).toISOString(),
    finished_at:
      status === "running" ? null : new Date(base + 1000 * 60 * 3).toISOString(),
    phases: phaseNames.map((name, i) => {
      if (status === "running" && i >= 2) {
        return {
          name,
          status: i === 2 ? "running" : "pending",
          started_at: i === 2 ? new Date(base + i * 30_000).toISOString() : null,
          finished_at: null,
          exit_code: null,
        };
      }
      const failed = status === "failed" && i === 2;
      return {
        name,
        status: failed
          ? "failed"
          : status === "failed" && i > 2
            ? "skipped"
            : "passed",
        started_at: new Date(base + i * 30_000).toISOString(),
        finished_at: new Date(base + i * 30_000 + 25_000).toISOString(),
        exit_code: failed ? 1 : 0,
      };
    }),
  };
}

const MOCK_PROJECTS: Project[] = [
  {
    id: "proj_shipyard",
    repo_full_name: "acme/shipyard",
    language: "rust",
    template: "ci-cd",
    webhook_id: 9001,
    created_at: "2026-05-20T09:00:00Z",
    last_cycle: mockCycle("proj_shipyard", 0),
  },
  {
    id: "proj_lighthouse",
    repo_full_name: "acme/lighthouse-web",
    language: "typescript",
    template: "ci-cd",
    webhook_id: 9002,
    created_at: "2026-05-22T11:00:00Z",
    last_cycle: mockCycle("proj_lighthouse", 1),
  },
];

// ---- Typed wrappers -------------------------------------------------------

// Daemon — Animus daemons are per-project-root.
// Pass `projectRoot` to query/start/stop a specific project's daemon.
// Omit it for the global install check (binary exists, plugins count).
export const daemonStatus = (projectRoot?: string) =>
  safeInvoke<DaemonStatus>(
    "daemon_status",
    { projectRoot },
    {
      installed: false,
      running: false,
      version: null,
      pid: null,
      plugins_installed: 0,
      binary_path: null,
    },
  );

export const daemonInstall = () =>
  safeInvoke<DaemonStatus>("daemon_install", undefined, {
    installed: true,
    running: false,
    version: "0.5.1",
    pid: null,
    plugins_installed: 0,
    binary_path: "/usr/local/bin/animus",
  });

export const daemonStart = (projectRoot?: string) =>
  safeInvoke<DaemonStatus>(
    "daemon_start",
    { projectRoot },
    {
      installed: true,
      running: true,
      version: "0.5.1",
      pid: 4242,
      plugins_installed: 4,
      binary_path: "/usr/local/bin/animus",
    },
  );

export const daemonStop = (projectRoot?: string) =>
  safeInvoke<DaemonStatus>("daemon_stop", { projectRoot }, {
    installed: true,
    running: false,
    version: "0.5.1",
    pid: null,
    plugins_installed: 4,
    binary_path: "/usr/local/bin/animus",
  });

export const daemonRestart = (projectRoot?: string) =>
  safeInvoke<DaemonStatus>(
    "daemon_restart",
    { projectRoot },
    {
      installed: true,
      running: true,
      version: "0.5.1",
      pid: 4242,
      plugins_installed: 4,
      binary_path: "/usr/local/bin/animus",
    },
  );

// Plugins
export const pluginList = () =>
  safeInvoke<Plugin[]>("plugin_list", undefined, MOCK_PLUGINS);

export const pluginInstallDefaults = () =>
  safeInvoke<Plugin[]>("plugin_install_defaults", undefined, MOCK_PLUGINS);

export const pluginInstall = (name: string) =>
  safeInvoke<Plugin>(
    "plugin_install",
    { name },
    {
      ...(MOCK_PLUGINS.find((p) => p.name === name) ?? MOCK_PLUGINS[0]!),
      installed: true,
    },
  );

export const pluginUpdate = (name?: string) =>
  safeInvoke<void>("plugin_update", { name: name ?? null }, undefined);

export const pluginUninstall = (name: string) =>
  safeInvoke<void>("plugin_uninstall", { name }, undefined);

// GitHub auth
export const githubAuthStatus = () =>
  safeInvoke<AuthStatus>("github_auth_status", undefined, {
    logged_in: false,
    login: null,
    avatar_url: null,
  });

export const githubAuthStart = () =>
  safeInvoke<DeviceCodeResponse>("github_auth_start", undefined, {
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    device_code: "mock-device-code",
    interval: 5,
    expires_in: 900,
  });

export const githubAuthPoll = (deviceCode: string) =>
  safeInvoke<AuthStatus>("github_auth_poll", { deviceCode });

export const githubAuthLogout = async (): Promise<AuthStatus> => {
  await safeInvoke<null>("github_logout", undefined, null);
  return { logged_in: false, login: null, avatar_url: null };
};

// GitHub repos + webhooks
export const githubListRepos = () =>
  safeInvoke<Repo[]>("github_list_repos", undefined, MOCK_REPOS);

export const githubRegisterWebhook = (args: {
  repoFullName: string;
  webhookUrl: string;
}) =>
  safeInvoke<Webhook>("github_register_webhook", args, {
    id: Math.floor(Math.random() * 100_000),
    url: args.webhookUrl,
    events: ["pull_request"],
    active: true,
  });

// Settings — tunnel URL
export const settingsGetTunnelUrl = () =>
  safeInvoke<string>("settings_get_tunnel_url", undefined, "");

export const settingsSetTunnelUrl = (url: string) =>
  safeInvoke<string>("settings_set_tunnel_url", { url }, url);

// Wisp tray
export async function setWispExpression(expression: string): Promise<void> {
  // No-ops outside Tauri (vitest/browser) and if the command isn't built yet.
  await safeInvoke<void>("set_wisp_expression", { expression }, undefined);
}

// Project management
export const projectList = () =>
  safeInvoke<Project[]>("project_list", undefined, MOCK_PROJECTS);

export const projectGet = (id: string) =>
  safeInvoke<Project | null>(
    "project_get",
    { id },
    MOCK_PROJECTS.find((p) => p.id === id) ?? null,
  );

export const projectListCycles = (id: string) =>
  safeInvoke<Cycle[]>(
    "project_list_cycles",
    { id },
    Array.from({ length: 6 }, (_, i) => mockCycle(id, i)),
  );

export const projectGetCycle = (args: { projectId: string; cycleId: string }) =>
  safeInvoke<Cycle | null>(
    "project_get_cycle",
    args,
    mockCycle(args.projectId, 0),
  );

export const projectSetupTemplate = (args: {
  repoFullName: string;
  language: string;
  template: string;
}) =>
  safeInvoke<Project>("project_setup_template", args, {
    id: `proj_${args.repoFullName.replace("/", "_")}_${Date.now()}`,
    repo_full_name: args.repoFullName,
    language: args.language,
    template: args.template,
    webhook_id: null,
    created_at: new Date().toISOString(),
    last_cycle: null,
  });

export const projectDelete = (id: string) =>
  safeInvoke<void>("project_delete", { id }, undefined as unknown as void);
