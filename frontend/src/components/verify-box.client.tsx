"use client";

/**
 * Dark (marketing-surface) variant of the asset lookup.
 *
 * Converted from a click handler + `onKeyDown` to a real `<form>`: implicit
 * submission, Enter-to-submit and the accessible name/role of a submit control
 * are then the browser's job rather than something reimplemented by hand. The
 * validation rule and error copy now come from `useVerifyAsset`, so this box
 * and the `/v` form cannot disagree about what a valid asset ID is.
 */
import Link from "next/link";
import { EXAMPLE_ASSET_ID, useVerifyAsset } from "@/hooks/use-verify-asset";
import { ArrowRightIcon, ShieldCheckIcon } from "@/app/icons";
import { CodeBlock } from "@/components/ui/code-block";

export function VerifyBox() {
  const { error, pending, verify, clearError } = useVerifyAsset();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-5 shadow-2xl backdrop-blur-xl sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-cyan-300/15 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-300 ring-1 ring-inset ring-emerald-300/25" aria-hidden="true"><ShieldCheckIcon className="h-4 w-4" /></span>
        <div><h2 className="text-sm font-semibold text-white">Verify an attestation</h2><p className="mt-1 text-xs text-slate-400">Public, wallet-free, checked on-chain.</p></div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 motion-reduce:animate-none" aria-hidden="true" /> Live</span>
      </div>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("assetId");
          verify(typeof value === "string" ? value : "");
        }}
      >
        <label htmlFor="verify-input" className="relative mt-6 block text-xs font-medium text-slate-300">Asset ID <span className="font-normal text-slate-400">(0x + 64 hex)</span></label>
        <div className="relative mt-2 flex gap-2">
          <input
            id="verify-input"
            name="assetId"
            placeholder={EXAMPLE_ASSET_ID}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            aria-describedby={error ? "verify-error verify-help" : "verify-help"}
            aria-invalid={error ? true : undefined}
            onChange={clearError}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/60 px-3 py-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
          />
          <button type="submit" disabled={pending} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60">
            {pending ? "Opening…" : "Verify"} <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <p id="verify-help" className="relative mt-3 text-[11px] leading-relaxed text-slate-400">Paste a full asset ID or{" "}
          <button
            type="button"
            onClick={() => {
              const input = document.getElementById("verify-input");
              if (input instanceof HTMLInputElement) {
                input.value = EXAMPLE_ASSET_ID;
                clearError();
                input.focus();
              }
            }}
            className="text-slate-300 underline decoration-slate-600 underline-offset-4 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            use the example
          </button>
          . No wallet required.</p>
        {error ? <p id="verify-error" role="alert" className="relative mt-3 rounded-lg bg-rose-300/10 px-3 py-2 text-xs font-medium text-rose-200 ring-1 ring-inset ring-rose-300/20">{error}</p> : null}
      </form>

      <div className="relative mt-6 border-t border-white/10 pt-4"><div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Verify independently</div><CodeBlock label="Independent verification command" className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-slate-300"><code>{`qtrust verify ${EXAMPLE_ASSET_ID.slice(0, 18)}…`}</code></CodeBlock><Link href="/v" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Learn about asset IDs <ArrowRightIcon className="h-3 w-3" aria-hidden="true" /></Link></div>
    </div>
  );
}
