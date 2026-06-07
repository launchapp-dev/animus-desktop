import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as ShadcnButton } from "./ui/button";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/**
 * Compatibility wrapper preserving the existing variant/size prop API while
 * delegating render to the shadcn-based button. Keeps consumers that still
 * pass `variant="primary"` / `size="md"` working without changes.
 */
export function Button({
  variant = "secondary",
  size = "md",
  children,
  ...rest
}: ButtonProps) {
  return (
    <ShadcnButton variant={variant} size={size} {...rest}>
      {children}
    </ShadcnButton>
  );
}
