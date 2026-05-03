"use client";

// Add chain — bind an Ika dWallet for a target chain so this wallet
// can send native transactions there.
//
// What happens behind the scenes (intentionally not surfaced here):
// the backend triggers a DKG ceremony on Ika's network, key shares
// are distributed across MPC nodes, an IkaConfig PDA is written on
// Solana that ties the wallet to the new dWallet. The whole thing
// takes ~30 seconds in pre-alpha.
//
// What the user sees: pick a chain, tap a button, watch a progress
// pill, land on a "your wallet now sends [Chain]" success state.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  CHAIN_CATALOG,
  chainByApiName,
  type ChainMeta,
} from "@/lib/retail/chains";
import { useToast } from "@/components/ui/Toast";
import { toDisplayName } from "@/lib/retail/walletNames";

type Stage = "pick" | "confirm" | "binding" | "done";

export default function AddChainPageWrapper() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas" aria-hidden="true" />
      }
    >
      <AddChainPage />
    </Suspense>
  );
}

function AddChainPage() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const reduce = useReducedMotion();
  const toast = useToast();
  const queryClient = useQueryClient();

  const walletName = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const walletDisplay = toDisplayName(walletName);

  const initialChain = useMemo(() => {
    const fromQuery = search?.get("chain");
    return fromQuery ? chainByApiName(fromQuery) : undefined;
  }, [search]);

  // Skip the picker if the URL already nominated a chain (e.g. arrived
  // from the chains list's per-chain "Add" link).
  const [stage, setStage] = useState<Stage>(
    initialChain ? "confirm" : "pick",
  );
  const [selected, setSelected] = useState<ChainMeta | null>(
    initialChain ?? null,
  );

  // Solana is implicit; never offer it as something to add. ERC-20
  // (kind 4) is folded into the Ethereum binding.
  const addable = CHAIN_CATALOG.filter((c) => c.kind !== 0);

  const bind = useMutation({
    mutationFn: async () => {
      if (!selected)
        throw new Error("Pick a chain first");
      // Backend defaults handle the dwallet_program / grpc_url
      // (env-pinned to Ika pre-alpha). We only need to pass `chain`.
      return backendApi.addWalletChain(walletName, {
        chain: selected.apiName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-chains"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", walletName] });
      setStage("done");
    },
    onError: (err) => {
      console.error("[add-chain]", err);
      const fe = friendlyError(err, "add-chain");
      toast.error(fe.title, { details: fe.body });
      setStage(selected ? "confirm" : "pick");
    },
  });

  const startBind = () => {
    if (!selected) return;
    setStage("binding");
    bind.mutate();
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay,
              href: `/app/wallet/${encodeURIComponent(walletName)}`,
            },
            {
              label: "Chains",
              href: `/app/wallet/${encodeURIComponent(walletName)}/chains`,
            },
            { label: "Add a chain" },
          ]}
        />
      </StickyTopBar>

      {stage === "pick" && (
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center text-center">
            <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Pick a chain
            </h1>
            <p className="mt-2 max-w-md text-base text-text-soft">
              Each chain you add lets {walletDisplay} send money there.
              You only need to set this up once per chain.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {addable.map((chain) => (
              <li key={chain.kind}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(chain);
                    setStage("confirm");
                  }}
                  className={
                    "group flex w-full items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 text-left shadow-card-rest " +
                    "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
                    "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  }
                >
                  <ChainBadge chain={chain} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-strong">
                      {chain.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-text-soft">
                      {chain.description}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {stage === "confirm" && selected && (
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center text-center">
            <ChainBadge chain={selected} size="lg" />
            <h1 className="mt-5 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Add {selected.name} to {walletDisplay}
            </h1>
            <p className="mt-2 max-w-md text-base text-text-soft">
              {selected.description}
            </p>
          </div>

          <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
              What happens next
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-text-strong">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                We&rsquo;ll create a new key for {walletDisplay} on{" "}
                {selected.name} (about 30 seconds).
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                Your spending rules apply on {selected.name} too. Same
                friends, same approvals.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                You can send {selected.ticker} from {walletDisplay} as
                soon as it&rsquo;s ready.
              </li>
            </ul>
          </div>

          <Button size="lg" fullWidth onClick={startBind}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add {selected.name}
          </Button>

          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setStage("pick");
            }}
            className="self-center text-sm text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            Pick a different chain
          </button>
        </motion.section>
      )}

      {stage === "binding" && selected && (
        <BindingStage chain={selected} reduce={!!reduce} />
      )}

      {stage === "done" && selected && (
        <DoneStage
          chain={selected}
          walletName={walletName}
          onContinue={() =>
            router.push(
              `/app/wallet/${encodeURIComponent(walletName)}/chains`,
            )
          }
          reduce={!!reduce}
        />
      )}
    </div>
  );
}

// ─── Binding stage ─────────────────────────────────────────────────

function BindingStage({
  chain,
  reduce,
}: {
  chain: ChainMeta;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  // Friendly progress steps. The actual DKG progress events would
  // wire into these labels; for now the lib/copy is in place so a
  // future SSE / polling loop can light each step in turn.
  const steps = useMemo(
    () => [
      "Spinning up the network",
      `Generating ${chain.name} key shares`,
      "Recording on Solana",
    ],
    [chain],
  );
  const [activeStep, setActiveStep] = useState(0);

  // Cycle through the steps every ~10s while we wait so it doesn't
  // look frozen. Real progress events from the backend would
  // replace this placeholder.
  useEffect(() => {
    const t = setInterval(() => {
      setActiveStep((s) => Math.min(steps.length - 1, s + 1));
    }, 10_000);
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <div className="relative">
        <ChainBadge chain={chain} size="lg" />
        <span
          aria-hidden="true"
          className={
            "absolute -inset-2 rounded-full border-2 border-accent/30 " +
            (reduce ? "" : "animate-pulse")
          }
        />
      </div>
      <div>
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
          Setting up {chain.name}…
        </h1>
        <p className="mt-2 max-w-md text-base text-text-soft">
          This usually takes about 30 seconds. Hang tight; you don&rsquo;t
          need to do anything.
        </p>
      </div>

      <ul className="w-full max-w-sm space-y-2 text-left">
        {steps.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <li
              key={label}
              className={
                "flex items-center gap-3 rounded-soft border px-4 py-2.5 text-sm transition-colors duration-base ease-out-soft " +
                (done
                  ? "border-accent/30 bg-accent/5 text-text-strong"
                  : active
                    ? "border-border-soft bg-surface-raised text-text-strong"
                    : "border-border-soft bg-canvas text-text-soft")
              }
            >
              {done ? (
                <Check
                  className="h-4 w-4 text-accent"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              ) : active ? (
                <BrandLoader size={16} label="Working" />
              ) : (
                <span className="h-4 w-4 rounded-full border border-border-soft" />
              )}
              {label}
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

// ─── Done stage ────────────────────────────────────────────────────

function DoneStage({
  chain,
  walletName,
  onContinue,
  reduce,
}: {
  chain: ChainMeta;
  walletName: string;
  onContinue: () => void;
  reduce: boolean;
}) {
  const walletDisplay = toDisplayName(walletName);
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <motion.div
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          damping: 18,
          stiffness: 240,
          delay: 0.05,
        }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest"
      >
        <Check className="h-10 w-10" strokeWidth={2.5} />
      </motion.div>
      <div>
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
          {chain.name} is ready
        </h1>
        <p className="mt-2 max-w-md text-base text-text-soft">
          {walletDisplay} can now send {chain.ticker} the same way it
          sends Solana. Your friends approve, the network signs.
        </p>
      </div>
      <Button size="lg" fullWidth onClick={onContinue}>
        Back to chains
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </motion.section>
  );
}
