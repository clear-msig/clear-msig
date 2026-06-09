"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, ReceiptText } from "lucide-react";
import clsx from "clsx";

interface PricingTier {
  id: string;
  name: string;
  valueLabel: string;
  valueSuffix?: string;
  tagline: string;
  meta: [string, string][];
  features: string[];
  featured?: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: "devnet",
    name: "Devnet",
    valueLabel: "$0",
    valueSuffix: "during pre-alpha",
    tagline: "Open testing while the protocol hardens.",
    meta: [
      ["Environment", "Devnet"],
      ["Platform fee", "$0"],
      ["Status", "Pre-alpha"],
    ],
    features: [
      "Shared wallets",
      "Agent trading demos",
      "Recovery vault testing",
      "No platform fee",
    ],
  },
  {
    id: "gas",
    name: "Gas fee revenue",
    valueLabel: "Per execution",
    valueSuffix: "not monthly",
    tagline: "ClearSig earns when approved value actually moves.",
    meta: [
      ["Fee type", "Gas plus service"],
      ["Trigger", "Executed tx"],
      ["Visible at sign", "Yes"],
    ],
    features: [
      "Small ClearSig fee on executed transactions",
      "Network gas stays transparent",
      "No subscription for dormant wallets",
      "Aligned with usage and volume",
      "Built for wallets, agents, and recovery flows",
    ],
    featured: true,
  },
  {
    id: "operators",
    name: "Operators",
    valueLabel: "Custom",
    valueSuffix: "for launch partners",
    tagline: "For teams that need policy, support, and rollout planning.",
    meta: [
      ["Partner", "Operator"],
      ["Settlement", "Custom"],
      ["Support", "Included"],
    ],
    features: [
      "Gas-fee sharing options",
      "Treasury controls",
      "Audit and compliance support",
      "Dedicated onboarding",
      "Mainnet launch planning",
    ],
  },
];

export function PricingSection() {
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.18, margin: "0px 0px -10% 0px" },
          transition: {
            duration: 0.7,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <section
      id="pricing"
      className="relative z-10 px-5 pb-24 pt-12 sm:px-10 sm:pb-32 sm:pt-20 lg:pt-24"
    >
      <motion.div
        {...fadeIn(0)}
        className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/30 bg-[#ccff00]/[0.06] px-3 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
          Revenue model
        </span>
      </motion.div>

      <motion.h2
        {...fadeIn(0.05)}
        className="mt-6 max-w-3xl text-[clamp(2.25rem,6vw,4.5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white sm:mt-8"
      >
        Revenue from
        <br />
        actual <span className="italic-skew">usage</span>.
      </motion.h2>

      <motion.p
        {...fadeIn(0.12)}
        className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/60 sm:mt-6 sm:text-base"
      >
        ClearSig is not built around seat pricing. The core model is a small
        gas/service fee when approved transactions execute.
      </motion.p>

      <div className="mt-14 grid grid-cols-1 gap-5 sm:mt-16 sm:gap-6 lg:mt-20 lg:grid-cols-3 lg:items-stretch lg:gap-6">
        {TIERS.map((tier, i) => (
          <TierCard
            key={tier.id}
            tier={tier}
            fadeProps={fadeIn(0.18 + i * 0.06)}
          />
        ))}
      </div>

      <motion.p
        {...fadeIn(0.4)}
        className="mt-10 max-w-2xl font-mono-tech text-[11px] uppercase tracking-[0.22em] text-white/40 sm:mt-12"
      >
        Devnet pre-alpha stays free. Mainnet fees will be shown before every execution.
      </motion.p>
    </section>
  );
}

interface TierCardProps {
  tier: PricingTier;
  fadeProps: Record<string, unknown>;
}

function TierCard({ tier, fadeProps }: TierCardProps) {
  return (
    <motion.div
      {...fadeProps}
      className={clsx(
        "product-card relative flex flex-col rounded-[1.35rem] px-5 pb-5 pt-7 transition-colors duration-300 sm:px-6 sm:pb-6 sm:pt-8",
        tier.featured
          ? "border-[#ccff00]/40 shadow-[0_30px_80px_-28px_rgba(204,255,0,0.18)] lg:-translate-y-3"
          : "hover:border-white/[0.16]",
      )}
    >
      {tier.featured && (
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#ccff00] px-3 py-1 font-mono-tech text-[9px] font-bold uppercase tracking-[0.24em] text-black shadow-[0_4px_16px_-4px_rgba(204,255,0,0.55)]">
          Primary model
        </span>
      )}

      <p
        className={clsx(
          "font-mono-tech text-[10px] uppercase tracking-[0.28em]",
          tier.featured ? "text-[#ccff00]" : "text-white/50",
        )}
      >
        {tier.name}
      </p>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[34px] font-light leading-none tracking-[-0.02em] text-white sm:text-[42px]">
          {tier.valueLabel}
        </span>
        {tier.valueSuffix ? (
          <span className="text-[12px] text-white/45 sm:text-[13px]">
            {tier.valueSuffix}
          </span>
        ) : null}
      </div>

      <p className="mt-3 min-h-[3.2rem] text-[13px] leading-relaxed text-white/60 sm:text-[14px]">
        {tier.tagline}
      </p>

      <div className="mt-5 space-y-2">
        {tier.meta.map(([label, value]) => (
          <div key={label} className="product-field flex items-center justify-between rounded-xl px-3 py-2.5">
            <span className="text-[11px] text-white/40">{label}</span>
            <span className="text-[12px] font-semibold text-white">{value}</span>
          </div>
        ))}
      </div>

      <ul className="mt-5 flex flex-1 flex-col gap-2.5 sm:mt-6">
        {tier.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2.5 text-[13px] leading-relaxed text-white/75 sm:text-[14px]"
          >
            <span
              className={clsx(
                "mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full",
                tier.featured
                  ? "bg-[#ccff00]/15 text-[#ccff00]"
                  : "bg-white/[0.06] text-white/55",
              )}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-black/25 px-5 py-3 text-[13px] font-semibold text-white/70">
        <ReceiptText className="h-4 w-4" aria-hidden="true" />
        Fee shown before signing
      </div>
      <span
        className={clsx(
          "mt-2.5 text-center font-mono-tech text-[9px] uppercase tracking-[0.26em]",
          tier.featured ? "text-[#ccff00]/70" : "text-white/35",
        )}
      >
        Launch policy pending
      </span>
    </motion.div>
  );
}
