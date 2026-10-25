import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CertificationVerifier } from "@/components/certification-verifier.client";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const VALID_RESULT = {
  valid: true,
  bundle_id: "bndl_01",
  issuer: "did:key:z6MkIssuer",
  subject: "0x00000000000000000000000000000000000000aa",
  verdict: "CERTIFIED",
  reasons: [],
  caveats: ["Audit covers 42 of 45 assets."],
  valid_until: "2026-12-01T00:00:00.000Z",
  expired: false,
  checked: {
    structure: true,
    digest: true,
    merkle: true,
    signature: true,
    validity: true,
  },
  chain_anchor: "skipped",
  timestamp: "2026-10-25T00:00:00.000Z",
};

function submit(text = JSON.stringify({ schema: "qtrust.certification.v1" })) {
  fireEvent.change(screen.getByLabelText("Bundle JSON"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Verify bundle" }));
}

describe("CertificationVerifier", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects malformed JSON without calling the API", () => {
    const fetchMock = mockFetch(200, VALID_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    render(<CertificationVerifier />);

    submit("{ not json");

    expect(screen.getByRole("alert")).toHaveTextContent("Bundle is not valid JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports every passing check and the parsed bundle", async () => {
    const fetchMock = mockFetch(200, VALID_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    render(<CertificationVerifier />);

    submit();

    await waitFor(() => expect(screen.getByText("Valid")).toBeInTheDocument());
    expect(screen.getAllByText("Passed")).toHaveLength(5);
    expect(screen.getByText("Evidence Merkle root")).toBeInTheDocument();
    expect(screen.getByText("did:key:z6MkIssuer")).toBeInTheDocument();
    expect(screen.getByText("Not requested — offline verification only")).toBeInTheDocument();
    expect(screen.getByText("Audit covers 42 of 45 assets.")).toBeInTheDocument();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.check_chain).toBe(false);
    expect(body.bundle.schema).toBe("qtrust.certification.v1");
  });

  it("shows the verifier's reasons when a check fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        ...VALID_RESULT,
        valid: false,
        reasons: ["evidence digest mismatch at leaf 2"],
        checked: { ...VALID_RESULT.checked, digest: false },
      }),
    );
    render(<CertificationVerifier />);

    submit();

    await waitFor(() => expect(screen.getByText("Not valid")).toBeInTheDocument());
    expect(screen.getByText("Why this failed")).toBeInTheDocument();
    expect(screen.getByText("evidence digest mismatch at leaf 2")).toBeInTheDocument();
    expect(screen.getAllByText("Passed")).toHaveLength(4);
    expect(screen.getAllByText("Failed")).toHaveLength(1);
  });

  it("surfaces an API error instead of an empty result", async () => {
    vi.stubGlobal("fetch", mockFetch(503, { error: "Certification verifier unavailable" }));
    render(<CertificationVerifier />);

    submit();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Certification verifier unavailable"),
    );
    expect(screen.queryByText("Verification result")).not.toBeInTheDocument();
  });

  it("pins the expected issuer when one is supplied", async () => {
    const fetchMock = mockFetch(200, VALID_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    render(<CertificationVerifier />);

    fireEvent.change(screen.getByLabelText(/Pinned issuer DID/), {
      target: { value: "did:key:z6MkExpected" },
    });
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.trust_anchor_did).toBe("did:key:z6MkExpected");
  });

  it("offers this deployment's key as a pin only when the page knows it", async () => {
    const fetchMock = mockFetch(200, VALID_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<CertificationVerifier />);
    expect(screen.queryByRole("button", { name: "Use as pinned issuer" })).not.toBeInTheDocument();

    rerender(
      <CertificationVerifier
        platformIssuer={{
          issuer: "did:key:z6MkPlatform",
          verification_method: "did:key:z6MkPlatform#key-1",
          key_fingerprint: "a1b2c3d4e5f60718293a4b5c6d7e8f90", // gitleaks:allow  # fake test fixture fingerprint
        }}
      />,
    );
    expect(screen.getByText(/This deployment signs bundles with/)).toHaveTextContent(
      "did:key:z6MkPlatform",
    );
    // The full fingerprint is long and adds no decision value on screen.
    expect(screen.getByText("a1b2c3d4e5f60718")).toBeInTheDocument();
    expect(screen.queryByText(/a1b2c3d4e5f60718293a/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use as pinned issuer" }));
    expect(screen.getByLabelText(/Pinned issuer DID/)).toHaveValue("did:key:z6MkPlatform");

    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).trust_anchor_did).toBe("did:key:z6MkPlatform");
  });

  it("confirms a pin that already matches this deployment instead of offering it again", () => {
    vi.stubGlobal("fetch", mockFetch(200, VALID_RESULT));
    render(
      <CertificationVerifier
        platformIssuer={{
          issuer: "did:key:z6MkPlatform",
          verification_method: "did:key:z6MkPlatform#key-1",
          key_fingerprint: "a1b2c3d4e5f60718293a4b5c6d7e8f90", // gitleaks:allow  # fake test fixture fingerprint
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Pinned issuer DID/), {
      target: { value: "did:key:z6MkPlatform" },
    });

    expect(screen.queryByRole("button", { name: "Use as pinned issuer" })).not.toBeInTheDocument();
    expect(screen.getByText(/Pinned to this deployment/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pinned issuer DID/)).toHaveAccessibleDescription(
      /a bundle signed by any other key is rejected/,
    );
  });
});
