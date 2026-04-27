"use client";

// Workspace layout used by all connected-app pages.
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { AppNav } from "@/components/layout/AppNav";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { motion, useScroll, useTransform } from "framer-motion";

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  useWalletGate();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, 300]);

  return (
    <main className="relative min-h-screen bg-background overflow-hidden px-3 pb-24 pt-32 sm:px-4 sm:pt-36 lg:px-6 font-sans">
      {/* Background Decor - Parallax Blob */}
      <motion.div
        style={{ y }}
        className="absolute top-0 right-[-10%] w-[60vw] h-[60vw] rounded-full bg-brand-green/10 blur-[150px] pointer-events-none"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[91rem] flex-col gap-6">
        <HeaderBar />
        <PreAlphaBanner />

        <div className="flex flex-col gap-6 md:flex-row">
          <aside className="hidden w-64 shrink-0 md:block relative z-20">
            <AppNav mode="desktop" />
          </aside>
          <section className="min-w-0 flex-1 relative z-20">{children}</section>
        </div>
      </div>

      <AppNav mode="mobile" />
    </main>
  );
}
