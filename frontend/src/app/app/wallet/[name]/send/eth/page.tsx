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
import { resolvePolicyEnforcement } from "@/lib/policies/enforce";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { InfoTip } from "@/components/retail/InfoTip";
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
  const isHyperliquid = params?.get("network") === "hyperliquid";
  const EVM_CHAIN_KIND = isHyperliquid ? 5 : 1;
  const EVM_LABEL = isHyperliquid ? "Hyperliquid" : "Ethereum";
  const EVM_TICKER = isHyperliquid ? "HYPE" : "ETH";
  const EVM_RPC_URL = isHyperliquid
    ? appConfig.preAlpha.hyperliquidRpcUrl
    : appConfig.preAlpha.destinationRpcUrl;
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
    // Force a fresh fetch every time we land on this page, even if
    // the cache is technically still fresh. Without this, a user who
    // just completed /setup/eth navigates here with the old
    // (pre-setup) intents list in cache. StaleTime hasn't elapsed ,
    // and the page renders "Enable Ethereum sending" again because
    // it doesn't see the just-created EvmTransfer intent. The Solana
    // RPC propagation race makes the background refetch a moment
    // later, but the user has already re-clicked Enable by then.
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(walletName);

  // Match the wallet's EvmTransfer intent and the corresponding
  // binding. Both must be present to send.
  const ethIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === EVM_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data, EVM_CHAIN_KIND]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === EVM_CHAIN_KIND,
    );
  }, [chainsQuery.data, EVM_CHAIN_KIND]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  // Both isLoading (first fetch) AND isFetching (background refetch
  // after invalidation / refetchOnMount) gate the "needs setup" UI.
  // Otherwise a user landing here straight from /setup/eth sees the
  // pre-setup cache for ~200ms and gets routed back into "Enable"
  // before the background refetch returns the just-created intent.
  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !ethBinding;
  const needsIntent = allSettled && !!ethBinding && !ethIntent;
  // Keep `allLoaded` as a backwards-compat alias so existing render
  // logic that uses it for skeleton gating keeps working.
  const allLoaded = allSettled;

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
    queryFn: () => fetchEvmBalance(walletEthAddress!, EVM_RPC_URL),
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
    queryKey: ["evm-gas-price", EVM_RPC_URL],
    queryFn: () => fetchEvmGasPrice(EVM_RPC_URL),
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
    chainKind: EVM_CHAIN_KIND,
    recipient: effectiveRecipient ?? "",
    ticker: EVM_TICKER,
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
        throw new Error(`${EVM_LABEL} sending isn't set up for this wallet`);
      if (!walletEthAddress)
        throw new Error(`Wallet's ${EVM_LABEL} address isn't ready yet`);
      if (!recipientValid || !effectiveRecipient)
        throw new Error("Recipient must be a valid 0x address or .eth name");

      const proposerPk = wallet.pickSigner(ethIntent.account.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }

      // 1. Pull the live nonce. Without this the EVM tx the dWallet
      //    signs gets rejected as a duplicate.
      const { nonce } = await fetchEvmNonce(walletEthAddress);

      // 2. Prepare. The CLI encodes nonce/to/value_wei/data into
      //    params_data per the EVM transfer template.
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: ethIntent.account.intentIndex,
        params: [
          `nonce=${nonce}`,
          `to=${effectiveRecipient}`,
          `value_wei=${amountWei.toString()}`,
          `data=`,
        ],
        actor_pubkey: proposerPk.toBase58(),
      });

      // 3. Sign on Solana. Proves to the program that this user is
      //    a proposer + counts as their approval.
      const signed = await signDescriptor(dry, { preferSigner: proposerPk });

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
      const intent = ethIntent.account;
      const approverPk = wallet.pickSigner(intent.approvers);

      // Old-program fallback: re-sign approve if the propose did not
      // auto-approve. With the upgrade this branch never fires.
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        if (!approverPk) {
          throw new Error(
            "The proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: approverPk.toBase58() },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      const policyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: EVM_CHAIN_KIND,
        recipient: effectiveRecipient ?? "",
        ticker: EVM_TICKER,
        amountDisplay: amount,
      });
      if (policyPlan.evaluation?.matched) {
        if (policyPlan.rule?.action === "require-extra-approvers") {
          const seen = new Set<string>([
            proposerPk.toBase58(),
            ...(approverPk ? [approverPk.toBase58()] : []),
          ]);
          const extraApprovers = policyPlan.extraApprovers.filter((addr) => {
            const normalized = addr.trim();
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          });
          if (extraApprovers.length === 0) {
            throw new Error(
              `Policy "${policyPlan.rule.name}" requires extra approvers, but none were configured.`,
            );
          }
          for (const extraApprover of extraApprovers) {
            if (!intent.approvers.includes(extraApprover)) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but that signer is not in the wallet's approver list.`,
              );
            }
            const extraSigner = wallet.pickSigner([extraApprover]);
            if (!extraSigner) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but none of your connected wallets can sign as that approver.`,
              );
            }
            const extraDry = await backendApi.prepare.approveProposal(
              walletName,
              proposal,
              { actor_pubkey: extraSigner.toBase58() },
            );
            const extraSigned = await signDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveProposal(walletName, proposal, {
              ...extraSigned,
              expiry: extraDry.expiry,
            });
          }
        } else if (
          policyPlan.rule?.action === "require-cooldown" &&
          policyPlan.extraCooldownSeconds > 0
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, policyPlan.extraCooldownSeconds * 1000),
          );
        }
      }

      // 5. Execute with broadcast=true and Ika dWallet params. The
      //    backend tells Ika to sign + broadcast the EVM tx.
      const executed = await backendApi.executeProposal(walletName, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        rpc_url: EVM_RPC_URL,
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast };
    },
    onSuccess: ({ broadcast }) => {
      const explorerUrl = broadcastExplorerUrl(
        broadcast,
        EVM_RPC_URL,
      );
      const explorerLabel = explorerLabelForChainKind(
        broadcast?.chain_kind,
        EVM_RPC_URL,
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
        chainKind: EVM_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: EVM_TICKER,
        recipientShort: sentTo,
        recipientFull: effectiveRecipient ?? undefined,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      // Refresh every place EVM balance is shown so the post-send
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
        chainKind: EVM_CHAIN_KIND,
        status: "failed",
        amountDisplay: amount.trim(),
        ticker: EVM_TICKER,
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
        title={`Add ${EVM_LABEL} to this wallet first`}
        body={`This wallet doesn't have a ${EVM_LABEL} address yet. Adding ${EVM_LABEL} spins up its dWallet (about 30 seconds), then you can come back here.`}
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add`,
          label: `Add ${EVM_LABEL}`,
        }}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title={`Enable ${EVM_LABEL} sending first`}
        body={`${EVM_LABEL} is bound to this wallet, but the spending rule for it isn't set up yet. One quick setup, then sends are unlocked.`}
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/eth${isHyperliquid ? "?network=hyperliquid" : ""}`,
          label: `Enable ${EVM_LABEL} sending`,
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
            <SendChainPicker walletName={walletName} activeKind={EVM_CHAIN_KIND} />
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
              chainKind={EVM_CHAIN_KIND}
              chainLabel={EVM_LABEL}
              ticker={EVM_TICKER}
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
          {stage === "sending" && (
            <SendingStage reduce={!!reduce} label={EVM_LABEL} />
          )}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              to={sentLabel.to}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
              walletName={walletName}
              walletDisplay={walletDisplay || "your shared wallet"}
              ticker={EVM_TICKER}
              networkLabel={EVM_LABEL}
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
  chainKind: number;
  chainLabel: string;
  ticker: string;
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
  chainKind,
  chainLabel,
  ticker,
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
  const ethMeta = chainByKind(chainKind);

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: chainLabel },
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
      value: `${amount.trim()} ${ticker}`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Compact left-aligned header. Matches SOL /send. Chain badge
          inline with eyebrow + display title; "From {wallet}" sits on
          the right edge so the network identity is unmistakable
          without burning vertical space. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send · {chainLabel}
            </p>
            <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
              Send {ticker}
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      {chainKind === 1 || chainKind === 4 ? (
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
      ) : null}

      {/* Compose grid. Amount + Recipient sit side-by-side on lg+
          and merge into one bordered card on mobile. Same shell as
          SOL /send and BTC /send/btc. */}
      <div
        className={
          "flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 " +
          "lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }
      >
        {/* Amount card. Eyebrow + Use max pill, underline-style
            input, balance line as plain text. Card chrome only at
            lg+; mobile uses the parent wrapper's chrome. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-5 lg:shadow-card-rest"
          }
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Amount
            </p>
            {typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const max =
                      walletBalanceWei > gasReserveWei
                        ? walletBalanceWei - gasReserveWei
                        : 0n;
                    setAmount(weiToEth(max, 12));
                  }}
                  className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
                >
                  Use max
                </button>
              )}
          </div>
          <label htmlFor="send-eth-amount-input" className="sr-only">
            Amount in {ticker}
          </label>
          <div
            className={
              "flex items-baseline gap-3 border-b border-glass-soft pb-3 " +
              "transition-colors duration-base ease-out-soft " +
              "focus-within:border-glass-strong"
            }
          >
            <input
              id="send-eth-amount-input"
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
              placeholder="0"
              autoFocus
              maxLength={20}
              aria-label={`Amount in ${ticker}`}
              className="min-w-0 flex-1 bg-transparent font-numerals text-3xl font-semibold tracking-tight text-text-strong tabular-nums outline-none placeholder:text-text-soft/50 sm:text-4xl"
            />
            <span
              aria-hidden="true"
              className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft sm:text-lg"
            >
              {ticker}
            </span>
          </div>
          <p className="text-xs text-text-soft">
            <span>Wallet has </span>
            <span className="font-numerals font-medium text-text-strong tabular-nums">
              {balanceLoading
                ? "…"
                : typeof walletBalanceWei === "bigint"
                  ? weiToEth(walletBalanceWei)
                  : "-"}
            </span>
            <span> {ticker}</span>
            {typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n && (
                <UsdHint
                  amount={walletBalanceWei}
                  smallestPerWhole={1_000_000_000_000_000_000n}
                  ticker={ticker}
                />
              )}
            {amount.trim() && !amountValid && (
              <span className="ml-1.5 text-warning">
                Must be a positive number.
              </span>
            )}
          </p>
          {insufficientBalance && walletBalanceWei !== null && (
            <p className="rounded-soft border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-strong">
              <span className="font-medium">Insufficient balance.</span>{" "}
              You have {weiToEth(walletBalanceWei)} {ticker}
              <UsdHint
                amount={walletBalanceWei}
                smallestPerWhole={1_000_000_000_000_000_000n}
                ticker={ticker}
              />
              {" "}, need at least {weiToEth(amountWei + gasReserveWei)} {ticker}
              including ~{weiToEth(gasReserveWei)} for gas. Top up the
              wallet&rsquo;s {chainLabel} address from a faucet
              {walletEthAddress ? ` (${shortEvmAddress(walletEthAddress)})` : ""}
              .
            </p>
          )}
        </section>

        {/* Recipient + Note card. Same merged-mobile / split-lg+
            treatment as Amount above. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-5 lg:shadow-card-rest"
          }
        >
          <Field
            label="To"
            hint={
              recipient.trim() && !recipientValid && !ensResolving && ensFailed
                ? "Couldn’t resolve that ENS name. Paste a 0x address instead."
                : recipient.trim() && !recipientValid && !ensResolving
                  ? `Must be a 0x… 42-character ${chainLabel} address or a .eth name.`
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
                  "flex-1 rounded-card border border-border-soft bg-canvas px-4 py-3 font-mono text-sm text-text-strong outline-none " +
                  "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                  "focus:border-accent focus:shadow-accent-rest"
                }
              />
              <QrScanButton
                ariaLabel="Scan recipient QR"
                title="Scan a recipient QR"
                onResult={(v) => setRecipient(parseEvmRecipientFromQr(v))}
                className={
                  "shrink-0 inline-flex h-auto items-center justify-center rounded-card border border-border-soft bg-canvas px-3 text-text-soft " +
                  "transition-[border-color,color,transform] duration-base ease-out-soft " +
                  "hover:-translate-y-0.5 hover:text-accent " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                }
              />
            </div>
            {ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Resolving {recipient.trim()}…
              </span>
            )}
            {ensName && effectiveRecipient && !ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Resolved {ensName} ·{" "}
                <span className="font-mono text-text-soft">
                  {shortEvmAddress(effectiveRecipient)}
                </span>
              </span>
            )}
          </Field>

          <RecentRecipientsChips
            walletName={walletName}
            chainKind={chainKind}
            onPick={(addr) => setRecipient(addr)}
          />

          <Field label="Note">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 80))}
              placeholder="What's it for? (optional)"
              maxLength={80}
              className={
                "w-full rounded-card border border-border-soft bg-canvas px-4 py-3 text-sm text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
          </Field>
        </section>
      </div>

      {/* Preview + popup narration. Info-icon mode so the headline +
          warning stay visible and the secondary context is one
          hover/tap away. Same pattern as SOL /send. */}
      <div className="flex flex-col gap-3">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && effectiveRecipient
              ? `Send ${amount.trim()} ${ticker} to ${
                  ensName ?? shortEvmAddress(effectiveRecipient)
                }`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          warning={`Cross-chain send is in alpha. The on-chain Solana sig you give here authorises Ika's dWallet network to broadcast the actual ${chainLabel} tx. If anything is wrong with the EVM-side params, the broadcast fails and the wallet's Solana state stays untouched.`}
          collapsibleDetails
        />
        <WalletPopupNarration
          action={`send this ${chainLabel} request`}
          popups={1}
          disclaimerBehindInfoTip
        />
      </div>

      {/* Action footer. InfoTip-backed approval hint + sticky CTA. */}
      <div className="flex flex-col gap-3 pt-1">
        <p className="inline-flex items-center gap-1.5 text-xs text-text-soft">
          Friends in {walletDisplay} approve before it sends.
          <InfoTip
            label="How approvals work"
            width="md"
            size="xs"
            side="start"
          >
            <span className="block">
              When you tap Send, this becomes a proposal in {walletDisplay}.
              The other approvers in this wallet get a notification and the
              transfer only goes through once the threshold approves. You can
              cancel anytime before that.
            </span>
          </InfoTip>
        </p>
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button size="lg" fullWidth disabled={!canSubmit} onClick={onSubmit}>
            Send request
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
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

function SendingStage({
  reduce,
  label,
}: {
  reduce: boolean;
  label: string;
}) {
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
        <BrandLoader size={32} label={`Sending ${label} request`} />
      </div>
      <p className="mt-5 text-base text-text-strong">Talking to {label}…</p>
      <p className="mt-1 text-xs text-text-soft">
        Signing on Solana, then handing off to Ika to broadcast on {label}.
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
  ticker: string;
  networkLabel: string;
  reduce: boolean;
}

function SentStage({
  amount,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  ticker,
  networkLabel,
  reduce,
}: SentStageProps) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: networkLabel },
  ];
  return (
    <SendReceipt
      status="confirmed"
      statusLabel={`Broadcast on ${networkLabel} via Ika`}
      amount={amount}
      ticker={ticker}
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/eth${networkLabel === "Hyperliquid" ? "?network=hyperliquid" : ""}`,
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
