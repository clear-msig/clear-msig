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
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Send,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  WalletPopupNarration,
} from "@/components/retail/WalletPopupNarration";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { shortEvmAddress } from "@/lib/chain/eth";

// Chain kind 1 = Ethereum (EIP-1559). Sepolia variant of the
// canonical evm_transfer template; the chain_id has been swapped to
// 11155111 so signed txs broadcast against the right network.
const ETH_TEMPLATE = "examples/intents/evm_transfer_sepolia.json";
const ETH_CHAIN_KIND = 1;

export default function SetupEthPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  const ethMeta = chainByKind(ETH_CHAIN_KIND);

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
          a.chainKind === ETH_CHAIN_KIND,
      );
  }, [intentsQuery.data]);

  useEffect(() => {
    if (!name || intentsQuery.isLoading || walletQuery.isLoading) return;
    if (existingEthIntent) {
      router.replace(
        `/app/wallet/${encodeURIComponent(name)}/send/eth`,
      );
    }
  }, [
    name,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    existingEthIntent,
    router,
  ]);

  // Binding guard. Without an Ethereum chain binding the dWallet
  // doesn't exist yet, so adding the intent would propose against
  // a chain the wallet can't sign on.
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === ETH_CHAIN_KIND,
    );
  }, [chainsQuery.data]);
  const ethAddress = ethBinding ? chainAddress(ethBinding) : null;
  const needsBinding =
    !chainsQuery.isLoading && !walletQuery.isLoading && !ethBinding;

  const [delaySeconds, setDelaySeconds] = useState<number>(0);

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethBinding) throw new Error("Bind Ethereum to this wallet first");
      const me = wallet.publicKey.toBase58();
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
        file: ETH_TEMPLATE,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: delaySeconds,
        policy_ciphertexts,
      });
      const signed = await signDescriptor(dry);
      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: ETH_TEMPLATE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend didn't return a proposal address from enable-Ethereum",
        );
      }
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry);
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
      toast.success(`${toHeadingName(name)} can now send Ethereum`);
      router.push(`/app/wallet/${encodeURIComponent(name)}/send/eth`);
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

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <StickyTopBar>
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: name, href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Enable Ethereum" },
          ]}
        />
      </StickyTopBar>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center">
            {ethMeta && (
              <div className="mb-6">
                <ChainBadge chain={ethMeta} size="lg" />
              </div>
            )}
            <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Enable Ethereum sending in <span className="text-accent">{toHeadingName(name)}</span>
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              Adds a spending rule for Ethereum so {toDisplayName(name)} can
              move ETH on the Sepolia testnet. One quick setup; the rule
              is signed by you and lives on chain.
            </p>

            {needsBinding && (
              <div className="mt-6 w-full rounded-card border border-warning/30 bg-warning/5 p-4 text-left">
                <p className="text-sm font-medium text-text-strong">
                  Bind Ethereum first
                </p>
                <p className="mt-1 text-xs text-text-soft">
                  This wallet does not have an Ethereum address yet. Add
                  Ethereum on the chains page (about 30 seconds) and come
                  back here.
                </p>
                <Link
                  href={`/app/wallet/${encodeURIComponent(name)}/chains/add`}
                  className={
                    "mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent " +
                    "rounded-soft px-2 py-1 transition-colors duration-base ease-out-soft hover:text-accent-hover " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-warning/5"
                  }
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                  Add Ethereum
                </Link>
              </div>
            )}

            {!needsBinding && (
              <>
                <div className="mt-6 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
                    What this enables
                  </p>
                  <ul className="mt-3 flex flex-col gap-2 text-sm text-text-strong">
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Send ETH from this wallet on Sepolia.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Same approval rule applies (right now, just you).
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Your wallet&rsquo;s ETH address: {ethAddress ? shortEvmAddress(ethAddress) : "(spinning up)"}.
                    </li>
                  </ul>
                </div>

                <div className="mt-4 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
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

                <div className="mt-6 w-full flex flex-col gap-3">
                  <SignPayloadPreview
                    action={`Enable Ethereum sending in ${toDisplayName(name)}`}
                    details={[
                      { label: "Wallet", value: toDisplayName(name) },
                      { label: "Chain", value: "Ethereum (Sepolia)" },
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
                    action="enable Ethereum sending"
                    popups={2}
                  />
                </div>

                <Button
                  size="lg"
                  fullWidth
                  className="mt-3"
                  onClick={() => setup.mutate()}
                  disabled={setup.isPending || !ethBinding}
                >
                  {setup.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Setting up
                    </>
                  ) : (
                    <>
                      Enable Ethereum sending
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </motion.section>
      </div>
    </main>
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
          : "border-border-soft bg-canvas hover:border-accent/40")
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
