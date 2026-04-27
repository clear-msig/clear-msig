"use client";

// Compact landing footer. The wordmark, a one-liner, two link rows,
// and the pre-alpha disclaimer. No clutter.

import Image from "next/image";
import { ExternalLink } from "lucide-react";

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

      </div>

    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-black/50">
        {title}
      </span>
      {links.map((l) =>
        l.external ? (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-black/70 transition-colors hover:text-brand-green"
          >
            {l.label}
            <ExternalLink size={10} className="text-black/30" />
          </a>
        ) : (
          <a
            key={l.label}
            href={l.href}
            className="text-black/70 transition-colors hover:text-brand-green"
          >
            {l.label}
          </a>
        )
      )}
    </div>
  );
}
