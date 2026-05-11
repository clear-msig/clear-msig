"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import clsx from "clsx";

interface PricingTier {
  id: string;
  name: string;
  priceLabel: string;
  priceSuffix?: string;
  tagline: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    priceSuffix: "forever",
    tagline: "For small teams and hobby DAOs trying Clear.",
    features: [
      "Up to 5 members per wallet",
      "Solana + one EVM chain",
      "Standard approval flows",
      "Community support",
    ],
    cta: "Get started",
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "$49",
    priceSuffix: "/ workspace, monthly",
    tagline: "For growing treasuries that need every chain and every signer.",
    features: [
      "Unlimited members per wallet",
      "Full chain support across Solana, EVM, BTC, and Zcash",
      "Hardware wallet sign-off (Ledger)",
      "Custom approval policies & allowances",
      "Priority email support",
    ],
    cta: "Choose Pro",
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    priceSuffix: "annual",
    tagline: "For DAOs and operators with formal treasury and governance needs.",
    features: [
      "Everything in Pro",
      "Advanced treasury controls",
      "Governance tooling & multi-workspace",
      "SSO, audit log export, role permissions",
      "Dedicated onboarding & SLA",
    ],
    cta: "Talk to us",
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
      {/* Eyebrow + coming-soon pill */}
      <motion.div
        {...fadeIn(0)}
        className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/30 bg-[#ccff00]/[0.06] px-3 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
          Coming soon · devnet pre-alpha
        </span>
      </motion.div>

      {/* Heading + lede */}
      <motion.h2
        {...fadeIn(0.05)}
        className="mt-6 max-w-3xl text-[clamp(2.25rem,6vw,4.5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white sm:mt-8"
      >
        Pricing that scales
        <br />
        with your <span className="italic-skew">treasury</span>.
      </motion.h2>

      <motion.p
        {...fadeIn(0.12)}
        className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/60 sm:mt-6 sm:text-base"
      >
        Free for small teams. Pro for unlimited scale. Enterprise for formal
        treasury controls.
      </motion.p>

      {/* Tier grid. Items-stretch so non-featured cards still match
          the featured card's lifted height on lg+, giving a clean
          baseline alignment regardless of feature count differences. */}
      <div className="mt-14 grid grid-cols-1 gap-5 sm:mt-16 sm:gap-6 lg:mt-20 lg:grid-cols-3 lg:items-stretch lg:gap-6">
        {TIERS.map((tier, i) => (
          <TierCard
            key={tier.id}
            tier={tier}
            fadeProps={fadeIn(0.18 + i * 0.06)}
          />
        ))}
      </div>

      {/* Pre-alpha note */}
      <motion.p
        {...fadeIn(0.4)}
        className="mt-10 max-w-2xl font-mono-tech text-[11px] uppercase tracking-[0.22em] text-white/40 sm:mt-12"
      >
        Plans take effect at mainnet launch. Devnet pre-alpha is free for
        everyone while we harden the protocol.
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
        // pt-9 reserves vertical space above the featured ribbon so
        // the title doesn't collide with the badge. Non-featured
        // cards keep the same top padding for vertical rhythm.
        "relative flex flex-col rounded-[1.5rem] border px-6 pb-6 pt-9 backdrop-blur-md transition-colors duration-300 sm:px-7 sm:pb-7 sm:pt-10",
        tier.featured
          ? "border-[#ccff00]/40 bg-[#ccff00]/[0.05] shadow-[0_30px_80px_-28px_rgba(204,255,0,0.22),0_8px_24px_-10px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] lg:-translate-y-3"
          : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]",
      )}
    >
      {tier.featured && (
        <span
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#ccff00] px-3 py-1 font-mono-tech text-[9px] font-bold uppercase tracking-[0.24em] text-black shadow-[0_4px_16px_-4px_rgba(204,255,0,0.55)]"
        >
          Most popular
        </span>
      )}

      {/* Name */}
      <p
        className={clsx(
          "font-mono-tech text-[10px] uppercase tracking-[0.28em]",
          tier.featured ? "text-[#ccff00]" : "text-white/50",
        )}
      >
        {tier.name}
      </p>

      {/* Price. Flex-wrap so suffix can drop below on the narrowest
          phones without crushing the price. */}
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[40px] font-light leading-none tracking-[-0.02em] text-white sm:text-[48px]">
          {tier.priceLabel}
        </span>
        {tier.priceSuffix ? (
          <span className="text-[12px] text-white/45 sm:text-[13px]">
            {tier.priceSuffix}
          </span>
        ) : null}
      </div>

      {/* Tagline. Fixed line clamp keeps card heights aligned even
          when tier copy lengths differ slightly. */}
      <p className="mt-3 min-h-[3.2rem] text-[13px] leading-relaxed text-white/60 sm:text-[14px]">
        {tier.tagline}
      </p>

      {/* Divider */}
      <div
        className={clsx(
          "mt-5 h-px w-full",
          tier.featured ? "bg-[#ccff00]/20" : "bg-white/[0.08]",
        )}
      />

      {/* Features */}
      <ul className="mt-5 flex flex-1 flex-col gap-3 sm:mt-6">
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

      {/* CTA. Disabled, "Coming soon". Single short label so it
          never wraps on narrow widths; the section's coming-soon
          pill carries the larger context. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Available at mainnet launch"
        className={clsx(
          "mt-8 inline-flex w-full cursor-not-allowed items-center justify-center rounded-full px-5 py-3 text-[13px] font-semibold transition-colors duration-200",
          tier.featured
            ? "bg-[#ccff00]/85 text-black"
            : "border border-white/12 bg-white/[0.03] text-white/55",
        )}
      >
        {tier.cta}
      </button>
      <span
        className={clsx(
          "mt-2.5 text-center font-mono-tech text-[9px] uppercase tracking-[0.26em]",
          tier.featured ? "text-[#ccff00]/70" : "text-white/35",
        )}
      >
        Available at mainnet
      </span>
    </motion.div>
  );
}
