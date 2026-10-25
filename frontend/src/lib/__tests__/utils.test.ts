import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * Regression guard for the font-size utilities.
 *
 * tailwind-merge treats an unknown `text-*` class as a text colour. Before the
 * custom sizes were registered, `cn("text-micro", "text-muted-foreground")`
 * kept only the colour, so every `PanelTitle` / `PanelDescription` /
 * `SectionHeading` / `StatusPill` rendered at the browser default 16px while
 * its source claimed 10–11px. These assertions are on the merged output, which
 * is what the components actually render.
 */
describe("cn", () => {
  it("keeps custom font sizes alongside a text colour", () => {
    expect(cn("text-micro", "text-muted-foreground")).toBe("text-micro text-muted-foreground");
    expect(cn("font-mono text-label text-muted-foreground")).toBe(
      "font-mono text-label text-muted-foreground",
    );
  });

  it("still resolves conflicts inside a group", () => {
    expect(cn("text-micro", "text-xs")).toBe("text-xs");
    expect(cn("text-muted-foreground", "text-danger")).toBe("text-danger");
  });
});
