import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Scrollable code / command block.
 *
 * A region that scrolls must be reachable by keyboard. A mouse user can drag a
 * long command into view; a keyboard-only user cannot unless the scroll
 * container itself accepts focus. axe raises `scrollable-region-focusable`
 * (serious) on every scrollable block that is not focusable. That is how these
 * were found: once the `/v/[id]` a11y spec stopped skipping itself, it reported
 * this rule against the route's code regions — a route that had never been
 * accessibility-audited, because its spec disabled itself precisely when the
 * page was broken.
 *
 * `role="region"` plus an `aria-label` gives that focus stop a name, so a
 * screen-reader user hears what they have scrolled into rather than landing on
 * an unlabelled `<pre>`. The focus ring uses the light-on-dark pairing these
 * blocks use everywhere; passing a light `className` would need a matching
 * ring override.
 */
export interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  /** Accessible name for the scroll region, e.g. "Independent verification commands". */
  label: string;
  children: React.ReactNode;
}

export function CodeBlock({ label, className, children, ...props }: CodeBlockProps) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn(
        "scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  );
}
