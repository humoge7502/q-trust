"use client";

import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { CHAIN } from "@/lib/config";
import { API_DOCS_URL } from "@/lib/api";
import { ArrowRightIcon, ArrowTopRightOnSquareIcon } from "@/app/icons";

function MenuIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}><path d="M6 6l12 12M6 18L18 6" /></svg>;
}

const navItems = [
  { label: "Protocol", href: "/#protocol" },
  { label: "Scanner", href: "/scanner" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Verify", href: "/v" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.5rem] max-w-[88rem] items-center justify-between gap-5 px-5 sm:px-8 lg:px-12">
        <Link href="/" className="group flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-bold tracking-widest text-slate-950 transition group-hover:bg-cyan-200" aria-hidden="true">QT</span>
          <span className="text-sm font-semibold tracking-tight text-white">Q-Trust</span>
          <span className="hidden border-l border-white/20 pl-3 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:inline">PQC assurance</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link key={item.label} href={item.href} className="rounded-full px-4 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{item.label}</Link>
          ))}
          <a href={`${API_DOCS_URL.replace(/\/$/, "")}/docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">API docs <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" /></a>
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 lg:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" /> {CHAIN.name}</span>
          <Link href="/dashboard" className="hidden items-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:inline-flex">Launch app <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" /></Link>

          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button type="button" aria-label="Open menu" aria-expanded={open} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 md:hidden"><MenuIcon className="h-4 w-4" aria-hidden="true" /></button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
              <Dialog.Content aria-label="Mobile navigation" className="fixed inset-y-0 right-0 z-50 flex h-full w-[86%] max-w-sm flex-col border-l border-white/10 bg-slate-950 p-6 shadow-2xl">
                <div className="flex items-center justify-between"><Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-bold tracking-widest text-slate-950">QT</span><span className="text-sm font-semibold text-white">Q-Trust</span></Link><Dialog.Close asChild><button type="button" aria-label="Close menu" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><CloseIcon className="h-4 w-4" aria-hidden="true" /></button></Dialog.Close></div>
                <Dialog.Title className="sr-only">Navigation menu</Dialog.Title>
                <Dialog.Description className="sr-only">Primary navigation for mobile</Dialog.Description>
                <nav aria-label="Mobile" className="mt-10 flex flex-col gap-2">{navItems.map((item) => <Link key={item.label} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-base font-medium text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{item.label}</Link>)}<a href={`${API_DOCS_URL.replace(/\/$/, "")}/docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl px-3 py-3 text-base font-medium text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">API docs <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" /></a></nav>
                <div className="mt-auto border-t border-white/10 pt-6"><div className="mb-4 flex items-center gap-2 text-xs text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" /> {CHAIN.name} · live</div><Link href="/dashboard" onClick={() => setOpen(false)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Launch app <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></Link></div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
