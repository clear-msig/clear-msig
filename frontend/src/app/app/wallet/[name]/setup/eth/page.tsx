"use client";

// Enable Ethereum sending. Mirrors /setup but for the EVM transfer
// template instead of SolTransfer. Adds a per-chain spending intent
// to the wallet so /send/eth can compose proposals against it.
//
// Pre-flight:
//   - The wallet MUST already be bound to Ethereum (an Ika dWallet
//     gives it an EVM address). Bindings happen on /chains/add.
//   - If the wallet is not bound yet, this page surfaces a clear
//     "bind Ethereum first" CTA instead of attempting the intent
//     mutation.
//
// Two-popup ceremony, identical to the Solana setup:
//   1. propose AddIntent for evm_transfer_sepolia.json
//   2. (auto-approves with the program upgrade; falls back through
//      approveIfNeeded against an old program)
// then sponsored execute.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import {
  ArrowRight,
  Check,
  Loader2,
  Send,
  UserPlus,
  Wallet,
} from "lucide-react";
import { NextStepCard } from "@/components/retail/NextStepCard";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  WalletPopupNarration,
} from "@/components/retail/WalletPopupNarration";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { shortEvmAddress } from "@/lib/chain/eth";

export default function SetupEthPage() {
  const params = useParams<{ name: string }>();
  const searchParams = useSearchParams();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const isHyperliquid = searchParams?.get("network") === "hyperliquid";
  const EVM_CHAIN_KIND = isHyperliquid ? 5 : 1;
  const EVM_TEMPLATE = isHyperliquid
    ? "examples/intents/hyperliquid_transfer.json"
    : "examples/intents/evm_transfer_sepolia.json";
  const EVM_LABEL = isHyperliquid ? "Hyperliquid" : "Ethereum";
  const EVM_TICKER = isHyperliquid ? "HYPE" : "ETH";

  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  const ethMeta = chainByKind(EVM_CHAIN_KIND);

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
  const chainsQuery = useWalletChains(name);

  // Already-set-up guard. If an EvmTransfer intent exists, send the
  // user straight to the cross-chain send page; this screen is a
  // one-time setup.
  const existingEthIntent = useMemo(() => {
    return (intentsQuery.data ?? [])
      .map((it) => it.account)
      .find(
        (a) =>
          a !== null &&
          a.intentType === IntentType.Custom &&
          a.chainKind === EVM_CHAIN_KIND,
      );
  }, [intentsQuery.data, EVM_CHAIN_KIND]);

  useEffect(() => {
    if (!name || intentsQuery.isLoading || walletQuery.isLoading) return;
    if (existingEthIntent) {
      router.replace(
        `/app/wallet/${encodeURIComponent(name)}/send/eth${isHyperliquid ? "?network=hyperliquid" : ""}`,
      );
    }
  }, [
    name,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    existingEthIntent,
    router,
    isHyperliquid,
  ]);

  // Binding guard. Without an Ethereum chain binding the dWallet
  // doesn't exist yet, so adding the intent would propose against
  // a chain the wallet can't sign on.
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === EVM_CHAIN_KIND,
    );
  }, [chainsQuery.data, EVM_CHAIN_KIND]);
  const ethAddress = ethBinding ? chainAddress(ethBinding) : null;
  const needsBinding =
    !chainsQuery.isLoading && !walletQuery.isLoading && !ethBinding;

  const [delaySeconds, setDelaySeconds] = useState<number>(0);
  // showDone gates the inline success card. Mirrors /setup (SOL).
  // Replaces the old `router.push(.../send/eth)` which threw the
  // user into the compose form before they could register that the
  // chain was set up.
  const [showDone, setShowDone] = useState(false);

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethBinding) throw new Error(`Bind ${EVM_LABEL} to this wallet first`);
      // Resolve which signer pubkey the wallet's AddIntent meta-
      // intent expects (Ledger vs Dynamic embedded). See setup/page.tsx.
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

      // Encrypt policy fields, same shape the SOL setup uses.
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

      const dry = await backendApi.prepare.addIntent(name, {
        file: EVM_TEMPLATE,
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
        file: EVM_TEMPLATE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          `Backend didn't return a proposal address from enable-${EVM_LABEL}`,
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
      // Sponsored execute. Flips the program-side state so the new
      // EvmTransfer intent is live; sends are then unblocked.
      await backendApi.executeProposal(name, proposal, {});
      return submitted;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      toast.success(`${toHeadingName(name)} can now send ${EVM_LABEL}`);
      // Inline success - parity with /setup (SOL). The previous
      // router.push to /send/eth threw the user into the compose
      // form before they could register that the chain was enabled.
      setShowDone(true);
    },
    onError: (err) => {
      console.error("[setup-eth]", err);
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

  const walletDisplay = toDisplayName(name);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-5"
      >
        {showDone ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-accent-rest">
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                    {EVM_LABEL} sending enabled
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-soft">
                    Spending rule is live on chain. No money has moved yet.
                  </p>
                </div>
              </div>
              <p className="mt-5 font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
                <span className="text-accent">{toHeadingName(name)}</span> can
                send {EVM_LABEL}
              </p>
              <p className="mt-1.5 text-sm text-text-soft">
                Pick a recipient, enter an amount, sign once.
              </p>
            </div>
            <NextStepCard
              title={`What do you want to do in ${walletDisplay}?`}
              options={[
                {
                  label: `Send your first ${EVM_TICKER} request`,
                  hint: "Pick a recipient, enter an amount, sign once.",
                  href: `/app/wallet/${encodeURIComponent(name)}/send/eth${isHyperliquid ? "?network=hyperliquid" : ""}`,
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
                  label: `Back to ${walletDisplay}`,
                  href: `/app/wallet/${encodeURIComponent(name)}`,
                  icon: Wallet,
                },
              ]}
            />
          </div>
        ) : (
          <>
            {/* Compact left-aligned header. Matches /send and the
                rest of the redesigned workspace pages. Chain badge
                inline + mono eyebrow + display title + "From {wallet}"
                on the right. */}
            <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="flex items-center gap-3">
                {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
                <div className="flex flex-col gap-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                    Setup · {EVM_LABEL}
                  </p>
                  <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
                    Enable {EVM_LABEL} sending
                  </h1>
                </div>
              </div>
              <p className="text-xs text-text-soft sm:text-sm">
                For{" "}
                <span className="font-medium text-text-strong">
                  {walletDisplay}
                </span>
              </p>
            </header>

            <p className="text-sm leading-relaxed text-text-soft">
              Adds a spending rule for {EVM_LABEL} so {walletDisplay} can move
              {EVM_TICKER === "HYPE" ? " HYPE" : " ETH"} on the network.
              One quick setup; the rule is signed by you and lives on chain.
            </p>

            {needsBinding && (
              <div className="rounded-card border border-warning/30 bg-warning/5 p-5 shadow-card-rest">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
                  Bind {EVM_LABEL} first
                </p>
                <p className="mt-2 text-sm text-text-strong">
                  This wallet does not have a {EVM_LABEL} address yet. Add
                  {EVM_LABEL} on the chains page (about 30 seconds) and come
                  back here.
                </p>
                <Link
                  href={`/app/wallet/${encodeURIComponent(name)}/chains/add`}
                  className={
                    "mt-3 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
                    "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  }
                >
                  Add {EVM_LABEL}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            )}

            {!needsBinding && (
              <>
                <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                    What this enables
                  </p>
                  <ul className="mt-3 flex flex-col gap-2 text-sm text-text-strong">
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Send {EVM_TICKER} from this wallet.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Same approval rule applies (right now, just you).
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Your wallet&rsquo;s {EVM_LABEL} address:{" "}
                      <span className="font-mono text-xs text-text-soft">
                        {ethAddress
                          ? shortEvmAddress(ethAddress)
                          : "(spinning up)"}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                    When approvals are in
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <PaceTile
                      selected={delaySeconds === 0}
                      onSelect={() => setDelaySeconds(0)}
                      title="Send right away"
                      body="Goes the moment everyone approves."
                    />
                    <PaceTile
                      selected={delaySeconds === 86400}
                      onSelect={() => setDelaySeconds(86400)}
                      title="Wait 24 hours"
                      body="A cooling-off day before it ships."
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <SignPayloadPreview
                    action={`Enable ${EVM_LABEL} sending in ${walletDisplay}`}
                    details={[
                      { label: "Wallet", value: walletDisplay },
                      { label: "Chain", value: EVM_LABEL },
                      ethAddress
                        ? {
                            label: "Address",
                            value: shortEvmAddress(ethAddress),
                            emphasis: "mono" as const,
                          }
                        : { label: "Address", value: "spinning up" },
                      {
                        label: "Pace",
                        value:
                          delaySeconds === 0
                          ? "Ships immediately"
                          : "Wait 24 hours",
                      },
                    ]}
                  />
                  <WalletPopupNarration
                    action={`enable ${EVM_LABEL} sending`}
                  />
                </div>

                <Button
                  size="lg"
                  fullWidth
                  onClick={() => setup.mutate()}
                  disabled={setup.isPending || !ethBinding}
                >
                  {setup.isPending ? (
                    <>
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      Setting up
                    </>
                  ) : (
                    <>
                      Enable {EVM_LABEL} sending
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </>
            )}
          </>
        )}
      </motion.section>
    </div>
  );
}

interface PaceTileProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}

function PaceTile({ selected, onSelect, title, body }: PaceTileProps) {
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
          "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold " +
          (selected ? "bg-accent text-white" : "bg-accent/10 text-accent")
        }
      >
        {selected ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
      </div>
      <p className="mt-1 text-sm font-medium text-text-strong">{title}</p>
      <p className="text-[11px] leading-snug text-text-soft">{body}</p>
    </button>
  );
}
