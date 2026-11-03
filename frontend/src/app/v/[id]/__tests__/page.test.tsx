/**
 * Regression test (post-merge adversarial pass, audit H-7 pattern): the
 * unreachable branch of /v/[id] renders a copy-pastable CLI snippet from the
 * RAW route param. The main flow already gates every snippet through
 * `parseAssetId`; this pins the same gate on `VerificationUnavailable`, so a
 * poisoned URL like /v/0xdead'); import os; os.system('id') can never plant
 * shell metacharacters in the rendered command.
 *
 * The page is an async server component, so the test awaits it directly and
 * walks the returned element tree instead of rendering a DOM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const apiMocks = vi.hoisted(() => ({
  fetchAsset: vi.fn(),
  fetchAssetVerification: vi.fn(),
  fetchIpfsJson: vi.fn(),
}));

vi.mock("@/lib/api", () => apiMocks);

// `notFound()` is only reached on a clean 404; the unavailable branch under
// test never calls it. The stub keeps the module import hermetic.
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import VerificationPage from "../page";

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const element = node as ReactElement;
  if (typeof element === "object" && "props" in element) {
    return textOf((element.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Resolve function components down to plain elements, then find the <code>. */
function codeTextIn(root: ReactNode): string | null {
  const stack: ReactNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined || typeof current === "boolean") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const element = current as ReactElement<{ children?: ReactNode }>;
    if (typeof element !== "object" || !("type" in element)) continue;
    if (element.type === "code") return textOf(element.props.children);
    if (typeof element.type === "function") {
      stack.push((element.type as (props: unknown) => ReactNode)(element.props));
      continue;
    }
    if (element.props && typeof element.props === "object" && "children" in element.props) {
      stack.push((element.props as { children?: ReactNode }).children);
    }
  }
  return null;
}

async function unavailableCliSnippet(id: string): Promise<string | null> {
  const tree = (await VerificationPage({
    params: Promise.resolve({ id }),
  })) as ReactElement;
  const code = codeTextIn(tree);
  return code === null ? null : code.trim();
}

describe("/v/[id] unreachable-branch CLI snippet (audit H-7)", () => {
  beforeEach(() => {
    apiMocks.fetchAsset.mockReset();
    apiMocks.fetchAssetVerification.mockReset();
    // Non-404 failure drives the page into the unreachable branch.
    apiMocks.fetchAsset.mockRejectedValue(new Error("502 Bad Gateway"));
    apiMocks.fetchAssetVerification.mockRejectedValue(new Error("502 Bad Gateway"));
  });

  it("renders the asset id verbatim for a well-formed id", async () => {
    const id = `0x${"ab".repeat(32)}`;
    expect(await unavailableCliSnippet(id)).toBe(`crypto-inspector verify ${id}`);
  });

  it("substitutes a literal placeholder for a poisoned id", async () => {
    const poison = `0xdeadbeef'); import os; os.system('id'); #`;
    const snippet = await unavailableCliSnippet(poison);
    expect(snippet).toBe("crypto-inspector verify <asset-id>");
    // Belt and braces: no fragment of the raw param may reach the snippet.
    expect(snippet).not.toContain("os.system");
    expect(snippet).not.toContain(poison);
  });
});
