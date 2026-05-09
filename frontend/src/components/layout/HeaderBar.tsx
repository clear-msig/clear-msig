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

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ScanLine, ShieldCheck, UserCircle2 } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { BrandMark } from "@/components/retail/BrandMark";
import { useToast } from "@/components/ui/Toast";
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
  const { connected } = useWallet();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const toast = useToast();

  const inApp = pathname.startsWith("/app");
  const isHome = pathname === "/app/wallet";
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
  // Account shortcut - lives on the Settings page only. Settings
  // moved into the bottom nav, so Account becomes the
  // companion surface reachable from the Settings page header.
  const showAccount = inAppConnected && pathname.startsWith("/app/settings");
  // Secure shortcut: only on the Home page so the icon doesn't
  // clutter every screen. Tapping deep-links into /app/secure
  // (the recovery hub).
  const showSecure = inAppConnected && isHome;
  const pageTitle = inAppConnected
    ? isHome
      ? "Welcome back"
      : getSectionLabel(pathname)
    : "";

  // router.back() walks browser history; fall back to home when
  // there's no in-app history yet (cold deep-link). Mount counts as
  // navigation #1, each pathname change increments.
  const navCountRef = useRef(0);
  useEffect(() => {
    navCountRef.current += 1;
  }, [pathname]);

  const handleBack = () => {
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

  return (
    <header
      className="fixed inset-x-3 top-3 z-[100] flex items-center gap-2 sm:inset-x-4 sm:top-4"
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
          <span className="flex h-5 w-5 items-center justify-center text-accent drop-shadow-[0_0_6px_rgba(204,255,0,0.5)]">
            <BrandMark size={18} />
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
          <span className="flex h-6 w-6 items-center justify-center text-accent drop-shadow-[0_0_6px_rgba(204,255,0,0.5)]">
            <BrandMark size={22} />
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
          ml-auto pushes the cluster to the trailing edge, opposite
          the title / back button on the leading edge. */}
      <AnimatePresence>
        {inAppConnected && (showScan || showAccount || showSecure) && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="ml-auto flex items-center gap-2 md:hidden"
          >
            <AnimatePresence>
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
