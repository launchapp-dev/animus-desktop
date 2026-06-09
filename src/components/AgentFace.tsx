import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { funEmoji } from "@dicebear/collection";

export type AgentState =
  | "idle"
  | "thinking"
  | "running"
  | "done"
  | "error"
  | "refusing";

interface AgentFaceProps {
  seed: string;
  state?: AgentState;
  size?: number;
  className?: string;
  title?: string;
}

const PALETTE = ["eee8e0", "d97757", "e6b34c", "8ee29a", "7fa9ff", "c992d4"];

// funEmoji enum values verified against @dicebear/fun-emoji schema.json.
// idle leaves mouth/eyes unset so the seed picks; other states force a
// closest-fit expression from the available enum.
function overridesFor(state: AgentState) {
  switch (state) {
    case "thinking":
      return { mouth: ["lilSmile" as const] };
    case "running":
      return { mouth: ["smileTeeth" as const] };
    case "done":
      return { mouth: ["smileLol" as const] };
    case "error":
      return { mouth: ["sad" as const], eyes: ["sad" as const] };
    case "refusing":
      return { mouth: ["plain" as const], eyes: ["closed" as const] };
    case "idle":
    default:
      return {};
  }
}

export function AgentFace({
  seed,
  state = "idle",
  size = 32,
  className,
  title,
}: AgentFaceProps) {
  const svg = useMemo(() => {
    const overrides = overridesFor(state);
    return createAvatar(funEmoji, {
      seed,
      size,
      backgroundColor: PALETTE,
      ...overrides,
    }).toString();
  }, [seed, state, size]);

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        lineHeight: 0,
      }}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      title={title}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default AgentFace;
