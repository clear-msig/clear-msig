// ChainBadge — gradient circle with the chain's symbol/short label.
// Same role MemberAvatar plays for people: a deterministic visual
// identity that lets users recognize a chain at a glance without
// reading text.

import clsx from "clsx";
import type { ChainMeta } from "@/lib/retail/chains";

interface ChainBadgeProps {
  chain: ChainMeta;
  size?: "sm" | "md" | "lg";
  ringClass?: string;
}

const SIZE: Record<NonNullable<ChainBadgeProps["size"]>, string> = {
  sm: "h-6 w-6 text-sm",
  md: "h-8 w-8 text-base",
  lg: "h-12 w-12 text-2xl",
};

export function ChainBadge({ chain, size = "md", ringClass }: ChainBadgeProps) {
  return (
    <span
      role="img"
      aria-label={chain.name}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold leading-none text-white",
        SIZE[size],
        chain.gradient.from,
        chain.gradient.to,
        ringClass && `ring-2 ${ringClass}`,
      )}
    >
      {chain.symbol}
    </span>
  );
}
