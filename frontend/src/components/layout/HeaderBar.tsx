"use client";

// Minimalist header - retail rebuild.
//
// On /app/* mobile the header now reads like a native app navbar:
//   • LEFT  - circular back button (only off home)
//   • CENTER - plain page title text on every connected app route.
//     No pill, no border, just centered text - the way iOS / Android
//     navbars do it.
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
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronLeft,
  ExternalLink,
  LogOut,
  Palette,
  RefreshCw,
  ScanLine,
  Usb,
  UserCircle2,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { BrandMark } from "@/components/retail/BrandMark";
import { TestnetFaucetLinks } from "@/components/layout/TestnetFaucetLinks";
import { useToast } from "@/components/ui/Toast";
import { addressUrl } from "@/lib/explorer";
import { formatBalance } from "@/lib/retail/format";
import { getSectionLabel, isSendRoute } from "@/lib/retail/sectionLabel";

// Shared pill-button class used by every floating mobile chrome
// affordance (back / scan / settings). Centralised so the three
// icon buttons read as a matched set.
const MOBILE_HEADER_BTN = [
  "flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised/95",
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
  const showBack = inAppConnected && !isHome;
  const showTitle = inAppConnected;
  const showBrandPill = !inApp || !connected;
  const showScan = isSendRoute(pathname);
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
      className="app-mobile-header fixed inset-x-3 top-3 z-[140] flex items-center gap-2 sm:inset-x-4 sm:top-4"
      role="banner"
    >
      {/* Back button - left edge, mobile only, off-home only. */}
      {showBack && (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className={MOBILE_HEADER_BTN}
        >
          <ChevronLeft size={18} />
        </button>
      )}

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

      {/* Mobile page title - one centered placement for every app
          route. It is independent of the left back button and the
          right wallet cluster, so page identity stays visually
          centered across Home, wallet detail, settings, and send
          screens. */}
      {showTitle && (
        <div
          className={clsx(
            "pointer-events-none top-1/2 flex md:hidden",
            isHome
              ? "min-w-0 flex-1 justify-start"
              : "absolute left-1/2 w-[min(52vw,18rem)] -translate-x-1/2 -translate-y-1/2 justify-center sm:w-[min(56vw,20rem)]",
          )}
        >
          <h1
            className={clsx(
              "max-w-full truncate font-semibold tracking-tight text-text-strong",
              isHome ? "text-lg" : "text-base",
              isHome ? "text-left" : "text-center",
            )}
          >
            {pageTitle}
          </h1>
        </div>
      )}

      {/* Right-side action cluster. Only renders when there's at
          least one action to show:
            • Scan     - on send routes
            • Wallet   - on every connected /app/* route. Notifications
                          and theme live inside this menu on mobile.
          ml-auto pushes the cluster to the trailing edge, opposite
          the title / back button on the leading edge. */}
      {inAppConnected && (
        <div className="ml-auto flex items-center gap-2 md:hidden">
          {showScan && (
            <button
              type="button"
              onClick={handleScan}
              aria-label="Scan a QR code"
              className={MOBILE_HEADER_BTN}
            >
              <ScanLine size={18} />
            </button>
          )}
          {address && (
            <div ref={walletMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setWalletMenuOpen((v) => !v)}
                    aria-label={`Connected wallet ${shortAddress}`}
                    aria-haspopup="menu"
                    aria-expanded={walletMenuOpen}
                    className={MOBILE_HEADER_BTN}
                  >
                    <Usb className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </button>

                  {walletMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Connected wallet"
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
                            className="flex h-8 w-8 shrink-0 items-center justify-center text-accent"
                          >
                            <Usb className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
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
                        <TestnetFaucetLinks itemClass={MOBILE_WALLET_MENU_ITEM_CLASS} />
                        <Link
                          role="menuitem"
                          href="/app/notifications"
                          onClick={() => setWalletMenuOpen(false)}
                          className={MOBILE_WALLET_MENU_ITEM_CLASS}
                        >
                          <Bell size={14} aria-hidden="true" />
                          Notifications
                          {notifications.unreadCount > 0 && (
                            <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-text-on-accent">
                              {notifications.unreadCount > 99
                                ? "99+"
                                : notifications.unreadCount}
                            </span>
                          )}
                        </Link>
                        <Link
                          role="menuitem"
                          href="/app/settings#theme"
                          onClick={() => setWalletMenuOpen(false)}
                          className={MOBILE_WALLET_MENU_ITEM_CLASS}
                        >
                          <Palette size={14} aria-hidden="true" />
                          Theme
                        </Link>
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
                    </div>
                  )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

const MOBILE_WALLET_MENU_ITEM_CLASS = clsx(
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-text-soft",
  "transition-colors duration-base ease-out-soft hover:bg-glass-soft hover:text-text-strong",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated",
);
