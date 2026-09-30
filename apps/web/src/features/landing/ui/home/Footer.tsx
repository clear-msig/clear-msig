"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "@/components/retail/BrandMark";

export function Footer() {
  return (
    <footer className="landing-content-section border-t border-border-soft !pb-10">
      <div className="mx-auto max-w-2xl text-center"><p className="landing-eyebrow">Ready when you are</p><h2 className="landing-heading mt-4">Start with clarity.</h2><p className="mt-5 text-base leading-relaxed text-text-soft">Choose a wallet for your team, your agents, or your recovery plan.</p><Link href="/choose" className="neon-cta mt-8 inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold">Get started <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
      <div className="mt-20 flex flex-col justify-between gap-8 border-t border-border-soft pt-8 sm:flex-row sm:items-start">
        <div><Link href="/" aria-label="ClearSig home" className="inline-flex items-center gap-2"><BrandMark size={24} /><span className="text-sm font-semibold text-text-strong">ClearSig</span></Link><p className="mt-3 max-w-xs text-xs leading-relaxed text-text-soft">Devnet preview. Please don’t use real money yet.</p></div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-soft">
          <Link href="/privacy" className="inline-flex min-h-tap items-center hover:text-text-strong">Privacy</Link>
          <Link href="/security" className="inline-flex min-h-tap items-center hover:text-text-strong">Security</Link>
          <Link href="https://github.com/clear-msig/clear-msig" target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center hover:text-text-strong">GitHub</Link>
          <a href="mailto:info@clearsig.xyz" className="inline-flex min-h-tap items-center hover:text-text-strong">Contact</a>
        </nav>
      </div>
      <p className="mt-8 text-xs text-text-soft">© 2026 ClearSig</p>
    </footer>
  );
}
