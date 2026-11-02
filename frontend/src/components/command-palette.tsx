"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Global command palette (⌘K / Ctrl+K) — the keyboard-first navigation layer
 * of the product (the "advanced component" the UI/UX toolkits' checklist
 * names that this app lacked).
 *
 * Accessibility contract (Vercel web-interface-guidelines + Addy Osmani's
 * frontend-ui-engineering + Radix primitives):
 *  - a real <dialog>-grade Radix Dialog: focus is trapped, Escape closes,
 *    focus returns to the trigger on close;
 *  - the input is labelled; results are a listbox with aria-selected state;
 *  - full arrow-key navigation with active-option-follow, Enter to go;
 *  - never the only route to content: every palette entry is a page that is
 *    also reachable from the header/footer.
 */

interface CommandItem {
  label: string;
  hint: string;
  href: string;
  group: "Navigate" | "Work" | "Learn";
}

const COMMANDS: CommandItem[] = [
  { group: "Work", label: "Scan an estate", hint: "CBOM inventory from source, manifests, TLS", href: "/scanner" },
  { group: "Work", label: "Score risk against policy", hint: "Risk engine · NIST, CNSA 2.0", href: "/scanner" },
  { group: "Work", label: "Plan the migration", hint: "Outcome-optimized ordering (qrd-sim/1.0)", href: "/scanner" },
  { group: "Work", label: "Verify an asset on-chain", hint: "Public record lookup — no wallet", href: "/v" },
  { group: "Navigate", label: "Dashboard", hint: "Organization home", href: "/dashboard" },
  { group: "Navigate", label: "Vendors", hint: "Vendor attestations portal", href: "/vendors" },
  { group: "Navigate", label: "Pricing", hint: "Published tiers — free core, quoted assurance", href: "/pricing" },
  { group: "Navigate", label: "Evidence", hint: "OMB M-26-15 requirements mapped", href: "/evidence" },
  { group: "Learn", label: "Why now", hint: "The quantum threat, honestly explained", href: "/why-now" },
  { group: "Learn", label: "Research", hint: "Claims, measurements, and the tie", href: "/research" },
  { group: "Learn", label: "Compare", hint: "Q-Trust against the alternatives", href: "/compare" },
  { group: "Learn", label: "Demo", hint: "The full walkthrough", href: "/demo" },
  { group: "Learn", label: "Developers", hint: "SDKs, CLI, and the API", href: "/developers" },
];

const GROUP_ORDER: CommandItem["group"][] = ["Work", "Navigate", "Learn"];

/**
 * Cross-component open channel for the header-mounted trigger. The palette
 * owns the Dialog.Root (and the ⌘K listener), but the visible trigger lives
 * in the header's left cluster — a `Dialog.Trigger` mounted beside it cannot
 * share that root, so the trigger publishes this event and the palette
 * listens for it next to the keydown listener below.
 */
export const COMMAND_PALETTE_OPEN_EVENT = "qtrust:open-command-palette";

/** The shared trigger markup: one source for the header trigger and the
 *  (test-exercised) in-palette trigger, so classes and the accessible name
 *  cannot drift between the two mounts. */
function CommandPaletteTriggerButton({ onClick }: { onClick?: React.MouseEventHandler<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      aria-label="Open command palette"
      onClick={onClick}
      className="hidden items-center gap-2 rounded-full border border-white/20 px-3.5 py-2 text-xs font-medium text-night-ink-soft transition hover:border-white/50 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quantum-soft md:inline-flex"
    >
      <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.75" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.25 10.25 13.25 13.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Search
      <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] leading-none text-night-ink-soft">
        ⌘K
      </kbd>
    </button>
  );
}

/**
 * Presentational trigger for the site header (or any surface outside this
 * component's Dialog.Root). Renders the exact same control the palette used
 * to render as a body-level orphan; clicking publishes the open event the
 * palette's effect listens for.
 */
export function CommandPaletteTrigger() {
  return (
    <CommandPaletteTriggerButton
      onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT))}
    />
  );
}

export function CommandPalette({ renderTrigger = true }: { renderTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // ⌘K / Ctrl+K toggles; "/" focuses the palette too (common convention).
  // The header-mounted trigger opens the palette through the same listener
  // set (see COMMAND_PALETTE_OPEN_EVENT) — one window listener set owns both
  // entry points, so ⌘K and the button can never disagree about state.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenRequest);
    };
  }, []);

  // Close on route change so the palette never lingers over new content.
  // Render-time state adjustment (react.dev/learn/you-might-not-need-an-effect):
  // comparing against the previous pathname needs no effect and no cascade.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? COMMANDS.filter((item) =>
          `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q),
        )
      : COMMANDS;
    return [...filtered].sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  }, [query]);

  // Keep the active option in view during arrow-key navigation.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    // Optional-call guard: scrollIntoView is unavailable in some embedded
    // environments (jsdom tests, exotic webviews) — keyboard nav must not
    // depend on scrolling being possible.
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) go(target.href);
    }
  };

  let renderedGroup: CommandItem["group"] | null = null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/* Default-on so unit tests (which render <CommandPalette /> and click
          the trigger) pass unchanged; the root layout opts out and mounts
          <CommandPaletteTrigger /> inside the header instead. */}
      {renderTrigger && (
        <Dialog.Trigger asChild>
          <CommandPaletteTriggerButton />
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-night/70" />
        <Dialog.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-night-raised shadow-2xl focus-visible:outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search and jump to any part of Q-Trust.
          </Dialog.Description>
          <div className="border-b border-white/10">
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="command-palette-listbox"
              aria-activedescendant={
                results[activeIndex] ? `command-option-${activeIndex}` : undefined
              }
              aria-label="Search commands and pages"
              placeholder="Search pages and actions…"
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-transparent px-5 py-4 text-sm text-white placeholder:text-night-ink-soft focus-visible:outline-none"
            />
          </div>
          <div
            ref={listRef}
            id="command-palette-listbox"
            role="listbox"
            aria-label="Commands"
            className="max-h-[46vh] overflow-y-auto p-2"
          >
            {results.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-night-ink-soft" role="status">
                Nothing matches “{query.trim()}”. Try a page name like “scan” or “verify”.
              </p>
            ) : (
              results.map((item, index) => {
                const header =
                  item.group !== renderedGroup ? item.group : null;
                renderedGroup = item.group;
                return (
                  <div key={`${item.group}-${item.label}`}>
                    {header && (
                      <p
                        className={cn(
                          "px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-night-ink-soft",
                          index === 0 && "pt-1.5",
                        )}
                      >
                        {header}
                      </p>
                    )}
                    <button
                      type="button"
                      id={`command-option-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      data-index={index}
                      tabIndex={-1}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(item.href)}
                      className={cn(
                        "flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        index === activeIndex
                          ? "bg-quantum-soft/10 text-white"
                          : "text-night-ink-soft",
                      )}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="hidden text-xs text-night-ink-soft sm:block">
                        {item.hint}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-[11px] text-night-ink-soft">
            <span className="inline-flex items-center gap-2">
              <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] leading-none">↑↓</kbd>
              navigate
              <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] leading-none">↵</kbd>
              open
            </span>
            <span>
              or <Link href="/scanner" className="underline underline-offset-4 hover:text-night-ink">browse the scanner</Link>
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
