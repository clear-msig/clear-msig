"use client";

// Send ETH (Sepolia) — purpose-built sibling of /send.
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
//   6. signMessage on Solana (the multisig is on Solana — your
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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
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
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { appConfig } from "@/lib/config";

const ETH_CHAIN_KIND = 1;

type Stage = "compose" | "sending" | "sent";

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
  const recipientValid = isValidEvmAddress(trimmedRecipient);
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
  // query is still loading or errored — over-reserving is the safe
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
  // Headroom multiplier — 50% over the live estimate so a spike
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
  // balance is still loading, don't block — the propose step is
  // safe; the broadcast itself will short-circuit if the balance
  // really is empty.
  const insufficientBalance =
    balanceLoaded && amountValid && balance! < requiredWei;

  const canSubmit =
    amountValid &&
    recipientValid &&
    !!ethIntent &&
    !!walletEthAddress &&
    !!wallet.publicKey &&
    !insufficientBalance;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethIntent || !ethIntent.account)
        throw new Error("Ethereum sending isn't set up for this wallet");
      if (!walletEthAddress)
        throw new Error("Wallet's Ethereum address isn't ready yet");
      if (!recipientValid) throw new Error("Recipient must be a valid 0x address");

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
          `to=${trimmedRecipient}`,
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
      setSentLabel({
        amount: amount.trim(),
        to: shortEvmAddress(trimmedRecipient),
        explorerUrl,
        explorerLabel,
      });
      // Persist the success in the per-wallet tx log for the
      // "Recent send attempts" widget — gives the user durable
      // proof of the send instead of a transient toast.
      recordAttempt({
        walletName,
        chainKind: ETH_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: "ETH",
        recipientShort: shortEvmAddress(trimmedRecipient),
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      // Refresh every place ETH balance is shown so the post-send
      // compose, /chains row, and portfolio panel all reflect the
      // new number. Multiple keys for the same data — each consumer
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
        walletName={walletName}
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
            { label: "Send ETH" },
          ]}
        />
      </StickyTopBar>

      <div className="flex flex-1 justify-center pt-6">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {stage === "compose" && (
            <SendChainPicker walletName={walletName} activeKind={ETH_CHAIN_KIND} />
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
              onDone={() =>
                router.push(
                  walletName
                    ? `/app/wallet/${encodeURIComponent(walletName)}`
                    : "/app/wallet",
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
  amount: string;
  setAmount: (s: string) => void;
  amountWei: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
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
  if (recipientValid) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(recipient),
      emphasis: "mono",
    });
  }
  if (amountValid) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ETH`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        {ethMeta && <ChainBadge chain={ethMeta} size="lg" />}
        <h1 className="mt-4 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Send ETH from {walletDisplay}
        </h1>
        <p className="mt-2 text-base text-text-soft">
          On Sepolia, the Ethereum testnet. Don&rsquo;t send mainnet ETH
          here.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
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
              className={
                "flex-1 rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-display text-2xl text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            <span className="text-sm font-medium text-text-soft">ETH</span>
          </div>
          {/* Live wallet balance + insufficient-balance gate. Shown
              right under the amount input so the user sees the
              ceiling while typing. */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-text-soft">
              {balanceLoading ? (
                "Loading wallet balance…"
              ) : walletBalanceWei !== null ? (
                <>
                  Wallet has{" "}
                  <span className="font-medium text-text-strong tabular-nums">
                    {weiToEth(walletBalanceWei)}
                  </span>{" "}
                  ETH
                </>
              ) : (
                "Couldn’t fetch balance"
              )}
            </span>
            {walletBalanceWei !== null && walletBalanceWei > 0n && (
              <button
                type="button"
                onClick={() => {
                  // Max = balance - gas reserve (clamped to 0).
                  const max =
                    walletBalanceWei > gasReserveWei
                      ? walletBalanceWei - gasReserveWei
                      : 0n;
                  setAmount(weiToEth(max, 12));
                }}
                className="font-medium text-accent transition-colors hover:text-accent/80"
              >
                Max
              </button>
            )}
          </div>
          {insufficientBalance && walletBalanceWei !== null && (
            <p className="mt-2 rounded-soft border border-warning/40 bg-warning/[0.07] px-3 py-2 text-xs text-text-strong">
              <span className="font-medium">Insufficient balance.</span>{" "}
              You have {weiToEth(walletBalanceWei)} ETH — need at least{" "}
              {weiToEth(amountWei + gasReserveWei)} ETH including ~
              {weiToEth(gasReserveWei)} for gas. Top up the wallet&rsquo;s
              Sepolia address from a faucet
              {walletEthAddress ? ` (${shortEvmAddress(walletEthAddress)})` : ""}
              .
            </p>
          )}
        </Field>

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
            amountValid && recipientValid
              ? `Send ${amount.trim()} ETH to ${shortEvmAddress(recipient)}`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          warning="Cross-chain send is in alpha. The on-chain Solana sig you give here authorises Ika's dWallet network to broadcast the actual Ethereum tx. If anything is wrong with the EVM-side params, the broadcast fails and the wallet's Solana state stays untouched."
        />
        <WalletPopupNarration action="send this Ethereum request" popups={1} />
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-3"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        Send request
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
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
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
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
    ? {}
    : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35 }}
      className="flex flex-col items-center text-center"
    >
      <BrandLoader size={48} label="Sending Ethereum request" />
      <h2 className="mt-5 font-display text-display-xs text-text-strong">
        Talking to Ethereum
      </h2>
      <p className="mt-1 text-sm text-text-soft">
        Building the request, signing on Solana, then handing off to
        Ika&rsquo;s dWallet network to broadcast on Sepolia.
      </p>
    </motion.div>
  );
}

interface SentStageProps {
  amount: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  onDone: () => void;
  reduce: boolean;
}

function SentStage({
  amount,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  onDone,
  reduce,
}: SentStageProps) {
  const walletDisplay = toDisplayName(walletName);
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 18, stiffness: 220 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest"
      >
        <Check className="h-10 w-10" strokeWidth={2.5} />
      </motion.div>
      <h2 className="font-display text-display-sm text-text-strong">
        {amount} ETH on the way to {to}
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        Approved + broadcast through Ika. Watch for it on Sepolia.
      </p>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-strong transition hover:border-accent/50 hover:text-accent"
        >
          View on {explorerLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
      <Button size="lg" fullWidth className="mt-8 max-w-xs" onClick={onDone}>
        Back to {walletDisplay}
      </Button>
    </div>
  );
}

// ─── Pre-flight cards (binding / intent missing) ──────────────────

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
  return (
    <div className="flex flex-col">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: toDisplayName(walletName) || "Wallet",
              href: walletName
                ? `/app/wallet/${encodeURIComponent(walletName)}`
                : "/app/wallet",
            },
            { label: "Send ETH" },
          ]}
        />
      </StickyTopBar>
      <div className="flex flex-1 items-center justify-center pt-6">
        <div className="w-full max-w-md text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldAlert className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-display-xs text-text-strong text-balance">
            {title}
          </h1>
          <p className="mt-2 text-base text-text-soft">{body}</p>
          <Link href={cta.href} className="mt-6 inline-block w-full">
            <Button size="lg" fullWidth>
              {cta.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
