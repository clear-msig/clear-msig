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
    <main className="relative min-h-screen overflow-x-hidden bg-background px-3 pb-32 pt-20 font-sans sm:px-4 sm:pb-16 sm:pt-20 lg:px-6 lg:pt-16">
      <HeaderBar />
      <CommandPalette />

      <div
        className={
          "relative z-10 mx-auto grid w-full max-w-[78rem] grid-cols-1 items-start gap-6 md:gap-0 " +
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
            "sticky top-20 hidden h-[calc(100vh-6rem)] overflow-x-hidden overflow-y-auto " +
            "border-r border-border-soft bg-surface-raised " +
            "transition-[width] duration-base ease-out-soft " +
            "md:block lg:top-16 lg:h-[calc(100vh-5rem)]"
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
