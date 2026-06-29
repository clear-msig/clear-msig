"use client";

// Buy crypto with NGN - onramp flow.
//
// Pattern mirrors /send: a single Suspense-wrapped client page with
// a stage state machine. Stages:
//
//   compose          → user picks chain + USD amount
//   creating         → POST /v1/ramp/intents
//   redirecting      → POST /v1/ramp/intents/:id/initialize-payment
//                      then opens Paystack/Kora hosted checkout in a
//                      new tab. The polling worker picks up from here.
//   awaiting_payment → polling intent status; user is paying at provider
//   settling         → payment confirmed; backend disburses crypto
//                      from treasury → user's dWallet address
//   completed        → settlement_completed (or terminal failure)

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";

import { useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import {
  fetchOnchainMemberships,
} from "@/lib/memberships/client";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useRampIntent } from "@/lib/hooks/useRampIntent";
import { rampApi, RampApiError } from "@/lib/ramp/client";
import { rampTargetForChainKind } from "@/lib/ramp/chains";
import { CHAIN_CATALOG, chainByKind } from "@/lib/retail/chains";
import type { ChainBindingResponse } from "@/lib/api/types";
import { toDisplayName } from "@/lib/retail/walletNames";
import { friendlyError } from "@/lib/api/errors";
import { recordNotificationFeed } from "@/lib/security/notificationFeed";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { useToast } from "@/components/ui/Toast";
import type {
  CreateRampIntentRequest,
  InitializePaymentResponse,
} from "@/lib/ramp/types";

type Stage =
  | { kind: "compose" }
  | { kind: "submitting" }
  | {
      kind: "redirecting";
      intentId: string;
      checkout: InitializePaymentResponse;
    }
  | { kind: "awaiting"; intentId: string }
  | { kind: "completed"; intentId: string }
  | { kind: "failed"; intentId: string; reason: string };

export default function BuyPageWrapper() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BuyPage />
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

function BuyPage() {
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
  const userAddress = wallet.publicKey?.toBase58() ?? "";

  // Verify the wallet exists + the connected user is a member -
  // matches the gate every other workspace page applies.
  const memberships = useQuery({
    queryKey: ["my-organizations", wallet.publicKey?.toBase58() ?? ""],
    queryFn: () =>
      fetchOnchainMemberships(wallet.publicKey?.toBase58() ?? ""),
    enabled: Boolean(wallet.publicKey),
    staleTime: 30_000,
  });
  const wallets = memberships.data ?? [];
  const memberOfThisWallet = wallets.some((m) => m.wallet_name === walletName);

  // Bound chains tell us where the disbursement can land. The user
  // picks one of these as the destination; the dWallet address on
  // that chain is the destination_wallet sent to the ramp service.
  const chains = useWalletChains(walletName);
  const bindings: ChainBindingResponse[] = useMemo(
    () => chains.data?.chains ?? [],
    [chains.data?.chains],
  );

  const [selectedKind, setSelectedKind] = useState<number | null>(null);
  const [usdAmount, setUsdAmount] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "compose" });
  const [recordedOutcomes, setRecordedOutcomes] = useState<Set<string>>(
    () => new Set(),
  );

  // Auto-pick the first available bound chain.
  useEffect(() => {
    if (selectedKind === null && bindings.length > 0) {
      const ready = bindings.find((b) => chainAddress(b) !== null);
      if (ready) setSelectedKind(ready.chain_kind);
    }
  }, [bindings, selectedKind]);

  const intentIdInFlight =
    stage.kind === "redirecting" ||
    stage.kind === "awaiting" ||
    stage.kind === "completed" ||
    stage.kind === "failed"
      ? stage.intentId
      : null;
  const polled = useRampIntent(
    wallet.publicKey?.toBase58() ?? null,
    intentIdInFlight,
  );

  // Drive the stage forward from polled status.
  useEffect(() => {
    const status = polled.data?.status;
    if (!status) return;
    if (status === "settlement_completed" || status === "payout_completed") {
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
          : {
              kind: "failed",
              intentId: polled.data!.intent_id,
              reason: status,
            },
      );
    } else if (
      stage.kind === "redirecting" &&
      (status === "payment_confirmed" ||
        status === "settlement_queued" ||
        status === "settlement_in_progress")
    ) {
      setStage({ kind: "awaiting", intentId: polled.data!.intent_id });
    }
  }, [polled.data, stage.kind]);

  useEffect(() => {
    if (!userAddress || (stage.kind !== "completed" && stage.kind !== "failed")) {
      return;
    }
    const key = `${stage.kind}:${stage.intentId}`;
    if (recordedOutcomes.has(key)) return;
    recordNotificationFeed(userAddress, {
      kind: "money_movement",
      walletName,
      title: stage.kind === "completed" ? "Crypto bought" : "Buy did not finish",
      body:
        stage.kind === "completed"
          ? `${walletDisplay} received the crypto from your bank checkout.`
          : `${walletDisplay} did not receive crypto from that checkout.`,
      href: `/app/wallet/${encodeURIComponent(walletName)}`,
    });
    setRecordedOutcomes((current) => new Set(current).add(key));
  }, [recordedOutcomes, stage, userAddress, walletDisplay, walletName]);

  const selectedChain = selectedKind === null ? null : chainByKind(selectedKind);
  const selectedBinding = bindings.find((b) => b.chain_kind === selectedKind);
  const destinationWallet =
    selectedBinding ? chainAddress(selectedBinding) : null;

  const usdCents = useMemo(() => {
    const trimmed = usdAmount.trim();
    if (!/^\d*(\.\d{0,2})?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
      return null;
    }
    const [intPart, fracPart = ""] = trimmed.split(".");
    const cents = BigInt(intPart || "0") * 100n + BigInt((fracPart + "00").slice(0, 2));
    return Number(cents);
  }, [usdAmount]);

  const canSubmit =
    stage.kind === "compose" &&
    selectedKind !== null &&
    destinationWallet &&
    usdCents !== null &&
    usdCents > 0 &&
    Boolean(wallet.publicKey);

  async function handleSubmit() {
    if (!canSubmit || !wallet.publicKey || selectedKind === null || !destinationWallet || usdCents === null) {
      return;
    }
    const target = rampTargetForChainKind(selectedKind, "testnet");
    if (!target) {
      toast.error("Unsupported chain for ramping");
      return;
    }
    setStage({ kind: "submitting" });
    const pubkey = wallet.publicKey.toBase58();
    const idempotencyKey = rampApi.newIdempotencyKey();
    const body: CreateRampIntentRequest = {
      intent_type: "onramp",
      chain_family: target.chain_family,
      chain_id: target.chain_id,
      asset_symbol: target.asset_symbol,
      // Onramp: the buy is sized in USD; asset_amount_minor is what
      // the operator expects to ship in the smallest unit. The
      // backend computes the actual delivered amount from the
      // funded NGN; we pass 0 here as a stand-in until the quote
      // engine returns the real value.
      asset_amount_minor: 0,
      usd_amount_cents: usdCents,
      destination_wallet: destinationWallet,
    };
    try {
      const created = await rampApi.createIntent(pubkey, body, idempotencyKey);
      const checkout = await rampApi.initializePayment(pubkey, created.intent_id);
      // Open Paystack/Kora checkout in a new tab so the user can pay
      // without losing their place in clear-msig.
      if (typeof window !== "undefined") {
        window.open(checkout.authorization_url, "_blank", "noopener,noreferrer");
      }
      setStage({ kind: "redirecting", intentId: created.intent_id, checkout });
    } catch (err) {
      const message =
        err instanceof RampApiError ? err.message : friendlyError(err).body;
      toast.error("Could not start checkout", { details: message });
      setStage({ kind: "compose" });
    }
  }

  if (!wallet.connected) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-soft">Connect a wallet to buy crypto.</p>
      </div>
    );
  }

  if (memberships.isLoading || chains.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageLoading />
      </div>
    );
  }

  if (!memberOfThisWallet) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-soft">
          You are not a member of <strong>{walletDisplay}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4"
      >
        <header className="flex flex-col gap-1">
          <h1 className="hidden font-display text-display-xs leading-tight text-text-strong md:block">
            Buy with naira
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">
            Pay in NGN - we send crypto straight to{" "}
            <span className="font-medium text-text-strong">{walletDisplay}</span>{" "}
            on the chain you pick.
          </p>
        </header>

        {stage.kind === "compose" || stage.kind === "submitting" ? (
          <ComposeForm
            bindings={bindings}
            selectedKind={selectedKind}
            onPickChain={setSelectedKind}
            usdAmount={usdAmount}
            onUsdChange={setUsdAmount}
            destinationWallet={destinationWallet}
            disabled={stage.kind === "submitting"}
            canSubmit={Boolean(canSubmit)}
            onSubmit={handleSubmit}
            selectedChainName={selectedChain?.name ?? null}
          />
        ) : null}

        {stage.kind === "redirecting" ? (
          <RedirectingCard
            checkout={stage.checkout}
            polled={polled.data?.status ?? null}
          />
        ) : null}

        {stage.kind === "awaiting" ? (
          <AwaitingCard status={polled.data?.status ?? null} />
        ) : null}

        {stage.kind === "completed" ? (
          <CompletedCard
            walletName={walletName}
            assetAmount={polled.data?.asset_amount_minor ?? 0}
            assetSymbol={polled.data?.asset_symbol ?? ""}
          />
        ) : null}

        {stage.kind === "failed" ? <FailedCard reason={stage.reason} /> : null}
      </motion.section>
    </div>
  );
}

// ─── Stage components ─────────────────────────────────────────────────

function ComposeForm({
  bindings,
  selectedKind,
  onPickChain,
  usdAmount,
  onUsdChange,
  destinationWallet,
  disabled,
  canSubmit,
  onSubmit,
  selectedChainName,
}: {
  bindings: ChainBindingResponse[];
  selectedKind: number | null;
  onPickChain: (kind: number) => void;
  usdAmount: string;
  onUsdChange: (v: string) => void;
  destinationWallet: string | null;
  disabled: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  selectedChainName: string | null;
}) {
  if (bindings.length === 0) {
    return (
      <div className="rounded-card border border-warning/30 bg-warning/5 p-5 text-center">
        <p className="font-medium text-text-strong">
          This wallet has no chains bound yet.
        </p>
        <p className="mt-2 text-sm text-text-soft">
          Add a chain first so we have somewhere to send the crypto.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
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
                  "flex flex-col items-center gap-2 rounded-soft border p-2.5 text-center transition sm:p-3 " +
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
          htmlFor="usd-amount"
          className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft"
        >
          Amount (USD)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-soft">
            $
          </span>
          <input
            id="usd-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            value={usdAmount}
            onChange={(e) => onUsdChange(e.target.value)}
            className="w-full rounded-soft border border-border-soft bg-canvas/50 py-3 pl-7 pr-3 text-base text-text-strong placeholder:text-text-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <p className="text-[11px] text-text-soft">
          Pay in NGN at checkout. We convert at the live rate.
        </p>
      </div>

      {destinationWallet && selectedChainName && (
        <div className="rounded-soft border border-border-soft bg-canvas/50 p-3 text-xs text-text-soft">
          Receiving to <strong className="text-text-strong">{selectedChainName}</strong> at{" "}
          <span className="font-mono text-text-strong">
            {destinationWallet.slice(0, 8)}…{destinationWallet.slice(-6)}
          </span>
        </div>
      )}

      <Button
        size="lg"
        fullWidth
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {disabled ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting checkout…
          </>
        ) : (
          <>
            Continue to checkout
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}

function RedirectingCard({
  checkout,
  polled,
}: {
  checkout: InitializePaymentResponse;
  polled: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-card border border-accent/30 bg-accent/5 p-5 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
        <ExternalLink className="h-6 w-6" />
      </div>
      <h2 className="font-display text-lg text-text-strong">
        Checkout opened in a new tab
      </h2>
      <p className="text-sm text-text-soft">
        Complete the payment at <strong>{checkout.payment_provider}</strong>.
        We&rsquo;ll detect it automatically and disburse to your wallet.
      </p>
      <a
        href={checkout.authorization_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-2 text-sm font-medium text-accent hover:underline"
      >
        Reopen checkout
        <ExternalLink className="h-4 w-4" />
      </a>
      <p className="text-[11px] text-text-soft">
        Status: {humanStatus(polled ?? "awaiting_payment")}
      </p>
    </div>
  );
}

function AwaitingCard({ status }: { status: string | null }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-surface-raised p-5 text-center shadow-card-rest">
      <Loader2 className="h-8 w-8 animate-spin text-accent" />
      <h2 className="font-display text-lg text-text-strong">
        Payment received - settling now
      </h2>
      <p className="text-sm text-text-soft">
        Sending crypto from the operator treasury to your wallet.
      </p>
      <p className="text-[11px] text-text-soft">
        Status: {humanStatus(status ?? "settlement_queued")}
      </p>
    </div>
  );
}

function CompletedCard({
  walletName,
  assetAmount,
  assetSymbol,
}: {
  walletName: string;
  assetAmount: number;
  assetSymbol: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-success/30 bg-success/5 p-5 text-center shadow-card-rest">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="font-display text-lg text-text-strong">All done</h2>
      <p className="text-sm text-text-soft">
        Crypto landed in <strong>{toDisplayName(walletName)}</strong>.
      </p>
      {assetAmount > 0 && (
        <p className="font-mono text-xs text-text-soft">
          {assetAmount} {assetSymbol} (smallest unit)
        </p>
      )}
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
        {humanStatus(reason)} - please try again or contact support.
      </p>
    </div>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case "awaiting_payment":
      return "Waiting for payment";
    case "payment_confirmed":
      return "Payment confirmed";
    case "settlement_queued":
      return "Settlement queued";
    case "settlement_in_progress":
      return "Settling on-chain";
    case "settlement_completed":
      return "Crypto delivered";
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
