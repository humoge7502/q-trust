import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CommandPalette } from "@/components/command-palette";

// next/navigation mock: capture pushed routes; stable pathname.
const push = vi.fn();
let currentPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPathname,
}));

describe("CommandPalette", () => {
  afterEach(() => {
    push.mockClear();
    currentPathname = "/";
    vi.restoreAllMocks();
  });

  it("opens from the trigger button and closes on Escape", async () => {
    render(<CommandPalette />);
    const trigger = screen.getByRole("button", { name: "Open command palette" });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument(),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("toggles with Ctrl/Cmd+K", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("filters results by query and shows a useful empty state", async () => {
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "verify" } });
    expect(screen.getByText("Verify an asset on-chain")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzzz-nothing" } });
    expect(screen.getByRole("status").textContent).toMatch(/nothing matches/i);
  });

  it("navigates with Enter on the active option and clears query", async () => {
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "pricing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/pricing"),
    );
    expect(input).toHaveValue("");
  });

  it("supports arrow-key navigation with aria-activedescendant", async () => {
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    const input = await screen.findByRole("combobox");
    const listbox = await screen.findByRole("listbox");
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThanOrEqual(5);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() =>
      expect(input.getAttribute("aria-activedescendant")).toBe("command-option-1"),
    );
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });
});
