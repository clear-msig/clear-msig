"use client";

// Send ETH (Sepolia) - purpose-built sibling of /send.
//
// The Solana send path is the original /send/page.tsx, untouched.
// This page exists for cross-chain. The flow:
//
//   1. Read the wallet's EVM binding (Ika dWallet → Sepolia address).
//      No binding => bounce to /chains/add.
//   2. Read the wallet's EVM intent (intent_index for the
//      EvmTransfer template). No intent => bounce to /setup/eth.
//   3. User enters recipient (0x...) + amount in ETH + optional note.
//   4. Frontend fetches the wallet's current EVM nonce from the
//      destination RPC.
//   5. prepare.createProposal with intent_index + EVM params.
//   6. signMessage on Solana (the multisig is on Solana - your
//      signature gates the EVM-side action).
//   7. submit.createProposal lands the proposal Approved on chain
//      (program auto-approves proposer-in-approvers, mirrors the
//      SolTransfer setup ceremony).
//   8. executeProposal with broadcast=true and Ika dWallet params
//      so the dWallet network signs + broadcasts the actual ETH tx
//      to Sepolia.
//
// SignPayloadPreview shows the user the EVM-side facts BEFORE the
// wallet popup fires: chain, recipient, amount-in-ETH, the budget
// impact under the policy. The wallet popup itself still shows the
// raw Solana sign-message bytes because we cannot change what
// Phantom / Solflare render; the disclaimer in WalletPopupNarration
// reminds them that's normal.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  List as ListIcon,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import {
  broadcastExplorerUrl,
  explorerLabelForChainKind,
  type BroadcastResultLike,
} from "@/lib/explorer";
import { recordAttempt } from "@/lib/retail/txLog";
import { IntentType } from "@/lib/msig";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  ethToWei,
  fetchEvmBalance,
  fetchEvmGasPrice,
  fetchEvmNonce,
  isValidEvmAddress,
  shortEvmAddress,
  weiToEth,
} from "@/lib/chain/eth";
import { looksLikeEnsName, resolveEnsName } from "@/lib/chain/ens";
import { QrScanButton } from "@/components/retail/QrScanButton";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { appConfig } from "@/lib/config";

const ETH_CHAIN_KIND = 1;

type Stage = "compose" | "sending" | "sent";

// Strip an EIP-681 / wallet-scheme prefix from a scanned QR. We
// don't fully parse the URI (chain id + value query params); the
// recipient field cares about the address. Anything we can't
// recognise passes through unchanged so the user can paste raw
// content too.
function parseEvmRecipientFromQr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // ethereum:0x… or pay-ethereum:0x… (EIP-681).
  const m = trimmed.match(/^(?:pay-)?ethereum:(0x[0-9a-fA-F]{40})/);
  if (m) return m[1];
  // Otherwise let the input field's existing validation surface
  // any issues - better to pass through than silently swallow.
  return trimmed;
}

export default function SendEthPageWrapper() {
  return (
    <Suspense
      fallback={<div className="min-h-screen" aria-hidden="true" />}
    >
      <SendEthPage />
    </Suspense>
  );
}

function SendEthPage() {
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  const walletDisplay = toDisplayName(walletName);

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
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
  const chainsQuery = useWalletChains(walletName);

  // Match the wallet's EvmTransfer intent (chainKind === 1) and the
  // Ethereum binding. Both must be present to send.
  const ethIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === ETH_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === ETH_CHAIN_KIND,
    );
  }, [chainsQuery.data]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  const allLoaded =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading;
  const needsBinding = allLoaded && !ethBinding;
  const needsIntent = allLoaded && !!ethBinding && !ethIntent;

  const [stage, setStage] = useState<Stage>("compose");
  // Initial values from URL params so /app/wallet/[name]'s
  // QuickAction input can route here with the form pre-filled.
  const [amount, setAmount] = useState(() => params?.get("amount")?.trim() ?? "");
  const [recipient, setRecipient] = useState(() => params?.get("recipient")?.trim() ?? "");
  const [note, setNote] = useState(() => params?.get("note")?.trim() ?? "");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    to: string;
    explorerUrl: string | null;
    explorerLabel: string;
  } | null>(null);

  const trimmedRecipient = recipient.trim();
  const directlyValid = isValidEvmAddress(trimmedRecipient);

  // ENS resolution - fired when the typed text doesn't already
  // look like a 0x address but does look like an ENS name. The
  // resolved 0x address is what we sign / broadcast against; the
  // user-typed name is preserved for display only.
  const shouldTryEns =
    !directlyValid && looksLikeEnsName(trimmedRecipient);
  const ensQuery = useQuery({
    queryKey: ["ens-resolve", trimmedRecipient.toLowerCase()],
    queryFn: () => resolveEnsName(trimmedRecipient),
    enabled: shouldTryEns,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const ensAddress =
    shouldTryEns && ensQuery.data ? ensQuery.data : null;
  const ensResolving =
    shouldTryEns && (ensQuery.isLoading || ensQuery.isFetching);
  const ensFailed =
    shouldTryEns &&
    !ensResolving &&
    ensQuery.isFetched &&
    !ensQuery.data;

  // The address we'll actually sign + broadcast to. Either the
  // pasted 0x address or the ENS-resolved address.
  const effectiveRecipient = directlyValid
    ? trimmedRecipient
    : ensAddress;
  const recipientValid = !!effectiveRecipient;
  let amountValid = false;
  let amountWei = 0n;
  try {
    if (amount.trim()) {
      amountWei = ethToWei(amount);
      amountValid = amountWei > 0n;
    }
  } catch {
    amountValid = false;
  }

  // Live wallet ETH balance for the dWallet's Sepolia address. Fetched
  // every 15s; refreshed after a successful send so the post-send
  // balance is fresh. Drives the "Wallet has X.XXXX ETH" display + the
  // pre-flight insufficient-balance check below.
  const ethBalanceQuery = useQuery({
    queryKey: ["wallet-eth-balance", walletEthAddress ?? ""],
    queryFn: () => fetchEvmBalance(walletEthAddress!),
    enabled: !!walletEthAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Live gas price from the destination RPC. Refetched every 30s so
  // a Sepolia base-fee spike doesn't leave the user stuck with an
  // off-by-2x reserve. Falls back to a 50-gwei default below if the
  // query is still loading or errored - over-reserving is the safe
  // direction (lets a real send through later; doesn't push a
  // doomed one through now).
  const gasPriceQuery = useQuery({
    queryKey: ["evm-gas-price", appConfig.preAlpha.destinationRpcUrl],
    queryFn: () => fetchEvmGasPrice(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // 21000 gas for a value transfer (no calldata). Solidity calls
  // would need more, but the EVM intent template only does ETH
  // transfers; if that changes, read gas_limit from the intent's
  // tx_template (8 bytes at offset 8) instead.
  const VALUE_TRANSFER_GAS = 21_000n;
  // Headroom multiplier - 50% over the live estimate so a spike
  // mid-broadcast doesn't trip the wallet's effective balance.
  const GAS_RESERVE_HEADROOM_NUMER = 3n;
  const GAS_RESERVE_HEADROOM_DENOM = 2n;
  // Floor: 50 gwei × 21000 = 0.00105 ETH. Used when the live price
  // hasn't loaded yet so the Max button + insufficient-balance
  // check stay populated and the UX doesn't flicker.
  const FALLBACK_GAS_PRICE_WEI = 50_000_000_000n; // 50 gwei

  const liveGasPriceWei = gasPriceQuery.data ?? FALLBACK_GAS_PRICE_WEI;
  const ETH_GAS_RESERVE_WEI =
    (liveGasPriceWei * VALUE_TRANSFER_GAS * GAS_RESERVE_HEADROOM_NUMER) /
    GAS_RESERVE_HEADROOM_DENOM;

  const balance = ethBalanceQuery.data ?? null;
  const balanceLoaded = ethBalanceQuery.isFetched && balance !== null;
  const requiredWei = amountValid ? amountWei + ETH_GAS_RESERVE_WEI : 0n;
  // Block submit when we know the balance is too low. While the
  // balance is still loading, don't block - the propose step is
  // safe; the broadcast itself will short-circuit if the balance
  // really is empty.
  const insufficientBalance =
    balanceLoaded && amountValid && balance! < requiredWei;

  // Policy-rule pre-flight tripwire (Tier-5 #33). Same shape as the
  // SOL send: deny rules block submit, require-* surface friction
  // banners. ENS-resolved address is already in effectiveRecipient.
  const policyEvaluation = usePolicyEvaluation({
    walletName,
    chainKind: 1,
    recipient: effectiveRecipient ?? "",
    ticker: "ETH",
    amountDisplay: amount,
    enabled: amountValid && !!effectiveRecipient,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const canSubmit =
    amountValid &&
    recipientValid &&
    !!ethIntent &&
    !!walletEthAddress &&
    !!wallet.publicKey &&
    !insufficientBalance &&
    !policyDenied;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethIntent || !ethIntent.account)
        throw new Error("Ethereum sending isn't set up for this wallet");
      if (!walletEthAddress)
        throw new Error("Wallet's Ethereum address isn't ready yet");
      if (!recipientValid || !effectiveRecipient)
        throw new Error("Recipient must be a valid 0x address or .eth name");

      // Resolve which signer pubkey the wallet's approver list
      // expects (Ledger vs Dynamic embedded). See useWallet.pickSigner.
      const signerPk = wallet.pickSigner(ethIntent.account.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }

      // 1. Pull the live nonce. Without this the EVM tx the dWallet
      //    signs gets rejected as a duplicate.
      const { nonce } = await fetchEvmNonce(walletEthAddress);

      // 2. Prepare. The CLI encodes nonce/to/value_wei/data into
      //    params_data per the evm_transfer_sepolia template.
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: ethIntent.account.intentIndex,
        params: [
          `nonce=${nonce}`,
          `to=${effectiveRecipient}`,
          `value_wei=${amountWei.toString()}`,
          `data=`,
        ],
        actor_pubkey: signerPk.toBase58(),
      });

      // 3. Sign on Solana. Proves to the program that this user is
      //    a proposer + counts as their approval.
      const signed = await signDescriptor(dry, { preferSigner: signerPk });

      // 4. Submit. Lands the proposal Approved on chain (program's
      //    auto-approve when proposer-in-approvers).
      const submitted = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: ethIntent.account.intentIndex,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from submit");
      }

      // Old-program fallback: re-sign approve if the propose did not
      // auto-approve. With the upgrade this branch never fires.
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: signerPk.toBase58() },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      // 5. Execute with broadcast=true and Ika dWallet params. The
      //    backend tells Ika to sign + broadcast the EVM tx; the
      //    dWallet's secp256k1 signature lands the real Sepolia tx.
      const executed = await backendApi.executeProposal(walletName, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        rpc_url: appConfig.preAlpha.destinationRpcUrl,
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast };
    },
    onSuccess: ({ broadcast }) => {
      const explorerUrl = broadcastExplorerUrl(
        broadcast,
        appConfig.preAlpha.destinationRpcUrl,
      );
      const explorerLabel = explorerLabelForChainKind(
        broadcast?.chain_kind,
        appConfig.preAlpha.destinationRpcUrl,
      );
      // Prefer the typed ENS name in the success label so the user
      // sees what they wrote ("vitalik.eth") rather than the
      // resolved 0x address.
      const sentTo = ensAddress
        ? trimmedRecipient
        : shortEvmAddress(effectiveRecipient ?? trimmedRecipient);
      setSentLabel({
        amount: amount.trim(),
        to: sentTo,
        explorerUrl,
        explorerLabel,
      });
      // Persist the success in the per-wallet tx log for the
      // "Recent send attempts" widget - gives the user durable
      // proof of the send instead of a transient toast.
      recordAttempt({
        walletName,
        chainKind: ETH_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: "ETH",
        recipientShort: sentTo,
        recipientFull: effectiveRecipient ?? undefined,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      // Refresh every place ETH balance is shown so the post-send
      // compose, /chains row, and portfolio panel all reflect the
      // new number. Multiple keys for the same data - each consumer
      // picked its own type/shape; invalidate them all.
      queryClient.invalidateQueries({ queryKey: ["wallet-eth-balance"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-eth]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      // Persist the failure so the user can find the error after
      // the toast disappears. Keep stderr (when available from a
      // BackendApiError payload) for the "Show details" expander.
      const stderr =
        (err as { payload?: { stderr?: string } })?.payload?.stderr ?? undefined;
      recordAttempt({
        walletName,
        chainKind: ETH_CHAIN_KIND,
        status: "failed",
        amountDisplay: amount.trim(),
        ticker: "ETH",
        recipientShort: effectiveRecipient
          ? ensAddress
            ? trimmedRecipient
            : shortEvmAddress(effectiveRecipient)
          : trimmedRecipient || undefined,
        errorBrief: fe.title,
        errorStderr: stderr ? stderr.slice(0, 800) : undefined,
      });
      setStage("compose");
    },
  });

  const handleSubmit = () => {
    setStage("sending");
    submit.mutate();
  };

  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  // Short-circuit renders for the two pre-flight gates. Bounces are
  // explicit links rather than auto-redirects so the user understands
  // why they were moved.
  if (allLoaded && needsBinding) {
    return (
      <PreFlightCard
        title="Add Ethereum to this wallet first"
        body="This wallet doesn't have an Ethereum address yet. Adding Ethereum spins up its dWallet (about 30 seconds), then you can come back here."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add`,
          label: "Add Ethereum",
        }}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title="Enable Ethereum sending first"
        body="Ethereum is bound to this wallet, but the spending rule for it isn't set up yet. One quick setup, then sends are unlocked."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/eth`,
          label: "Enable Ethereum sending",
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="flex flex-1 flex-col">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {stage === "compose" && (
            <SendChainPicker walletName={walletName} activeKind={ETH_CHAIN_KIND} />
          )}
          {stage === "compose" && policyEvaluation?.matched && (
            <PolicyMatchBanner
              walletName={walletName}
              evaluation={policyEvaluation}
            />
          )}
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName}
              walletEthAddress={walletEthAddress}
              amount={amount}
              setAmount={setAmount}
              amountWei={amountWei}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientValid={recipientValid}
              effectiveRecipient={effectiveRecipient}
              ensName={ensAddress ? trimmedRecipient : null}
              ensResolving={ensResolving}
              ensFailed={ensFailed}
              note={note}
              setNote={setNote}
              amountValid={amountValid}
              canSubmit={canSubmit}
              walletBalanceWei={balance}
              balanceLoading={ethBalanceQuery.isLoading}
              insufficientBalance={insufficientBalance}
              gasReserveWei={ETH_GAS_RESERVE_WEI}
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && <SendingStage reduce={!!reduce} />}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              to={sentLabel.to}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
              walletName={walletName}
              walletDisplay={walletDisplay || "your shared wallet"}
              reduce={!!reduce}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}

// ─── Compose stage ────────────────────────────────────────────────

interface ComposeStageProps {
  walletName: string;
  walletEthAddress: string | null;
  amount: string;
  setAmount: (s: string) => void;
  amountWei: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  /// The 0x address we'll actually sign + broadcast against -
  /// either the typed 0x or the ENS-resolved one. Null while
  /// the user is typing.
  effectiveRecipient: string | null;
  /// The .eth name the user typed, when we successfully
  /// resolved it. Null when the user pasted a raw 0x address.
  ensName: string | null;
  /// True while the ENS proxy is in flight.
  ensResolving: boolean;
  /// True when the typed text looked like an ENS name but the
  /// proxy returned no record.
  ensFailed: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  walletBalanceWei: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  gasReserveWei: bigint;
  onSubmit: () => void;
  reduce: boolean;
}

function ComposeStage({
  walletName,
  walletEthAddress,
  amount,
  setAmount,
  amountWei,
  recipient,
  setRecipient,
  recipientValid,
  effectiveRecipient,
  ensName,
  ensResolving,
  ensFailed,
  note,
  setNote,
  amountValid,
  canSubmit,
  walletBalanceWei,
  balanceLoading,
  insufficientBalance,
  gasReserveWei,
  onSubmit,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const ethMeta = chainByKind(ETH_CHAIN_KIND);

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: "Ethereum (Sepolia)" },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid && effectiveRecipient) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(effectiveRecipient),
      emphasis: "mono",
    });
    if (ensName) {
      previewDetails.push({ label: "ENS name", value: ensName });
    }
  }
  if (amountValid) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ETH`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Compact left-aligned header — matches SOL /send. Chain badge
          inline with eyebrow + display title; "From {wallet}" sits on
          the right edge so the network identity is unmistakable
          without burning vertical space. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send · Ethereum
            </p>
            <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
              Send ETH
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/send/erc20`}
        className={
          "inline-flex min-h-tap w-fit items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-soft " +
          "transition-[border-color,color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:text-accent " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        Send a token instead (USDC, DAI, …)
      </Link>

      <div className="flex flex-col gap-3">
        <Field
          label="Amount"
          hint={amount.trim() && !amountValid ? "Must be a positive number." : undefined}
        >
          <div className="flex items-baseline gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const stripped = e.target.value.replace(/[^\d.]/g, "");
                const [whole = "", frac] = stripped.split(".");
                const next =
                  frac === undefined
                    ? whole.slice(0, 12)
                    : `${whole.slice(0, 12)}.${frac.slice(0, 18)}`;
                setAmount(next);
              }}
              placeholder="0.05"
              // font-numerals tabular-nums for column-aligned digits.
              // Same treatment as the SOL send page - every financial
              // amount input shares this typography.
              className={
                "flex-1 rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-numerals text-2xl font-semibold text-text-strong tabular-nums outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            <span className="font-display text-sm font-semibold uppercase tracking-[0.24em] text-text-soft">
              ETH
            </span>
          </div>
          {/* Live wallet balance + insufficient-balance gate.
              Same chip-pill treatment as the SOL send page -
              balance + Max sit as one group, font-numerals on
              the value for tabular alignment. */}
          <div className="mt-2 inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-2 text-xs">
            <span className="text-text-soft">Wallet has</span>
            <span className="font-numerals font-semibold text-text-strong tabular-nums">
              {balanceLoading
                ? "…"
                : typeof walletBalanceWei === "bigint"
                  ? weiToEth(walletBalanceWei)
                  : "-"}
            </span>
            <span className="text-text-soft">ETH</span>
            {typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n && (
                <UsdHint
                  amount={walletBalanceWei}
                  smallestPerWhole={1_000_000_000_000_000_000n}
                  ticker="ETH"
                  variant="plain"
                  className="text-text-soft"
                />
              )}
            {typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n && (
                <>
                  <span aria-hidden="true" className="h-3 w-px bg-border-soft" />
                  <button
                    type="button"
                    onClick={() => {
                      const max =
                        walletBalanceWei > gasReserveWei
                          ? walletBalanceWei - gasReserveWei
                          : 0n;
                      setAmount(weiToEth(max, 12));
                    }}
                    className="-mr-2 inline-flex min-h-tap min-w-tap items-center justify-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10"
                  >
                    Max
                  </button>
                </>
              )}
          </div>
          {insufficientBalance && walletBalanceWei !== null && (
            <p className="mt-2 rounded-soft border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-strong">
              <span className="font-medium">Insufficient balance.</span>{" "}
              You have {weiToEth(walletBalanceWei)} ETH
              <UsdHint
                amount={walletBalanceWei}
                smallestPerWhole={1_000_000_000_000_000_000n}
                ticker="ETH"
              />
              {" "}- need at least{" "}
              {weiToEth(amountWei + gasReserveWei)} ETH including ~
              {weiToEth(gasReserveWei)} for gas. Top up the wallet&rsquo;s
              Sepolia address from a faucet
              {walletEthAddress ? ` (${shortEvmAddress(walletEthAddress)})` : ""}
              .
            </p>
          )}
        </Field>

        <RecentRecipientsChips
          walletName={walletName}
          chainKind={ETH_CHAIN_KIND}
          onPick={(addr) => setRecipient(addr)}
        />

        <Field
          label="Recipient"
          hint={
            recipient.trim() && !recipientValid && !ensResolving && ensFailed
              ? "Couldn’t resolve that ENS name. Paste a 0x address instead."
              : recipient.trim() && !recipientValid && !ensResolving
                ? "Must be a 0x… 42-character Ethereum address or a .eth name."
                : undefined
          }
        >
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x… or vitalik.eth"
              className={
                "flex-1 rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-mono text-sm text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            <QrScanButton
              ariaLabel="Scan recipient QR"
              title="Scan a recipient QR"
              onResult={(v) => setRecipient(parseEvmRecipientFromQr(v))}
              className={
                "shrink-0 inline-flex h-auto items-center justify-center rounded-card border border-border-soft bg-surface-raised px-3 text-text-soft " +
                "transition-[border-color,color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:text-accent " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            />
          </div>
          {ensResolving && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Resolving {recipient.trim()}…
            </p>
          )}
          {ensName && effectiveRecipient && !ensResolving && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              Resolved {ensName} ·{" "}
              <span className="font-mono text-text-soft">
                {shortEvmAddress(effectiveRecipient)}
              </span>
            </p>
          )}
        </Field>

        <Field label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 80))}
            placeholder="What's it for?"
            className={
              "w-full rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && effectiveRecipient
              ? `Send ${amount.trim()} ETH to ${
                  ensName ?? shortEvmAddress(effectiveRecipient)
                }`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          warning="Cross-chain send is in alpha. The on-chain Solana sig you give here authorises Ika's dWallet network to broadcast the actual Ethereum tx. If anything is wrong with the EVM-side params, the broadcast fails and the wallet's Solana state stays untouched."
        />
        <WalletPopupNarration action="send this Ethereum request" popups={1} />
      </div>

      {/* Sticky-bottom CTA on mobile - see SOL send for full
          rationale. Form is long; without sticky the user scrolls
          past their typed values to find the button. */}
      <div
        className={
          "mt-3 -mx-3 sm:mx-0 px-3 sm:px-0 " +
          "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
          "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
        }
      >
        <Button
          size="lg"
          fullWidth
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          Send request
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-warning">{hint}</span>
      )}
    </label>
  );
}

// ─── Sending + sent stages ────────────────────────────────────────

function SendingStage({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <BrandLoader size={32} label="Sending Ethereum request" />
      </div>
      <p className="mt-5 text-base text-text-strong">Talking to Ethereum…</p>
      <p className="mt-1 text-xs text-text-soft">
        Signing on Solana, then handing off to Ika to broadcast on Sepolia.
      </p>
    </motion.section>
  );
}

interface SentStageProps {
  amount: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  walletDisplay: string;
  reduce: boolean;
}

function SentStage({
  amount,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  reduce,
}: SentStageProps) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Sepolia" },
  ];
  return (
    <SendReceipt
      status="confirmed"
      statusLabel="Broadcast on Sepolia via Ika"
      amount={amount}
      ticker="ETH"
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/eth`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See approvals coming in.",
          href: `/app/wallet/${encodeURIComponent(walletName)}`,
          icon: ListIcon,
        },
      ]}
      reduce={reduce}
    />
  );
}

// ─── Pre-flight cards (binding / intent missing) ──────────────────

function PreFlightCard({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-gutter py-10">
      <div className="w-full max-w-md rounded-card border border-warning/30 bg-warning/5 p-6 text-center shadow-card-rest">
        <div className="flex justify-center text-warning">
          <ShieldAlert className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-display text-display-xs text-text-strong">
          {title}
        </h2>
        <p className="mt-2 text-sm text-text-soft">{body}</p>
        <Link href={cta.href} className="mt-4 inline-block">
          <Button size="md">
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
