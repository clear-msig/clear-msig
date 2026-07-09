"use client";

// Send an ERC-20 token (Sepolia) - sibling of /send/eth for token
// transfers. The wallet's same Sepolia address (chain_kind=1 binding)
// holds ERC-20 balances; the intent that unlocks the send is
// chain_kind=4 (set up via /setup/erc20). The user picks the token
// per-send by pasting its contract address - one intent unlocks every
// ERC-20 the wallet holds.
//
// Flow:
//   1. Read wallet + EVM binding + ERC-20 intent. Bounce to /setup
//      or /chains/add if either is missing.
//   2. User pastes a token contract → we fetch decimals/symbol via
//      eth_call (lib/chain/erc20.ts) so the amount input + Max are
//      properly scaled.
//   3. User enters recipient (0x…) + amount in token units.
//   4. Frontend pulls the live nonce, encodes
//      [nonce, token_contract, recipient, amount] into the
//      erc20_transfer_sepolia template's params.
//   5. prepare → sign on Solana → submit → execute(broadcast=true)
//      via Ika to broadcast the actual ERC-20 tx to Sepolia.
//
// The wallet's secp256k1 dWallet key signs both ETH transfers and
// ERC-20 calls - same key, different preimage builder. So a single
// chain binding covers both intents.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, List as ListIcon, Loader2, ShieldAlert } from "lucide-react";
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
  fetchEvmNonce,
  isValidEvmAddress,
  shortEvmAddress,
} from "@/lib/chain/eth";
import {
  fetchErc20Balance,
  fetchErc20Metadata,
  isValidErc20Contract,
  tokenAmountToBaseUnits,
  tokenAmountToString,
} from "@/lib/chain/erc20";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { FormField, TextInput } from "@/components/retail/FormField";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import {
  assertPolicyNotDenied,
  resolvePolicyEnforcement,
} from "@/lib/policies/enforce";
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
import {
  SEND_NOTE_LABEL,
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";

const ERC20_CHAIN_KIND = 4;
const ETH_CHAIN_KIND = 1;

type Stage = "compose" | "sending" | "sent";

export default function SendErc20PageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SendErc20Page />
    </Suspense>
  );
}

function SendErc20Page() {
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
    // Force fresh fetch on every mount so users navigating here
    // straight from /setup/erc20 don't see the pre-setup cache and
    // get bounced back into "Enable" UI while the background refetch
    // is still in flight. See the matching note on /send/eth.
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(walletName);

  const erc20Intent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === ERC20_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === ETH_CHAIN_KIND,
    );
  }, [chainsQuery.data]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  // Gate on BOTH isLoading and isFetching so the page doesn't render
  // "Turn on token sending" on stale cache while a background refetch
  // (triggered by refetchOnMount: "always") is still fetching the
  // post-setup intent list. See the matching note on /send/eth.
  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !ethBinding;
  const needsIntent = allSettled && !!ethBinding && !erc20Intent;
  const allLoaded = allSettled;

  const [stage, setStage] = useState<Stage>("compose");
  const [tokenContract, setTokenContract] = useState(
    () => params?.get("token")?.trim() ?? "",
  );
  const [amount, setAmount] = useState(
    () => params?.get("amount")?.trim() ?? "",
  );
  const [recipient, setRecipient] = useState(
    () => params?.get("recipient")?.trim() ?? "",
  );
  const [note, setNote] = useState(() => params?.get("note")?.trim() ?? "");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    symbol: string;
    to: string;
    explorerUrl: string | null;
    explorerLabel: string;
  } | null>(null);

  const trimmedToken = tokenContract.trim();
  const trimmedRecipient = recipient.trim();
  const tokenContractValid = isValidErc20Contract(trimmedToken);
  const recipientValid = isValidEvmAddress(trimmedRecipient);

  // Token metadata - decimals + symbol + name from the token contract
  // via eth_call. Without this we couldn't scale the user's typed
  // "1.5" into base units, and the post-send confirmation would say
  // "1.5 (unknown token)".
  const tokenMetaQuery = useQuery({
    queryKey: ["erc20-metadata", trimmedToken.toLowerCase()],
    queryFn: () => fetchErc20Metadata(trimmedToken),
    enabled: tokenContractValid,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const meta = tokenMetaQuery.data ?? null;
  const decimals = meta?.decimals ?? null;
  const symbol = meta?.symbol ?? null;

  // Live token balance for the wallet's Sepolia address. Drives the
  // "Wallet has X.XX TOKEN" caption + the Max button + the
  // insufficient-balance gate.
  const balanceQuery = useQuery({
    queryKey: [
      "wallet-erc20-balance",
      trimmedToken.toLowerCase(),
      walletEthAddress ?? "",
    ],
    queryFn: () => fetchErc20Balance(trimmedToken, walletEthAddress!),
    enabled: tokenContractValid && !!walletEthAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const balance = balanceQuery.data ?? null;
  const balanceLoaded = balanceQuery.isFetched && balance !== null;

  let amountValid = false;
  let amountBase = 0n;
  if (amount.trim() && decimals !== null) {
    try {
      amountBase = tokenAmountToBaseUnits(amount, decimals);
      amountValid = amountBase > 0n;
    } catch {
      amountValid = false;
    }
  }

  const insufficientBalance =
    balanceLoaded && amountValid && balance! < amountBase;

  // Policy-rule pre-flight tripwire (Tier-5 #33). chain_kind=4 for
  // ERC-20; passes the token contract through so per-token rules
  // can scope themselves correctly.
  const policyEvaluation = usePolicyEvaluation({
    walletName,
    chainKind: 4,
    tokenContract: trimmedToken.toLowerCase(),
    recipient: trimmedRecipient,
    ticker: symbol ?? "TOKEN",
    amountDisplay: amount,
    enabled: amountValid && recipientValid && tokenContractValid,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const canSubmit =
    tokenContractValid &&
    !!meta &&
    amountValid &&
    recipientValid &&
    !!erc20Intent &&
    !!walletEthAddress &&
    !!wallet.publicKey &&
    !insufficientBalance &&
    !policyDenied;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!erc20Intent || !erc20Intent.account)
        throw new Error("ERC-20 sending isn't set up for this wallet");
      if (!walletEthAddress)
        throw new Error("Wallet's Ethereum address isn't ready yet");
      if (!tokenContractValid)
        throw new Error("Token contract must be a 0x… 42-character address");
      if (!recipientValid)
        throw new Error("Recipient must be a valid 0x address");
      if (!meta) throw new Error("Couldn't read token metadata yet");

      const proposerPk = wallet.pickSigner(erc20Intent.account.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const submitPolicyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: 4,
        tokenContract: trimmedToken.toLowerCase(),
        recipient: trimmedRecipient,
        ticker: symbol ?? "TOKEN",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(submitPolicyPlan);

      const { nonce } = await fetchEvmNonce(walletEthAddress);

      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: erc20Intent.account.intentIndex,
        params: [
          `nonce=${nonce}`,
          `token_contract=${trimmedToken}`,
          `recipient=${trimmedRecipient}`,
          `amount=${amountBase.toString()}`,
        ],
        actor_pubkey: proposerPk.toBase58(),
      });

      const signed = await signDescriptor(dry, { preferSigner: proposerPk });

      const submitted = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: erc20Intent.account.intentIndex,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from submit");
      }
      const intent = erc20Intent.account;
      const approverPk = wallet.pickSigner(intent.approvers);

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
        chainKind: 4,
        tokenContract: trimmedToken.toLowerCase(),
        recipient: trimmedRecipient,
        ticker: symbol ?? "TOKEN",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(policyPlan);
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

      // Execute via Ika. Same shape as the EVM native send: pass the
      // dWallet program + gRPC + destination RPC so the backend can
      // sign + broadcast the ERC-20 transfer call to Sepolia.
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
      const tickerSafe = symbol ?? "TOKEN";
      setSentLabel({
        amount: amount.trim(),
        symbol: tickerSafe,
        to: shortEvmAddress(trimmedRecipient),
        explorerUrl,
        explorerLabel,
      });
      recordAttempt({
        walletName,
        chainKind: ERC20_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: tickerSafe,
        recipientShort: shortEvmAddress(trimmedRecipient),
        recipientFull: trimmedRecipient,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      queryClient.invalidateQueries({ queryKey: ["wallet-erc20-balance"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-erc20]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      const stderr =
        (err as { payload?: { stderr?: string } })?.payload?.stderr ?? undefined;
      recordAttempt({
        walletName,
        chainKind: ERC20_CHAIN_KIND,
        status: "failed",
        amountDisplay: amount.trim(),
        ticker: symbol ?? "TOKEN",
        recipientShort: trimmedRecipient
          ? shortEvmAddress(trimmedRecipient)
          : undefined,
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

  if (allLoaded && needsBinding) {
    return (
      <PreFlightCard
        title="Turn on token sending"
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=evm_1559&next=erc20&autostart=1`,
          label: "Turn on token sending",
        }}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title="Turn on token sending"
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/erc20?autostart=1`,
          label: "Turn on token sending",
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
            <SendChainPicker
              walletName={walletName}
              activeKind={ERC20_CHAIN_KIND}
            />
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
              tokenContract={tokenContract}
              setTokenContract={setTokenContract}
              tokenContractValid={tokenContractValid}
              metadata={meta}
              metadataLoading={tokenContractValid && tokenMetaQuery.isLoading}
              metadataError={tokenContractValid && !!tokenMetaQuery.error}
              amount={amount}
              setAmount={setAmount}
              amountBase={amountBase}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientValid={recipientValid}
              note={note}
              setNote={setNote}
              amountValid={amountValid}
              canSubmit={canSubmit}
              walletBalance={balance}
              balanceLoading={balanceQuery.isLoading}
              insufficientBalance={insufficientBalance}
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && <SendingStage reduce={!!reduce} />}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              symbol={sentLabel.symbol}
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
  tokenContract: string;
  setTokenContract: (s: string) => void;
  tokenContractValid: boolean;
  metadata: { decimals: number; symbol: string; name: string | null } | null;
  metadataLoading: boolean;
  metadataError: boolean;
  amount: string;
  setAmount: (s: string) => void;
  amountBase: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  walletBalance: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  onSubmit: () => void;
  reduce: boolean;
}

function ComposeStage({
  walletName,
  walletEthAddress,
  tokenContract,
  setTokenContract,
  tokenContractValid,
  metadata,
  metadataLoading,
  metadataError,
  amount,
  setAmount,
  amountBase,
  recipient,
  setRecipient,
  recipientValid,
  note,
  setNote,
  amountValid,
  canSubmit,
  walletBalance,
  balanceLoading,
  insufficientBalance,
  onSubmit,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const ethMeta = chainByKind(ETH_CHAIN_KIND);
  const symbol = metadata?.symbol ?? "TOKEN";
  const decimals = metadata?.decimals ?? 18;

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: walletDisplay || "your wallet" },
    { label: "Chain", value: "Ethereum (Sepolia) - ERC-20" },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (tokenContractValid && metadata) {
    previewDetails.push({
      label: "Token",
      value: metadata.name
        ? `${metadata.name} (${metadata.symbol})`
        : metadata.symbol,
    });
    previewDetails.push({
      label: "Token contract",
      value: shortEvmAddress(tokenContract),
      emphasis: "mono",
    });
  }
  if (recipientValid) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(recipient),
      emphasis: "mono",
    });
  }
  if (amountValid && metadata) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ${metadata.symbol}`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact left-aligned header. Matches SOL / ETH / BTC /send. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send
            </p>
            <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
              Send token
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Field
          label="Token contract"
          hint={
            tokenContract.trim() && !tokenContractValid
              ? "Must be a 0x… 42-character contract address."
              : metadataError
                ? "Couldn't read this token's metadata. Make sure the address is right and the network's reachable."
                : undefined
          }
        >
          <TextInput
            type="text"
            value={tokenContract}
            onChange={(e) => setTokenContract(e.target.value)}
            placeholder="0x… (e.g. Sepolia USDC)"
            className="font-mono"
          />
          {metadataLoading && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Reading token…
            </p>
          )}
          {metadata && !metadataLoading && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {metadata.name
                ? `${metadata.name} (${metadata.symbol}) · ${metadata.decimals} decimals`
                : `${metadata.symbol} · ${metadata.decimals} decimals`}
            </p>
          )}
        </Field>

        <SendAmountField
          id="send-erc20-amount-input"
          ticker={symbol}
          value={amount}
          onChange={(e) => {
            const stripped = e.target.value.replace(/[^\d.]/g, "");
            const [whole = "", frac] = stripped.split(".");
            const next =
              frac === undefined
                ? whole.slice(0, 24)
                : `${whole.slice(0, 24)}.${frac.slice(0, decimals)}`;
            setAmount(next);
          }}
          placeholder="0"
          disabled={!metadata}
          action={
            typeof walletBalance === "bigint" &&
            walletBalance > 0n &&
            metadata ? (
              <button
                type="button"
                onClick={() => {
                  setAmount(
                    tokenAmountToString(
                      walletBalance,
                      metadata.decimals,
                      metadata.decimals,
                    ),
                  );
                }}
                className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
              >
                Use max
              </button>
            ) : null
          }
          footer={
            <>
              <span>Wallet has </span>
              <span className="font-numerals font-semibold text-text-strong tabular-nums">
                {balanceLoading
                  ? "..."
                  : typeof walletBalance === "bigint" && metadata
                    ? tokenAmountToString(walletBalance, metadata.decimals, 6)
                    : "-"}
              </span>
              <span> {metadata?.symbol ?? symbol}</span>
              {typeof walletBalance === "bigint" &&
                walletBalance > 0n &&
                metadata && (
                  <UsdHint
                    amount={walletBalance}
                    smallestPerWhole={10n ** BigInt(metadata.decimals)}
                    ticker={metadata.symbol}
                    variant="plain"
                    className="text-text-soft"
                  />
                )}
              {amount.trim() && !amountValid && metadata && (
                <span className="ml-1.5 text-warning">
                  Must be a positive {metadata.symbol} amount.
                </span>
              )}
            </>
          }
          warning={
            insufficientBalance && walletBalance !== null && metadata ? (
              <>
                <span className="font-medium">Insufficient balance.</span> You
                have {tokenAmountToString(walletBalance, metadata.decimals, 6)}{" "}
                {metadata.symbol} - need{" "}
                {tokenAmountToString(amountBase, metadata.decimals, 6)}.
              </>
            ) : null
          }
        />

        <RecentRecipientsChips
          walletName={walletName}
          chainKind={ERC20_CHAIN_KIND}
          onPick={(addr) => setRecipient(addr)}
        />

        <Field
          label="Recipient"
          hint={
            recipient.trim() && !recipientValid
              ? "Must be a 0x… 42-character Ethereum address."
              : undefined
          }
        >
          <TextInput
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className="font-mono"
          />
        </Field>

        <Field label={SEND_NOTE_LABEL}>
          <TextInput
            type="text"
            value={note}
            onChange={(e) =>
              setNote(e.target.value.slice(0, SEND_NOTE_MAX_LENGTH))
            }
            placeholder={SEND_NOTE_PLACEHOLDER}
            maxLength={SEND_NOTE_MAX_LENGTH}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && metadata
              ? `Send ${amount.trim()} ${metadata.symbol} to ${shortEvmAddress(recipient)}`
              : "Fill in the token, amount and recipient above"
          }
          details={previewDetails}
        />
      </div>

      {/* Sticky-bottom CTA on mobile - see SOL send for rationale. */}
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

// ─── Field wrapper ────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <FormField label={label} error={hint} as="div">
      {children}
    </FormField>
  );
}

// ─── Sending stage ────────────────────────────────────────────────

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
        <BrandLoader size={32} label="Sending token request" />
      </div>
      <p className="mt-5 text-base text-text-strong">Sending token request…</p>
      <p className="mt-1 text-xs text-text-soft">
        Finishing the send on Sepolia.
      </p>
    </motion.section>
  );
}

// ─── Sent stage ──────────────────────────────────────────────────

function SentStage({
  amount,
  symbol,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  reduce,
}: {
  amount: string;
  symbol: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  walletDisplay: string;
  reduce: boolean;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Sepolia" },
    { label: "Token", value: symbol },
  ];
  return (
    <SendReceipt
      status="confirmed"
      statusLabel="Confirmed on Sepolia"
      amount={amount}
      ticker={symbol}
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another token",
          hint: "Same wallet, pick a different token.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/erc20`,
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

// ─── Pre-flight bounce card ──────────────────────────────────────

function PreFlightCard({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
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
        {body ? <p className="mt-2 text-sm text-text-soft">{body}</p> : null}
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
