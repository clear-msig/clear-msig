"use client";

import type { ComponentProps } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import { BTC_CHAIN_KIND } from "@/lib/chain/btcIntentReadiness";
import { chainByKind } from "@/lib/retail/chains";
import { ComposeForm } from "@/features/send/ui/bitcoin/BtcComposeForm";
import { SendErrorBanner } from "@/features/send/ui/bitcoin/SendErrorBanner";
import {
  BlockedNote,
  NeedsBinding,
  NeedsSetup,
} from "@/features/send/ui/bitcoin/BtcSetupStates";
import {
  AwaitingApprovalCard,
  BitcoinSetupPendingCard,
  SentCard,
} from "@/features/send/ui/bitcoin/BtcSendResults";
import { buildBtcPreviewDetails, shortBtcAddress } from "@/features/send/ui/bitcoin/bitcoinPreview";

type ComposeProps = ComponentProps<typeof ComposeForm>;

interface BtcSendScreenProps {
  walletName: string;
  walletDisplay: string;
  network: ComposeProps["network"];
  reduceMotion: boolean;
  disconnected: boolean;
  ledgerBlocked: boolean;
  loading: boolean;
  needsBinding: boolean;
  needsSetup: boolean;
  ready: boolean;
  setupPending: boolean;
  setupSucceeded: boolean;
  onSetup: () => void;
  setupRequest: ComponentProps<typeof BitcoinSetupPendingCard> | null;
  bindingAddress: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  sendError: ComponentProps<typeof SendErrorBanner>["error"] | null;
  onResetError: () => void;
  onDismissError: () => void;
  policyEvaluation: ComponentProps<typeof PolicyMatchBanner>["evaluation"] | null;
  compose: ComposeProps;
  approvalThreshold: number;
  timelockSeconds: number;
  sent: ComponentProps<typeof SentCard>["sent"] | null;
  awaitingApproval: ComponentProps<typeof AwaitingApprovalCard>["request"] | null;
  onSendAnother: () => void;
  onRequestAnother: () => void;
}

export function BtcSendScreen({
  walletName,
  walletDisplay,
  network,
  reduceMotion,
  disconnected,
  ledgerBlocked,
  loading,
  needsBinding,
  needsSetup,
  ready,
  setupPending,
  setupSucceeded,
  onSetup,
  setupRequest,
  bindingAddress,
  balanceSats,
  balanceLoading,
  balanceError,
  sendError,
  onResetError,
  onDismissError,
  policyEvaluation,
  compose,
  approvalThreshold,
  timelockSeconds,
  sent,
  awaitingApproval,
  onSendAnother,
  onRequestAnother,
}: BtcSendScreenProps) {
  const btcMeta = chainByKind(BTC_CHAIN_KIND);
  const motionProps = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <motion.section
        {...motionProps}
        transition={{ duration: 0.3 }}
        className="flex w-full flex-col gap-5"
      >
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            {btcMeta ? <ChainBadge chain={btcMeta} size="md" /> : null}
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Send
              </p>
              <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong sm:text-3xl md:block">
                Send BTC
              </h1>
            </div>
          </div>
          <p className="text-xs text-text-soft sm:text-sm">
            From <span className="font-medium text-text-strong">{walletDisplay}</span>
            <span className="ml-1 text-text-soft/70">· {network}</span>
          </p>
        </header>

        <SendChainPicker walletName={walletName} activeKind={BTC_CHAIN_KIND} />

        {disconnected && (
          <BlockedNote
            title="Sign in first"
            body="Connect your Solana wallet to authorise sends from this multisig."
          />
        )}
        {!disconnected && ledgerBlocked && (
          <BlockedNote
            title="Use a software wallet for Bitcoin"
            body="Switch wallets and try again. Ledger support for Bitcoin sends is coming after the beta path is stable."
          />
        )}
        {loading && !disconnected && !ledgerBlocked && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking Bitcoin…
          </div>
        )}

        {needsBinding && <NeedsBinding walletName={walletName} reduce={reduceMotion} />}
        {needsSetup && !setupRequest && (
          <NeedsSetup
            address={bindingAddress}
            balanceSats={balanceSats}
            balanceLoading={balanceLoading}
            balanceError={balanceError}
            network={network}
            onSetup={onSetup}
            busy={setupPending || setupSucceeded}
            reduce={reduceMotion}
          />
        )}
        {needsSetup && setupRequest && <BitcoinSetupPendingCard {...setupRequest} />}
        {ready && !sent && !awaitingApproval && sendError && (
          <SendErrorBanner
            error={sendError}
            onReset={onResetError}
            onDismiss={onDismissError}
          />
        )}
        {ready && !sent && !awaitingApproval && !sendError && setupRequest && (
          <BitcoinSetupPendingCard {...setupRequest} />
        )}
        {ready && !sent && !awaitingApproval && policyEvaluation?.matched && (
          <PolicyMatchBanner walletName={walletName} evaluation={policyEvaluation} />
        )}
        {ready && !sent && !awaitingApproval && (
          <SignPayloadPreview
            action={
              compose.amountBtc.trim() && compose.destination.trim()
                ? `Send ${compose.amountBtc.trim()} BTC to ${shortBtcAddress(compose.destination.trim())}`
                : "Fill in the amount and recipient above"
            }
            details={buildBtcPreviewDetails({
              walletDisplay,
              destination: compose.destination,
              amountBtc: compose.amountBtc,
              selectedUtxo: compose.selectedUtxo,
              effectiveFeeSats: compose.effectiveFeeSats,
              changeSats: compose.changeSats,
              note: compose.note,
              approvalThreshold,
              timelockSeconds,
            })}
            collapsibleDetails
          />
        )}
        {ready && !sent && !awaitingApproval && <ComposeForm {...compose} />}
        {sent && (
          <SentCard
            sent={sent}
            walletDisplay={walletDisplay}
            walletName={walletName}
            network={network}
            onAnother={onSendAnother}
          />
        )}
        {awaitingApproval && (
          <AwaitingApprovalCard
            request={awaitingApproval}
            walletDisplay={walletDisplay}
            walletName={walletName}
            onAnother={onRequestAnother}
          />
        )}
      </motion.section>
    </div>
  );
}
