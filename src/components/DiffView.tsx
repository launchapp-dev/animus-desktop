import { diffLineKind } from "../lib/utils";

/** Renders diff text with per-line add/remove/hunk coloring. Assumes the caller
 *  already decided the text is a diff (see `isDiffText`). */
export function DiffView({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre className="cx-diff" data-testid="diff-view">
      {lines.map((l, i) => (
        <div key={i} className={`cx-diff__line cx-diff__line--${diffLineKind(l)}`}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

export default DiffView;
