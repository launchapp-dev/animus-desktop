import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";
import { useProjectsStore } from "../state/projects";
import type { Phase } from "../types/contracts";

interface LogLine {
  ts: number;
  phase: string;
  text: string;
}

interface LogPayload {
  cycle_id?: string;
  phase?: string;
  line?: string;
  text?: string;
}

function phaseDuration(phase: Phase): string {
  if (!phase.started_at) return "—";
  const start = new Date(phase.started_at).getTime();
  const end = phase.finished_at
    ? new Date(phase.finished_at).getTime()
    : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}

const MOCK_LOG_LINES = [
  "$ npm ci",
  "added 482 packages in 6.1s",
  "$ npm run lint",
  "> eslint . --max-warnings=0",
  "✓ no problems found",
  "$ npm test",
  "PASS  src/utils.test.ts",
  "PASS  src/parser.test.ts",
  "Tests: 24 passed, 24 total",
  "$ npm run build",
  "vite v5.4.0 building for production...",
  "✓ 312 modules transformed.",
  "dist/index.html  0.5 kB",
  "✓ built in 4.21s",
  "posting status check to GitHub…",
  "status: success",
];

export function CycleDetail() {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const { selectedCycle, selected, selectCycle, select } = useProjectsStore();
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id || !cycleId) return;
    if (!selected || selected.id !== id) void select(id);
    void selectCycle(id, cycleId);
  }, [id, cycleId, select, selectCycle, selected]);

  useEffect(() => {
    if (!selectedCycle) return;
    const running = selectedCycle.phases.find((p) => p.status === "running");
    setActivePhase(running?.name ?? selectedCycle.phases[0]?.name ?? null);
  }, [selectedCycle]);

  // Mock log streaming when no backend event arrives.
  useEffect(() => {
    if (!activePhase) return;
    setLogLines([]);
    let i = 0;
    const interval = window.setInterval(() => {
      if (i >= MOCK_LOG_LINES.length) {
        window.clearInterval(interval);
        return;
      }
      const text = MOCK_LOG_LINES[i++]!;
      setLogLines((prev) => [
        ...prev,
        { ts: Date.now(), phase: activePhase, text },
      ]);
    }, 220);
    return () => window.clearInterval(interval);
  }, [activePhase]);

  // Real backend event subscription — gracefully ignored if unavailable.
  useEffect(() => {
    if (!cycleId) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const stop = await listen<LogPayload>("cycle:log", (event) => {
          const p = event.payload;
          if (!p || p.cycle_id !== cycleId) return;
          setLogLines((prev) => [
            ...prev,
            {
              ts: Date.now(),
              phase: p.phase ?? "unknown",
              text: p.line ?? p.text ?? "",
            },
          ]);
        });
        unlisten = stop;
      } catch (e) {
        console.warn("[CycleDetail] event listen unavailable:", e);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [cycleId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logLines]);

  const filtered = useMemo(
    () => logLines.filter((l) => !activePhase || l.phase === activePhase),
    [logLines, activePhase],
  );

  if (!selectedCycle) {
    return (
      <div className="view">
        <div className="loading-pane">
          <Spinner label="Loading cycle…" />
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="breadcrumb">
        <Link to="/" className="breadcrumb__link">
          Projects
        </Link>
        <span className="breadcrumb__sep">/</span>
        {selected ? (
          <Link to={`/projects/${selected.id}`} className="breadcrumb__link">
            {selected.repo_full_name}
          </Link>
        ) : (
          <span>{id}</span>
        )}
        <span className="breadcrumb__sep">/</span>
        <span className="mono small muted">#{cycleId?.slice(-6)}</span>
      </div>

      <header className="view__header">
        <div>
          <h1 className="view__title">Cycle #{cycleId?.slice(-6)}</h1>
          <p className="view__subtitle">
            <Badge tone={selectedCycle.status} dot>
              {selectedCycle.status}
            </Badge>
            <span className="dot-sep">·</span>
            <span>
              started{" "}
              {new Date(selectedCycle.started_at).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              })}
            </span>
          </p>
        </div>
      </header>

      <div className="cycle-layout">
        <aside className="phase-rail">
          <div className="phase-rail__title">Phases</div>
          {selectedCycle.phases.map((phase) => (
            <button
              key={phase.name}
              className={`phase-tab ${activePhase === phase.name ? "phase-tab--active" : ""}`}
              onClick={() => setActivePhase(phase.name)}
            >
              <span className={`phase-tab__dot phase-tab__dot--${phase.status}`} />
              <span className="phase-tab__name">{phase.name}</span>
              <span className="phase-tab__dur muted small">
                {phaseDuration(phase)}
              </span>
            </button>
          ))}
        </aside>

        <section className="log-pane">
          <div className="log-pane__header">
            <span className="mono small">
              {activePhase ?? "no phase selected"}
            </span>
            <span className="muted small">{filtered.length} lines</span>
          </div>
          <div className="log-pane__body">
            {filtered.length === 0 ? (
              <div className="log-empty muted">Waiting for output…</div>
            ) : (
              filtered.map((line, i) => (
                <div key={i} className="log-line">
                  <span className="log-line__text">{line.text}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </section>
      </div>
    </div>
  );
}
