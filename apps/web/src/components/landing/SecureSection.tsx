"use client";

import Link from "next/link";
import { ArrowRight, KeyRound, ShieldCheck, Users } from "lucide-react";

export function SecureSection() {
  return (
    <section id="secure" className="landing-content-section">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <div><p className="landing-eyebrow">Recovery, planned ahead</p><h2 className="landing-heading mt-4">Lose a device.<br />Keep a way back.</h2><p className="mt-6 max-w-lg text-base leading-relaxed text-text-soft sm:text-lg">Choose trusted members and passkeys. Set the threshold needed to recover your vault.</p><Link href="/secure" className="mt-7 inline-flex min-h-tap items-center gap-2 text-sm font-semibold text-text-strong hover:text-accent">Explore recovery <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
        <div className="rounded-[1.5rem] border border-border-soft bg-surface-raised p-6 sm:p-8">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-accent/10 p-3 text-accent"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-base font-semibold text-text-strong">Your recovery plan</h3><p className="mt-1 text-xs text-text-soft">Personal vault · devnet preview</p></div></div>
          <div className="mt-7 space-y-5">{[{ Icon: Users, title: "Trusted members", detail: "Choose who can help you recover." }, { Icon: KeyRound, title: "Passkeys", detail: "Use credentials on devices you trust." }, { Icon: ShieldCheck, title: "An approval threshold", detail: "Decide how many approvals are required." }].map(({ Icon, title, detail }) => <div key={title} className="flex gap-4 border-t border-border-soft pt-5"><Icon className="mt-1 h-5 w-5 shrink-0 text-text-soft" aria-hidden="true" /><div><p className="text-sm font-medium text-text-strong">{title}</p><p className="mt-1 text-sm text-text-soft">{detail}</p></div></div>)}</div>
        </div>
      </div>
    </section>
  );
}
