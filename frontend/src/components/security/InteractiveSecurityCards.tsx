"use client";

// Interactive cards for /security. Passkey + Ledger.
//
// These two cards are the only Dynamic-Labs- and LedgerProvider-
// dependent pieces of the /security page. When they lived inline in
// `app/security/page.tsx`, the bundler couldn't tree-shake those
// dependencies out of the page's initial chunk, so /security was
// shipping ~750 kB of Dynamic SDK + Ledger transport that nobody
// downloaded for the marketing copy above. Pulling them into this
// separate "use client" module, combined with importing the module
// via `next/dynamic({ ssr: false, loading: () => null })` in
// page.tsx, moves the Dynamic chunks behind an async boundary that
// only loads after first paint.
//
// First-time visitors who land on /security and scroll past the
// hero / watchlist see the placeholder area; the interactive cards
// hydrate moments later when the lazy chunk lands. Same UX as
// before, just deferred so the marketing content paints fast.

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Usb } from "lucide-react";
import {
  useGetPasskeys,
  useIsLoggedIn,
  useRegisterPasskey,
} from "@dynamic-labs/sdk-react-core";
import EmbeddedDynamicProviderTree from "@/features/wallet-runtime/infrastructure/EmbeddedDynamicProviderTree";
import { useLedger } from "@/lib/wallet/LedgerProvider";
import { useToast } from "@/components/ui/Toast";

export default function InteractiveSecurityCards() {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";
  if (!environmentId) return null;
  return (
    <EmbeddedDynamicProviderTree environmentId={environmentId}>
      <InteractiveSecurityCardsContent />
    </EmbeddedDynamicProviderTree>
  );
}

function InteractiveSecurityCardsContent() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
      <PasskeyCard />
      <LedgerCard />
    </div>
  );
}

function PasskeyCard() {
  const isLoggedIn = useIsLoggedIn();
  const getPasskeys = useGetPasskeys();
  const registerPasskey = useRegisterPasskey();
  const toast = useToast();

  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setPasskeyCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await getPasskeys();
        if (!cancelled) setPasskeyCount(list?.length ?? 0);
      } catch {
        if (!cancelled) setPasskeyCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, getPasskeys, registering]);

  const handleAdd = async () => {
    setRegistering(true);
    try {
      await registerPasskey();
      toast.success("Passkey added. Your wallet is harder to take over now.");
      const list = await getPasskeys().catch(() => null);
      setPasskeyCount(list?.length ?? 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not register a passkey.",
      );
    } finally {
      setRegistering(false);
    }
  };

  const hasPasskey = (passkeyCount ?? 0) > 0;
  const supportsPasskey = passkeyCount !== null;

  return (
    <article className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md sm:p-6">
      <div className="flex items-center justify-between">
        <div
          className={
            "flex h-10 w-10 items-center justify-center rounded-xl ring-1 " +
            (hasPasskey
              ? "bg-[#ccff00]/15 text-[#ccff00] ring-[#ccff00]/30"
              : "bg-[#ccff00]/10 text-[#ccff00] ring-[#ccff00]/20")
          }
        >
          {hasPasskey ? (
            <Check className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <KeyRound className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          )}
        </div>
        {hasPasskey && (
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Active
          </span>
        )}
      </div>
      <h2 className="mt-4 font-display text-lg leading-tight text-white">
        {hasPasskey ? "Passkey added" : "Add a passkey"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        {hasPasskey
          ? "Your account is harder to take over even if your email is compromised. You can manage passkeys from the wallet menu."
          : "Email-only sign-in means an attacker who breaks into your email can take over your wallet. A passkey cuts that path off."}
      </p>
      {!hasPasskey && supportsPasskey && isLoggedIn ? (
        <button
          type="button"
          onClick={handleAdd}
          disabled={registering}
          className={
            "mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black " +
            "transition-colors duration-200 hover:bg-[#ccff00] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c] " +
            "disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {registering ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Adding passkey
            </>
          ) : (
            "Add passkey"
          )}
        </button>
      ) : null}
      {!supportsPasskey && !isLoggedIn ? (
        <p className="mt-4 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/40">
          Sign in to manage passkeys
        </p>
      ) : null}
    </article>
  );
}

function LedgerCard() {
  const ledger = useLedger();
  const toast = useToast();
  const supportsHid =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "hid" in navigator;
  const connected = !!ledger.session;

  const handleConnect = async () => {
    try {
      await ledger.connect();
      toast.success(
        "Ledger connected. Signing routes through your device now.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not connect Ledger",
      );
    }
  };

  return (
    <article className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md sm:p-6">
      <div className="flex items-center justify-between">
        <div
          className={
            "flex h-10 w-10 items-center justify-center rounded-xl ring-1 " +
            (connected
              ? "bg-[#ccff00]/15 text-[#ccff00] ring-[#ccff00]/30"
              : "bg-[#ccff00]/10 text-[#ccff00] ring-[#ccff00]/20")
          }
        >
          {connected ? (
            <Check className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <Usb className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          )}
        </div>
        {connected && (
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Connected
          </span>
        )}
      </div>
      <h2 className="mt-4 font-display text-lg leading-tight text-white">
        {connected
          ? "Ledger connected"
          : "Use a Ledger for the strongest signing"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        {connected
          ? "Every signed action shows the full message on the Ledger screen. Read it before approving."
          : "Software wallets show technical-looking text in the popup. A Ledger renders the full plain message on the device. You read what you sign, on hardware you control."}
      </p>
      {connected ? (
        <button
          type="button"
          onClick={() => ledger.disconnect()}
          className={
            "mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/70 " +
            "transition-colors duration-200 hover:border-white/40 hover:text-white " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
          }
        >
          Disconnect Ledger
        </button>
      ) : supportsHid ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={ledger.connecting}
          className={
            "mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black " +
            "transition-colors duration-200 hover:bg-[#ccff00] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c] " +
            "disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {ledger.connecting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Waiting for your Ledger
            </>
          ) : (
            "Connect Ledger"
          )}
        </button>
      ) : (
        <p className="mt-4 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/40">
          WebHID needed · use Chrome, Edge, or Brave
        </p>
      )}
    </article>
  );
}
