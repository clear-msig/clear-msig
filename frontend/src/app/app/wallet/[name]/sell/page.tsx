"use client";

// Sell crypto for NGN — offramp flow.
//
// Stages:
//   compose  → pick chain + amount + bank account
//   creating → POST /v1/ramp/intents (offramp)
//             then POST /v1/ramp/intents/:id/prepare-signature
//             which returns the treasury deposit address
//   awaiting_send → user is shown the treasury address; they go
//             through the existing clear-msig propose / approve /
//             execute flow on /app/wallet/[name]/send to send the
//             crypto to that address. After broadcast, they paste
//             the tx hash here.
//   confirming → POST /v1/internal/chain/confirm
//   payout    → polling intent status (settlement → payout → done)
//   completed → payout_completed
//
// The clear-msig multisig is invisible to the ramp service — from its
// POV, it's just a regular incoming on-chain transfer.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Landmark,
  Loader2,
} from "lucide-react";

import { useWallet } from "@/lib/wallet";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useRampIntent } from "@/lib/hooks/useRampIntent";
import { rampApi, RampApiError } from "@/lib/ramp/client";
import {
  rampTargetForChainKind,
  wholeToMinor,
} from "@/lib/ramp/chains";
import { CHAIN_CATALOG, chainByKind } from "@/lib/retail/chains";
import type { ChainBindingResponse } from "@/lib/api/types";
import { toDisplayName } from "@/lib/retail/walletNames";
import { friendlyError } from "@/lib/api/errors";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { useToast } from "@/components/ui/Toast";
import type {
  BankListItem,
  CreateRampIntentRequest,
  PrepareSignatureResponse,
} from "@/lib/ramp/types";

type Stage =
  | { kind: "compose" }
  | { kind: "submitting" }
  | {
      kind: "awaiting_send";
      intentId: string;
      prep: PrepareSignatureResponse;
      assetAmountMinor: number;
    }
  | {
      kind: "confirming";
      intentId: string;
    }
  | { kind: "payout"; intentId: string }
  | { kind: "completed"; intentId: string }
  | { kind: "failed"; intentId: string; reason: string };

export default function SellPageWrapper() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SellPage />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <BrandLoader />
    </div>
  );
}

function SellPage() {
  const route = useParams<{ name: string }>();
  const wallet = useWallet();
  const toast = useToast();

  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  const walletDisplay = toDisplayName(walletName);

  const memberships = useQuery({
    queryKey: ["my-organizations", wallet.publicKey?.toBase58() ?? ""],
    queryFn: () =>
      fetchOnchainMemberships(wallet.publicKey?.toBase58() ?? ""),
    enabled: Boolean(wallet.publicKey),
    staleTime: 30_000,
  });
  const wallets = memberships.data ?? [];
  const memberOfThisWallet = wallets.some((m) => m.wallet_name === walletName);

  const chains = useWalletChains(walletName);
  const bindings: ChainBindingResponse[] = chains.data?.chains ?? [];

  // Bank list — fetched once, cached for the session.
  const banks = useQuery<BankListItem[]>({
    queryKey: ["ramp-banks", "nigeria"],
    queryFn: () => rampApi.listBanks("nigeria"),
    staleTime: 60 * 60_000,
  });

  // Form state
  const [selectedKind, setSelectedKind] = useState<number | null>(null);
  const [assetAmount, setAssetAmount] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "compose" });
  const [txHashInput, setTxHashInput] = useState("");

  useEffect(() => {
    if (selectedKind === null && bindings.length > 0) {
      const ready = bindings.find((b) => chainAddress(b) !== null);
      if (ready) setSelectedKind(ready.chain_kind);
    }
  }, [bindings, selectedKind]);

  const intentIdInFlight =
    stage.kind === "awaiting_send" ||
    stage.kind === "confirming" ||
    stage.kind === "payout" ||
    stage.kind === "completed" ||
    stage.kind === "failed"
      ? stage.intentId
      : null;
  const polled = useRampIntent(
    wallet.publicKey?.toBase58() ?? null,
    intentIdInFlight,
  );

  // Drive stage forward from polled status.
  useEffect(() => {
    const status = polled.data?.status;
    if (!status) return;
    if (status === "payout_completed") {
      setStage((prev) =>
        prev.kind === "completed"
          ? prev
          : { kind: "completed", intentId: polled.data!.intent_id },
      );
    } else if (
      status === "failed" ||
      status === "expired" ||
      status === "cancelled" ||
      status === "manual_review_required"
    ) {
      setStage((prev) =>
        prev.kind === "failed"
          ? prev
          : { kind: "failed", intentId: polled.data!.intent_id, reason: status },
      );
    } else if (
      (status === "settlement_completed" || status === "payout_in_progress") &&
      stage.kind !== "payout"
    ) {
      setStage({ kind: "payout", intentId: polled.data!.intent_id });
    }
  }, [polled.data, stage.kind]);

  // Resolve account name on debounced bank input.
  useEffect(() => {
    if (!bankCode || accountNumber.length !== 10) {
      setResolvedName(null);
      return;
    }
    const handle = setTimeout(async () => {
      setResolving(true);
      try {
        const r = await rampApi.resolveBank(accountNumber, bankCode);
        setResolvedName(r.account_name);
      } catch {
        setResolvedName(null);
      } finally {
        setResolving(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [bankCode, accountNumber]);

  const selectedChain = selectedKind === null ? null : chainByKind(selectedKind);
  const selectedBinding = bindings.find((b) => b.chain_kind === selectedKind);
  const sourceWallet = selectedBinding ? chainAddress(selectedBinding) : null;

  const target = selectedKind !== null ? rampTargetForChainKind(selectedKind, "testnet") : null;
  const amountMinor = useMemo(() => {
    if (!target) return null;
    return wholeToMinor(
      assetAmount,
      target.smallest_per_whole,
      target.display_decimals,
    );
  }, [assetAmount, target]);

  const canSubmit =
    stage.kind === "compose" &&
    selectedKind !== null &&
    amountMinor !== null &&
    amountMinor > 0n &&
    bankCode.length > 0 &&
    accountNumber.length === 10 &&
    resolvedName !== null &&
    sourceWallet !== null &&
    Boolean(wallet.publicKey);

  async function handleSubmit() {
    if (
      !canSubmit ||
      !wallet.publicKey ||
      selectedKind === null ||
      !target ||
      amountMinor === null ||
      !sourceWallet
    ) {
      return;
    }
    setStage({ kind: "submitting" });
    const pubkey = wallet.publicKey.toBase58();
    const idempotencyKey = rampApi.newIdempotencyKey();
    const body: CreateRampIntentRequest = {
      intent_type: "offramp",
      chain_family: target.chain_family,
      chain_id: target.chain_id,
      asset_symbol: target.asset_symbol,
      asset_amount_minor: Number(amountMinor),
      // Backend computes NGN from this for the offramp quote.
      // Without an oracle, we let the backend's USD→NGN flow run on
      // a coarse 1:1 mapping seeded by the asset_amount_minor.
      usd_amount_cents: 100, // minimum stub; backend recomputes
      source_wallet: sourceWallet,
      bank_code: bankCode,
      bank_account_number: accountNumber,
    };
    try {
      const created = await rampApi.createIntent(pubkey, body, idempotencyKey);
      const prep = await rampApi.prepareSignature(pubkey, created.intent_id);
      setStage({
        kind: "awaiting_send",
        intentId: created.intent_id,
        prep,
        assetAmountMinor: Number(amountMinor),
      });
    } catch (err) {
      const message =
        err instanceof RampApiError ? err.message : friendlyError(err).body;
      toast.error("Could not start withdrawal", { details: message });
      setStage({ kind: "compose" });
    }
  }

  async function handleConfirmTx() {
    if (stage.kind !== "awaiting_send") return;
    const txHash = txHashInput.trim();
    if (!txHash) {
      toast.error("Paste the transaction hash from your send.");
      return;
    }
    setStage({ kind: "confirming", intentId: stage.intentId });
    try {
      await rampApi.confirmChainTransfer({
        intent_id: stage.intentId,
        chain_family: stage.prep.chain_family,
        chain_id: stage.prep.chain_id,
        tx_hash: txHash,
        event_index: 0,
        sender_wallet: sourceWallet ?? "",
        asset_symbol: stage.prep.asset_symbol,
        amount_minor: stage.assetAmountMinor,
        confirmations: 1,
        finalized: true,
      });
      setStage({ kind: "payout", intentId: stage.intentId });
    } catch (err) {
      const message =
        err instanceof RampApiError ? err.message : friendlyError(err).body;
      toast.error("Could not record your transfer", { details: message });
      setStage({
        kind: "awaiting_send",
        intentId: stage.intentId,
        prep: stage.prep,
        assetAmountMinor: stage.assetAmountMinor,
      });
    }
  }

  if (!wallet.connected) {
    return (
      <div className="flex flex-col gap-6">
        <SellTopBar walletName={walletName} walletDisplay={walletDisplay} />
        <p className="text-sm text-text-soft">Connect a wallet to sell crypto.</p>
      </div>
    );
  }

  if (memberships.isLoading || chains.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <SellTopBar walletName={walletName} walletDisplay={walletDisplay} />
        <PageLoading />
      </div>
    );
  }

  if (!memberOfThisWallet) {
    return (
      <div className="flex flex-col gap-6">
        <SellTopBar walletName={walletName} walletDisplay={walletDisplay} />
        <p className="text-sm text-text-soft">
          You are not a member of <strong>{walletDisplay}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SellTopBar walletName={walletName} walletDisplay={walletDisplay} />

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-6"
      >
        <header className="flex flex-col items-center text-center">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Cash out
          </p>
          <h1 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
            Sell crypto for naira
          </h1>
          <p className="mt-1 text-sm text-text-soft">
            Send crypto from <strong>{walletDisplay}</strong>. We pay NGN
            into your bank.
          </p>
        </header>

        {(stage.kind === "compose" || stage.kind === "submitting") && (
          <ComposeForm
            bindings={bindings}
            selectedKind={selectedKind}
            onPickChain={setSelectedKind}
            assetAmount={assetAmount}
            onAmountChange={setAssetAmount}
            bankCode={bankCode}
            onBankCodeChange={(v) => {
              setBankCode(v);
              setResolvedName(null);
            }}
            accountNumber={accountNumber}
            onAccountChange={(v) => {
              setAccountNumber(v.replace(/\D/g, "").slice(0, 10));
              setResolvedName(null);
            }}
            resolvedName={resolvedName}
            resolving={resolving}
            banks={banks.data ?? []}
            disabled={stage.kind === "submitting"}
            canSubmit={Boolean(canSubmit)}
            onSubmit={handleSubmit}
            selectedChainName={selectedChain?.name ?? null}
            selectedTicker={selectedChain?.ticker ?? null}
          />
        )}

        {stage.kind === "awaiting_send" && (
          <AwaitingSendCard
            walletName={walletName}
            prep={stage.prep}
            assetAmountMinor={stage.assetAmountMinor}
            txHashInput={txHashInput}
            onTxHashChange={setTxHashInput}
            onConfirm={handleConfirmTx}
          />
        )}

        {stage.kind === "confirming" && (
          <CenteredStatus icon="loader" title="Recording your transfer…" />
        )}

        {stage.kind === "payout" && (
          <CenteredStatus
            icon="loader"
            title="Bank payout in progress"
            body={`Status: ${humanStatus(polled.data?.status ?? "settlement_completed")}`}
          />
        )}

        {stage.kind === "completed" && (
          <CompletedCard walletName={walletName} />
        )}

        {stage.kind === "failed" && <FailedCard reason={stage.reason} />}
      </motion.section>
    </div>
  );
}

function SellTopBar({
  walletName,
  walletDisplay,
}: {
  walletName: string;
  walletDisplay: string;
}) {
  return (
    <>
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay || "Wallet",
              href: `/app/wallet/${encodeURIComponent(walletName)}`,
            },
            { label: "Sell" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip — see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>
    </>
  );
}

// ─── Stage components ─────────────────────────────────────────────────

function ComposeForm({
  bindings,
  selectedKind,
  onPickChain,
  assetAmount,
  onAmountChange,
  bankCode,
  onBankCodeChange,
  accountNumber,
  onAccountChange,
  resolvedName,
  resolving,
  banks,
  disabled,
  canSubmit,
  onSubmit,
  selectedChainName,
  selectedTicker,
}: {
  bindings: ChainBindingResponse[];
  selectedKind: number | null;
  onPickChain: (kind: number) => void;
  assetAmount: string;
  onAmountChange: (v: string) => void;
  bankCode: string;
  onBankCodeChange: (v: string) => void;
  accountNumber: string;
  onAccountChange: (v: string) => void;
  resolvedName: string | null;
  resolving: boolean;
  banks: BankListItem[];
  disabled: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  selectedChainName: string | null;
  selectedTicker: string | null;
}) {
  if (bindings.length === 0) {
    return (
      <div className="rounded-card border border-warning/30 bg-warning/5 p-5 text-center">
        <p className="font-medium text-text-strong">
          This wallet has no chains bound yet.
        </p>
        <p className="mt-2 text-sm text-text-soft">
          Add a chain first so we have a source to withdraw from.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Chain
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHAIN_CATALOG.filter((c) => c.kind !== 4).map((chain) => {
            const binding = bindings.find((b) => b.chain_kind === chain.kind);
            const ready = binding && chainAddress(binding) !== null;
            const selected = selectedKind === chain.kind;
            return (
              <button
                key={chain.kind}
                type="button"
                disabled={!ready || disabled}
                onClick={() => onPickChain(chain.kind)}
                className={
                  "flex flex-col items-center gap-2 rounded-soft border p-3 text-center transition " +
                  (selected
                    ? "border-accent bg-accent/5 text-accent"
                    : ready
                      ? "border-border-soft bg-canvas/50 text-text-strong hover:border-border-strong"
                      : "border-dashed border-border-soft text-text-soft opacity-50")
                }
              >
                <ChainBadge chain={chain} size="md" />
                <span className="text-xs font-medium">{chain.ticker}</span>
                {!ready && (
                  <span className="text-[10px] text-text-soft">not bound</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="asset-amount"
          className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft"
        >
          Amount {selectedTicker ? `(${selectedTicker})` : ""}
        </label>
        <input
          id="asset-amount"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          disabled={disabled}
          value={assetAmount}
          onChange={(e) => onAmountChange(e.target.value)}
          className="w-full rounded-soft border border-border-soft bg-canvas/50 py-3 px-3 text-base text-text-strong placeholder:text-text-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="bank-select"
          className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft"
        >
          Bank
        </label>
        <select
          id="bank-select"
          disabled={disabled || banks.length === 0}
          value={bankCode}
          onChange={(e) => onBankCodeChange(e.target.value)}
          className="w-full rounded-soft border border-border-soft bg-canvas/50 py-3 px-3 text-sm text-text-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="">
            {banks.length === 0 ? "Loading banks…" : "Select your bank"}
          </option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="account-number"
          className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft"
        >
          Account number
        </label>
        <input
          id="account-number"
          inputMode="numeric"
          placeholder="0123456789"
          disabled={disabled}
          value={accountNumber}
          onChange={(e) => onAccountChange(e.target.value)}
          className="w-full rounded-soft border border-border-soft bg-canvas/50 py-3 px-3 font-mono text-sm text-text-strong placeholder:text-text-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {resolving && (
          <p className="flex items-center gap-1.5 text-[11px] text-text-soft">
            <Loader2 className="h-3 w-3 animate-spin" />
            Resolving account…
          </p>
        )}
        {resolvedName && (
          <p className="flex items-center gap-1.5 text-[11px] text-success">
            <Check className="h-3 w-3" />
            {resolvedName}
          </p>
        )}
      </div>

      <Button size="lg" fullWidth disabled={!canSubmit} onClick={onSubmit}>
        {disabled ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing withdrawal…
          </>
        ) : (
          <>
            Continue
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>

      {selectedChainName && (
        <p className="text-center text-[11px] text-text-soft">
          Withdrawing from {selectedChainName}.
        </p>
      )}
    </div>
  );
}

function AwaitingSendCard({
  walletName,
  prep,
  assetAmountMinor,
  txHashInput,
  onTxHashChange,
  onConfirm,
}: {
  walletName: string;
  prep: PrepareSignatureResponse;
  assetAmountMinor: number;
  txHashInput: string;
  onTxHashChange: (v: string) => void;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const sendUrl = `/app/wallet/${encodeURIComponent(walletName)}/send?to=${encodeURIComponent(prep.treasury_address)}`;
  return (
    <div className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Landmark className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-text-strong">
            Send {assetAmountMinor} {prep.asset_symbol} (smallest unit)
          </p>
          <p className="text-xs text-text-soft">
            to the operator treasury — we&rsquo;ll pay you in NGN once it&rsquo;s confirmed on-chain.
          </p>
        </div>
      </div>

      <div className="rounded-soft border border-border-soft bg-canvas/50 p-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-soft">
          Treasury address
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 break-all font-mono text-xs text-text-strong">
            {prep.treasury_address}
          </code>
          <button
            type="button"
            aria-label="Copy address"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prep.treasury_address);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard blocked */
              }
            }}
            className="flex h-8 w-8 items-center justify-center rounded-soft text-text-soft transition hover:bg-canvas hover:text-text-strong"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Link
        href={sendUrl}
        className="inline-flex items-center justify-center gap-2 rounded-soft border border-accent/30 bg-accent/5 px-4 py-3 text-sm font-medium text-accent transition hover:bg-accent/10"
      >
        Open Send (pre-filled with this address)
        <ExternalLink className="h-4 w-4" />
      </Link>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <label
          htmlFor="tx-hash"
          className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft"
        >
          Transaction hash
        </label>
        <input
          id="tx-hash"
          type="text"
          placeholder="Paste tx hash after broadcast"
          value={txHashInput}
          onChange={(e) => onTxHashChange(e.target.value)}
          className="w-full rounded-soft border border-border-soft bg-canvas/50 py-3 px-3 font-mono text-xs text-text-strong placeholder:text-text-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button size="lg" fullWidth disabled={!txHashInput.trim()} onClick={onConfirm}>
          I&rsquo;ve sent it — record my transfer
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CenteredStatus({
  icon,
  title,
  body,
}: {
  icon: "loader" | "check";
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest">
      {icon === "loader" ? (
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
          <Check className="h-6 w-6" />
        </div>
      )}
      <h2 className="font-display text-lg text-text-strong">{title}</h2>
      {body && <p className="text-sm text-text-soft">{body}</p>}
    </div>
  );
}

function CompletedCard({ walletName }: { walletName: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-success/30 bg-success/5 p-6 text-center shadow-card-rest">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="font-display text-lg text-text-strong">
        Bank transfer complete
      </h2>
      <p className="text-sm text-text-soft">
        NGN should be in your bank account shortly.
      </p>
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}`}
        className="text-sm font-medium text-accent hover:underline"
      >
        Back to wallet
      </Link>
    </div>
  );
}

function FailedCard({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-danger/30 bg-danger/5 p-5 shadow-card-rest">
      <h2 className="font-display text-lg text-text-strong">
        Something went wrong
      </h2>
      <p className="text-sm text-text-soft">
        {humanStatus(reason)} — please try again or contact support.
      </p>
    </div>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case "awaiting_user_transfer_signature":
      return "Waiting for your transfer";
    case "awaiting_user_transfer_confirmation":
      return "Waiting for chain confirmation";
    case "settlement_queued":
      return "Settlement queued";
    case "settlement_in_progress":
      return "Settlement in progress";
    case "settlement_completed":
      return "Crypto received — preparing payout";
    case "payout_in_progress":
      return "Bank transfer in progress";
    case "payout_completed":
      return "Bank transfer complete";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    case "manual_review_required":
      return "Under review";
    default:
      return status;
  }
}
