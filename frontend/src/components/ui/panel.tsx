import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface + heading primitives for the application layer.
 *
 * ## Why this exists
 *
 * The app layer had no shared surface vocabulary. The same card wrapper was
 * written out verbatim 18 times across six files, and the same panel heading
 * (`text-sm font-semibold uppercase tracking-wider text-slate-500`) appeared 11
 * times — alongside `text-slate-800`, `text-slate-950` and `text-slate-600`
 * variants of the same idea. Nothing was wrong with any one of them; the problem
 * was that no two agreed, so the product read as a set of screens written at
 * different times rather than one system.
 *
 * ## Hierarchy
 *
 * Three levels, separated by *face* as well as size — which is what keeps the
 * dense application layer legible without making everything large:
 *
 *   page title      `<h1>` display face, tight tracking        (`text-2xl`)
 *   section heading `<h2>` mono, uppercase, wide tracking      (`SectionHeading`, 11px)
 *   panel title     `<h3>` mono, uppercase, wide tracking      (`PanelTitle`, 10px)
 *
 * The mono uppercase treatment is the product's editorial-technical register
 * (see the marketing surface's section metadata) and it carries a practical
 * benefit here: a label set in mono at wide tracking is unambiguous at 10px in
 * a way sentence-case Inter is not.
 *
 * ## Tokens
 *
 * These consume the semantic set already declared in `globals.css`
 * (`border`, `card`, `muted-foreground`), which the GPU/analytics panels were
 * already written against. Migrating the raw `slate-*` call sites onto those
 * names — rather than inventing a parallel set — is what lets the light
 * surface be retuned in one place.
 */

type HeadingTag = "h2" | "h3" | "h4";

/** Card surface: border, raised background, small shadow. */
export const Panel = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <section
    ref={ref}
    className={cn("rounded-xl border border-border bg-card shadow-sm", className)}
    {...props}
  />
));
Panel.displayName = "Panel";

/** Header strip: title group on the left, actions on the right. */
export function PanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

/** Groups a `PanelTitle` with its optional `PanelDescription`. */
export function PanelHeading({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0", className)} {...props} />;
}

export interface PanelTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingTag;
}

export function PanelTitle({
  as: Tag = "h3",
  className,
  ...props
}: PanelTitleProps) {
  return (
    <Tag
      className={cn(
        "font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PanelDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-micro text-muted-foreground", className)} {...props} />;
}

/** Right-hand slot of a `PanelHeader`. */
export function PanelActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2", className)} {...props} />
  );
}

/** Padded content area. Tables pass `className="p-0"` and own their own edges. */
export function PanelBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function PanelFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-t border-border px-5 py-4 text-micro text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Section heading above a group of panels.
 *
 * Deliberately not a `PanelTitle`: this label belongs to the page, not to a
 * surface, so it must not inherit the panel's border or background and needs to
 * be addressable by `aria-labelledby` for the section it introduces.
 */
export function SectionHeading({
  as: Tag = "h2",
  className,
  ...props
}: PanelTitleProps) {
  return (
    <Tag
      className={cn(
        "font-mono text-micro font-semibold uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
