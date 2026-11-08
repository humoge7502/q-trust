"use client";

/**
 * Operator access UI.
 *
 * The same-origin proxy refuses the money/state-mutating surface (relayer
 * submissions, workspace writes, webhook mutations, credential issuance)
 * unless the caller presents its own credential — see
 * `lib/api-route-policy.ts`. Scanner, planner, evidence and GPU compute are
 * open to every visitor and never need this panel. Before this component the
 * affected controls simply failed with an opaque 403; they now render either a
 * proactive "Operator access" panel or an in-context prompt.
 *
 * CREDENTIAL HANDLING
 * -------------------
 * Saving a key first tries to EXCHANGE it for a short-lived session token
 * (`lib/operator-session.ts`): the raw key is presented exactly once and never
 * stored, and the browser keeps only the session. If the session service is
 * unavailable, saving falls back to today's behaviour and keeps the raw key in
 * this tab's `sessionStorage`. Either way the credential is never rendered
 * back in full and is never sent anywhere except the same-origin proxy.
 */
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { useOperatorKey } from "@/hooks/use-operator-key";
import { useOperatorSession } from "@/hooks/use-operator-session";
import { clearOperatorSession, exchangeOperatorKey } from "@/lib/operator-session";
import { setOperatorKey } from "@/lib/operator-key";

/** Mask a stored key so it is identifiable without being disclosed in full. */
function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Honest, tone-tagged outcome text for the last save/clear action. */
interface Feedback {
  tone: "success" | "error";
  message: string;
}

function KeyField({ onSaved }: { onSaved?: () => void }) {
  const keyId = useId();
  const helpId = `${keyId}-help`;
  const statusId = `${keyId}-status`;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const current = useOperatorKey();
  const session = useOperatorSession();

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await exchangeOperatorKey(trimmed);
      if (result.ok) {
        // The session now carries access; drop any raw key so it does not
        // linger as a second, stronger credential. (exchangeOperatorKey also
        // clears it — this keeps the invariant if the store changes later.)
        setOperatorKey("");
        setDraft("");
        setFeedback({
          tone: "success",
          message: "Session started for this tab — your key was not stored.",
        });
        onSaved?.();
      } else if (result.reason === "rejected") {
        // The server saw the key and refused it. Persist nothing — a stored
        // rejected key would just make every privileged call fail with an
        // opaque backend error instead of this honest one.
        setFeedback({
          tone: "error",
          message: "The server rejected this key. Check that it is valid and not revoked.",
        });
      } else {
        // Session service unavailable (older backend, 503, network): fall back
        // to keeping the raw key in this tab's sessionStorage, exactly the
        // pre-session behaviour.
        setOperatorKey(trimmed);
        setDraft("");
        setFeedback({
          tone: "success",
          message: "Session service unavailable — key kept in this tab's storage instead.",
        });
        onSaved?.();
      }
    } finally {
      setPending(false);
    }
  }

  function clear() {
    setOperatorKey(null);
    clearOperatorSession();
    setFeedback(null);
    onSaved?.();
  }

  const hasCredential = Boolean(session) || Boolean(current);

  return (
    <div className="mt-3">
      <label htmlFor={keyId} className="block text-micro font-medium text-neutral">
        Q-Trust API key
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input
          id={keyId}
          type="password"
          name="qtrust-operator-key"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={helpId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={
            session
              ? "Session active"
              : current
                ? `Stored: ${maskKey(current)}`
                : "Paste your API key"
          }
          className="max-w-xs font-mono"
        />
        <Button size="sm" onClick={() => void save()} disabled={!draft.trim() || pending}>
          {pending ? "Exchanging…" : "Save key"}
        </Button>
        {hasCredential ? (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>
      <p id={helpId} className="mt-2 max-w-prose text-micro leading-5 text-muted-foreground">
        Your key is exchanged once for a short-lived session token and is not stored in
        the browser; the token is sent to the same-origin API proxy and forwarded as the
        backend <code className="rounded bg-neutral-surface px-1">x-api-key</code>. If the
        session service is unavailable, the key is kept in this tab&rsquo;s session
        storage only. The server-side admin key is never used for privileged routes, so
        each operator should use their own key.
      </p>
      {feedback ? (
        <p
          id={statusId}
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`mt-2 text-micro font-medium ${feedback.tone === "error" ? "text-danger" : "text-success"}`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

/** Collapsible settings panel, for pages that offer several privileged actions. */
export function OperatorAccessPanel({
  defaultOpen = false,
  variant = "card",
}: {
  defaultOpen?: boolean;
  /**
   * `card` — a full bordered block, for operator-facing pages where privileged
   * actions are the point (`/dashboard`, `/vendors`).
   *
   * `strip` — a single 40px row with the explanation behind a disclosure, for
   * the public surface. On `/scanner` the card variant sat *above* the tool and
   * was the first thing a visitor saw, which read as "this product needs a key"
   * when in fact nothing on the page does. The strip states the opposite —
   * public surface, key optional — and still opens the same field.
   */
  variant?: "card" | "strip";
}) {
  const current = useOperatorKey();
  const session = useOperatorSession();
  const hasCredential = Boolean(session) || Boolean(current);
  const credentialLabel = session ? "session active" : current ? "key set" : "optional";

  if (variant === "strip") {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-micro font-medium text-muted-foreground transition hover:border-slate-400 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 [&::-webkit-details-marker]:hidden">
          <span
            className={`h-1.5 w-1.5 rounded-full ${hasCredential ? "bg-success" : "bg-slate-400"}`}
            aria-hidden="true"
          />
          Operator access
          <span aria-hidden="true">·</span>
          <span className="font-normal">{hasCredential ? credentialLabel : "optional"}</span>
        </summary>
        <div className="mt-3 rounded-xl border border-border bg-white p-4">
          <p className="max-w-prose text-micro leading-6 text-muted-foreground">
            Only relayer submissions, workspace writes, webhook mutations and
            credential issuance require the caller&rsquo;s own key. Scanning, the AI
            planner, evidence records, GPU analysis, public verification, risk scoring
            and compliance evaluation are open to every visitor and need no key.
          </p>
          <KeyField />
        </div>
      </details>
    );
  }

  return (
    <details
      open={defaultOpen}
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600">
        Operator access
        <StatusPill tone={hasCredential ? "success" : "neutral"} className="ml-2">
          {hasCredential ? credentialLabel : "no key"}
        </StatusPill>
      </summary>
      <p className="mt-3 max-w-prose text-micro leading-6 text-muted-foreground">
        Only relayer submissions, workspace writes, webhook mutations and credential
        issuance require the caller&rsquo;s own key. Scanning, the AI planner, evidence
        records, GPU analysis, public verification, risk scoring and compliance
        evaluation are open to every visitor and need no key.
      </p>
      <KeyField />
    </details>
  );
}

/**
 * In-context prompt shown when a privileged action was attempted without a
 * credential (or with one the backend refused). Saving the key calls
 * `onSaved`, so callers can immediately retry.
 */
export function OperatorAccessInline({
  endpoint,
  onSaved,
}: {
  endpoint: string;
  onSaved?: () => void;
}) {
  const current = useOperatorKey();
  return (
    <div
      role="alert"
      data-tone="warning"
      className="mt-3 rounded-lg border border-warning-border bg-warning-surface p-3 text-micro text-warning"
    >
      <p className="font-semibold">Operator access required</p>
      <p className="mt-1 leading-5">
        <code className="rounded bg-card/70 px-1 font-mono">{endpoint}</code> mutates
        on-chain state or spends relayer gas, so it needs an API key. Add your Q-Trust API
        key to continue, or call the API directly with your own key.
      </p>
      {current ? (
        <p className="mt-2 leading-5">
          A key is already set for this tab, so the request was rejected by the backend.
          Check that the key is valid and not revoked.
        </p>
      ) : (
        <KeyField onSaved={onSaved} />
      )}
    </div>
  );
}
