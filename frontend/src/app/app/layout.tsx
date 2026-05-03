"use client";

// Workspace layout used by all connected-app pages.
//
// Visually mirrors the landing page: light outer bg (bg-background)
// with dark content cards rendered by each route. Decorative parallax
// blob + subtle gradient blurs (matching the landing hero) keep the
// surface feeling cinematic instead of form-y. Inside this shell every
// child page is expected to use bg-surface-card / bg-surface cards with
// white text — same pattern as ProblemSection, BeforeAfterSection, and
// the chains showcase on the landing page.
//
// Navigation: persistent left sidebar on desktop (md+), mobile drawer
// triggered by HeaderBar's menu button below md. The sidebar surfaces
// the connected wallet's organisations + a Create CTA so the user
// always has somewhere to go without hunting through menus.

import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { BottomNav } from "@/components/retail/BottomNav";

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  useWalletGate();

  return (
    // Workspace surface is now flat. The decorative parallax blobs
    // (brand-green + cyan) have been retired — Apple Wallet, Cash App,
    // Squads, Safe all run crisp surfaces inside the app. Soft blurs
    // signal "marketing page" and undermined the money-app register.
    // The landing page keeps its single accent wash; the workspace is
    // a working surface.
    <main className="relative min-h-screen overflow-x-hidden bg-background px-3 pb-32 pt-20 font-sans sm:px-4 sm:pb-16 sm:pt-20 lg:px-6 lg:pt-16">
      <HeaderBar />
      <CommandPalette />

      <div className="relative z-10 mx-auto grid w-full max-w-[78rem] grid-cols-1 gap-6 md:grid-cols-[16rem_1fr] md:items-start">
        {/* Persistent sidebar on md+; hidden on mobile (lives in the
            HeaderBar drawer instead). Sticky so it stays visible as the
            main column scrolls. */}
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] overflow-y-auto rounded-3xl border border-white/10 bg-surface-card-strong shadow-card-dark md:block lg:top-16 lg:h-[calc(100vh-5rem)]">
          <WorkspaceSidebar />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <PreAlphaBanner />
          <section className="relative z-20 min-w-0">{children}</section>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
