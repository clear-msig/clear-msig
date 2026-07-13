"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronLeft, Wallet } from "lucide-react";
import type { OnchainMembership } from "@/lib/memberships/client";
import {
  sortPinnedFirst,
  subscribePinnedWallets,
} from "@/lib/security/pinnedWallets";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { toDisplayName } from "@/lib/retail/walletNames";
import { resolveWalletProductSurface } from "@/lib/productWorkspace";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";
import { formatBalance } from "@/lib/retail/format";
import { useBalancePrivacy } from "@/lib/hooks/useBalancePrivacy";
import { Shimmer } from "@/features/wallet/ui/home/WalletDashboardSections";

export function MobileWalletSwitchModal({
  open,
  wallets,
  balances,
  loadingBalances,
  pendingByWallet,
  onClose,
}: {
  open: boolean;
  wallets: OnchainMembership[];
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  pendingByWallet: Map<string, number>;
  onClose: () => void;
}) {
  const [pinTick, setPinTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => setMounted(true), []);
  useEffect(() => subscribePinnedWallets(() => setPinTick((n) => n + 1)), []);
  useBodyScrollLock(open);
  useFocusTrap(dialogRef, open && mounted);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const ordered = useMemo(() => {
    void pinTick;
    return sortPinnedFirst(wallets, (membership) => membership.wallet_name ?? "");
  }, [wallets, pinTick]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={dialogRef}
          className="fixed inset-0 z-[500] bg-canvas md:flex md:items-center md:justify-center md:bg-black/55 md:p-6 md:backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-switch-title"
          tabIndex={-1}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="flex h-full flex-col bg-canvas md:h-auto md:max-h-[min(760px,calc(100vh-3rem))] md:w-full md:max-w-xl md:overflow-hidden md:rounded-card md:border md:border-border-soft md:bg-surface-raised md:shadow-card-rest"
            initial={reduce ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="relative flex h-16 shrink-0 items-center justify-between border-b border-border-soft bg-canvas px-4">
              <button
                type="button"
                onClick={onClose}
                aria-label="Back to wallet home"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised text-text-strong shadow-[0_10px_28px_-20px_rgba(0,0,0,0.7)] transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <h2
                id="wallet-switch-title"
                tabIndex={-1}
                data-dialog-initial-focus
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base font-semibold text-text-strong"
              >
                Switch
              </h2>
              <span className="h-10 w-10" aria-hidden="true" />
            </header>

            <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-text-soft">
                    Your wallets
                  </p>
                  <p className="mt-1 text-sm text-text-soft">
                    Pick a wallet to open.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 font-numerals text-xs font-semibold text-text-soft">
                  {wallets.length}
                </span>
              </div>
              <div className="mt-5 flex flex-col gap-2.5">
                {ordered.map((membership) => (
                  <MobileWalletSwitchRow
                    key={membership.wallet}
                    membership={membership}
                    balanceLamports={balances?.get(membership.wallet) ?? null}
                    loadingBalance={loadingBalances}
                    pendingCount={pendingByWallet.get(membership.wallet) ?? 0}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
function MobileWalletSwitchRow({
  membership,
  balanceLamports,
  loadingBalance,
  pendingCount,
  onNavigate,
}: {
  membership: OnchainMembership;
  balanceLamports: number | null;
  loadingBalance: boolean;
  pendingCount: number;
  onNavigate: () => void;
}) {
  const onChainName = membership.wallet_name ?? "Wallet";
  const name = toDisplayName(onChainName);
  const surface = resolveWalletProductSurface(onChainName);
  const ProductIcon = surface ? PRODUCT_SURFACE_ICON[surface] : Wallet;
  const href = `/app/wallet/${encodeURIComponent(onChainName)}`;
  const balance = balanceLamports !== null ? formatBalance(balanceLamports) : null;
  const { hidden } = useBalancePrivacy();
  const hiddenClass = hidden ? "blur-sm select-none" : "";

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest transition-[border-color,transform] duration-base hover:-translate-y-0.5 hover:border-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ProductIcon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text-strong">
          {name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          {loadingBalance && balance === null ? (
            <Shimmer className="h-3.5 w-14 rounded-full" />
          ) : (
            <span
              className={clsx(
                "font-numerals text-xs font-semibold text-text-soft tabular-nums transition-[filter] duration-base",
                hiddenClass,
              )}
            >
              {`${balance?.amount ?? "0"} ${balance?.ticker ?? "SOL"}`}
            </span>
          )}
        </span>
      </span>
      {pendingCount > 0 ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-text-on-accent">
          {pendingCount}
        </span>
      ) : null}
      <ArrowRight
        className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden="true"
      />
    </Link>
  );
}
