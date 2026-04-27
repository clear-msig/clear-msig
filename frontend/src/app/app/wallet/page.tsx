"use client";

// Wallet page groups wallet creation and wallet state operations.
import { motion } from "framer-motion";
import { CreateWalletCard } from "@/components/wallet/CreateWalletCard";
import { WalletPanel } from "@/components/wallet/WalletPanel";
import { MyOrganizationsCard } from "@/components/wallet/MyOrganizationsCard";
import { WorkflowTips } from "@/components/layout/WorkflowTips";

export default function WalletPage() {
  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl border border-white/10 bg-white/[0.02] px-4 py-4 sm:px-6"
      >
        <h2 className="text-base font-bold text-brand-white sm:text-lg">1. Organization Membership</h2>
        <p className="mt-1 text-sm text-text-muted">Connect wallet and check where this address participates.</p>
        <div className="mt-4">
          <MyOrganizationsCard />
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-6 rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6"
      >
        <h2 className="text-base font-bold text-brand-white sm:text-lg">2. Create and Configure Organization</h2>
        <p className="mt-1 text-sm text-text-muted">Create wallet policy, then bind chain settings for execution.</p>
        <div className="mt-4 grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <CreateWalletCard />
          <WalletPanel />
        </div>
      </motion.section>

      <div className="mt-6">
        <WorkflowTips />
      </div>
    </>
  );
}
