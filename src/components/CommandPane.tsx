import { useActiveProject } from "../state/activeProject";

export function CommandPane() {
  const open = useActiveProject((s) => s.commandOpen);
  const title = useActiveProject((s) => s.commandTitle);
  const close = useActiveProject((s) => s.closeCommand);

  if (!open) {
    return <aside className="command-pane command-pane--closed" />;
  }

  return (
    <aside className="command-pane">
      <header className="command-pane__header">
        <h2 className="command-pane__title">{title ?? "Details"}</h2>
        <button
          type="button"
          className="command-pane__close"
          aria-label="Close"
          onClick={close}
        >
          ✕
        </button>
      </header>
      <div className="command-pane__body">
        {/* Mode-specific content lives here; for v1, this is a placeholder
            slot. Each Bridge mode pushes its own content into commandContext
            and the corresponding renderer hooks into useActiveProject. */}
        <p style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          Contextual details for the current selection will render here.
        </p>
      </div>
    </aside>
  );
}
