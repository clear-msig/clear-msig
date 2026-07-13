"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { UsdHint } from "@/components/retail/UsdHint";
import { formatSats, type BitcoinNetwork } from "@/lib/chain/btc";
import { btcBalanceStatusLabel } from "@/features/send/ui/bitcoin/bitcoinBalanceStatus";

export type BtcSetupPendingReason = "approval" | "sync";

export function BlockedNote({ title, body }: { title: string; body: string }) {
  return (
    <aside className="rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
      <p className="font-medium text-text-strong">{title}</p>
      <p className="mt-1">{body}</p>
    </aside>
  );
}
export function NeedsBinding({
  walletName,
  reduce,
}: {
  walletName: string;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=bitcoin_p2wpkh&autostart=1`}
        className="self-start"
      >
        <Button>
          Turn on Bitcoin sending
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Link>
    </motion.section>
  );
}

export function NeedsSetup({
  address,
  balanceSats,
  balanceLoading,
  balanceError,
  network,
  onSetup,
  busy,
  reduce,
}: {
  address: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  network: BitcoinNetwork;
  onSetup: () => void;
  busy: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      {address && (
        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Bitcoin address
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
            {address}
          </p>
          <p className="mt-2 font-numerals text-[11px] tabular-nums text-text-soft">
            Balance:{" "}
            {balanceLoading ? (
              "checking..."
            ) : balanceSats !== null ? (
              <>
                {formatSats(balanceSats)} BTC
                <UsdHint
                  amount={balanceSats}
                  smallestPerWhole={100_000_000n}
                  ticker="BTC"
                />
              </>
            ) : (
              btcBalanceStatusLabel(balanceError, network)
            )}
          </p>
        </div>
      )}
      <Button onClick={onSetup} disabled={busy} fullWidth>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Turning on Bitcoin…
          </>
        ) : (
          <>
            Turn on Bitcoin sending
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>
    </motion.section>
  );
}
