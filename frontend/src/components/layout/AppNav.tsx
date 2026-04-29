"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Wallet } from "lucide-react";
import { motion } from "framer-motion";

// Intents and Proposals used to be separate top-level routes. They're
// now tabs inside /app/wallet/[name] so the workflow is wallet-scoped
// instead of asking users to type a wallet name in three places.
const tabs = [{ href: "/app/wallet", label: "Wallet", icon: Wallet }];

export function AppNav({ mode }: { mode: "desktop" | "mobile" }) {
  const pathname = usePathname();

  if (mode === "desktop") {
    return (
      <nav className="sticky top-6 rounded-[2.5rem] bg-surface p-4 shadow-card-shadow">
        <ul className="flex flex-col gap-3">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <li key={tab.href}>
                <Link href={tab.href} className="relative block">
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={clsx(
                      "relative flex items-center gap-4 rounded-2xl px-5 py-4 text-sm font-bold transition-all duration-300 z-10",
                      active ? "text-surface" : "text-text-card-muted hover:text-brand-white"
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="activeTabDesktop"
                        className="absolute inset-0 z-[-1] rounded-2xl bg-brand-green shadow-glow"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    <Icon size={20} className={active ? "text-surface" : "text-brand-green"} />
                    <span>{tab.label}</span>
                  </motion.div>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav className="fixed inset-x-4 bottom-4 z-50 rounded-[2.5rem] bg-surface p-2 shadow-card-shadow md:hidden">
      <ul className="grid grid-cols-3 gap-2">
        {/* Mobile mappings... keep it minimal string rep */}
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link href={tab.href} className="relative block">
                <motion.div
                  whileTap={{ scale: 0.95 }}
                  className={clsx(
                    "relative flex flex-col items-center justify-center rounded-2xl px-2 py-3 text-[12px] font-bold transition-all duration-300 z-10",
                    active ? "text-surface" : "text-text-card-muted hover:text-brand-white"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="activeTabMobile"
                      className="absolute inset-0 z-[-1] rounded-2xl bg-brand-green shadow-glow"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                  <Icon size={20} className={active ? "text-surface mb-1" : "text-brand-green mb-1"} />
                  <span>{tab.label}</span>
                </motion.div>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
