import { useCallback, useEffect, useMemo, useState } from "react";
import {
  animusSecretGet,
  animusSecretImportEnv,
  animusSecretList,
  animusSecretRm,
  animusSecretSet,
  type SecretListData,
} from "../../api/animus_secrets";
import type { Project } from "../../types/contracts";

interface RevealedSecret {
  key: string;
  value: string;
  shownAt: number;
}

const AUTO_HIDE_MS = 30_000;

function envelopeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err ?? "unknown error");
}

export function SecretsView({ project }: { project: Project }) {
  const [data, setData] = useState<SecretListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [revealBusy, setRevealBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // Import form
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Delete confirm
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const path = project.repo_path?.trim();
    if (!path) {
      setError("This project has no folder path on disk.");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await animusSecretList(path);
      if (!res.ok || !res.data) {
        setError(envelopeError(res.error) || `secret list failed (stderr: ${res.rawStderr || "—"})`);
      } else {
        setData(res.data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [project.repo_path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-hide revealed value
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setRevealed(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [revealed]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.keys;
    return data.keys.filter((k) => k.toLowerCase().includes(q));
  }, [data, search]);

  async function handleReveal(key: string) {
    const path = project.repo_path?.trim();
    if (!path) return;
    setRevealBusy(key);
    setError(null);
    try {
      const res = await animusSecretGet(path, key);
      if (res.ok && res.data) {
        setRevealed({ key, value: res.data.value, shownAt: Date.now() });
      } else {
        setError(envelopeError(res.error) || `secret get failed: ${res.rawStderr || "—"}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRevealBusy(null);
    }
  }

  async function handleCopy(key: string) {
    const path = project.repo_path?.trim();
    if (!path) return;
    setRevealBusy(key);
    setError(null);
    try {
      const res = await animusSecretGet(path, key);
      if (res.ok && res.data) {
        await navigator.clipboard.writeText(res.data.value);
        setRevealed({ key, value: "✓ copied to clipboard", shownAt: Date.now() });
      } else {
        setError(envelopeError(res.error) || "secret get failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRevealBusy(null);
    }
  }

  async function handleAdd() {
    const path = project.repo_path?.trim();
    if (!path) return;
    if (!newKey.trim() || !newValue) return;
    setAddBusy(true);
    setError(null);
    try {
      const res = await animusSecretSet(path, newKey.trim(), newValue);
      if (res.ok) {
        setNewKey("");
        setNewValue("");
        setShowAdd(false);
        await refresh();
      } else {
        setError(envelopeError(res.error) || `secret set failed: ${res.rawStderr || "—"}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAddBusy(false);
    }
  }

  async function handleDelete(key: string) {
    const path = project.repo_path?.trim();
    if (!path) return;
    setDeleteBusy(key);
    setError(null);
    try {
      const res = await animusSecretRm(path, key);
      if (res.ok) {
        setPendingDelete(null);
        await refresh();
      } else {
        setError(envelopeError(res.error) || `secret rm failed: ${res.rawStderr || "—"}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(null);
    }
  }

  async function handleImport() {
    const path = project.repo_path?.trim();
    if (!path) return;
    setImportBusy(true);
    setError(null);
    setImportMsg(null);
    try {
      const res = await animusSecretImportEnv(path, importFile.trim() || null, importOverwrite);
      if (res.ok && res.data) {
        const d = res.data;
        setImportMsg(
          `imported ${d.imported}${d.skipped ? `, skipped ${d.skipped}` : ""}${
            d.source ? ` from ${d.source}` : ""
          }`,
        );
        setShowImport(false);
        setImportFile("");
        setImportOverwrite(false);
        await refresh();
      } else {
        setError(envelopeError(res.error) || `secret import-env failed: ${res.rawStderr || "—"}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="plugins-pane">
      <header className="plugins-pane__head">
        <div>
          <h2 className="workflows-pane__title">Secrets</h2>
          <p className="workflows-pane__subtitle">
            {data ? `${data.keys.length} stored` : loading ? "checking…" : "—"} ·{" "}
            OS keychain · per-project scope
          </p>
        </div>
        <div className="plugins-pane__head-actions">
          <button
            type="button"
            className="workflow-row__run"
            onClick={() => {
              setShowAdd((s) => !s);
              setShowImport(false);
            }}
            disabled={loading}
          >
            {showAdd ? "Cancel" : "+ Add secret"}
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => {
              setShowImport((s) => !s);
              setShowAdd(false);
            }}
            disabled={loading}
          >
            Import .env
          </button>
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {data && (
        <div className="secrets-pane__scope">
          <span>scope</span>
          <code>{data.scope}</code>
          <span>·</span>
          <span>service</span>
          <code>{data.service}</code>
        </div>
      )}

      {error && (
        <div className="workflow-error">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Secrets error</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
          <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
            Requires Animus CLI 0.5.8+ — bump with{" "}
            <code>animus update</code> if you're on an older binary.
          </p>
        </div>
      )}

      {importMsg && (
        <div className="workflows-pane__toast">{importMsg}</div>
      )}

      {showAdd && (
        <section className="secret-form">
          <label className="secret-form__row">
            <span className="secret-form__label">Key</span>
            <input
              className="plugins-pane__search"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="LINEAR_API_TOKEN"
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="secret-form__row">
            <span className="secret-form__label">Value</span>
            <input
              className="plugins-pane__search"
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="paste value"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Stored in the macOS keychain under the per-project service. Values
            never leave the daemon's process when read.
          </p>
          <div className="card__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => {
                setShowAdd(false);
                setNewKey("");
                setNewValue("");
              }}
              disabled={addBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="workflow-row__run"
              onClick={() => void handleAdd()}
              disabled={addBusy || !newKey.trim() || !newValue}
            >
              {addBusy ? "Saving…" : "Save secret"}
            </button>
          </div>
        </section>
      )}

      {showImport && (
        <section className="secret-form">
          <label className="secret-form__row">
            <span className="secret-form__label">File</span>
            <input
              className="plugins-pane__search"
              value={importFile}
              onChange={(e) => setImportFile(e.target.value)}
              placeholder={`${project.repo_path?.trim() ?? ""}/.env`}
              spellCheck={false}
            />
          </label>
          <label className="plugins-pane__toggle">
            <input
              type="checkbox"
              checked={importOverwrite}
              onChange={(e) => setImportOverwrite(e.target.checked)}
            />
            <span>Overwrite existing keys on collision</span>
          </label>
          <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Each non-comment <code>KEY=VALUE</code> line becomes a stored
            entry. Defaults to <code>&lt;project&gt;/.env</code> when blank.
          </p>
          <div className="card__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="plugins-pane__ghost"
              onClick={() => setShowImport(false)}
              disabled={importBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="workflow-row__run"
              onClick={() => void handleImport()}
              disabled={importBusy}
            >
              {importBusy ? "Importing…" : "Import"}
            </button>
          </div>
        </section>
      )}

      <div className="plugins-pane__toolbar">
        <input
          className="plugins-pane__search"
          placeholder="Search keys…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && !loading && !error ? (
        <p style={{ color: "var(--text-faint)", fontSize: 12, padding: "12px 0" }}>
          {data?.keys.length === 0
            ? "No secrets stored for this project yet. Click + Add secret or Import .env."
            : "No keys match your search."}
        </p>
      ) : (
        <ul className="secret-list">
          {filtered.map((key) => (
            <li key={key} className="secret-row">
              <div className="secret-row__head">
                <code className="secret-row__key">{key}</code>
                {revealed?.key === key ? (
                  <code className="secret-row__value">
                    {revealed.value}
                  </code>
                ) : (
                  <span className="secret-row__masked">••••••••</span>
                )}
              </div>
              <div className="secret-row__actions">
                {pendingDelete === key ? (
                  <>
                    <button
                      type="button"
                      className="plugins-pane__ghost"
                      onClick={() => setPendingDelete(null)}
                      disabled={deleteBusy === key}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="secret-row__delete"
                      onClick={() => void handleDelete(key)}
                      disabled={deleteBusy === key}
                    >
                      {deleteBusy === key ? "Deleting…" : "Confirm delete"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="plugins-pane__ghost"
                      onClick={() => void handleReveal(key)}
                      disabled={revealBusy === key}
                    >
                      {revealBusy === key
                        ? "…"
                        : revealed?.key === key
                          ? "Hide"
                          : "Reveal"}
                    </button>
                    <button
                      type="button"
                      className="plugins-pane__ghost"
                      onClick={() => void handleCopy(key)}
                      disabled={revealBusy === key}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="secret-row__delete"
                      onClick={() => setPendingDelete(key)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {revealed && (
        <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
          Revealed value auto-hides in 30s.
        </p>
      )}
    </div>
  );
}
