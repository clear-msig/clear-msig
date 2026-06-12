"use client";

// Set up sending - single-tap spending-rule bootstrap.
//
// A freshly-created wallet has no on-chain intents (spending rules)
// yet, so creating a request to send money fails. This screen wraps
// the prepare → sign → submit flow that adds a default SolTransfer
// intent into one user-visible action: "Set up sending."
//
// Approvers default to just the connected user (matching the
// /welcome flow's wallet-creation defaults). When the contacts /
// member-management layer lands, this should expand to the full
// member set.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { ArrowRight, Check, Clock, Loader2, Send, UserPlus, Wallet, Zap } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";

import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { NextStepCard } from "@/components/retail/NextStepCard";

// Backend reads template files relative to the workspace root. The
// SolTransfer template gives the wallet a generic "send to anyone, any
// amount" rule - what a retail user expects from "send money."
const SOL_TEMPLATE_FILE = "examples/intents/solana_transfer.json";
const BATCH_SOL_TEMPLATE_FILE = "examples/intents/solana_batch_transfer.json";
const SOL_TRANSFER_TEMPLATE = "transfer {1:10^9} SOL to {0}";
const BATCH_SOL_TEMPLATE = "batch_sol_transfer_v1";

export default function SetupSpendingPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const router = useRouter();
  const search = useSearchParams();
  const isProSurface = search.get("surface") === "pro";
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  // Guard against landing here for a wallet that's already set up.
  // Without this, a user reloading /setup on a wallet with an
  // existing SolTransfer would happily start adding a duplicate
  // rule - second rule lands at a higher slot, /send picks the wrong
  // intent, and the wallet popup behavior gets confusing fast. The
  // guard is a redirect rather than a hidden CTA so the user
  // arriving at the page mistakenly is moved on to where they
  // actually want to be.
  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const alreadySetUp = useMemo(() => {
    const customs = (intentsQuery.data ?? []).filter(
      (it) => it.account?.intentType === IntentType.Custom,
    );
    if (isProSurface) {
      return (
        customs.some((it) => it.account?.template === SOL_TRANSFER_TEMPLATE) &&
        customs.some((it) => it.account?.template === BATCH_SOL_TEMPLATE)
      );
    }
    return customs.length > 0;
  }, [intentsQuery.data, isProSurface]);
  useEffect(() => {
    if (!name || intentsQuery.isLoading || walletQuery.isLoading) return;
    if (alreadySetUp) {
      router.replace(
        `/app/wallet/${encodeURIComponent(name)}${isProSurface ? "?surface=pro" : ""}`,
      );
    }
  }, [
    name,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    alreadySetUp,
    isProSurface,
    router,
  ]);

  // Time-lock choice. 0 = ship immediately once approvals land.
  // 24 * 3600 = 86_400s wait. Per the retail-pivot Months 3-4 spec,
  // this is "Wait 24h before sending" - a cooling-off period for
  // shared wallets that want a buffer against impulse / mistakes.
  const [delaySeconds, setDelaySeconds] = useState<number>(0);
  // Stays true after the on-chain enable lands so we can render the
  // NextStepCard inline instead of router.push'ing the user away.
  const [showDone, setShowDone] = useState(false);

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) {
        throw new Error("Connect your wallet first");
      }
      // Setup signs against the AddIntent meta-intent (slot 0),
      // whose approvers were set at wallet-create time. Resolve
      // which of our pubkeys (Ledger vs Dynamic embedded) is in
      // that approver list - without this, a user with both
      // signers connected can pick the wrong one and have the
      // on-chain verify reject. Mirror of the send pages' fix.
      const addIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.AddIntent,
      );
      const signerPk = addIntent?.account
        ? wallet.pickSigner(addIntent.account.approvers)
        : wallet.publicKey;
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const me = signerPk.toBase58();
      const proposers = [me];
      const approvers = [me];
      const threshold = 1;

      // 0. Encrypt the policy fields client-side via the Encrypt
      //    surface. Pre-alpha returns plaintext-as-ciphertext; the
      //    identifiers flow through to the backend + CLI so the
      //    full wire path is exercised.
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([delaySeconds & 0xff]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      const existingCustoms = (intentsQuery.data ?? []).filter(
        (it) => it.account?.intentType === IntentType.Custom,
      );
      const hasSolTransfer = existingCustoms.some(
        (it) => it.account?.template === SOL_TRANSFER_TEMPLATE,
      );
      const hasBatchTransfer = existingCustoms.some(
        (it) => it.account?.template === BATCH_SOL_TEMPLATE,
      );
      const templatesToAdd = isProSurface
        ? [
            ...(hasSolTransfer ? [] : [SOL_TEMPLATE_FILE]),
            ...(hasBatchTransfer ? [] : [BATCH_SOL_TEMPLATE_FILE]),
          ]
        : existingCustoms.length > 0
          ? []
          : [SOL_TEMPLATE_FILE];

      let lastSubmitted: Record<string, unknown> | null = null;
      for (const file of templatesToAdd) {
        const dry = await backendApi.prepare.addIntent(name, {
          file,
          proposers,
          approvers,
          threshold,
          cancellation_threshold: 1,
          timelock: delaySeconds,
          policy_ciphertexts,
        });

        const signed = await signDescriptor(dry, { preferSigner: signerPk });
        const submitted = await backendApi.submit.addIntent(name, {
          ...signed,
          params_data_hex: dry.params_data_hex,
          expiry: dry.expiry,
          file,
        });
        lastSubmitted = submitted;

        const proposal = (submitted as Record<string, unknown>)?.proposal;
        if (typeof proposal !== "string" || proposal.length === 0) {
          throw new Error(
            "Backend didn't return a proposal address from the propose step",
          );
        }

        const decision = await approveIfNeeded(connection, proposal);
        if (decision.needsApproveSignature) {
          const approveDry = await backendApi.prepare.approveProposal(
            name,
            proposal,
            { actor_pubkey: me },
          );
          const approveSigned = await signDescriptor(approveDry, {
            preferSigner: signerPk,
          });
          await backendApi.submit.approveProposal(name, proposal, {
            ...approveSigned,
            expiry: approveDry.expiry,
          });
        }

        await backendApi.executeProposal(name, proposal, {});
        await sleep(650);
      }

      return lastSubmitted ?? {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      // Don't push the user away - render a NextStepCard inline so
      // they choose where to go next (send their first request,
      // invite someone, or back to the hub). The toast captures the
      // celebration; the card captures the next move.
      toast.success(
        isProSurface
          ? `${toHeadingName(name)} is ready for Pro payouts`
          : `${toHeadingName(name)} is ready to send`,
      );
      setShowDone(true);
    },
    onError: (err) => {
      console.error("[setup-spending]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Set up sending" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip - see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {showDone ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-accent-rest">
                <Check className="h-8 w-8" strokeWidth={2.5} />
              </div>
              <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
                <span className="text-accent">{toHeadingName(name)}</span>{" "}
                is ready {isProSurface ? "for Pro transfers" : "to send"}
              </h1>
              <p className="mt-3 max-w-sm text-base text-text-soft">
                {isProSurface
                  ? "The SOL funding and batch transfer rules are on chain. No money has moved yet."
                  : "Spending rule is on chain. The activity row you see is the rule going into effect. No money has moved yet."}
              </p>
              <div className="mt-8 w-full">
                <NextStepCard
                  title={`What do you want to do in ${toDisplayName(name)}?`}
                  options={[
                    {
                      label: isProSurface ? "Create bank payout" : "Send your first request",
                      hint: isProSurface
                        ? "Fund settlement from the multisig, then Kora pays NGN."
                        : "Pick someone, enter an amount, sign once.",
                      href: isProSurface
                        ? `/app/wallet/${encodeURIComponent(name)}/payouts?surface=pro`
                        : `/app/wallet/${encodeURIComponent(name)}/send`,
                      primary: true,
                      icon: Send,
                    },
                    {
                      label: "Invite someone",
                      hint: "Friend, teammate, or board member.",
                      href: `/app/wallet/${encodeURIComponent(name)}/members/add`,
                      icon: UserPlus,
                    },
                    {
                      label: `Back to ${toDisplayName(name)}`,
                      href: `/app/wallet/${encodeURIComponent(name)}${isProSurface ? "?surface=pro" : ""}`,
                      icon: Wallet,
                    },
                  ]}
                />
              </div>
            </div>
          ) : (
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Send className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {isProSurface ? "Pro setup" : "First-time setup"}
            </p>
            <h1 className="hidden md:block mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              {isProSurface ? "Enable Pro transfers in" : "Set up sending in"}{" "}
              <span className="text-accent">{toHeadingName(name)}</span>
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              {isProSurface
                ? "One setup adds the SOL funding rule and batch transfer rule this Pro workspace needs. Your wallet will ask you to confirm."
                : `One quick setup so this wallet can send money. Your wallet will ask you to confirm. That's how the rule becomes part of ${toDisplayName(name)}.`}
            </p>

            <div className="mt-6 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                {isProSurface ? "What this enables" : "What this enables"}
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-sm text-text-strong">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {isProSurface
                    ? "Your team can fund approved bank payouts from the multisig, then dispatch NGN through Kora."
                    : "Anyone in the wallet can request to send money out."}
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  Your wallet&rsquo;s approval rules apply (right now,
                  just you).
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {isProSurface
                    ? "Personal wallets stay simple; Pro carries the team workflow."
                    : "You can change this later when you have more friends."}
                </li>
              </ul>
            </div>

            {/* Optional cooling-off period - `timelockSeconds` on the
                intent. Defaults to ship-immediately; 24h is the
                second-thoughts buffer for shared wallets. */}
            <div className="mt-4 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                When approvals are in
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SpeedOption
                  selected={delaySeconds === 0}
                  onSelect={() => setDelaySeconds(0)}
                  Icon={Zap}
                  title="Send right away"
                  body="Goes the moment everyone approves."
                />
                <SpeedOption
                  selected={delaySeconds === 86400}
                  onSelect={() => setDelaySeconds(86400)}
                  Icon={Clock}
                  title="Wait 24 hours"
                  body="A cooling-off day before it ships."
                />
              </div>
            </div>

            <div className="mt-6 flex w-full flex-col gap-3">
              <SignPayloadPreview
                action={`${isProSurface ? "Enable Pro transfers" : "Enable sending"} in ${toDisplayName(name)}`}
                details={[
                  { label: "Wallet", value: toDisplayName(name) },
                  {
                    label: "Approvers",
                    value: "Just you for now",
                  },
                  {
                    label: "Pace",
                    value:
                      delaySeconds === 0
                        ? "Ships immediately"
                        : "Wait 24 hours",
                  },
                ]}
              />
              <WalletPopupNarration action="enable sending" />
            </div>

            <Button
              size="lg"
              fullWidth
              className="mt-3"
              onClick={() => setup.mutate()}
              disabled={setup.isPending}
            >
              {setup.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Setting up…
                </>
              ) : (
                <>
                  {isProSurface ? "Enable Pro transfers" : "Enable sending"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
          )}
        </motion.section>
      </div>
    </main>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ─── Speed option tile ─────────────────────────────────────────────

interface SpeedOptionProps {
  selected: boolean;
  onSelect: () => void;
  Icon: typeof Zap;
  title: string;
  body: string;
}

function SpeedOption({
  selected,
  onSelect,
  Icon,
  title,
  body,
}: SpeedOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-1 rounded-card border p-3 text-left " +
        "transition-[border-color,background-color,box-shadow] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
        (selected
          ? "border-accent bg-accent/5 shadow-card-rest"
          : "border-border-soft bg-canvas")
      }
    >
      <div
        className={
          "flex h-9 w-9 items-center justify-center rounded-full " +
          (selected ? "bg-accent text-white" : "bg-accent/10 text-accent")
        }
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <p className="mt-1 text-sm font-medium text-text-strong">{title}</p>
      <p className="text-[11px] leading-snug text-text-soft">{body}</p>
    </button>
  );
}
