import type { ReactNode } from "react";
import type { CycleStatus, PhaseStatus } from "../types/contracts";
import { Badge as ShadcnBadge } from "./ui/badge";

type StatusTone =
  | CycleStatus
  | PhaseStatus
  | "neutral"
  | "info"
  | "warn";

interface BadgeProps {
  tone?: StatusTone;
  children: ReactNode;
  dot?: boolean;
}

/**
 * Compatibility wrapper preserving the existing `tone` + `dot` props while
 * delegating render to the shadcn-based badge variants.
 */
export function Badge({ tone = "neutral", children, dot = false }: BadgeProps) {
  return (
    <ShadcnBadge variant={tone}>
      {dot && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "currentColor" }}
        />
      )}
      {children}
    </ShadcnBadge>
  );
}
