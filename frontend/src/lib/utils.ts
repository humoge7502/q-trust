import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `text-micro` and `text-label` are font SIZES declared in `@theme`
 * (`--text-micro`, `--text-label`), but tailwind-merge has no way to know that:
 * any unrecognised `text-*` class is treated as a text colour. Combining them
 * with a colour — `cn("text-micro", "text-muted-foreground")`, which is exactly
 * how `PanelTitle`, `PanelDescription`, `SectionHeading` and `StatusPill` are
 * written — made the merge drop the size and keep the colour. The utilities
 * looked right in source and every heading silently rendered at the browser's
 * default 16px.
 *
 * Registering the size group restores the intended scale. Keep this list in
 * sync with the `--text-*` tokens in `globals.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-label", "text-micro"],
    },
  },
});

/** Merge Tailwind class names with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
