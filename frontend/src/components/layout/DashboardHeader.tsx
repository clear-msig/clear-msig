"use client";

// Desktop top header - back navigation for the workspace shell.
//
// Sits above the scrollable content column on md+, hidden on mobile.
// Primary navigation (Home / Activity / Contacts / Settings) lives in
// the sidebar; this header is dedicated to back-navigation context: a
// back button that returns the user to where they came from, plus a
// short label of the current section so the page identity is always
// readable.
//
// Back-button behavior:
//   • If the user has navigated within the app this session,
//     router.back() walks browser history (preserving scroll, query
//     params, intermediate steps).
//   • If they landed directly on a deep route (cold link, refresh),
//     getParentRoute() falls back to a sensible parent so back never
//     ejects the user out of the app.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Usb,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { useToast } from "@/components/ui/Toast";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { addressUrl } from "@/lib/explorer";
import { formatBalance } from "@/lib/retail/format";
import { getSectionLabel } from "@/lib/retail/sectionLabel";
import { ThemeModeButton } from "@/components/security/ThemeModeButton";
import { TestnetFaucetLinks } from "@/components/layout/TestnetFaucetLinks";

const ROOT_ROUTES = new Set([
  "/app/wallet",
  "/app/activity",
  "/app/contacts",
  "/app/account",
  "/app/settings",
]);

function getParentRoute(pathname: string): string {
  if (!pathname.startsWith("/app/")) return "/app/wallet";
  // Detail-page drill-downs always live under Home.
  if (
    pathname.startsWith("/app/proposals") ||
    pathname.startsWith("/app/intents") ||
    pathname.startsWith("/app/invitations")
  ) {
    return "/app/wallet";
  }
  if (pathname === "/app/notifications") return "/app/wallet";
  if (pathname.startsWith("/app/notifications/")) return "/app/notifications";
  if (pathname.startsWith("/app/settings/")) return "/app/settings";
  if (pathname.startsWith("/app/account/")) return "/app/account";
  // Walk one segment up; if we'd land at /app or /app/, go to /app/wallet.
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length <= 2) return "/app/wallet";
  return "/" + segs.slice(0, -1).join("/");
}

export function DashboardHeader() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const contentScrolled = useContentStageScrolled(pathname);
  // Track in-app navigations so router.back() only fires when it'll
  // actually land somewhere in our app. Mount counts as 1; each
  // pathname change increments. count > 1 ⇒ at least one in-app jump
  // has happened ⇒ history.back() is safe.
  const navCountRef = useRef(0);
  useEffect(() => {
    navCountRef.current += 1;
  }, [pathname]);

  const isRoot = ROOT_ROUTES.has(pathname);
  const label = getSectionLabel(pathname);

  const handleBack = () => {
    if (navCountRef.current > 1) {
      router.back();
    } else {
      router.push(getParentRoute(pathname));
    }
  };

  return (
    <header
      role="banner"
      className={clsx(
        "app-dashboard-header relative z-30 hidden h-14 shrink-0 items-center gap-3 px-6 md:flex lg:px-8 xl:px-10",
        "border-b border-border-soft bg-canvas transition-shadow duration-200 ease-out",
        contentScrolled && "shadow-[0_14px_34px_-28px_rgba(0,0,0,0.95)]",
      )}
    >
      {!isRoot ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className={clsx(
            "group inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-glass-soft py-1.5 pl-2 pr-3 text-xs font-medium text-text-soft",
            "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <ChevronLeft
            size={14}
            className="transition-transform duration-base group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          <span>Back</span>
        </button>
      ) : null}
      {!isRoot && label ? (
        <span
          aria-hidden="true"
          className="h-5 w-px shrink-0 bg-glass-strong"
        />
      ) : null}
      {label ? (
        <h1 className="truncate font-display text-sm font-semibold tracking-tight text-text-strong">
          {label}
        </h1>
      ) : null}

      {/* Top-right - wallet connection state. Search + New moved to
          the sidebar (BrandRow's WorkspaceActions). The header now
          owns the connect / disconnect surface so it sits at eye
          level instead of buried in the sidebar footer. */}
      <div className="ml-auto flex items-center gap-2">
        <ThemeModeButton />
        <HeaderNotificationsButton />
        <HeaderWalletPill />
      </div>
    </header>
  );
}

function useContentStageScrolled(pathname: string) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const stage = document.querySelector<HTMLElement>(".app-content-stage");
    if (!stage) return;

    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setScrolled(stage.scrollTop > 2);
      });
    };

    update();
    stage.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  return scrolled;
}

function HeaderNotificationsButton() {
  const pathname = usePathname() ?? "";
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const { unreadCount } = useNotificationFeed(address);
  const active = pathname.startsWith("/app/notifications");

  if (!wallet.connected || !address) return null;

  const label = unreadCount
    ? `Notifications (${unreadCount} unread)`
    : "Notifications";

  return (
    <Link
      href="/app/notifications"
      aria-label={label}
      className={clsx(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-soft",
        "border border-border-soft bg-glass-soft text-text-soft",
        "transition-[border-color,color,background-color] duration-base ease-out-soft",
        "hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        active && "border-accent/50 bg-accent/[0.08] text-accent",
      )}
    >
      <Bell size={14} aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className={clsx(
            "absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center",
            "rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-text-on-accent",
            "ring-2 ring-canvas",
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

// ─── Header wallet pill ───────────────────────────────────────────
//
// Compact connect / connected state for the desktop top header.
// Shows an avatar + short address + disconnect icon when connected;
// falls back to a "Sign in" link otherwise (defensive - useWalletGate
// already redirects unauthenticated users out of /app/*, so this
// branch should only render in the brief mount-before-gate window).

function HeaderWalletPill() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const address = wallet.publicKey?.toBase58() ?? "";
  const explorerHref = address ? addressUrl(address) : "";

  const balanceQuery = useQuery({
    queryKey: ["connected-wallet-balance", address],
    queryFn: async () => {
      if (!wallet.publicKey) return 0;
      return connection.getBalance(wallet.publicKey, "confirmed");
    },
    enabled: wallet.connected && Boolean(wallet.publicKey),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!wallet.connected || !address) {
    return (
      <Link
        href="/connect"
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-glass-soft px-3 py-1.5 text-xs font-medium text-text-soft",
          "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        Sign in
        <ArrowRight size={12} aria-hidden="true" />
      </Link>
    );
  }

  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
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
      /* swallow - we still want the cache wipe to land */
    }
    queryClient.clear();
    if (typeof window !== "undefined") {
      window.location.replace("/");
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "inline-flex h-9 items-center gap-2 rounded-soft border border-border-soft bg-glass-soft py-1 pl-1.5 pr-2.5 backdrop-blur-md",
          "transition-[border-color,background-color] duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center text-accent"
        >
          <Usb className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col items-start leading-none">
          <span className="font-mono text-[11px] text-text-strong">{short}</span>
          <span className="mt-1 max-w-[6.5rem] truncate text-[10px] font-medium text-text-muted">
            {balanceLabel}
          </span>
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={clsx(
            "shrink-0 text-text-muted transition-transform duration-base",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Connected wallet"
          className={clsx(
            "absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-80 overflow-hidden rounded-lg border border-border-soft bg-surface-elevated shadow-xl shadow-black/10",
            "ring-1 ring-black/5",
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
              <p className="mt-1 text-sm font-semibold text-text-strong">
                {balanceLabel}
              </p>
            </div>
            <div className="bg-surface-elevated px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-text-muted">
                Signer
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-text-strong">
                <ShieldCheck size={13} aria-hidden="true" />
                {signerLabel}
              </p>
            </div>
          </div>

          <div className="p-1.5">
            <a
              role="menuitem"
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className={WALLET_MENU_ITEM_CLASS}
            >
              <ExternalLink size={14} aria-hidden="true" />
              View on explorer
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={handleRefreshBalance}
              disabled={balanceQuery.isFetching}
              className={clsx(WALLET_MENU_ITEM_CLASS, "disabled:opacity-60")}
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={clsx(balanceQuery.isFetching && "animate-spin")}
              />
              Refresh balance
            </button>
            <TestnetFaucetLinks itemClass={WALLET_MENU_ITEM_CLASS} />
            <button
              type="button"
              role="menuitem"
              onClick={handleDisconnect}
              className={clsx(
                WALLET_MENU_ITEM_CLASS,
                "text-rose-500 hover:bg-rose-500/10 hover:text-rose-500",
              )}
            >
              <LogOut size={14} aria-hidden="true" />
              Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WALLET_MENU_ITEM_CLASS = clsx(
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-text-soft",
  "transition-colors duration-base ease-out-soft hover:bg-glass-soft hover:text-text-strong",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated",
);
