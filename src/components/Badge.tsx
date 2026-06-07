import type { ReactNode } from "react";
import type { CycleStatus, PhaseStatus } from "../types/contracts";

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

export function Badge({ tone = "neutral", children, dot = false }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}
