import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Badge as UIBadge } from "../components/ui/badge";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { PackCard } from "../components/PackCard";
import { Input } from "../components/ui/input";
import {
  githubListRepos,
  githubRegisterWebhook,
  projectSetupTemplate,
  settingsGetTunnelUrl,
  settingsSetTunnelUrl,
} from "../api/_invoke";
import { bridgeAttachProject } from "../api/event_bridge";
import { useAuthStore } from "../state/auth";
import { useDaemonStore } from "../state/daemon";
import { useProjectsStore } from "../state/projects";
import { PACKS, type PackMeta } from "../data/packs";
import type { Repo } from "../types/contracts";

const STEPS = [
  "Daemon",
  "GitHub",
  "Repository",
  "Pack",
  "Trigger",
  "Tunnel",
  "Register",
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type TriggerKind = "pull_request" | "push" | "release" | "schedule";

interface TriggerOption {
  kind: TriggerKind;
  title: string;
  description: string;
}

const TRIGGERS: TriggerOption[] = [
  {
    kind: "pull_request",
    title: "Pull requests",
    description:
      "Run on opened, reopened, synchronize, and ready-for-review events. The default for CI/CD.",
  },
  {
    kind: "push",
    title: "Push to branch",
    description:
      "Run whenever commits land on the default branch (or a tag is pushed).",
  },
  {
    kind: "release",
    title: "Release published",
    description: "Run when a GitHub release is published or edited.",
  },
  {
    kind: "schedule",
    title: "Schedule",
    description: "Run on a cron expression (UTC).",
  },
];

function languageKey(lang: string | null): string {
  if (!lang) return "typescript";
  const l = lang.toLowerCase();
  if (l === "ts" || l === "typescript" || l === "javascript" || l === "js")
    return "typescript";
  if (l === "rust" || l === "rs") return "rust";
  if (l === "python" || l === "py") return "python";
  if (l === "go") return "go";
  return l;
}

function workflowPreview(language: string): string {
  const cmds: Record<string, { lint: string; test: string; build: string }> = {
    typescript: {
      lint: "npm run lint",
      test: "npm test",
      build: "npm run build",
    },
    rust: {
      lint: "cargo clippy -- -D warnings",
      test: "cargo test --workspace",
      build: "cargo build --release",
    },
    python: {
      lint: "ruff check .",
      test: "pytest",
      build: "python -m build",
    },
    go: {
      lint: "go vet ./...",
      test: "go test ./...",
      build: "go build ./...",
    },
  };
  const c = cmds[language] ?? cmds.typescript!;
  return `workflows:
  ci-cd:
    phases:
      - name: lint
        command: ${c.lint}
      - name: test
        command: ${c.test}
      - name: build
        command: ${c.build}
      - name: status-post
        command: ./scripts/gh-status-post.sh
`;
}

function StepDots({ active }: { active: StepIndex }) {
  return (
    <ol className="step-dots">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`step-dot ${i === active ? "step-dot--active" : ""} ${i < active ? "step-dot--done" : ""}`}
        >
          <span className="step-dot__num">{i + 1}</span>
          <span className="step-dot__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function AddProjectFlow() {
  const navigate = useNavigate();
  const daemon = useDaemonStore();
  const auth = useAuthStore();
  const addProject = useProjectsStore((s) => s.addProject);

  const [step, setStep] = useState<StepIndex>(0);

  // Step 2: repo picker
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  // Step 3: pack picker (default CI/CD)
  const [selectedPack, setSelectedPack] = useState<PackMeta>(
    () => PACKS.find((p) => p.id === "ci-cd")!,
  );

  // Step 4: trigger
  const [selectedTrigger, setSelectedTrigger] =
    useState<TriggerKind>("pull_request");
  const [cron, setCron] = useState("0 6 * * *");

  // Step 5: tunnel URL
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelTouched, setTunnelTouched] = useState(false);

  // Step 6: register
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Auto-poll auth + bootstrap state on mount
  useEffect(() => {
    void daemon.refresh();
    void auth.refresh();
    void settingsGetTunnelUrl().then(setTunnelUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance from step 0 → 1 once daemon is running.
  useEffect(() => {
    if (step === 0 && daemon.status?.running) setStep(1);
  }, [step, daemon.status?.running]);

  // Auto-advance from step 1 → 2 once auth complete.
  useEffect(() => {
    if (step === 1 && auth.status?.logged_in) {
      setStep(2);
      void loadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, auth.status?.logged_in]);

  // Device-flow polling loop.
  const pollTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!auth.deviceCode || auth.status?.logged_in) {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      return;
    }
    pollTimer.current = window.setInterval(() => {
      void auth.poll();
    }, Math.max(1500, auth.deviceCode.interval * 1000));
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [auth, auth.deviceCode, auth.status?.logged_in]);

  async function loadRepos() {
    setReposLoading(true);
    try {
      const list = await githubListRepos();
      setRepos(list);
    } finally {
      setReposLoading(false);
    }
  }

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, search]);

  const language = languageKey(selectedRepo?.language ?? null);

  const tunnelValid = useMemo(() => {
    try {
      const u = new URL(tunnelUrl);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [tunnelUrl]);

  // Tunnel is only required for webhook-based triggers. A schedule trigger can
  // skip the tunnel step entirely (cron runs locally).
  const tunnelRequired = selectedTrigger !== "schedule";

  async function handleRegister() {
    if (!selectedRepo) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      if (tunnelRequired) {
        await settingsSetTunnelUrl(tunnelUrl);
      }
      const project = await projectSetupTemplate({
        repoFullName: selectedRepo.full_name,
        language,
        template: selectedPack.id,
      });
      let webhookId: number | null = null;
      if (tunnelRequired) {
        const webhook = await githubRegisterWebhook({
          repoFullName: selectedRepo.full_name,
          webhookUrl: tunnelUrl,
        });
        webhookId = webhook.id;
      }
      const finalProject = { ...project, webhook_id: webhookId };
      addProject(finalProject);
      if (finalProject.repo_path && finalProject.repo_path.trim().length > 0) {
        try {
          await bridgeAttachProject(finalProject.id, finalProject.repo_path);
        } catch (e) {
          console.warn("bridge_attach_project failed:", e);
        }
      }
      navigate(`/projects/${finalProject.id}`);
    } catch (e) {
      setRegisterError(String(e));
    } finally {
      setRegistering(false);
    }
  }

  const visiblePacks = useMemo(() => PACKS.filter((p) => !p.hidden), []);

  return (
    <div className="view view--narrow">
      <div className="breadcrumb">
        <Link to="/" className="breadcrumb__link">
          ← Cancel
        </Link>
      </div>

      <header className="view__header">
        <div>
          <h1 className="view__title">Add project</h1>
          <p className="view__subtitle">
            Connect a GitHub repository and stand up a CI/CD team.
          </p>
        </div>
      </header>

      <StepDots active={step} />

      <div className="wizard-step">
        {step === 0 && (
          <div className="card">
            <h2 className="card__title">Daemon</h2>
            <p className="muted small">
              Animus runs locally. We need the daemon installed and running
              before connecting GitHub.
            </p>
            <dl className="kv">
              <dt>Installed</dt>
              <dd>{daemon.status?.installed ? "Yes" : "No"}</dd>
              <dt>Running</dt>
              <dd>{daemon.status?.running ? "Yes" : "No"}</dd>
              <dt>Version</dt>
              <dd>{daemon.status?.version ?? "—"}</dd>
            </dl>
            <div className="card__actions">
              {!daemon.status?.installed && (
                <Button
                  variant="primary"
                  onClick={() => void daemon.install()}
                  disabled={daemon.loading}
                >
                  {daemon.loading ? "Installing…" : "Install daemon"}
                </Button>
              )}
              {daemon.status?.installed && !daemon.status.running && (
                <Button
                  variant="primary"
                  onClick={() => void daemon.start()}
                  disabled={daemon.loading}
                >
                  {daemon.loading ? "Starting…" : "Start daemon"}
                </Button>
              )}
              {daemon.status?.running && (
                <Button variant="primary" onClick={() => setStep(1)}>
                  Continue
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="card">
            <h2 className="card__title">Sign in to GitHub</h2>
            {auth.status?.logged_in ? (
              <>
                <p>
                  Signed in as <strong>@{auth.status.login}</strong>
                </p>
                <div className="card__actions">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setStep(2);
                      void loadRepos();
                    }}
                  >
                    Continue
                  </Button>
                </div>
              </>
            ) : auth.deviceCode ? (
              <div className="device-code-card">
                <div className="device-code-card__row">
                  <span className="muted small">Code</span>
                  <code className="device-code">
                    {auth.deviceCode.user_code}
                  </code>
                </div>
                <p>
                  Open{" "}
                  <a
                    className="link"
                    href={auth.deviceCode.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {auth.deviceCode.verification_uri}
                  </a>{" "}
                  and enter the code.
                </p>
                <div className="card__actions">
                  <Spinner label="Waiting for GitHub…" />
                  <Button variant="ghost" onClick={() => auth.reset()}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="muted small">
                  We'll use the GitHub device flow — no browser redirect needed.
                </p>
                <div className="card__actions">
                  <Button
                    variant="primary"
                    onClick={() => void auth.startDeviceFlow()}
                    disabled={auth.loading}
                  >
                    {auth.loading ? "Starting…" : "Start GitHub sign in"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="card">
            <h2 className="card__title">Pick a repository</h2>
            <div className="form-row">
              <input
                className="input"
                placeholder="Search repos…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {reposLoading ? (
              <Spinner label="Loading repos…" />
            ) : (
              <div className="repo-list">
                {filteredRepos.map((r) => (
                  <button
                    key={r.id}
                    className={`repo-row ${selectedRepo?.id === r.id ? "repo-row--selected" : ""}`}
                    onClick={() => setSelectedRepo(r)}
                  >
                    <div className="repo-row__main">
                      <div className="repo-row__name">{r.full_name}</div>
                      <div className="muted small">
                        {r.description ?? "No description"}
                      </div>
                    </div>
                    <div className="repo-row__meta">
                      {r.private && <Badge tone="warn">private</Badge>}
                      {r.language && (
                        <span className="lang-tag">{r.language}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!selectedRepo}
                onClick={() => setStep(3)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && selectedRepo && (
          <div className="card">
            <h2 className="card__title">Pick a workflow pack</h2>
            <p className="muted small">
              Animus ships 11 team templates. CI/CD is the v1 launch lighthouse;
              the others ship as templates land.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {visiblePacks.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  selected={selectedPack.id === p.id}
                  onSelect={(pack) => setSelectedPack(pack)}
                />
              ))}
            </div>
            {selectedPack.id === "ci-cd" && (
              <details className="mt-3 rounded-md border border-border bg-bg p-3 text-[12px]">
                <summary className="cursor-pointer select-none text-text-muted">
                  Preview generated workflow for <strong>{language}</strong>
                </summary>
                <pre className="yaml-preview mt-2">
                  <code>{workflowPreview(language)}</code>
                </pre>
              </details>
            )}
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep(4)}
                disabled={!selectedPack.enabled}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 4 && selectedRepo && (
          <div className="card">
            <h2 className="card__title">Choose a trigger</h2>
            <p className="muted small">
              Pick what fires this team. v1 supports GitHub webhook events and
              cron schedules; more triggers from the 307 subject backends ship
              in a later release.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {TRIGGERS.map((t) => {
                const active = selectedTrigger === t.kind;
                return (
                  <button
                    key={t.kind}
                    type="button"
                    onClick={() => setSelectedTrigger(t.kind)}
                    className={[
                      "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                      active
                        ? "border-accent bg-accent-bg"
                        : "border-border bg-bg-elevated hover:border-border-strong hover:bg-bg-hover",
                    ].join(" ")}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-sm font-semibold text-text">
                        {t.title}
                      </span>
                      {active && (
                        <UIBadge
                          variant="info"
                          className="text-[10px] uppercase tracking-wider"
                        >
                          Selected
                        </UIBadge>
                      )}
                    </div>
                    <span className="text-[12px] text-text-muted">
                      {t.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedTrigger === "schedule" && (
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Cron expression
                </label>
                <Input
                  className="mono"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 6 * * *"
                />
                <p className="mt-1 text-[11px] text-text-faint">
                  Standard 5-field cron, UTC. Default: every day at 06:00.
                </p>
              </div>
            )}
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep(5)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="card">
            <h2 className="card__title">
              {tunnelRequired ? "Webhook tunnel URL" : "Tunnel (skipped)"}
            </h2>
            {tunnelRequired ? (
              <>
                <p className="muted small">
                  GitHub will POST {selectedTrigger.replace("_", " ")} events
                  here. Use the public URL from your Cloudflare Tunnel (or
                  another reverse proxy) pointing at the local daemon.
                </p>
                <div className="form-row">
                  <input
                    className="input mono"
                    type="url"
                    placeholder="https://ci.your-domain.dev/webhook"
                    value={tunnelUrl}
                    onChange={(e) => {
                      setTunnelUrl(e.target.value);
                      setTunnelTouched(true);
                    }}
                  />
                </div>
                {tunnelTouched && !tunnelValid && (
                  <div className="alert alert--warn">
                    That doesn't look like a valid URL.
                  </div>
                )}
              </>
            ) : (
              <p className="muted small">
                Schedule triggers run locally on the daemon. No public webhook
                URL needed.
              </p>
            )}
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(4)}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={tunnelRequired && !tunnelValid}
                onClick={() => setStep(6)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 6 && selectedRepo && (
          <div className="card">
            <h2 className="card__title">Register</h2>
            <p className="muted small">Final review before we wire it up.</p>
            <dl className="kv">
              <dt>Repository</dt>
              <dd>{selectedRepo.full_name}</dd>
              <dt>Language</dt>
              <dd>{language}</dd>
              <dt>Pack</dt>
              <dd>{selectedPack.title}</dd>
              <dt>Trigger</dt>
              <dd>
                {selectedTrigger === "schedule"
                  ? `schedule (${cron})`
                  : selectedTrigger.replace("_", " ")}
              </dd>
              {tunnelRequired && (
                <>
                  <dt>Webhook URL</dt>
                  <dd className="mono small">{tunnelUrl}</dd>
                </>
              )}
            </dl>
            {registerError && (
              <div className="alert alert--error">{registerError}</div>
            )}
            <div className="card__actions">
              <Button
                variant="ghost"
                onClick={() => setStep(5)}
                disabled={registering}
              >
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleRegister()}
                disabled={registering}
              >
                {registering ? "Registering…" : "Register project"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
