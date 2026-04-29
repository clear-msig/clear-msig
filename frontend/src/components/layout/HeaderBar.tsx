"use client";

// Minimalist header. Connect Wallet (left) + menu button (right).
//
// Connect Wallet is hidden until the first-visit onboarding walkthrough
// is dismissed — useOnboarding gates that. Mounts on landing AND /app/*
// so the experience is consistent.
//
// Animations are transform/opacity only to stay GPU-accelerated at 60fps.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, LogOut, Wallet, ClipboardList, Zap, Github, RefreshCcw, Home as HomeIcon } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import clsx from "clsx";

export function HeaderBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { completed, hydrated, reset } = useOnboarding();
  const { connected, disconnect } = useWallet();
  const pathname = usePathname();

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

        {/* right: Menu button */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/85 text-black backdrop-blur transition-transform duration-150 hover:scale-105 active:scale-95"
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <Menu size={18} />
        </button>
      </header>

      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        connected={connected}
        disconnect={disconnect}
        showIntro={() => {
          reset();
          setMenuOpen(false);
        }}
        pathname={pathname ?? ""}
      />
    </>
  );
}

interface MenuDrawerProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  disconnect: () => Promise<void>;
  showIntro: () => void;
  pathname: string;
}

function MenuDrawer({ open, onClose, connected, disconnect, showIntro, pathname }: MenuDrawerProps) {
  const links = [
    { href: "/", label: "Home", Icon: HomeIcon },
    { href: "/app/wallet", label: "Wallets", Icon: Wallet },
    { href: "/app/intents", label: "Intents", Icon: ClipboardList },
    { href: "/app/proposals", label: "Proposals", Icon: Zap },
  ];

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
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260, mass: 0.7 }}
            className="fixed right-0 top-0 z-[151] flex h-full w-[88%] max-w-[340px] flex-col bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-bold tracking-tight text-black">
                Clear-MSIG
              </span>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-black/5 hover:text-black"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            <nav className="mt-8 flex flex-col gap-1">
              {links.map(({ href, label, Icon }) => {
                const active = pathname === href || (href !== "/" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={clsx(
                      "group inline-flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition-colors",
                      active
                        ? "bg-black text-white"
                        : "text-black/70 hover:bg-black/5 hover:text-black"
                    )}
                  >
                    <Icon size={16} className={active ? "text-white" : "text-black/40 group-hover:text-black"} />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto flex flex-col gap-1 border-t border-black/5 pt-4">
              <button
                type="button"
                onClick={showIntro}
                className="inline-flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5 hover:text-black"
              >
                <RefreshCcw size={16} className="text-black/40" />
                Show intro again
              </button>
              <a
                href="https://github.com/clear-msig/clear-msig"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5 hover:text-black"
              >
                <Github size={16} className="text-black/40" />
                GitHub
              </a>
              {connected && (
                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    onClose();
                  }}
                  className="inline-flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-rose-500 transition-colors hover:bg-rose-50"
                >
                  <LogOut size={16} />
                  Disconnect
                </button>
              )}
            </div>

            <p className="mt-6 text-[10px] uppercase tracking-widest text-black/30">
              Pre-alpha · Devnet only
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
