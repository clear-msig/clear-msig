"use client";

// Wallet hub — landing page for connected users. Two stacked sections:
// "Your organizations" (read-only) and "Create & configure" (the form
// flow). Visual language follows the landing page: light outer bg
// (inherited from /app/layout.tsx), dark cards within, brand-green
// eyebrow chips above each section heading.

import { motion } from "framer-motion";
import { Sparkles, Users, Wallet as WalletIcon } from "lucide-react";
import { CreateWalletCard } from "@/components/wallet/CreateWalletCard";
import { WalletPanel } from "@/components/wallet/WalletPanel";
import { MyOrganizationsCard } from "@/components/wallet/MyOrganizationsCard";
import { WorkflowTips } from "@/components/layout/WorkflowTips";

export default function WalletPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHero />

      <Section
        delay={0.1}
        eyebrow="Step 1"
        eyebrowIcon={<Users size={11} />}
        title="Your organizations"
        description="Multisigs you've created or been added to. Click any to open its workspace."
      >
        <MyOrganizationsCard />
      </Section>

      <Section
        delay={0.2}
        eyebrow="Step 2"
        eyebrowIcon={<Sparkles size={11} />}
        title="Create &amp; configure"
        description="Spin up a new multisig, then bind it to the chains you want to drive."
      >
        <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <CreateWalletCard />
          <WalletPanel />
        </div>
      </Section>

      <WorkflowTips />
    </div>
  );
}

function PageHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-black/10 bg-white/70 px-6 py-8 shadow-card-shadow backdrop-blur sm:px-8 sm:py-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-brand-green/15 blur-3xl"
      />
      <div className="relative z-10 flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-green/15 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-brand-emerald">
          <WalletIcon size={11} /> Workspace
        </span>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-black text-balance sm:text-4xl">
          Sign intents.
          <br />
          <span className="bg-gradient-to-br from-brand-emerald via-brand-green to-brand-green-bright bg-clip-text text-transparent">
            Drive every chain.
          </span>
        </h1>
        <p className="max-w-xl text-sm text-black/60 sm:text-base">
          One Solana multisig, every destination chain via Ika dWallet. Pick an
          existing organization below or create a new one to get started.
        </p>
      </div>
    </motion.div>
  );
}

function Section({
  delay,
  eyebrow,
  eyebrowIcon,
  title,
  description,
  children,
}: {
  delay: number;
  eyebrow: string;
  eyebrowIcon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-black px-5 py-6 shadow-card-dark sm:px-7 sm:py-8"
    >
      {/* Soft top-corner glow, same idiom as BeforeAfterSection on the
          landing page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-green/10 blur-3xl"
      />
      <div className="relative z-10 flex flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-green">
            {eyebrowIcon}
            {eyebrow}
          </span>
          <h2 className="font-display text-xl font-bold leading-tight tracking-tight text-brand-white sm:text-2xl">
            {title}
          </h2>
          <p className="text-sm text-white/60">{description}</p>
        </header>
        <div>{children}</div>
      </div>
    </motion.section>
  );
}
