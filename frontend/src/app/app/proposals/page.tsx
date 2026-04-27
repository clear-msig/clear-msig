"use client";

// Proposals page focuses on proposal creation, voting, execution, and cleanup.
import { motion } from "framer-motion";
import { ProposalCard } from "@/components/proposals/ProposalCard";
import { ProposalList } from "@/components/proposals/ProposalList";

export default function ProposalsPage() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6"
    >
      <h2 className="text-base font-bold text-brand-white sm:text-lg">4. Proposal Lifecycle and Execution</h2>
      <p className="mt-1 text-sm text-text-muted">Create proposals, collect approvals, and execute once policy is satisfied.</p>
      <div className="mt-4 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <ProposalCard />
        <ProposalList />
      </div>
    </motion.section>
  );
}
