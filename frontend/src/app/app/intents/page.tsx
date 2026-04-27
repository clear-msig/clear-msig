"use client";

// Intents page isolates intent management actions from proposal operations.
import { motion } from "framer-motion";
import { IntentCard } from "@/components/intents/IntentCard";

export default function IntentsPage() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6"
    >
      <h2 className="text-base font-bold text-brand-white sm:text-lg">3. Intent Governance</h2>
      <p className="mt-1 text-sm text-text-muted">Create, update, and remove executable intent templates.</p>
      <div className="mt-4">
        <IntentCard />
      </div>
    </motion.section>
  );
}
