"use client";

import { CHAINS } from "@/components/landing/ChainLogos";
import type { ChainMeta } from "@/components/landing/ChainLogos";

export function ChainMarquee() {
  const supportedChains = CHAINS.filter((chain) =>
    ["sol", "eth", "btc", "zec", "hyperliquid"].includes(chain.key),
  );
  const marqueeSet = Array.from({ length: 5 }).flatMap(() => supportedChains);
  const track = [...marqueeSet, ...marqueeSet];

  return (
    <section
      aria-label="Supported networks"
      className="relative left-1/2 z-10 w-screen -translate-x-1/2 overflow-hidden bg-[#0c0c0c] py-5 sm:py-7"
    >
      <div className="mx-auto max-w-[1600px]">
        <div className="landing-chain-marquee relative overflow-hidden bg-[#101311] py-4 shadow-[0_20px_70px_-56px_rgba(0,0,0,0.95)]">
          <div className="landing-chain-marquee-track flex w-max items-center gap-10">
            {track.map((chain, index) => (
              <ChainMarqueeItem
                key={`${chain.key}-${index}`}
                chain={chain}
                duplicate={index >= marqueeSet.length}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
function ChainMarqueeItem({
  chain,
  duplicate,
}: {
  chain: ChainMeta;
  duplicate: boolean;
}) {
  const Logo = chain.Logo;

  return (
    <span
      aria-hidden={duplicate}
      aria-label={duplicate ? undefined : chain.label}
      className="flex h-12 w-12 shrink-0 items-center justify-center"
    >
      <Logo size={28} className="h-7 w-7" />
    </span>
  );
}
