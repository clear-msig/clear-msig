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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Home, List as ListIcon, Loader2, ShieldAlert } from "lucide-react";
import { NextStepCard } from "@/components/retail/NextStepCard";
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
import { ChainBadge } from "@/components/retail/ChainBadge";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { appConfig } from "@/lib/config";

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
  const router = useRouter();
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

  const allLoaded =
    !walletQuery.isLoading && !intentsQuery.isLoading && !chainsQuery.isLoading;
  const needsBinding = allLoaded && !ethBinding;
  const needsIntent = allLoaded && !!ethBinding && !erc20Intent;

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

      const signerPk = wallet.pickSigner(erc20Intent.account.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }

      const { nonce } = await fetchEvmNonce(walletEthAddress);

      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: erc20Intent.account.intentIndex,
        params: [
          `nonce=${nonce}`,
          `token_contract=${trimmedToken}`,
          `recipient=${trimmedRecipient}`,
          `amount=${amountBase.toString()}`,
        ],
        actor_pubkey: signerPk.toBase58(),
      });

      const signed = await signDescriptor(dry, { preferSigner: signerPk });

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
        title="Add Ethereum to this wallet first"
        body="ERC-20 sending uses the wallet's Ethereum address. Add Ethereum on the chains page (about 30 seconds), then come back here."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add`,
          label: "Add Ethereum",
        }}
        walletName={walletName}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title="Enable ERC-20 sending first"
        body="Ethereum is bound to this wallet, but the spending rule for ERC-20 tokens isn't set up yet. One quick setup, then per-token sends are unlocked."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/erc20`,
          label: "Enable ERC-20 sending",
        }}
        walletName={walletName}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay || "Wallet",
              href: walletName
                ? `/app/wallet/${encodeURIComponent(walletName)}`
                : "/app/wallet",
            },
            { label: "Send ERC-20" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip - see /send for rationale. */}
      <div className="px-gutter pt-2">
        <BackToWallets />
      </div>

      <div className="flex flex-1 justify-center pt-6">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-lg"
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
              onBack={() =>
                router.push(
                  `/app/wallet/${encodeURIComponent(walletName)}`,
                )
              }
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
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        {ethMeta && <ChainBadge chain={ethMeta} size="lg" />}
        <span aria-hidden="true" className="mt-4 block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Send · ERC-20 token
        </p>
        <h1 className="hidden md:block mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Send a token from <span className="text-accent">{walletDisplay}</span>
        </h1>
      </div>

      <div className="mt-6 flex flex-col gap-3">
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
          <input
            type="text"
            value={tokenContract}
            onChange={(e) => setTokenContract(e.target.value)}
            placeholder="0x… (e.g. Sepolia USDC)"
            className={
              "w-full rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-mono text-sm text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
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

        <Field
          label="Amount"
          hint={
            amount.trim() && !amountValid && metadata
              ? `Must be a positive ${metadata.symbol} amount.`
              : undefined
          }
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
                    ? whole.slice(0, 24)
                    : `${whole.slice(0, 24)}.${frac.slice(0, decimals)}`;
                setAmount(next);
              }}
              placeholder="0.0"
              disabled={!metadata}
              // font-numerals tabular-nums - same financial typography
              // as SOL / ETH amount inputs.
              className={
                "flex-1 rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-numerals text-2xl font-semibold text-text-strong tabular-nums outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest " +
                "disabled:cursor-not-allowed disabled:opacity-60"
              }
            />
            <span className="font-display text-sm font-semibold uppercase tracking-[0.24em] text-text-soft">
              {symbol}
            </span>
          </div>
          {/* Balance chip - single pill consolidates the
              "Wallet has X TOKEN" + Max button. Tabular-numeric
              digits keep the value column aligned. */}
          <div className="mt-2 inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-2 text-xs">
            <span className="text-text-soft">Wallet has</span>
            <span className="font-numerals font-semibold text-text-strong tabular-nums">
              {balanceLoading
                ? "…"
                : typeof walletBalance === "bigint" && metadata
                  ? tokenAmountToString(walletBalance, metadata.decimals, 6)
                  : "-"}
            </span>
            <span className="text-text-soft">{metadata?.symbol ?? symbol}</span>
            {typeof walletBalance === "bigint" &&
              walletBalance > 0n &&
              metadata && (
                <>
                  <span aria-hidden="true" className="h-3 w-px bg-border-soft" />
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
                    className="-mr-2 inline-flex min-h-tap min-w-tap items-center justify-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10"
                  >
                    Max
                  </button>
                </>
              )}
          </div>
          {insufficientBalance && walletBalance !== null && metadata && (
            <p className="mt-2 rounded-soft border border-warning/40 bg-warning/[0.07] px-3 py-2 text-xs text-text-strong">
              <span className="font-medium">Insufficient balance.</span> You
              have {tokenAmountToString(walletBalance, metadata.decimals, 6)}{" "}
              {metadata.symbol} - need{" "}
              {tokenAmountToString(amountBase, metadata.decimals, 6)}.
            </p>
          )}
        </Field>

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
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className={
              "w-full rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-mono text-sm text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
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
            amountValid && recipientValid && metadata
              ? `Send ${amount.trim()} ${metadata.symbol} to ${shortEvmAddress(recipient)}`
              : "Fill in the token, amount and recipient above"
          }
          details={previewDetails}
          warning="Cross-chain send is in alpha. The Solana sig you give here authorises Ika's dWallet network to broadcast the actual ERC-20 transfer on Ethereum. If anything is wrong with the EVM-side params, the broadcast fails and the wallet's Solana state stays untouched."
        />
        <WalletPopupNarration action="send this token request" popups={1} />
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-xs text-warning" role="alert">
          {hint}
        </span>
      )}
    </label>
  );
}

// ─── Sending stage ────────────────────────────────────────────────

function SendingStage({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
      <p className="text-sm font-medium text-text-strong">Sending request…</p>
      <p className="max-w-xs text-xs text-text-soft">
        Signing on Solana, then dWallet signs the ERC-20 transfer and
        broadcasts it on Sepolia.
      </p>
    </motion.div>
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
  onBack,
  reduce,
}: {
  amount: string;
  symbol: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  onBack: () => void;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-display-sm leading-[1.05] text-text-strong">
        Sent {amount} {symbol}
      </h1>
      <p className="mt-2 text-sm text-text-soft">
        to <span className="font-mono text-text-strong">{to}</span>
      </p>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={
            "mt-5 inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          View on {explorerLabel}
        </a>
      ) : null}
      {/* Three-option NextStepCard mirrors the SOL + ETH send
          patterns. The previous "Back to {wallet}" sole CTA dropped
          the explorer link the moment a user tapped it. */}
      <div className="mt-8 w-full">
        <NextStepCard
          title={`Anything else from ${toDisplayName(walletName) || "this wallet"}?`}
          options={[
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
            {
              label: "Back to home",
              href: "/app/wallet",
              icon: Home,
            },
          ]}
        />
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
      >
        Or, dismiss this and stay here
      </button>
    </motion.div>
  );
}

// ─── Pre-flight bounce card ──────────────────────────────────────

function PreFlightCard({
  title,
  body,
  cta,
  walletName,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
  walletName: string;
}) {
  const walletDisplay = toDisplayName(walletName);
  return (
    <div className="flex flex-col">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay || "Wallet",
              href: walletName
                ? `/app/wallet/${encodeURIComponent(walletName)}`
                : "/app/wallet",
            },
            { label: "Send ERC-20" },
          ]}
        />
      </StickyTopBar>

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
    </div>
  );
}

