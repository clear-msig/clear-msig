"use client";

// Sign-in security - opens Dynamic's user-profile modal so embedded
// wallet users can enroll passkeys, change email, or revoke devices
// without us baking that flow ourselves.
//
// External wallets (Phantom / Solflare / Backpack / Ledger) carry
// their own auth - Dynamic isn't where their passkey lives. We tell
// users that explicitly so the row doesn't read as "passkey
// unavailable" when actually they already have a hardware-grade
// signer.

import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

export function SignInSecurityRow() {
  const { setShowDynamicUserProfile, user, primaryWallet } = useDynamicContext();
  // Same duck-type the rest of the codebase uses (lib/wallet/index.ts).
  // `key` carries the connector identifier at runtime; embedded
  // variants are "dynamicwaas" / "turnkey", external is everything else.
  const c = (primaryWallet as unknown as {
    connector?: { key?: string; name?: string; overrideKey?: string };
  })?.connector;
  const id = (c?.key ?? c?.overrideKey ?? c?.name ?? "").toLowerCase();
  const isEmbedded = /dynamicwaas|turnkey/.test(id);
  const isExternal = !!primaryWallet && !isEmbedded;
  const hasDynamicAccount = !!user;

  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">
          Sign-in security
        </p>
        <p className="mt-0.5 text-xs text-text-soft">
          {isExternal
            ? "Connected via an external wallet - passkey / hardware-key auth is managed by that wallet, not Clear."
            : hasDynamicAccount
              ? "Manage passkey, email, and device list. Passkey beats email-link sign-in for both speed and security."
              : "Connect first; sign-in options become available after."}
        </p>
      </div>
      {!isExternal && hasDynamicAccount && (
        <button
          type="button"
          onClick={() => setShowDynamicUserProfile(true)}
          className={clsx(
            "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent",
            "transition-[background-color,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          Manage
        </button>
      )}
    </section>
  );
}
