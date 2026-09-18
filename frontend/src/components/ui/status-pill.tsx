import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Status chip — the app layer's single vocabulary for "what does this state
 * mean".
 *
 * ## Why this exists
 *
 * The same five states were previously expressed in inconsistent hues: success
 * as `emerald-50`/`emerald-700` in the dashboard and vendor portal, `green-500`
 * in the compliance score bar and `green-600` on `green-500/15` in its status
 * chips; failure as `rose-50`/`rose-700` in one place and `red-600` on
 * `red-500/15` in another. Identical meaning, different colour depending on the
 * file.
 *
 * The compliance chips were also a genuine WCAG failure rather than just an
 * inconsistency: a 600-level foreground on a 15% tint of the same hue measured
 * ~2.8:1 against the 4.5:1 AA minimum. Every tone below pairs a foreground with
 * a surface that was *measured against that surface*, not merely against white
 * — see the ratios documented in `globals.css`.
 *
 * ## Tones
 *
 * `success` / `danger` / `warning` / `info` / `neutral` map to the semantic
 * state palette; `accent` is the brand tone for non-state labels (a product
 * name, a version, a count) and is not a status at all.
 */
export type StatusTone =
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "neutral"
  | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-surface text-success ring-success-border",
  danger: "bg-danger-surface text-danger ring-danger-border",
  warning: "bg-warning-surface text-warning ring-warning-border",
  info: "bg-info-surface text-info ring-info-border",
  neutral: "bg-neutral-surface text-neutral ring-neutral-border",
  accent: "bg-qtrust-50 text-qtrust-700 ring-qtrust-600/20",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** Optional leading icon, rendered `aria-hidden` (the label carries meaning). */
  icon?: React.ReactNode;
}

export function StatusPill({
  tone,
  icon,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      // `data-tone` is the stable contract for tests: asserting a semantic tone
      // survives a palette change, whereas asserting a literal Tailwind class
      // (`text-green-600`) pinned a colour that failed WCAG AA and disagreed
      // with the same state rendered elsewhere in the app.
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
