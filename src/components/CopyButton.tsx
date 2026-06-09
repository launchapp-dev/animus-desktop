import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Small copy-to-clipboard button with a brief confirmation tick. Renders
 *  nothing when there's no text to copy. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className={`cx-copy ${className ?? ""}`}
      title="Copy"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable — ignore */
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export default CopyButton;
