import { useCallback, useEffect, useMemo, useState } from "react";
import { pluginInstall, pluginList } from "../../api/_invoke";
import {
  animusFlavorCurrent,
  animusFlavorInstall,
  animusFlavorList,
  type FlavorCurrent,
  type FlavorListEntry,
  type FlavorManifest,
  type FlavorRoleSet,
} from "../../api/animus";
import type { Plugin, Project } from "../../types/contracts";

// Plugins install machine-wide (~/.animus/plugins/). The only project-scoped
// question is the FLAVOR: which plugins this project's runtime requires and
// recommends, and whether they're present. The full browse/install catalog
// lives in Settings — this view answers "is THIS project set up right?".

const ROLE_ORDER: (keyof FlavorManifest)[] = [
  "providers",
  "subjects",
  "queue",
  "workflow_runner",
  "transports",
  "ui",
  "triggers",
  "packs",
  "durable_store",
  "memory_store",
];

const ROLE_LABEL: Record<string, string> = {
  providers: "Providers",
  subjects: "Subjects",
  queue: "Queue",
  workflow_runner: "Workflow runner",
  transports: "Transports",
  ui: "Web UI",
  triggers: "Triggers",
  packs: "Packs",
  durable_store: "Durable store",
  memory_store: "Memory store",
};

/** Manifest slugs are repo-qualified (`launchapp-dev/animus-provider-claude`);
 *  the installed list reports bare names (`animus-provider-claude`). */
function bareName(slug: string): string {
  const parts = slug.split("/");
  return parts[parts.length - 1] ?? slug;
}

interface FlavorPlugin {
  slug: string;
  name: string;
  role: string;
  roleLabel: string;
  installed: boolean;
}

function collect(
  manifest: FlavorManifest,
  installedNames: Set<string>,
  pick: (set: FlavorRoleSet) => string[],
): FlavorPlugin[] {
  const out: FlavorPlugin[] = [];
  for (const role of ROLE_ORDER) {
    const set = manifest[role] as FlavorRoleSet | undefined;
    if (!set) continue;
    for (const slug of pick(set)) {
      const name = bareName(slug);
      out.push({
        slug,
        name,
        role: role as string,
        roleLabel: ROLE_LABEL[role as string] ?? (role as string),
        installed: installedNames.has(name),
      });
    }
  }
  return out;
}

function PluginRow({
  plugin,
  installing,
  onInstall,
}: {
  plugin: FlavorPlugin;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="rt-row">
      <span
        className={`rt-row__dot rt-row__dot--${plugin.installed ? "ok" : "missing"}`}
        aria-hidden
      />
      <span className="rt-row__name">{plugin.name}</span>
      <span className="rt-row__role">{plugin.roleLabel}</span>
      <span className="rt-row__action">
        {plugin.installed ? (
          <span className="rt-row__installed">Installed</span>
        ) : (
          <button
            type="button"
            className="rt-install"
            disabled={installing}
            onClick={onInstall}
          >
            {installing ? "Installing…" : "Install"}
          </button>
        )}
      </span>
    </div>
  );
}

export function PluginsView({ project }: { project: Project }) {
  const path = project.repo_path?.trim() ?? "";
  const [flavor, setFlavor] = useState<FlavorCurrent | null>(null);
  const [flavors, setFlavors] = useState<FlavorListEntry[]>([]);
  const [installed, setInstalled] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    if (!path) {
      setError("This project has no folder path on disk.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [fres, list, lres] = await Promise.all([
        animusFlavorCurrent(path),
        pluginList(),
        animusFlavorList(path),
      ]);
      if (!fres.ok || !fres.data) {
        setError(
          (fres.error && typeof fres.error === "object" && "message" in fres.error
            ? String((fres.error as { message: unknown }).message)
            : null) ?? fres.rawStderr ?? "could not read project flavor",
        );
      } else {
        setFlavor(fres.data);
      }
      setInstalled(list);
      if (lres.ok && lres.data) setFlavors(lres.data.flavors ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const installedNames = useMemo(
    () => new Set(installed.map((p) => p.name)),
    [installed],
  );

  const required = useMemo(
    () =>
      flavor ? collect(flavor.manifest, installedNames, (s) => s.required) : [],
    [flavor, installedNames],
  );
  const recommended = useMemo(
    () =>
      flavor
        ? collect(flavor.manifest, installedNames, (s) => s.recommended)
        : [],
    [flavor, installedNames],
  );

  const missingRequired = required.filter((p) => !p.installed);

  const recommendedByRole = useMemo(() => {
    const by = new Map<string, FlavorPlugin[]>();
    for (const p of recommended) by.set(p.roleLabel, [...(by.get(p.roleLabel) ?? []), p]);
    return Array.from(by.entries());
  }, [recommended]);

  async function installOne(slug: string) {
    setInstalling(slug);
    setError(null);
    try {
      await pluginInstall(slug);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
    }
  }

  async function installMissing() {
    setBulkBusy(true);
    setError(null);
    try {
      for (const p of missingRequired) {
        setInstalling(p.slug);
        await pluginInstall(p.slug);
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
      setBulkBusy(false);
    }
  }

  async function switchFlavor(name: string) {
    if (!name || name === flavor?.name) return;
    setSwitching(true);
    setError(null);
    try {
      const res = await animusFlavorInstall(path, name);
      if (!res.ok) {
        setError(
          (res.error && typeof res.error === "object" && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : null) ?? res.rawStderr ?? `could not switch to flavor "${name}"`,
        );
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSwitching(false);
    }
  }

  const ready = flavor != null && missingRequired.length === 0;

  return (
    <div className="rt-pane">
      <header className="rt-head">
        <div className="rt-head__main">
          <h2 className="rt-head__title">Runtime</h2>
          {flavor ? (
            <p className="rt-head__sub">
              Flavor <strong>{flavor.manifest.title || flavor.name}</strong>
              <span className="rt-head__ver">v{flavor.manifest.version}</span>
            </p>
          ) : (
            <p className="rt-head__sub">{loading ? "Reading flavor…" : "No flavor configured"}</p>
          )}
        </div>
        <div className="rt-head__actions">
          {flavors.length > 1 && flavor && (
            <label className="rt-flavor-pick" title="Switch this project's flavor">
              <span className="rt-flavor-pick__label">Flavor</span>
              <select
                className="rt-flavor-pick__select"
                value={flavor.name}
                disabled={switching || loading}
                onChange={(e) => void switchFlavor(e.target.value)}
              >
                {flavors.map((f) => (
                  <option key={f.name} value={f.name} disabled={!f.available}>
                    {f.title || f.name}
                    {f.name === flavor.name ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {switching && <span className="rt-flavor-pick__busy">Switching…</span>}
          {flavor && (
            <span className={`rt-status rt-status--${ready ? "ok" : "gap"}`}>
              <span className="rt-status__dot" aria-hidden />
              {ready
                ? "Runtime ready"
                : `${missingRequired.length} required missing`}
            </span>
          )}
          <button
            type="button"
            className="plugins-pane__ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {flavor?.manifest.description && (
        <p className="rt-desc">{flavor.manifest.description}</p>
      )}

      {error && (
        <div className="workflow-error">
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{error}</pre>
        </div>
      )}

      {flavor && (
        <>
          <section className="rt-section">
            <div className="rt-section__head">
              <h3 className="rt-section__title">
                Required <span className="rt-section__count">{required.length}</span>
              </h3>
              {missingRequired.length > 0 && (
                <button
                  type="button"
                  className="rt-install rt-install--bulk"
                  disabled={bulkBusy}
                  onClick={() => void installMissing()}
                >
                  {bulkBusy
                    ? "Installing…"
                    : `Install ${missingRequired.length} missing`}
                </button>
              )}
            </div>
            <div className="rt-list">
              {required.map((p) => (
                <PluginRow
                  key={p.slug}
                  plugin={p}
                  installing={installing === p.slug}
                  onInstall={() => void installOne(p.slug)}
                />
              ))}
            </div>
          </section>

          {recommended.length > 0 && (
            <section className="rt-section">
              <button
                type="button"
                className="rt-section__toggle"
                onClick={() => setShowRecommended((v) => !v)}
              >
                <span className="rt-section__caret">{showRecommended ? "▼" : "▶"}</span>
                <h3 className="rt-section__title">
                  Recommended{" "}
                  <span className="rt-section__count">{recommended.length}</span>
                </h3>
                <span className="rt-section__hint">
                  optional add-ons for this flavor
                </span>
              </button>
              {showRecommended &&
                recommendedByRole.map(([roleLabel, items]) => (
                  <div key={roleLabel} className="rt-subgroup">
                    <div className="rt-subgroup__label">{roleLabel}</div>
                    <div className="rt-list">
                      {items.map((p) => (
                        <PluginRow
                          key={p.slug}
                          plugin={p}
                          installing={installing === p.slug}
                          onInstall={() => void installOne(p.slug)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          )}

          <p className="rt-footnote">
            Plugins install machine-wide and are shared across all your projects.
            Browse, update, or remove the full catalog in <strong>Settings</strong>.
          </p>
        </>
      )}
    </div>
  );
}

export default PluginsView;
