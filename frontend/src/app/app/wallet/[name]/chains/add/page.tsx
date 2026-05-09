"use client";

// Add chain - bind an Ika dWallet for a target chain so this wallet
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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Plus } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
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
      // Two query keys, two prefixes - useWalletWorkflow uses
      // ["wallet-chains", name] (read-only chain list from chain),
      // useWalletChains uses ["wallet-chains-api", name] (the
      // backend's address-enriched list that the /chains page
      // renders). Without the second invalidation the chains
      // page keeps showing stale data for up to its 30s
      // staleTime, which manifests as "I added the chain but it
      // didn't reflect."
      queryClient.invalidateQueries({ queryKey: ["wallet-chains"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-chains-api"] });
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      {stage === "pick" && (
        <PickStage
          walletDisplay={walletDisplay}
          chains={addable}
          onPick={(chain) => {
            setSelected(chain);
            setStage("confirm");
          }}
          motionProps={motionProps}
        />
      )}

      {stage === "confirm" && selected && (
        <ConfirmStage
          chain={selected}
          walletDisplay={walletDisplay}
          onConfirm={startBind}
          onPickDifferent={() => {
            setSelected(null);
            setStage("pick");
          }}
          motionProps={motionProps}
        />
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

// ─── Pick stage ────────────────────────────────────────────────────

function PickStage({
  walletDisplay,
  chains,
  onPick,
  motionProps,
}: {
  walletDisplay: string;
  chains: ChainMeta[];
  onPick: (c: ChainMeta) => void;
  motionProps: Record<string, unknown>;
}) {
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Add chain · {walletDisplay}
        </p>
        <h1 className="mt-2 font-display text-2xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
          Pick a chain
        </h1>
        <p className="mt-3 max-w-xl text-sm text-text-soft sm:text-base">
          Each chain you add lets {walletDisplay} send money there. You only
          need to set this up once per chain.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {chains.map((chain) => (
          <li key={chain.kind}>
            <button
              type="button"
              onClick={() => onPick(chain)}
              className={
                "group flex w-full items-center gap-4 rounded-card border border-border-soft bg-surface-raised p-4 text-left shadow-card-rest sm:p-5 " +
                "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              <ChainBadge chain={chain} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-sm font-semibold text-text-strong">
                    {chain.name}
                  </p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
                    {chain.ticker}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-text-soft">
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
  );
}

// ─── Confirm stage ─────────────────────────────────────────────────

function ConfirmStage({
  chain,
  walletDisplay,
  onConfirm,
  onPickDifferent,
  motionProps,
}: {
  chain: ChainMeta;
  walletDisplay: string;
  onConfirm: () => void;
  onPickDifferent: () => void;
  motionProps: Record<string, unknown>;
}) {
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      {/* Header strip — chain badge + eyebrow + display title.
          Left-aligned to match the rest of the workspace. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <ChainBadge chain={chain} size="lg" />
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Add chain · {chain.ticker}
            </p>
            <h1 className="mt-1.5 font-display text-2xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
              Add {chain.name}
            </h1>
            <p className="mt-1 text-xs text-text-soft sm:text-sm">
              to <span className="text-text-strong">{walletDisplay}</span>
            </p>
          </div>
        </div>
      </header>

      <p className="max-w-xl text-sm text-text-soft sm:text-base">
        {chain.description}
      </p>

      {/* What happens next — card with refined header strip. */}
      <section className="overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        <header className="border-b border-border-soft px-5 py-3 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            What happens next
          </p>
        </header>
        <ul className="divide-y divide-border-soft">
          {[
            {
              n: "01",
              body: (
                <>
                  We&rsquo;ll create a new key for {walletDisplay} on{" "}
                  <span className="text-text-strong">{chain.name}</span>{" "}
                  <span className="text-text-soft">(about 30 seconds)</span>.
                </>
              ),
            },
            {
              n: "02",
              body: (
                <>
                  Your spending rules apply on {chain.name} too. Same
                  friends, same approvals.
                </>
              ),
            },
            {
              n: "03",
              body: (
                <>
                  You can send{" "}
                  <span className="text-text-strong">{chain.ticker}</span>{" "}
                  from {walletDisplay} as soon as it&rsquo;s ready.
                </>
              ),
            },
          ].map((row) => (
            <li
              key={row.n}
              className="flex items-start gap-3 px-5 py-3.5 text-sm text-text-strong sm:px-6"
            >
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft pt-0.5">
                {row.n}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">{row.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <Button size="lg" fullWidth onClick={onConfirm}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add {chain.name}
      </Button>

      <button
        type="button"
        onClick={onPickDifferent}
        className={
          "self-center rounded-soft px-3 py-1.5 text-sm text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        Pick a different chain
      </button>
    </motion.section>
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
  const [elapsedSecs, setElapsedSecs] = useState(0);

  // Cycle through the steps every ~10s while we wait so it doesn't
  // look frozen. Real progress events from the backend would
  // replace this placeholder. Also tick a separate elapsed counter
  // so if the DKG runs past 30s the user sees the page hasn't
  // stalled - just a visible "still working, 47s elapsed".
  useEffect(() => {
    const stepTimer = setInterval(() => {
      setActiveStep((s) => Math.min(steps.length - 1, s + 1));
    }, 10_000);
    const tickTimer = setInterval(() => {
      setElapsedSecs((s) => s + 1);
    }, 1_000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(tickTimer);
    };
  }, [steps.length]);

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-6"
    >
      {/* Header strip — chain badge + eyebrow + display title. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            <ChainBadge chain={chain} size="lg" />
            <span
              aria-hidden="true"
              className={
                "absolute -inset-1.5 rounded-full border-2 border-accent/30 " +
                (reduce ? "" : "animate-pulse")
              }
            />
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Setting up · {chain.ticker}
            </p>
            <h1 className="mt-1.5 font-display text-2xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
              Adding {chain.name}…
            </h1>
            <p className="mt-1 font-numerals text-xs tabular-nums text-text-soft">
              {elapsedSecs}s elapsed
              {elapsedSecs > 45 && (
                <>
                  {" · "}
                  <span className="text-text-strong">
                    Devnet is slower than usual today; still working.
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <p className="max-w-xl text-sm text-text-soft sm:text-base">
        This usually takes about 30 seconds. Hang tight; you don&rsquo;t need
        to do anything. Don&rsquo;t close the tab.
      </p>

      {/* Progress steps card. Each step lights up as the DKG advances. */}
      <section className="overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        <header className="border-b border-border-soft px-5 py-3 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Progress
          </p>
        </header>
        <ul className="divide-y divide-border-soft">
          {steps.map((label, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <li
                key={label}
                className={
                  "flex items-center gap-3 px-5 py-3.5 text-sm transition-colors duration-base ease-out-soft sm:px-6 " +
                  (done
                    ? "bg-accent/[0.04] text-text-strong"
                    : active
                      ? "text-text-strong"
                      : "text-text-soft")
                }
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {done ? (
                    <Check
                      className="h-4 w-4 text-accent"
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  ) : active ? (
                    <BrandLoader size={16} label="Working" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-border-soft" />
                  )}
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 leading-relaxed">{label}</span>
              </li>
            );
          })}
        </ul>
      </section>
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
      className="flex flex-col gap-6"
    >
      {/* Header strip — success chip + eyebrow + display title. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <motion.div
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              damping: 18,
              stiffness: 240,
              delay: 0.05,
            }}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-text-on-accent shadow-accent-rest sm:h-16 sm:w-16"
          >
            <Check className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
          </motion.div>
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
              Done · {chain.ticker}
            </p>
            <h1 className="mt-1.5 font-display text-2xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
              {chain.name} is ready
            </h1>
          </div>
        </div>
      </header>

      <p className="max-w-xl text-sm text-text-soft sm:text-base">
        {walletDisplay} can now send{" "}
        <span className="text-text-strong">{chain.ticker}</span> the same way
        it sends Solana. Your friends approve, the network signs.
      </p>

      <Button size="lg" fullWidth onClick={onContinue}>
        Back to chains
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </motion.section>
  );
}
