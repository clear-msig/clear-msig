"use client";

// /security — plain-language security posture for retail users.
//
// The full attack-surface walkthrough lives in SECURITY.md at the
// project root. This page is the human-readable subset: what we
// protect, what users should do, what's still rough. Linked from
// settings so the answer to "is this safe?" has a destination.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  ShieldCheck,
  KeyRound,
  Globe,
  Check,
  Loader2,
  Usb,
} from "lucide-react";
import {
  useIsLoggedIn,
  useGetPasskeys,
  useRegisterPasskey,
} from "@dynamic-labs/sdk-react-core";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { useToast } from "@/components/ui/Toast";
import { useLedger } from "@/lib/wallet/LedgerProvider";

export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Link
          href="/app/settings"
          className={
            "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Settings
        </Link>
      </StickyTopBar>

      <header className="text-center">
        <h1 className="font-display text-display-xs leading-tight text-text-strong">
          Keeping your wallet safe
        </h1>
        <p className="mt-1 text-base text-text-soft">
          What we protect, what to watch for.
        </p>
      </header>

      <section className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Globe className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-strong">
            Always sign in here
          </p>
          <p className="mt-1 text-xs text-text-soft">
            Bookmark the address bar. Look-alike sites can mint a real
            wallet under someone else&rsquo;s control while you think
            you&rsquo;re signing into Clear. If anything in the URL
            looks off, close the tab.
          </p>
        </div>
      </section>

      <PasskeyCard />

      <LedgerCard />

      <section className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-strong">
            Always read the destination before signing
          </p>
          <p className="mt-1 text-xs text-text-soft">
            Every send shows the recipient&rsquo;s short address right
            above the wallet popup. If that address looks wrong, cancel.
            Contacts can be edited on this device, so the address is
            the truth, the name is the convenience.
          </p>
        </div>
      </section>

      <p className="rounded-card border border-border-soft bg-surface-raised p-4 text-xs text-text-soft">
        Pre-alpha. Some encryption protections in the UI ride on the
        Encrypt network going live. Until then, they show a pre-alpha
        chip. The full security model is documented at
        {" "}
        <a
          href="https://github.com/clear-msig/clear-msig/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-text-strong underline decoration-border-soft hover:decoration-accent"
        >
          SECURITY.md
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        .
      </p>
    </div>
  );
}

function LedgerCard() {
  const ledger = useLedger();
  const toast = useToast();
  const supportsHid =
    typeof window !== "undefined" && typeof navigator !== "undefined" && "hid" in navigator;
  const connected = !!ledger.session;

  const handleConnect = async () => {
    try {
      await ledger.connect();
      toast.success("Ledger connected. Signing routes through your device now.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not connect Ledger",
      );
    }
  };

  return (
    <section className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
          (connected ? "bg-accent/15 text-accent" : "bg-accent/10 text-accent")
        }
      >
        {connected ? (
          <Check className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Usb className="h-5 w-5" strokeWidth={1.75} />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-text-strong">
          {connected
            ? "Ledger connected"
            : "Use a Ledger for the strongest signing"}
        </p>
        <p className="mt-1 text-xs text-text-soft">
          {connected
            ? "Every signed action shows the full message on the Ledger screen. Read it before approving."
            : "Software wallets show technical-looking text in the popup. A Ledger renders the full plain message on the device. You read what you sign, on hardware you control."}
        </p>
        {connected ? (
          <button
            type="button"
            onClick={() => ledger.disconnect()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Disconnect Ledger
          </button>
        ) : supportsHid ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={ledger.connecting}
            className={
              "mt-3 inline-flex items-center gap-2 rounded-soft bg-accent px-4 py-2 text-sm font-medium text-text-on-accent " +
              "shadow-accent-rest transition-[transform,box-shadow] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:shadow-accent-raised " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
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
          <p className="mt-2 text-xs text-text-soft">
            Hardware wallets need WebHID. Open this page in Chrome,
            Edge, or Brave to use a Ledger.
          </p>
        )}
      </div>
    </section>
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
        // Dynamic returns errors for accounts that don't have a
        // passkey-eligible wallet (e.g. external connectors). Treat
        // any read failure as "not applicable" so the prose nudge
        // still renders.
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
      const message =
        err instanceof Error ? err.message : "Could not register a passkey.";
      toast.error(message);
    } finally {
      setRegistering(false);
    }
  };

  const hasPasskey = (passkeyCount ?? 0) > 0;
  const supportsPasskey = passkeyCount !== null;

  return (
    <section className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
          (hasPasskey ? "bg-accent/15 text-accent" : "bg-accent/10 text-accent")
        }
      >
        {hasPasskey ? (
          <Check className="h-5 w-5" strokeWidth={2} />
        ) : (
          <KeyRound className="h-5 w-5" strokeWidth={1.75} />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-text-strong">
          {hasPasskey ? "Passkey added" : "Add a passkey"}
        </p>
        <p className="mt-1 text-xs text-text-soft">
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
              "mt-3 inline-flex items-center gap-2 rounded-soft bg-accent px-4 py-2 text-sm font-medium text-text-on-accent " +
              "shadow-accent-rest transition-[transform,box-shadow] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:shadow-accent-raised " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
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
          <p className="mt-2 text-xs text-text-soft">
            Sign in to manage passkeys for your account.
          </p>
        ) : null}
      </div>
    </section>
  );
}
