"use client";

// Workspace layout used by all connected-app pages.
//
// Desktop (md+): fixed two-column shell. The sidebar is pinned to the
// viewport's left edge at full height (no scroll, no offset, no card
// chrome - just a right divider). The right column has its own top
// header and an internally-scrolling content area, so the sidebar
// never moves when the user scrolls the page.
//
// Mobile (<md): falls back to body scroll. The sidebar is hidden and
// reachable via HeaderBar's left-sliding drawer; BottomNav handles
// primary navigation. DashboardHeader is desktop-only.

import { useEffect, useState } from "react";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { AppLockOverlay } from "@/components/security/AppLockOverlay";
import { PhishingWarningBanner } from "@/components/security/PhishingWarningBanner";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { CommandPaletteLoader } from "@/components/layout/CommandPaletteLoader";
import {
  SidebarProvider,
  useSidebar,
} from "@/components/providers/SidebarProvider";
import { ActionNeededProvider } from "@/lib/hooks/useActionNeeded";
import { RouteAccessibility } from "@/components/layout/RouteAccessibility";

const DashboardHeader = dynamic(
  () =>
    import("@/components/layout/DashboardHeader").then(
      (mod) => mod.DashboardHeader,
    ),
  { ssr: false, loading: () => null },
);

const WorkspaceSidebar = dynamic(
  () =>
    import("@/components/layout/WorkspaceSidebar").then(
      (mod) => mod.WorkspaceSidebar,
    ),
  { ssr: false, loading: () => null },
);

const BottomNav = dynamic(
  () => import("@/components/retail/BottomNav").then((mod) => mod.BottomNav),
  { ssr: false, loading: () => null },
);

const ActionNotificationsRuntime = dynamic(
  () =>
    import("@/components/layout/ActionNotificationsRuntime").then(
      (mod) => mod.ActionNotificationsRuntime,
    ),
  { ssr: false, loading: () => null },
);

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  useWalletGate();
  // App-lock overlay sits OUTSIDE the SidebarProvider/WorkspaceShell
  // so the protected tree (which mounts hooks like useActionNeeded
  // and the notification ping) doesn't render at all while locked.
  // Drilling the lock down to mid-tree would still leak the
  // "something needs you" Notification through the gate.
  return (
    <AppLockOverlay>
      <SidebarProvider>
        <ActionNeededProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </ActionNeededProvider>
      </SidebarProvider>
    </AppLockOverlay>
  );
}

function WorkspaceShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const sidebar = useSidebar();
  const expanded = sidebar?.expanded ?? true;
  const pathname = usePathname() ?? "";
  const isWalletHub = pathname === "/app/wallet";
  const notificationsReady = useDeferredRuntime();
  return (
    <div
      className={clsx(
        "app-experience relative bg-canvas font-sans md:flex md:h-screen md:overflow-hidden",
        isWalletHub && "wallet-dot-canvas",
      )}
    >
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[600] -translate-y-24 rounded-soft bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent shadow-card-raised transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <RouteAccessibility pathname={pathname} />
      <MobileHeaderBackdrop />
      <HeaderBar />
      {notificationsReady ? <ActionNotificationsRuntime /> : null}
      <CommandPaletteLoader />

      {/* Sidebar - pinned to the viewport's left edge on md+. Owns
          its own internal scroll so a long wallet list doesn't push
          the rail off-screen. Hidden on mobile (lives in the drawer). */}
      <aside
        className={
          "hidden h-screen shrink-0 overflow-x-hidden overflow-y-auto " +
          "app-sidebar-shell border-r border-border-soft bg-surface-raised/95 " +
          "transition-[width] duration-base ease-out-soft md:block " +
          (expanded ? "w-64" : "w-16")
        }
      >
        <WorkspaceSidebar />
      </aside>

      {/* Right column.
          • Desktop: md:overflow-hidden caps the column at viewport
            height; the inner content div owns the scroll so the
            DashboardHeader stays pinned at the top while the user
            scrolls page content underneath.
          • Mobile: no overflow constraints - body scroll handles it,
            keeping URL-bar collapse and BottomNav behavior native. */}
      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <DashboardHeader />
        {/* Top + bottom padding lives on the INNER wrapper (not the
            scroll container) so a `sticky top-0` element inside the
            page can land flush against the DashboardHeader. Putting
            pt on the scroll container would push every sticky child
            down by that amount because sticky offsets are measured
            from the padding-box edge of the scrollport. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="app-content-stage relative z-10 flex-1 px-4 sm:px-5 md:overflow-y-auto md:overscroll-contain md:px-8 lg:px-10 xl:px-12"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-4 pb-32 pt-16 sm:pb-16 md:pb-12 md:pt-8">
            <PhishingWarningBanner />
            <PreAlphaBanner />
            <section className="relative z-20 min-w-0">{children}</section>
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

function useDeferredRuntime(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setReady(true), {
        timeout: 2_000,
      });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => setReady(true), 1_200);
    return () => window.clearTimeout(handle);
  }, []);

  return ready;
}

function MobileHeaderBackdrop() {
  const scrolled = useBodyScrolled();

  return (
    <div
      aria-hidden="true"
      className={clsx(
        "pointer-events-none fixed inset-x-0 top-0 z-[90] h-16 md:hidden",
        "transition-[background-color,box-shadow] duration-200 ease-out",
        scrolled
          ? "bg-canvas shadow-[0_12px_32px_-24px_rgba(0,0,0,0.9)]"
          : "bg-canvas/95",
      )}
    />
  );
}

function useBodyScrolled() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setScrolled(
          window.scrollY > 2 || document.documentElement.scrollTop > 2,
        );
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return scrolled;
}
