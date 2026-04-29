"use client";

// Compact landing footer. The wordmark, a one-liner, a credibility badge
// strip, and the pre-alpha disclaimer. No clutter.

import Image from "next/image";
import { ExternalLink, Github, ShieldCheck } from "lucide-react";

const REPO_URL = "https://github.com/clear-msig/clear-msig";

export function LandingFooter() {
  return (
    <footer className="w-full border-t border-black/10 bg-white/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[91rem] flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3 md:max-w-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green p-[2px] shadow-glow">
              <span className="flex h-full w-full items-center justify-center rounded-[10px] bg-black">
                <Image
                  src="/assets/solana.png"
                  alt="Clear-MSIG"
                  width={18}
                  height={18}
                />
              </span>
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-black">
              Clear-MSIG
            </span>
          </div>
          <p className="text-sm text-black/60">
            A Solana multisig where every signature is a sentence your Ledger
            can read. Cross-chain custody via Ika dWallets.
          </p>
          <p className="text-[11px] font-mono uppercase tracking-widest text-black/40">
            pre-alpha · devnet only
          </p>
        </div>

        {/* Credibility badge strip — judges + early users glance here for
            trust signals before they connect a wallet. */}
        <div className="flex flex-col gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Quasar-built</Badge>
            <Badge>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
                aria-label="View source on GitHub"
              >
                <Github size={11} /> Open source
              </a>
            </Badge>
            <Badge>
              <a
                href={`${REPO_URL}/blob/main/DEPLOYMENTS.md`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
                aria-label="View deployment details"
              >
                <ShieldCheck size={11} /> Devnet only
              </a>
            </Badge>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-black/50 transition-colors hover:text-brand-green"
          >
            View on GitHub <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </footer>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-black/70">
      {children}
    </span>
  );
}

