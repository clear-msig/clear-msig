"use client";

// Minimalist header. Connect Wallet (left) + menu button (right, mobile
// only — desktop has the persistent sidebar in the workspace layout).
//
// Connect Wallet is hidden until the first-visit onboarding walkthrough
// is dismissed — useOnboarding gates that. Mounts on landing AND /app/*
// so the experience is consistent.
//
// Animations are transform/opacity only to stay GPU-accelerated at 60fps.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { Menu, X } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import clsx from "clsx";

export function HeaderBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { completed, hydrated } = useOnboarding();
  const { connected } = useWallet();

  // Show Connect Wallet only after onboarding (or before hydration, to
  // avoid a layout shift — useOnboarding defaults to completed=true on
  // first render so the button is visible by default).
  const showConnect = !hydrated || completed;

  return (
    <>
      <header
        className="fixed inset-x-3 top-3 z-[100] flex items-center justify-between sm:inset-x-4 sm:top-4"
        role="banner"
      >
        {/* left: Connect Wallet (gated by onboarding) */}
        <div className="flex min-w-0 items-center">
          <AnimatePresence>
            {showConnect && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <WalletMultiButton
                  className={clsx(
                    "!h-auto !rounded-full !px-4 !py-2 !text-xs !font-semibold sm:!px-5 sm:!text-sm",
                    "!border !border-black/10 !bg-white/85 !text-black !backdrop-blur",
                    "hover:!bg-white"
                  )}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* right: Menu button — only when a wallet is connected AND on
            mobile (md:hidden). Desktop has the persistent sidebar in
            the workspace layout, so this drawer trigger would be
            redundant there. */}
        <AnimatePresence>
          {connected && (
            <motion.button
              type="button"
              onClick={() => setMenuOpen(true)}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/85 text-black backdrop-blur transition-transform duration-150 hover:scale-105 active:scale-95 md:hidden"
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
            className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm"
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
            className="fixed right-0 top-0 z-[151] flex h-full w-[88%] max-w-[340px] flex-col bg-black shadow-2xl"
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
