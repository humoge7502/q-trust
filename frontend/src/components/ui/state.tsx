import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty and error states.
 *
 * Both replaced a bare `<p className="p-6 text-sm text-slate-500">No assets
 * registered yet.</p>`. A one-line grey sentence answers "is it broken or
 * empty?" badly: it does not say what happened, whether the user did anything
 * wrong, or what to do next — and in a data-bound tool those are the only three
 * questions that matter.
 *
 * `EmptyState` carries an optional real action (a link or button) rather than
 * burying the next step in prose, and `ErrorState` exposes a retry because the
 * overwhelmingly common failure here is transient (backend unreachable).
 *
 * Error copy must never surface a raw exception. `description` is expected to
 * be written for a user; the technical detail belongs in the server log.
 */

export interface EmptyStateProps {
  /** Short, factual statement of what is absent. */
  title: string;
  /** Why it is absent and what to do about it. */
  description?: React.ReactNode;
  /** A real control, not a suggestion in prose. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("p-6 text-center sm:p-8", className)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-micro leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  /** Rendered as a "Try again" button when provided. */
  onRetry?: () => void;
  /** True while a retry is in flight; disables the control and relabels it. */
  retrying?: boolean;
  className?: string;
}

export function ErrorState({
  title = "We could not load this",
  description,
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "border-t border-danger-border bg-danger-surface px-5 py-4",
        className,
      )}
    >
      <p className="text-sm font-medium text-danger">{title}</p>
      {description ? (
        <p className="mt-1.5 text-micro leading-6 text-danger">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          className="mt-3 inline-flex items-center rounded-lg border border-danger-border bg-card px-3 py-1.5 text-micro font-semibold text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}
