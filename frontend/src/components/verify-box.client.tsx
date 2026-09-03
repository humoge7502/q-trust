"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseAssetId } from "@/lib/config";
import { ArrowRightIcon, ShieldCheckIcon } from "@/app/icons";

const EXAMPLE_ASSET_ID = "0x7b52d7b29272207cab6c061ee4e58141b434ce20eef955b5684c175ceb12c6b6";

export function VerifyBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleVerify() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter an asset ID (0x + 64 hex chars).");
      return;
    }
    try {
      setError(null);
      router.push(`/v/${parseAssetId(trimmed)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid asset ID.");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-5 shadow-2xl backdrop-blur-xl sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-cyan-300/15 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-300 ring-1 ring-inset ring-emerald-300/25" aria-hidden="true"><ShieldCheckIcon className="h-4 w-4" /></span>
        <div><h2 className="text-sm font-semibold text-white">Verify an attestation</h2><p className="mt-1 text-xs text-slate-400">Public, wallet-free, checked on-chain.</p></div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 motion-reduce:animate-none" aria-hidden="true" /> Live</span>
      </div>

      <label htmlFor="verify-input" className="relative mt-6 block text-xs font-medium text-slate-300">Asset ID <span className="font-normal text-slate-500">(0x + 64 hex)</span></label>
      <div className="relative mt-2 flex gap-2">
        <input id="verify-input" value={value} onChange={(e) => { setValue(e.target.value); if (error) setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }} placeholder={EXAMPLE_ASSET_ID} spellCheck={false} autoComplete="off" inputMode="text" aria-describedby={error ? "verify-error verify-help" : "verify-help"} aria-invalid={error ? "true" : undefined} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/60 px-3 py-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20" />
        <button type="button" onClick={handleVerify} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">Verify <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div>
      <p id="verify-help" className="relative mt-3 text-[11px] leading-relaxed text-slate-500">Paste a full asset ID or <button type="button" onClick={() => setValue(EXAMPLE_ASSET_ID)} className="text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">use the example</button>. No wallet required.</p>
      {error ? <p id="verify-error" role="alert" aria-live="polite" className="relative mt-3 rounded-lg bg-rose-300/10 px-3 py-2 text-xs font-medium text-rose-200 ring-1 ring-inset ring-rose-300/20">{error}</p> : null}

      <div className="relative mt-6 border-t border-white/10 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Verify independently</div><pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-slate-300"><code>{`qtrust verify ${EXAMPLE_ASSET_ID.slice(0, 18)}…`}</code></pre><Link href="/v" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200">Learn about asset IDs <ArrowRightIcon className="h-3 w-3" aria-hidden="true" /></Link></div>
    </div>
  );
}

export const VERIFY_EXAMPLE_ASSET_ID = EXAMPLE_ASSET_ID;
