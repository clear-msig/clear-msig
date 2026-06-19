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

import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { AppLockOverlay } from "@/components/security/AppLockOverlay";
import { PhishingWarningBanner } from "@/components/security/PhishingWarningBanner";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { CommandPaletteLoader } from "@/components/layout/CommandPaletteLoader";
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
    <main className="app-experience relative bg-canvas font-sans md:flex md:h-screen md:overflow-hidden">
      {/* Atmospheric accents - two soft radial blooms anchoring the
          page corners. Pure decoration, pointer-events-none, lifts
          the obsidian canvas off the "flat black" reading without
          competing with foreground content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"
      >
        <div
          className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full opacity-35"
          style={{
            background:
              "radial-gradient(circle at center, rgba(204, 255, 0, 0.08) 0%, rgba(204, 255, 0, 0.035) 32%, rgba(204, 255, 0, 0) 68%)",
          }}
        />
        <div
          className="absolute -bottom-44 -right-44 h-[640px] w-[640px] rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle at center, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.03) 34%, rgba(16, 185, 129, 0) 70%)",
          }}
        />
      </div>

      {/* Mobile-only header backdrop - covers the gap between the
          floating hamburger and the brand pill so scrolled content
          doesn't peek through. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-14 bg-canvas/95 md:hidden"
      />
      <HeaderBar />
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
        <div
          className="app-content-stage relative z-10 flex-1 px-3 sm:px-4 md:overflow-y-auto md:overscroll-contain md:px-8 lg:px-10 xl:px-12"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 pb-32 pt-16 sm:pb-16 md:pb-12 md:pt-8">
            <PhishingWarningBanner />
            <PreAlphaBanner />
            <section className="relative z-20 min-w-0">{children}</section>
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
