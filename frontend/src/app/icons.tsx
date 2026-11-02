/**
 * Inline SVG icon components — avoids pulling in lucide-react as a hard dep.
 * These are tiny (<1kB each) and tree-shakeable.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
};

// Icons are decorative by default (they are always paired with visible text,
// so exposing them to the a11y tree only adds "image, image" noise). Each
// <svg> carries aria-hidden="true" focusable="false"; a caller that needs a
// labelled icon overrides via props (spread last). See hallmark gate 33.

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function XCircleIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function ArrowTopRightOnSquareIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

export function CheckBadgeIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M12 2 14.5 5l4 .5-2 3.5 2 3.5-4 .5L12 22l-2.5-3-4-.5 2-3.5-2-3.5 4-.5L12 2z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function DocumentCheckIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

export function ChartBarIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 16v-4M12 16V8M17 16v-7" />
    </svg>
  );
}

export function BeakerIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      <path d="M8 14h8" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CpuChipIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

/** Scan / sweep — two expanding arcs plus a sweep line. */
export function RadarIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M19.07 4.93A10 10 0 1 0 21 12" />
      <path d="M15.54 8.46A6 6 0 1 0 18 12" />
      <path d="M12 12l8-8" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

/** Phased plan — three checked milestones. */
export function RouteIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3 6 1.5 1.5L7 5" />
      <path d="m3 12 1.5 1.5L7 11" />
      <path d="m3 18 1.5 1.5L7 17" />
    </svg>
  );
}

/** Timing trace — the side-channel surface's signal. */
export function ActivityIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M3 12h3l2.5-7 3 14 3-10 2 3h4.5" />
    </svg>
  );
}

/** Copy to clipboard. */
export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Confirmation tick. */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} aria-hidden="true" focusable="false" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
