import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import {
  githubListRepos,
  githubRegisterWebhook,
  projectSetupTemplate,
  settingsGetTunnelUrl,
  settingsSetTunnelUrl,
} from "../api/_invoke";
import { useAuthStore } from "../state/auth";
import { useDaemonStore } from "../state/daemon";
import { useProjectsStore } from "../state/projects";
import type { Repo } from "../types/contracts";

const STEPS = [
  "Daemon",
  "GitHub",
  "Repository",
  "Template",
  "Tunnel",
  "Register",
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

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

  // Step 4: tunnel URL
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelTouched, setTunnelTouched] = useState(false);

  // Step 5: register
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

  async function handleRegister() {
    if (!selectedRepo) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      await settingsSetTunnelUrl(tunnelUrl);
      const project = await projectSetupTemplate({
        repoFullName: selectedRepo.full_name,
        language,
        template: "ci-cd",
      });
      const webhook = await githubRegisterWebhook({
        repoFullName: selectedRepo.full_name,
        webhookUrl: tunnelUrl,
      });
      const finalProject = { ...project, webhook_id: webhook.id };
      addProject(finalProject);
      navigate(`/projects/${finalProject.id}`);
    } catch (e) {
      setRegisterError(String(e));
    } finally {
      setRegistering(false);
    }
  }

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
                  We'll use the GitHub device flow — no browser redirect
                  needed.
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
            <h2 className="card__title">Confirm template</h2>
            <p>
              We'll set up CI/CD for this <strong>{language}</strong> project.
              Lint, test, build, and post status checks back to GitHub.
            </p>
            <pre className="yaml-preview">
              <code>{workflowPreview(language)}</code>
            </pre>
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep(4)}>
                Looks good
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="card">
            <h2 className="card__title">Webhook tunnel URL</h2>
            <p className="muted small">
              GitHub will POST pull-request events here. Use the public URL
              from your Cloudflare Tunnel (or another reverse proxy) pointing
              at the local daemon.
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
            <div className="card__actions">
              <Button variant="ghost" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!tunnelValid}
                onClick={() => setStep(5)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 5 && selectedRepo && (
          <div className="card">
            <h2 className="card__title">Register</h2>
            <p className="muted small">Final review before we wire it up.</p>
            <dl className="kv">
              <dt>Repository</dt>
              <dd>{selectedRepo.full_name}</dd>
              <dt>Language</dt>
              <dd>{language}</dd>
              <dt>Template</dt>
              <dd>ci-cd</dd>
              <dt>Webhook URL</dt>
              <dd className="mono small">{tunnelUrl}</dd>
            </dl>
            {registerError && (
              <div className="alert alert--error">{registerError}</div>
            )}
            <div className="card__actions">
              <Button
                variant="ghost"
                onClick={() => setStep(4)}
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
