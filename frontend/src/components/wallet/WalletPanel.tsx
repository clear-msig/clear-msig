"use client";

// Wallet panel displays live backend health and selected wallet state.
import { useState } from "react";
import { appConfig } from "@/lib/config";
import { CardShell } from "@/components/ui/CardShell";
import { useWalletWorkflow } from "@/lib/hooks/useWalletWorkflow";
import { useToast } from "@/components/ui/Toast";
import { motion } from "framer-motion";

export function WalletPanel() {
  const [walletName, setWalletName] = useState(appConfig.defaultWalletName);
  const [chain, setChain] = useState(appConfig.preAlpha.chain);
  const workflow = useWalletWorkflow(walletName);
  const toast = useToast();

  const chainBindings = Array.isArray(workflow.chainsQuery.data)
    ? workflow.chainsQuery.data.length
    : 0;

  const addChain = () => {
    workflow.addChainMutation.mutate(
      { chain },
      {
        onSuccess: () => {
          toast.success(`Chain binding "${chain}" submitted`, {
            details:
              "The relayer ran the bind on Solana and pinged Ika's DKG. The chain bindings count will refresh in a moment.",
          });
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to bind chain",
            { details: String(err) }
          );
        },
      }
    );
  };

  return (
    <CardShell title="Wallet State" subtitle="Link this organization to chain execution settings">
      <motion.div 
        className="flex flex-col gap-3"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        <p className="rounded-xl border border-brand-green/30 bg-brand-green/10 px-3 py-2 text-xs font-medium text-brand-white">
          This section binds your wallet to an execution chain for Ika pre-alpha signing.
        </p>

        <label className="text-sm font-semibold text-brand-white">Wallet name</label>
        <input
          value={walletName}
          onChange={(event) => setWalletName(event.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors ring-brand-green/60 focus:border-brand-green/50 focus:bg-white/10 focus:ring"
          placeholder="treasury"
        />
      </motion.div>

      <motion.div 
        className="mt-4 grid gap-2 text-sm"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
      >
        <p className="text-brand-white">
          Backend: <span className="font-semibold text-brand-green">{workflow.healthQuery.isSuccess ? "online" : "checking"}</span>
        </p>
        <p className="text-brand-white">
          Wallet lookup: <span className="font-semibold text-brand-green">{workflow.walletQuery.isFetching ? "loading" : "ready"}</span>
        </p>
        <p className="text-brand-white">
          Chain bindings: <span className="font-semibold text-brand-green">{chainBindings}</span>
        </p>
      </motion.div>

      <motion.div
        className="mt-4 grid gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Chain type</span>
          <input
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
          placeholder="Chain (evm_1559|evm_1559_erc20|bitcoin_p2wpkh)"
        />
        </label>
      </motion.div>

      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        onClick={addChain}
        className="mt-2 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-black transition-all hover:shadow-glow"
      >
        Add chain binding
      </motion.button>

    </CardShell>
  );
}
