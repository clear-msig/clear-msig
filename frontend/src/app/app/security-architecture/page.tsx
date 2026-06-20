"use client";

import { ArrowRight, Database, Eye, FileCheck2, Server, ShieldCheck } from "lucide-react";

const LAYERS = [
  {
    title: "Browser proposes",
    body: "The app displays state, builds readable intents, and asks the owner to sign.",
    Icon: Eye,
  },
  {
    title: "Backend verifies",
    body: "Render validates policy, simulates, rate-limits, logs, and prepares transactions.",
    Icon: Server,
  },
  {
    title: "Chain enforces",
    body: "The Solana program is the final authority for membership, approvals, replay protection, and execution.",
    Icon: ShieldCheck,
  },
  {
    title: "Redis is temporary",
    body: "Queues, sessions, nonces, and cache live here. It is not the source of truth for vault control.",
    Icon: Database,
  },
] as const;

const CHECKS = [
  "approval threshold",
  "who may propose, approve, and execute",
  "nonce and replay protection",
  "policy commitment",
  "agent allowance and venue limits",
  "transaction simulation and audit log",
];

export default function SecurityArchitecturePage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Security architecture
        </p>
        <h1 className="font-display text-2xl leading-tight text-text-strong md:text-display-xs">
          ClearSig does not trust the browser
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-soft">
          Infrastructure only matters when enforcement lives in the right place.
        </p>
      </header>

      <section className="grid gap-2 sm:grid-cols-2">
        {LAYERS.map(({ title, body, Icon }) => (
          <article
            key={title}
            className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.85} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-text-soft">{body}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              What must never be client-only
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {CHECKS.map((check) => (
                <li key={check} className="flex items-center gap-2 text-xs text-text-soft">
                  <ArrowRight className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  {check}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
