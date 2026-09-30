"use client";

import Link from "next/link";
import { ArrowRight, Bot, ShieldCheck } from "lucide-react";

export function AgentControlSection() {
  return (
    <section id="agents" className="landing-content-section">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <div><p className="landing-eyebrow">For people and agents</p><h2 className="landing-heading mt-4">Give an agent<br />clear boundaries.</h2><p className="mt-6 max-w-lg text-base leading-relaxed text-text-soft sm:text-lg">Set the market, budget, and approval rules. Keep the decisions that matter with your team.</p><Link href="/agent" className="mt-7 inline-flex min-h-tap items-center gap-2 text-sm font-semibold text-text-strong hover:text-accent">Explore agent controls <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
        <div className="rounded-[1.5rem] border border-border-soft bg-surface-raised p-6 sm:p-8">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-accent/10 p-3 text-accent"><Bot className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-base font-semibold text-text-strong">Treasury agent</h3><p className="mt-1 text-xs text-text-soft">Example permission boundaries</p></div></div>
          <dl className="mt-7 divide-y divide-border-soft text-sm">{[["Market", "SOL"], ["Budget", "$500"], ["Approval rule", "2 of 3 owners"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-text-soft">{label}</dt><dd className="font-medium text-text-strong">{value}</dd></div>)}</dl>
          <p className="mt-6 flex items-start gap-2 rounded-soft bg-canvas p-4 text-sm leading-relaxed text-text-soft"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> Permissions stay narrow. Requests outside the rules need attention.</p>
        </div>
      </div>
    </section>
  );
}
