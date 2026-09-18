"use client";

/**
 * Asset-ID lookup form for the standalone `/v` route.
 *
 * `/v` is the destination of the "Verify" item in the primary navigation on
 * every page, and it previously offered no input at all — it told visitors to
 * paste an asset ID "into the address bar" and linked back home. The nav item
 * was a dead end. This is the real control.
 *
 * Built on a native `<form>` with `onSubmit` rather than a click handler plus
 * `onKeyDown`: the browser then owns Enter-to-submit, implicit submission and
 * the submit semantics assistive technology announces. `Enter` handling
 * written by hand is one of the most common places a form quietly stops
 * working for keyboard and screen-reader users.
 *
 * This is the light-surface variant (the app layer); `VerifyBox` is the dark
 * marketing variant. They share `useVerifyAsset`, so the validation rule and
 * the error copy cannot drift apart.
 */
import { ShieldCheckIcon } from "@/app/icons";
import { EXAMPLE_ASSET_ID, useVerifyAsset } from "@/hooks/use-verify-asset";

export function VerifyForm() {
  const { error, pending, verify, clearError } = useVerifyAsset();

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("assetId");
        verify(typeof value === "string" ? value : "");
      }}
    >
      <label htmlFor="asset-id" className="block text-sm font-medium text-slate-900">
        Asset ID
        <span className="ml-2 font-mono text-xs font-normal text-slate-600">
          0x + 64 hex
        </span>
      </label>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="asset-id"
          name="assetId"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={EXAMPLE_ASSET_ID}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "asset-id-error asset-id-help" : "asset-id-help"}
          onChange={clearError}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 font-mono text-xs text-slate-900 placeholder:text-slate-500 transition focus:border-qtrust-600 focus:outline-none focus:ring-2 focus:ring-qtrust-600/25 aria-[invalid=true]:border-risk-critical"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0"
        >
          {pending ? "Opening…" : "Verify"}
        </button>
      </div>

      <p id="asset-id-help" className="mt-3 text-xs leading-6 text-slate-600">
        Paste a full asset ID, or{" "}
        <button
          type="button"
          onClick={() => {
            const input = document.getElementById("asset-id");
            if (input instanceof HTMLInputElement) {
              input.value = EXAMPLE_ASSET_ID;
              clearError();
              input.focus();
            }
          }}
          className="font-medium text-slate-900 underline decoration-slate-400 underline-offset-4 transition hover:decoration-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
        >
          use the example
        </button>
        . No wallet or account required.
      </p>

      {error ? (
        <p
          id="asset-id-error"
          role="alert"
          className="mt-3 rounded-xl border border-risk-critical/30 bg-risk-critical/5 px-3 py-2 text-xs font-medium text-risk-critical"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-6 flex items-start gap-2 border-t border-slate-200 pt-5 text-xs leading-6 text-slate-600">
        <ShieldCheckIcon className="mt-1 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
        <span>
          Verification reads the on-chain record directly: status, organization,
          CBOM hash and timestamp. Nothing about the underlying evidence leaves
          its private store.
        </span>
      </p>
    </form>
  );
}
