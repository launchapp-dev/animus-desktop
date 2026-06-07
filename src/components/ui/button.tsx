import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-[#0a0d12] hover:bg-accent-hover",
        secondary:
          "bg-bg-elevated text-text border-border hover:bg-bg-raised hover:border-border-strong",
        ghost:
          "bg-transparent text-text-muted hover:bg-bg-hover hover:text-text",
        danger:
          "bg-transparent text-red border-border hover:bg-red-bg hover:border-red",
        outline:
          "bg-transparent text-text border-border hover:bg-bg-hover",
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs rounded-md",
        md: "h-8 px-3.5 text-[13px] rounded-md",
        lg: "h-10 px-5 text-sm rounded-md",
        icon: "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
