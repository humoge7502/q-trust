import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontally scrollable region for content that is wider than the viewport
 * (wide `<table>`s on small screens, command panes, etc.).
 *
 * A mouse user can drag a wide table into view; a keyboard-only user cannot
 * unless the scroll container itself accepts focus. axe raises
 * `scrollable-region-focusable` (serious) on every scrollable block that is not
 * focusable, which is how the `/research` mobile audit found these table
 * wrappers. `role="region"` plus an `aria-label` gives the focus stop a name so
 * a screen-reader user hears what they scrolled into.
 *
 * This is the `<div>`-wrapper counterpart to `CodeBlock`, which covers `<pre>`
 * blocks with the same contract.
 */
export interface ScrollXProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the scroll region, e.g. "Reproduction status table". */
  label: string;
}

export function ScrollX({ label, className, children, ...props }: ScrollXProps) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn(
        "scrollbar-thin overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
