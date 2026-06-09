import { useEffect, useMemo, useRef, useState } from "react";
import {
  useProjectEventsBucket,
  useProjectEvents,
} from "../../state/projectEvents";
import { localWorkflowsRead } from "../../api/workflow_yaml";
import type { Project } from "../../types/contracts";
import {
  ALL_CATS,
  dedupEvents,
  fromCycleEvent,
  matchesFilter,
  type FilterKey,
  type NormalizedEvent,
} from "./journal/model";
import { TranscriptRow } from "./journal/Transcript";

const FILTERS: FilterKey[] = [
  "all",
  "workflows",
  "phases",
  "dispatch",
  "llm",
  "errors",
];

export function StreamView({ project }: { project: Project }) {
  const bucket = useProjectEventsBucket(project.id);
  const setAgentByPhase = useProjectEvents((s) => s.setAgentByPhase);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<NormalizedEvent[] | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const path = project.repo_path?.trim();
    if (!path) return;
    let cancelled = false;
    localWorkflowsRead(path)
      .then((report) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of report.phases) if (p.agent) map[p.id] = p.agent;
        setAgentByPhase(project.id, map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, project.repo_path, setAgentByPhase]);

  // Live events oldest-last for a streaming feed.
  const liveEvents = useMemo<NormalizedEvent[]>(() => {
    const out: NormalizedEvent[] = [];
    const base = Date.now();
    bucket.cycles.forEach((c, i) => {
      if (!ALL_CATS.has(c.cat)) return;
      const e = fromCycleEvent(c, base - i * 1000);
      // enrich agent from phase map
      if (!e.agent && e.phaseId && bucket.agentByPhase[e.phaseId]) {
        e.agent = bucket.agentByPhase[e.phaseId]!;
      }
      out.push(e);
    });
    const dedup = dedupEvents(out);
    dedup.sort((a, b) => a.ts - b.ts); // oldest first for stream
    return dedup;
  }, [bucket.cycles, bucket.agentByPhase]);

  const events = paused && frozen ? frozen : liveEvents;

  const filtered = useMemo(
    () => events.filter((e) => matchesFilter(e, filter)),
    [events, filter],
  );

  // Auto-scroll to bottom on new events unless paused.
  useEffect(() => {
    if (paused) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [filtered.length, paused]);

  function togglePause() {
    if (paused) {
      setFrozen(null);
      setPaused(false);
    } else {
      setFrozen(liveEvents);
      setPaused(true);
    }
  }

  return (
    <div className="stream-pane">
      <header className="stream-pane__head">
        <div className="stream-pane__title-block">
          <span className={`stream-pane__live ${paused ? "stream-pane__live--paused" : ""}`}>
            <span className="stream-pane__live-dot" />
            {paused ? "PAUSED" : "LIVE"}
          </span>
          <span className="stream-pane__count">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        <nav className="journal-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`journal-filter ${filter === f ? "journal-filter--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="plugins-pane__ghost"
          onClick={togglePause}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </header>
      <div className="stream-pane__feed" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="journal-empty">
            Waiting for live events. Start a workflow on this project's daemon
            and activity will stream here in real time.
          </div>
        ) : (
          <div className="tr">
            {filtered.map((e, i) => (
              <TranscriptRow key={`${e.tsRaw ?? e.ts}-${e.cat}-${i}`} evt={e} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

export default StreamView;
