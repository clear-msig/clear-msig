"use client";

// Minimalist header — retail rebuild.
//
// The wallet-select button has moved to its own page (/connect). This
// header now does two things:
//   - Brand-only on landing + the connect page (clean public surface).
//   - On /app/* mobile, a menu button that opens the workspace drawer
//     so users can reach search / wallet list / disconnect without a
//     persistent sidebar (which is desktop-only).
//
// All animations are transform/opacity only.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { Menu, Wallet as WalletIcon, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";

export function HeaderBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { hydrated } = useOnboarding();
  const { connected } = useWallet();
  const pathname = usePathname() ?? "";

  const inApp = pathname.startsWith("/app");

  return (
    <>
      <header
        className="fixed inset-x-3 top-3 z-[100] flex items-center justify-between sm:inset-x-4 sm:top-4"
        role="banner"
      >
        {/* Brand — links home. Always rendered. */}
        <Link
          href="/"
          aria-label="Clear home"
          className={
            "inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 " +
            "text-sm font-semibold text-text-strong shadow-card-rest " +
            "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-accent">
            <WalletIcon size={11} strokeWidth={2.25} />
          </span>
          Clear
        </Link>

        {/* Mobile menu button — only on /app/* once a wallet is
            connected. Desktop has the persistent sidebar in the
            workspace layout, so this drawer trigger would be redundant
            there. */}
        <AnimatePresence>
          {hydrated && connected && inApp && (
            <motion.button
              type="button"
              onClick={() => setMenuOpen(true)}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={
                "flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised " +
                "text-text-strong shadow-card-rest " +
                "transition-transform duration-base ease-out-soft hover:-translate-y-0.5 active:scale-95 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                "md:hidden"
              }
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Menu size={18} />
            </motion.button>
          )}
        </AnimatePresence>
      </header>

      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

interface MenuDrawerProps {
  open: boolean;
  onClose: () => void;
}

function MenuDrawer({ open, onClose }: MenuDrawerProps) {
  // Escape closes the drawer. Standard modal expectation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Trap Tab inside the drawer while open and restore focus on close.
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, open);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[150] bg-surface-card/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260, mass: 0.7 }}
            className="fixed right-0 top-0 z-[151] flex h-full w-[88%] max-w-[340px] flex-col bg-surface-card shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
            <WorkspaceSidebar onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
