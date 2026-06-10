/** Queued (type-ahead) messages shown above the chat composer. Pure
 *  presentational so the queue/auto-send flow is component-testable. */
export function QueuePanel({
  queue,
  paused,
  onRemove,
  onResume,
}: {
  queue: string[];
  paused: boolean;
  onRemove: (index: number) => void;
  onResume: () => void;
}) {
  if (queue.length === 0) return null;
  return (
    <div className="cx-queue" data-testid="queue-panel">
      <span className="cx-queue__label">
        {paused
          ? "Queue paused (you stopped the agent)"
          : "Queued · sends when the agent is free"}
        {paused && (
          <button
            type="button"
            className="cx-queue__resume"
            onClick={onResume}
            title="Resume sending queued messages"
          >
            ▶ resume
          </button>
        )}
      </span>
      {queue.map((q, i) => (
        <div key={i} className="cx-queue__item">
          <span className="cx-queue__text">{q}</span>
          <button
            type="button"
            className="cx-queue__rm"
            title="Remove"
            onClick={() => onRemove(i)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default QueuePanel;
