"use client";

import { ReceiptText, ShieldCheck, Users } from "lucide-react";

export function Bento() {
  return (
    <section id="bento" className="landing-content-section">
      <div className="max-w-2xl"><p className="landing-eyebrow">A simple flow</p><h2 className="landing-heading mt-4">One clear step<br />at a time.</h2></div>
      <ol className="mt-10 grid gap-5 sm:mt-14 md:grid-cols-3">
        {[
          { Icon: ReceiptText, title: "Describe the action", body: "Choose who gets paid, how much, and on which network." },
          { Icon: ShieldCheck, title: "Review the rules", body: "Check the spending limits and conditions before signing." },
          { Icon: Users, title: "Approve together", body: "The required owners review the same readable request." },
        ].map(({ Icon, title, body }, index) => (
          <li key={title} className="rounded-card border border-border-soft bg-surface-raised p-6 sm:p-7">
            <div className="flex items-center justify-between text-text-soft"><Icon className="h-5 w-5" aria-hidden="true" /><span className="font-mono text-xs">0{index + 1}</span></div>
            <h3 className="mt-7 text-lg font-semibold text-text-strong">{title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-text-soft">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
