"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, Check, ShieldCheck } from "lucide-react";

export function Hero() {
  return (
    <section className="relative grid min-h-[calc(100svh-72px)] items-center gap-12 px-5 py-16 sm:min-h-[calc(100svh-100px)] sm:px-10 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
      <div className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">ClearSig · shared wallets</p>
        <h1 className="mt-6 text-[clamp(3.25rem,7.5vw,6.5rem)] font-medium leading-[1.02] tracking-[-0.055em] text-text-strong">
          Sign intents.<br /><span className="text-accent">Not hex.</span>
        </h1>
        <p className="mt-7 max-w-lg text-lg leading-relaxed text-text-soft sm:text-xl">
          Move money together, with readable approvals and clear rules before anything moves.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
          <Link href="/choose" className="neon-cta inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold">
            Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href="#why" className="inline-flex min-h-12 items-center gap-2 text-sm font-medium text-text-strong hover:text-accent">
            How it works <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <p className="mt-5 text-xs text-text-soft">Devnet preview · test funds only</p>
      </div>
      <div className="mx-auto w-full max-w-md rounded-[1.5rem] border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-8" aria-label="Example of a readable approval">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div><p className="text-sm font-semibold text-text-strong">A clear approval</p><p className="mt-0.5 text-xs text-text-soft">Illustrative signing receipt</p></div>
        </div>
        <p className="mt-9 font-numerals text-4xl font-medium tracking-[-0.04em] text-text-strong">5 <span className="text-2xl text-text-soft">SOL</span></p>
        <p className="mt-2 text-sm text-text-soft">to Operations vault</p>
        <dl className="mt-7 divide-y divide-border-soft text-sm">
          {[['Network', 'Solana'], ['Spending limit', '$500 cap'], ['Approval rule', '2 of 3 owners']].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-text-soft">{label}</dt><dd className="text-right font-medium text-text-strong">{value}</dd></div>
          ))}
        </dl>
        <p className="mt-5 flex items-center gap-2 border-t border-border-soft pt-5 text-sm text-text-soft"><Check className="h-4 w-4 text-accent" aria-hidden="true" /> The action is visible before you sign</p>
      </div>
    </section>
  );
}
