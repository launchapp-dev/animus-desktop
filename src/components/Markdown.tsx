import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { AnimusJson } from "./AnimusJson";

interface Props {
  children: string;
  className?: string;
}

// Open http(s) links in the system browser instead of navigating the webview.
function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (href && /^https?:\/\//.test(href)) {
          e.preventDefault();
          void openExternal(href).catch(() => {});
        }
      }}
    >
      {children}
    </a>
  );
}

/** One markdown renderer for the whole app: GFM (tables, task lists,
 *  strikethrough, autolinks) + highlight.js code highlighting + safe
 *  external links. Memoized since transcript/chat re-render often. */
export const Markdown = memo(function Markdown({ children, className }: Props) {
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ a: ExternalLink }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

function tryParseJson(text: string): unknown | null {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  const lastCh = t[t.length - 1];
  if (!(lastCh === "}" || lastCh === "]")) return null;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* not JSON */
  }
  return null;
}

function looksLikeCommandOutput(text: string): boolean {
  const head = text.slice(0, 200);
  return /^===.*===/m.test(head) || text.startsWith("$") || text.includes("\n$ ");
}

function CollapsibleCode({
  code,
  lang,
  collapseAt = 24,
}: {
  code: string;
  lang: string;
  collapseAt?: number;
}) {
  const lines = code.split("\n");
  const long = lines.length > collapseAt;
  const [open, setOpen] = useState(!long);
  const shown = open ? code : lines.slice(0, collapseAt).join("\n");
  return (
    <div className="rich-code">
      <div className="rich-code__bar">
        <span className="rich-code__lang">{lang}</span>
        <span className="rich-code__count">{lines.length} lines</span>
        {long && (
          <button
            type="button"
            className="rich-code__toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "collapse" : `show all ${lines.length}`}
          </button>
        )}
      </div>
      <Markdown>{"```" + lang + "\n" + shown + "\n```"}</Markdown>
    </div>
  );
}

/** Smart renderer for free-form tool/agent output: recognized Animus JSON
 *  shapes get custom components, other JSON is pretty-printed + highlighted,
 *  command stdout is monospace, everything else is markdown.
 *
 *  `plain` = the source is program output, not authored markdown — so the
 *  non-JSON fallback is monospace (preserving `---`, `#`, `hint:` etc.)
 *  instead of being parsed as markdown. Use for tool results / command stdout. */
export function RichText({ text, plain }: { text: string; plain?: boolean }) {
  const parsed = tryParseJson(text);
  if (parsed !== null) {
    return (
      <AnimusJson
        value={parsed}
        fallback={(pretty) => <CollapsibleCode code={pretty} lang="json" />}
      />
    );
  }
  if (plain || looksLikeCommandOutput(text)) {
    const lines = text.split("\n");
    if (lines.length > 28 || text.length > 2000) {
      return <CollapsibleCode code={text} lang="text" collapseAt={24} />;
    }
    return <pre className="rich-output">{text}</pre>;
  }
  return <Markdown>{text}</Markdown>;
}

export default Markdown;
