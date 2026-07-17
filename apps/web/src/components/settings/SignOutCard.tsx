"use client";

// Sign-out card - shared by the Account page (where it's the leaf
// destructive action) and historically by the legacy combined
// Settings page. Resting state stays neutral; the rose tint emerges
// only on hover/focus so the card never shouts at rest.
//
// Logout flow:
//   1. Dynamic SDK handleLogOut() (terminates the auth session)
//   2. Ledger disconnect (if a hardware session is active)
//   3. queryClient.clear() (purges every cached wallet/intent/balance
//      so no stale member data survives in memory)
//   4. window.location.replace("/") - HARD navigation, NOT a client
//      router push. The hard nav guarantees no React state, no
//      framer-motion animations, no in-flight queries can outlive
//      the logout. Safer than router.replace for a security boundary.

import { useMemo } from "react";
import clsx from "clsx";
import { ArrowRight, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet";

export function SignOutCard() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const address = wallet.publicKey?.toBase58() ?? "";
  const short = useMemo(
    () => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : ""),
    [address],
  );

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect();
    } catch {
      /* swallow - we still want to redirect even if disconnect throws */
    }
    // Purge react-query cache so the next session never sees the
    // previous user's wallets / balances / intents. Sensitive data
    // (saved contacts, app-lock PIN, theme preference, etc.) lives
    // in localStorage and is per-device, not per-account, so we
    // intentionally don't wipe those.
    queryClient.clear();
    // Hard nav (not router.replace) so React state, framer-motion
    // animations, and any in-flight subscriptions can't outlive
    // the logout. The browser does a full page load on /, which
    // boots the app fresh.
    if (typeof window !== "undefined") {
      window.location.replace("/");
    }
  };

  return (
    <section
      className={clsx(
        "rounded-card border border-border-soft bg-surface-raised shadow-card-rest",
        "transition-colors duration-base ease-out-soft hover:border-rose-500/30",
      )}
    >
      <button
        type="button"
        onClick={handleDisconnect}
        className={clsx(
          "group flex w-full items-center justify-between gap-3 rounded-card px-5 py-3.5 text-left",
          "transition-colors duration-base ease-out-soft hover:bg-rose-500/[0.05]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-inset",
        )}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 transition-colors duration-base ease-out-soft group-hover:bg-rose-500/15">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text-strong">
              Sign out
            </span>
            {short ? (
              <span className="font-mono text-[11px] text-text-soft">
                {short}
              </span>
            ) : null}
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-rose-500"
          aria-hidden="true"
        />
      </button>
    </section>
  );
}
