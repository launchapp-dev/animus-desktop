import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight",
  {
    variants: {
      variant: {
        neutral: "border-border bg-bg-elevated text-text-muted",
        info: "border-blue/30 bg-blue-bg text-blue",
        running: "border-blue/30 bg-blue-bg text-blue",
        passed: "border-green/30 bg-green-bg text-green",
        failed: "border-red/30 bg-red-bg text-red",
        pending: "border-border bg-gray-bg text-text-muted",
        skipped: "border-border bg-gray-bg text-text-muted",
        cancelled: "border-yellow/30 bg-yellow-bg text-yellow",
        warn: "border-yellow/30 bg-yellow-bg text-yellow",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
