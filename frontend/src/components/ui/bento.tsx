/**
 * Bento grid primitives (B2) — server components, pure layout.
 *
 * `BentoGrid` is the responsive cell container (1 col mobile, 2 md, 3 lg).
 * `data-reveal-group` can be passed through to stagger Reveal-wrapped cells
 * (see scroll-effects.client.tsx). Spanning is a `className` concern: callers
 * place e.g. `md:col-span-2` / `lg:row-span-2` on the cell wrapper.
 *
 * `BentoCard` is the night panel: raised surface, hairline edge, mono eyebrow,
 * icon slot, title, body, and a trailing slot for card-specific footers. It
 * renders no interaction of its own — static content in DOM order, so there
 * is nothing to reduce under prefers-reduced-motion.
 */
import type { ComponentType, HTMLAttributes, ReactNode, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface BentoGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function BentoGrid({ children, className = "", ...props }: BentoGridProps) {
  return (
    <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export interface BentoCardProps {
  /** Mono eyebrow line above the title (number or label register). */
  eyebrow?: string;
  /** Decorative icon; always rendered aria-hidden (paired with visible text). */
  icon?: IconComponent;
  title: ReactNode;
  /** Heading level for the title — "h3" by default, "h2" when the card
   *  carries its section's heading. */
  titleAs?: "h2" | "h3";
  /** Extra classes on the title element (e.g. editorial scale on a lead card). */
  titleClassName?: string;
  body?: ReactNode;
  /** Trailing slot — footers, links, or overlay decorations like BorderBeam. */
  children?: ReactNode;
  className?: string;
}

export function BentoCard({ eyebrow, icon: Icon, title, titleAs: Title = "h3", titleClassName = "", body, children, className = "" }: BentoCardProps) {
  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border border-night-edge bg-night-raised p-6 text-night-ink ${className}`.trim()}
    >
      {(eyebrow || Icon) && (
        <div className="flex items-center justify-between">
          {eyebrow ? (
            <span className="font-mono text-label font-semibold uppercase tracking-[0.2em] text-night-ink-soft">
              {eyebrow}
            </span>
          ) : (
            <span />
          )}
          {Icon && (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-night-edge bg-night text-quantum-soft">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
        </div>
      )}
      <Title className={`mt-5 text-2xl font-semibold tracking-[-0.04em] ${titleClassName}`.trim()}>{title}</Title>
      {body && <p className="mt-3 text-sm leading-6 text-night-ink-soft">{body}</p>}
      {children && <div className="mt-auto pt-5">{children}</div>}
    </article>
  );
}
