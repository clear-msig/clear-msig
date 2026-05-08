"use client";

// Workspace layout used by all connected-app pages.
//
// Visually flat: light bg-background outer, light bg-surface-raised
// sidebar attached to the left, page column on the right. The sidebar
// has two desktop states (rail / full) controlled by SidebarProvider;
// the grid template columns animate smoothly between widths.
//
// Mobile (<md): the sidebar is hidden in the layout flow and rendered
// instead inside HeaderBar's left-sliding drawer.

import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { AppLockOverlay } from "@/components/security/AppLockOverlay";
import { PhishingWarningBanner } from "@/components/security/PhishingWarningBanner";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { BottomNav } from "@/components/retail/BottomNav";
import {
  SidebarProvider,
  useSidebar,
} from "@/components/providers/SidebarProvider";

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
        <WorkspaceShell>{children}</WorkspaceShell>
      </SidebarProvider>
    </AppLockOverlay>
  );
}

function WorkspaceShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const sidebar = useSidebar();
  const expanded = sidebar?.expanded ?? true;
  // Multisig collab signal: when something lands in the user's
  // pending-approvals list and the tab is hidden, fire a browser
  // Notification. Hook is rendered here so it runs across every
  // /app/* page and survives the route changes that destroy lower
  // components.
  useActionNotifications();
  return (
    <main
      className={
        // Mobile: pt-16 (64px). The floating hamburger ends at
        // ~52px; pt-16 sits the first content 12px below it. The
        // backdrop strip below covers any overlap from scrolled
        // content. pt-24 (the previous value) was overcorrected
        // and produced a "long empty band" at the top of every
        // page. Desktop hides the brand pill on /app/* so we drop
        // to pt-6.
        "relative min-h-screen overflow-x-hidden bg-canvas px-3 pb-32 pt-16 font-sans " +
        "sm:px-4 sm:pb-16 md:pt-6 lg:px-6 lg:pt-6"
      }
    >
      {/* Mobile-only header backdrop — when content scrolls under
          the floating hamburger / brand pill, the scrolled text
          would otherwise peek through the gap between the two
          buttons. A canvas-coloured strip behind them solves it
          without a per-button bg bump. Hidden on md+ where there
          is no floating header. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-14 bg-canvas md:hidden"
      />
      <HeaderBar />
      <CommandPalette />

      <div
        className={
          // Bumped from max-w-[78rem] to max-w-[96rem] (1536px). On a
          // 1920+ monitor the previous cap left ~336px empty on each
          // side; the new cap halves that to ~192px while keeping
          // text-line widths reasonable on the page column.
          "relative z-10 mx-auto grid w-full max-w-[96rem] grid-cols-1 items-start gap-6 md:gap-0 " +
          "transition-[grid-template-columns] duration-base ease-out-soft " +
          (expanded ? "md:grid-cols-[16rem_1fr]" : "md:grid-cols-[4rem_1fr]")
        }
      >
        {/* Persistent sidebar on md+; hidden on mobile (lives in the
            HeaderBar drawer instead). Sticky so it stays visible as
            the main column scrolls. Light surface with a soft right
            border so it reads as a real navigation rail attached to
            the page column, not a floating card. */}
        <aside
          className={
            // top-6 matches md:pt-6 above so the sidebar's brand row
            // sits flush with where the floating pill used to live.
            "sticky top-6 hidden h-[calc(100vh-3rem)] overflow-x-hidden overflow-y-auto " +
            "border-r border-border-soft bg-surface-raised " +
            "transition-[width] duration-base ease-out-soft " +
            "md:block"
          }
        >
          <WorkspaceSidebar />
        </aside>

        {/* Page column. md:pl-6 restores the breathing space the
            md:gap-0 grid removed, so the sidebar's right border has a
            clear margin to the page content. */}
        <div className="flex min-w-0 flex-col gap-4 md:pl-6">
          <PhishingWarningBanner />
          <PreAlphaBanner />
          <section className="relative z-20 min-w-0">{children}</section>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
