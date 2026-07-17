// ChainBadge - circular chain logo, deterministic per chain.
//
// First paint: load the CoinGecko CDN logo for the chain. If the image
// errors (offline, CDN hiccup), fall back to the chain's currency
// glyph (◎/Ξ/₿/ⓩ) on a gradient background - the original "letter
// disc" look. Either way, the badge surface is the same size so
// layouts don't shift.
//
// We use `<img>` directly rather than `next/image` so external CDN
// URLs don't need allowlist configuration in next.config - the image
// is small and cached by the browser/CDN, no real perf penalty.

"use client";

import { useState } from "react";
import clsx from "clsx";
import type { ChainMeta } from "@/lib/retail/chains";

interface ChainBadgeProps {
  chain: ChainMeta;
  size?: "sm" | "md" | "lg";
  ringClass?: string;
}

const SIZE: Record<NonNullable<ChainBadgeProps["size"]>, { box: string; px: number; text: string }> = {
  sm: { box: "h-6 w-6", px: 24, text: "text-sm" },
  md: { box: "h-8 w-8", px: 32, text: "text-base" },
  lg: { box: "h-12 w-12", px: 48, text: "text-2xl" },
};

export function ChainBadge({ chain, size = "md", ringClass }: ChainBadgeProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const dim = SIZE[size];

  if (imgFailed) {
    // Fallback - gradient circle with the currency glyph centered.
    return (
      <span
        role="img"
        aria-label={chain.name}
        className={clsx(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold leading-none text-white",
          dim.box,
          dim.text,
          chain.gradient.from,
          chain.gradient.to,
          ringClass && `ring-2 ${ringClass}`,
        )}
      >
        {chain.symbol}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised",
        dim.box,
        ringClass && `ring-2 ${ringClass}`,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chain.logoUrl}
        alt={chain.name}
        width={dim.px}
        height={dim.px}
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
