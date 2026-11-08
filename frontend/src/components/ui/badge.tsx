import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-qtrust-600 text-white",
        secondary: "bg-neutral-surface text-muted-foreground",
        // danger/neutral are the semantic state tokens from globals.css —
        // rose-50/rose-700 and slate-300/slate-700 were the same intent, raw.
        destructive: "bg-danger-surface text-danger",
        outline: "border border-neutral-border text-neutral",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
