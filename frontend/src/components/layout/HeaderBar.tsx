"use client";

// Minimalist header - retail rebuild.
//
// On /app/* mobile the header now reads like a native app navbar:
//   • LEFT  - circular back button (only off home)
//   • CENTER - plain page title text ("Welcome back" on home,
//     section label everywhere else). No pill, no border, just
//     centered text - the way iOS / Android navbars do it.
//   • RIGHT - Scan (only on send routes) + Settings cluster.
//
// On public surfaces (landing / connect / welcome / privacy / security)
// the header carries the brand pill on the left and nothing else.
// Desktop is unchanged: the workspace sidebar + DashboardHeader own
// the chrome there.
//
// All animations are transform/opacity only.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronLeft,
  Copy,
  ExternalLink,
  LogOut,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { BrandMark } from "@/components/retail/BrandMark";
import { useToast } from "@/components/ui/Toast";
import { addressUrl } from "@/lib/explorer";
import { avatarGradient } from "@/lib/retail/avatar";
import { formatBalance } from "@/lib/retail/format";
import { getSectionLabel, isSendRoute } from "@/lib/retail/sectionLabel";

// Shared pill-button class used by every floating mobile chrome
// affordance (back / scan / settings). Centralised so the three
// icon buttons read as a matched set.
const MOBILE_HEADER_BTN = [
  "flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-glass-soft backdrop-blur-md",
  "text-text-strong shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]",
  "transition-[transform,border-color,background-color,color] duration-base ease-out-soft",
  "hover:-translate-y-0.5 hover:bg-glass-strong active:scale-95",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  "md:hidden",
].join(" ");

export function HeaderBar() {
  const { hydrated } = useOnboarding();
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const address = publicKey?.toBase58() ?? "";
  const notifications = useNotificationFeed(address);
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const toast = useToast();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  const inApp = pathname.startsWith("/app");
  const isHome = pathname === "/app/wallet";
  const isWalletLandingRoute = /^\/app\/wallet\/[^/]+$/.test(pathname);
  const inAppConnected = hydrated && connected && inApp;

  // Native-app navbar wiring.
  //   showBack       - left arrow button on every /app/* page except home
  //   showTitle      - plain centered text on every /app/* mobile page
  //   showBrandPill  - only on public surfaces
  //   showScan       - only when composing a transfer
  //   showAccount    - only on the Settings page (Account is reachable
  //                    from the Settings header now that Settings lives
  //                    in the bottom nav).
  //   showSecure     - only on the Home page (recovery hub shortcut).
  const showBack = inAppConnected && !isHome;
  const showTitle = inAppConnected;
  const showBrandPill = !inApp || !connected;
  const showScan = isSendRoute(pathname);
  const showNotifications = inAppConnected && !pathname.startsWith("/app/notifications");
  // Account shortcut - lives on the Settings page only. Settings
  // moved into the bottom nav, so Account becomes the
  // companion surface reachable from the Settings page header.
  const showAccount = inAppConnected && pathname.startsWith("/app/settings");
  // Secure shortcut removed — Secure is no longer a separate
  // top-level destination. Personal recovery now lives as a shape
  // inside the unified wallet-create flow (/app/wallet/new). The
  // /app/secure/* routes still work for deep links. See Fesal
  // feedback 2026-05-11.
  const showSecure = false;
  const showWallet = inAppConnected;
  const pageTitle = inAppConnected
    ? isHome
      ? "Welcome back"
      : getSectionLabel(pathname)
    : "";

  const balanceQuery = useQuery({
    queryKey: ["connected-wallet-balance", address],
    queryFn: async () => {
      if (!publicKey) return 0;
      return connection.getBalance(publicKey, "confirmed");
    },
    enabled: inAppConnected && Boolean(publicKey),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // router.back() walks browser history; fall back to home when
  // there's no in-app history yet (cold deep-link). Mount counts as
  // navigation #1, each pathname change increments.
  const navCountRef = useRef(0);
  useEffect(() => {
    navCountRef.current += 1;
  }, [pathname]);

  useEffect(() => {
    if (!walletMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!walletMenuRef.current?.contains(event.target as Node)) {
        setWalletMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [walletMenuOpen]);

  const handleBack = () => {
    if (isWalletLandingRoute) {
      router.replace("/app/wallet");
      return;
    }
    if (navCountRef.current > 1) {
      router.back();
    } else {
      router.push("/app/wallet");
    }
  };

  const handleScan = () => {
    toast.info("Coming soon", {
      details: "Scan-to-send is on the way - sit tight, this is rolling out.",
    });
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Wallet address copied");
    } catch (err) {
      toast.error("Could not copy wallet address", {
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRefreshBalance = async () => {
    try {
      await balanceQuery.refetch();
      toast.info("Wallet balance refreshed");
    } catch (err) {
      toast.error("Could not refresh wallet balance", {
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect();
    } catch {
      /* keep going so the local app cache is still cleared */
    }
    queryClient.clear();
    if (typeof window !== "undefined") {
      window.location.replace("/");
    }
  };

  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "";
  const grad = address ? avatarGradient(address) : null;
  const formattedBalance =
    typeof balanceQuery.data === "number" ? formatBalance(balanceQuery.data) : null;
  const balanceLabel = balanceQuery.isLoading
    ? "Loading"
    : formattedBalance
      ? `${formattedBalance.amount} ${formattedBalance.ticker}`
      : "Balance unavailable";
  const signerLabel = wallet.isLedger
    ? "Ledger"
    : wallet.dynamicPublicKey
      ? "Embedded wallet"
      : wallet.isPhantomWallet
        ? "Phantom"
        : "Connected wallet";

  return (
    <header
      className="fixed inset-x-3 top-3 z-[140] flex items-center gap-2 sm:inset-x-4 sm:top-4"
      role="banner"
    >
      {/* Back button - left edge, mobile only, off-home only. */}
      <AnimatePresence>
        {showBack && (
          <motion.button
            key="back"
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={MOBILE_HEADER_BTN}
          >
            <ChevronLeft size={18} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Brand pill - public surfaces only. */}
      {showBrandPill && (
        <Link
          href="/"
          aria-label="Clear home"
          className={clsx(
            "inline-flex items-center gap-2 rounded-full border border-border-soft bg-glass-soft px-3 py-1.5 backdrop-blur-md",
            "text-sm font-semibold text-text-strong shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]",
            "transition-[transform,box-shadow,border-color,background-color] duration-base ease-out-soft",
            "hover:-translate-y-0.5 hover:bg-glass-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <span className="flex h-5 w-5 items-center justify-center drop-shadow-[0_0_6px_rgba(204,255,0,0.5)]">
            <BrandMark size={16} />
          </span>
          Clear
        </Link>
      )}

      {/* HOME title - left edge, mobile only. Renders BEFORE the
          right cluster so the greeting hugs the leading edge while
          the right cluster's `ml-auto` pushes the action icons all
          the way to the trailing edge. The two ends never overlap. */}
      {showTitle && isHome && (
        <motion.h1
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2 md:hidden"
        >
          <span className="flex h-6 w-6 items-center justify-center drop-shadow-[0_0_6px_rgba(204,255,0,0.5)]">
            <BrandMark size={20} />
          </span>
          <span className="text-lg font-semibold tracking-tight text-text-strong">
            Welcome back
          </span>
        </motion.h1>
      )}

      {/* OFF-HOME title - absolutely-centered text. Stays
          geometrically centered regardless of how wide the back /
          right clusters are, the way iOS / Android navbars do it.
          pointer-events-none lets clicks fall through to the
          back/scan/settings buttons. */}
      {showTitle && !isHome && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center md:hidden">
          <motion.h1
            key={pageTitle}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-[55vw] truncate text-base font-semibold tracking-tight text-text-strong"
          >
            {pageTitle}
          </motion.h1>
        </div>
      )}

      {/* Right-side action cluster. Only renders when there's at
          least one action to show:
            • Scan     - on send routes
            • Account  - on the Settings page
            • Secure   - on the Home page only (recovery hub)
            • Wallet   - on every connected /app/* route
          ml-auto pushes the cluster to the trailing edge, opposite
          the title / back button on the leading edge. */}
      <AnimatePresence>
        {inAppConnected && (showScan || showAccount || showSecure || showNotifications || showWallet) && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="ml-auto flex items-center gap-2 md:hidden"
          >
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  key="notifications"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href="/app/notifications"
                    aria-label={
                      notifications.unreadCount > 0
                        ? `Notifications (${notifications.unreadCount} unread)`
                        : "Notifications"
                    }
                    className={clsx("relative", MOBILE_HEADER_BTN)}
                  >
                    <Bell size={18} />
                    {notifications.unreadCount > 0 && (
                      <span
                        aria-hidden="true"
                        className={clsx(
                          "absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center",
                          "rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-text-on-accent",
                          "ring-2 ring-canvas",
                        )}
                      >
                        {notifications.unreadCount > 99
                          ? "99+"
                          : notifications.unreadCount}
                      </span>
                    )}
                  </Link>
                </motion.div>
              )}
              {showScan && (
                <motion.button
                  key="scan"
                  type="button"
                  onClick={handleScan}
                  aria-label="Scan a QR code"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className={MOBILE_HEADER_BTN}
                >
                  <ScanLine size={18} />
                </motion.button>
              )}
              {showWallet && address && grad && (
                <motion.div
                  key="wallet"
                  ref={walletMenuRef}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="relative"
                >
                  <button
                    type="button"
                    onClick={() => setWalletMenuOpen((v) => !v)}
                    aria-label={`Connected wallet ${shortAddress}`}
                    aria-haspopup="menu"
                    aria-expanded={walletMenuOpen}
                    className={clsx(MOBILE_HEADER_BTN, "overflow-hidden p-0")}
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br",
                        grad.from,
                        grad.to,
                      )}
                    >
                      <span className="h-2 w-2 rounded-full bg-white/90" />
                    </span>
                  </button>

                  {walletMenuOpen && (
                    <motion.div
                      role="menu"
                      aria-label="Connected wallet"
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                      className={clsx(
                        "absolute right-0 top-[calc(100%+0.5rem)] w-[calc(100vw-1.5rem)] max-w-80 overflow-hidden rounded-lg",
                        "max-h-[calc(100vh-5rem)] overflow-y-auto border border-border-soft bg-surface-elevated shadow-xl shadow-black/15 ring-1 ring-black/5",
                        "z-[150]",
                      )}
                    >
                      <div className="border-b border-border-soft px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={clsx(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm",
                              grad.from,
                              grad.to,
                            )}
                          >
                            <span className="block h-2 w-2 rounded-full bg-white/90" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-text-strong">
                              Connected wallet
                            </p>
                            <p className="truncate font-mono text-[11px] text-text-muted">
                              {address}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-px bg-border-soft">
                        <div className="bg-surface-elevated px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase text-text-muted">
                            Balance
                          </p>
                          <p className="mt-1 truncate text-sm font-semibold text-text-strong">
                            {balanceLabel}
                          </p>
                        </div>
                        <div className="bg-surface-elevated px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase text-text-muted">
                            Signer
                          </p>
                          <p className="mt-1 truncate text-sm font-semibold text-text-strong">
                            {signerLabel}
                          </p>
                        </div>
                      </div>

                      <div className="p-1.5">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleCopyAddress}
                          className={MOBILE_WALLET_MENU_ITEM_CLASS}
                        >
                          <Copy size={14} aria-hidden="true" />
                          Copy address
                        </button>
                        <a
                          role="menuitem"
                          href={addressUrl(address)}
                          target="_blank"
                          rel="noreferrer"
                          className={MOBILE_WALLET_MENU_ITEM_CLASS}
                        >
                          <ExternalLink size={14} aria-hidden="true" />
                          View on explorer
                        </a>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleRefreshBalance}
                          disabled={balanceQuery.isFetching}
                          className={clsx(
                            MOBILE_WALLET_MENU_ITEM_CLASS,
                            "disabled:opacity-60",
                          )}
                        >
                          <RefreshCw
                            size={14}
                            aria-hidden="true"
                            className={clsx(balanceQuery.isFetching && "animate-spin")}
                          />
                          Refresh balance
                        </button>
                        <Link
                          role="menuitem"
                          href="/app/account"
                          onClick={() => setWalletMenuOpen(false)}
                          className={MOBILE_WALLET_MENU_ITEM_CLASS}
                        >
                          <UserCircle2 size={14} aria-hidden="true" />
                          Account
                        </Link>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleDisconnect}
                          className={clsx(
                            MOBILE_WALLET_MENU_ITEM_CLASS,
                            "text-rose-500 hover:bg-rose-500/10 hover:text-rose-500",
                          )}
                        >
                          <LogOut size={14} aria-hidden="true" />
                          Disconnect
                        </button>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
              {showSecure && (
                <motion.div
                  key="secure"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href="/app/secure"
                    aria-label="Secure (recovery)"
                    className={MOBILE_HEADER_BTN}
                  >
                    <ShieldCheck size={18} />
                  </Link>
                </motion.div>
              )}
              {showAccount && (
                <motion.div
                  key="account"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href="/app/account"
                    aria-label="Account"
                    className={MOBILE_HEADER_BTN}
                  >
                    <UserCircle2 size={18} />
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

const MOBILE_WALLET_MENU_ITEM_CLASS = clsx(
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-text-soft",
  "transition-colors duration-base ease-out-soft hover:bg-glass-soft hover:text-text-strong",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated",
);
