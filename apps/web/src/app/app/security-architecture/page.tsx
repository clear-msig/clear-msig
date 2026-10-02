"use client";

import { ArrowRight, Database, Eye, FileCheck2, Server, ShieldCheck } from "lucide-react";

const LAYERS = [
  {
    title: "Browser proposes",
    body: "The browser shows and checks signing details and local risk hints. These checks aid review; a compromised browser can mislead the display. An in-app hash is not independent verification.",
    Icon: Eye,
  },
  {
    title: "Backend verifies",
    body: "The backend prepares canonical documents and transactions and applies server checks. Availability and server-provided information remain trust dependencies; a successful response is not proof of execution.",
    Icon: Server,
  },
  {
    title: "Chain enforces",
    body: "Supported Solana actions enforce membership, approvals, committed payloads, timelocks and replay protection. RPC state and deployed program identity must match the pinned configuration.",
    Icon: ShieldCheck,
  },
  {
    title: "Durable state matters",
    body: "Redis also holds durable idempotency and handoff records. Losing them can impair safe recovery. These records do not replace on-chain approval authority.",
    Icon: Database,
  },
] as const;

const CHECKS = [
  "approval threshold",
  "who may propose, approve, and execute",
  "nonce and replay protection",
  "policy commitment",
  "exact supported action payload",
  "timelock and expiry",
];

export default function SecurityArchitecturePage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Security architecture
        </p>
        <h1 className="font-display text-2xl leading-tight text-text-strong md:text-display-xs">
          Where each check happens
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-soft">
          Devnet pre-alpha only. Do not use real funds. Local, server and chain checks have different roles.
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

      <section className="rounded-card border border-warning/30 bg-surface-raised p-4 text-sm text-text-soft">
        <h2 className="font-semibold text-text-strong">Current control and privacy limits</h2>
        <p className="mt-2">Ika currently uses a single mock signer, not production distributed MPC. Do not treat remote-chain assets as protected by a qualified distributed custody system.</p>
        <p className="mt-2">The Encrypt integration is a pre-alpha interface; policy confidentiality and on-chain FHE enforcement are not live. Public chain data remains public.</p>
        <p className="mt-2">The program is upgradeable. Upgrade authority and configured RPC, relayer and provider services remain trust and availability dependencies. External agent execution remains gated.</p>
        <p className="mt-2">Physical hardware display behavior is not qualified here. Verify what your signer actually presents; cancel if you cannot verify the action. An independently usable verification workflow remains a gap.</p>
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              Checks enforced for supported Solana actions
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
