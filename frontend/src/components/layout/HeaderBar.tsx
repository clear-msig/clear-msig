"use client";

// Minimalist header — retail rebuild.
//
// The wallet-select button has moved to its own page (/connect). This
// header now does two things:
//   - Brand-only on landing + the connect page (clean public surface).
//   - On /app/* mobile, a menu button that opens the workspace
//     sidebar drawer (sliding in from the left) so users can reach
//     search / wallet list / disconnect without a persistent
//     sidebar (which is desktop-only).
//
// Menu button sits on the LEFT of the header next to the brand pill.
// Drawer slides from the LEFT to match the menu button's side and
// match the desktop sidebar's anchor — no left/right whiplash between
// the trigger and the surface it opens.
//
// All animations are transform/opacity only.

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { Menu, X } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { BrandMark } from "@/components/retail/BrandMark";
import { useSidebar } from "@/components/providers/SidebarProvider";

export function HeaderBar() {
  const { hydrated } = useOnboarding();
  const { connected } = useWallet();
  const pathname = usePathname() ?? "";
  // Null on the landing page (no SidebarProvider). HeaderBar is
  // rendered there too, but the menu button is gated on `inApp` so we
  // never read `sidebar` if it's null.
  const sidebar = useSidebar();

  const inApp = pathname.startsWith("/app");
  const showMenuButton = hydrated && connected && inApp && sidebar !== null;
  // The desktop sidebar (md+) carries its own brand row already.
  // Rendering the floating brand pill in the corner on top of that
  // duplicates the wordmark and reserves a wide empty band across
  // the top of every /app/* page. Hide it on md+ when in /app/*; keep
  // it on mobile (where the sidebar lives behind a drawer) and on
  // public surfaces (/, /privacy, /security, /connect, /welcome) where
  // there is no sidebar at all.
  const showBrandPill = !inApp || !connected;

  return (
    <>
      <header
        className="fixed inset-x-3 top-3 z-[100] flex items-center justify-start gap-2 sm:inset-x-4 sm:top-4"
        role="banner"
      >
        {/* Mobile menu button — only on /app/* once a wallet is
            connected. Sits left of the brand so the trigger is on the
            same side as the drawer it opens. Desktop has the
            persistent sidebar in the workspace layout, so this trigger
            would be redundant there. */}
        <AnimatePresence>
          {showMenuButton && (
            <motion.button
              type="button"
              onClick={() => sidebar.openMobile()}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={
                "flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised " +
                "text-text-strong shadow-card-rest " +
                "transition-transform duration-base ease-out-soft hover:-translate-y-0.5 active:scale-95 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                "md:hidden"
              }
              aria-label="Open menu"
              aria-expanded={sidebar.mobileOpen}
            >
              <Menu size={18} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Brand pill. Visible on public surfaces and on /app/* mobile;
            hidden on /app/* desktop where the sidebar carries the brand
            and a duplicate would create a wide empty header band. */}
        {showBrandPill && (
          <Link
            href="/"
            aria-label="Clear home"
            className={
              "inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 " +
              "text-sm font-semibold text-text-strong shadow-card-rest " +
              "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
              // Mobile keeps the pill (the sidebar is a drawer there).
              // md+ on /app/* hides it via the showBrandPill check above.
              (inApp && connected ? "md:hidden" : "")
            }
          >
            <span className="flex h-5 w-5 items-center justify-center text-accent">
              <BrandMark size={18} />
            </span>
            Clear
          </Link>
        )}
      </header>

      {sidebar && (
        <MenuDrawer open={sidebar.mobileOpen} onClose={sidebar.closeMobile} />
      )}
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
            className="fixed inset-0 z-[150] bg-text-strong/30 backdrop-blur-sm md:hidden"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            tabIndex={-1}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260, mass: 0.7 }}
            className="fixed left-0 top-0 z-[151] flex h-full w-[88%] max-w-[320px] flex-col border-r border-border-soft bg-surface-raised shadow-card-raised md:hidden"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
            <WorkspaceSidebar onNavigate={onClose} forceExpanded />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
