"use client";

import { Check, ReceiptText, ShieldCheck, Users } from "lucide-react";

export function WhyClear() {
  return (
    <section id="why" className="landing-content-section">
      <div className="mb-10 max-w-2xl sm:mb-14">
        <p className="landing-eyebrow">Read before signing</p>
        <h2 className="landing-heading mt-4">A shared wallet<br />you can read.</h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-text-soft sm:text-lg">See the amount, destination, and approval rules in one receipt. No decoding required.</p>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="rounded-[1.5rem] border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-soft">Signing receipt</p>
            <ReceiptText className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <p className="mt-7 font-numerals text-4xl font-medium tracking-[-0.04em] text-text-strong sm:text-5xl">5 SOL</p>
          <p className="mt-2 text-base text-text-soft">to Operations vault</p>
          <dl className="mt-7 divide-y divide-border-soft">
            {[["Action", "Send"], ["Network", "Solana"], ["Policy", "$500 cap"], ["Approvals", "2 of 3 owners"]].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-3 text-sm"><dt className="text-text-soft">{label}</dt><dd className="font-medium text-text-strong">{value}</dd></div>
            ))}
          </dl>
          <p className="mt-5 flex items-center gap-2 text-xs text-text-soft"><Check className="h-4 w-4 text-accent" aria-hidden="true" /> An example, not a live transaction</p>
        </div>
        <div>
          <div className="divide-y divide-border-soft">
            {[
              { Icon: ReceiptText, title: "Understand the action", detail: "The destination and amount stay visible, right where you need them." },
              { Icon: ShieldCheck, title: "Keep limits in view", detail: "Review the rules that apply before approving a request." },
              { Icon: Users, title: "Know who approves", detail: "See the approval threshold and the people responsible." },
            ].map(({ Icon, title, detail }) => (
              <div key={title} className="flex gap-4 py-6 first:pt-1"><Icon className="mt-1 h-5 w-5 shrink-0 text-accent" aria-hidden="true" /><div><h3 className="text-base font-semibold text-text-strong">{title}</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-text-soft">{detail}</p></div></div>
            ))}
          </div>
          <details className="mt-5 rounded-soft border border-border-soft p-4 text-sm text-text-soft">
            <summary className="cursor-pointer font-medium text-text-strong">Why raw transaction data isn’t enough</summary>
            <p className="mt-3 leading-relaxed">A hash such as <span className="font-mono">0x7a9f2c01b8e4</span> doesn’t explain where money goes. ClearSig presents the readable action alongside the rules you’re approving.</p>
          </details>
        </div>
      </div>
    </section>
  );
}
