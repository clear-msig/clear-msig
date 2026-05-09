"use client";

// /security - plain-language security posture, dressed in the
// marketing chrome (LandingNav + LandingAtmospherics) so /, /privacy,
// /security and /welcome all read as one product surface.
//
// The full attack-surface walkthrough lives in SECURITY.md at the
// project root. This page is the human-readable subset: what we
// protect, what users should do, what's still rough.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  ShieldCheck,
  Usb,
} from "lucide-react";
import {
  useGetPasskeys,
  useIsLoggedIn,
  useRegisterPasskey,
} from "@dynamic-labs/sdk-react-core";
import {
  LandingAtmospherics,
  LandingNav,
} from "@/components/landing/LandingChrome";
import { useLedger } from "@/lib/wallet/LedgerProvider";
import { useToast } from "@/components/ui/Toast";

export default function SecurityPage() {
  const reduce = useReducedMotion();
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.5,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <LandingAtmospherics />
      </div>

      <LandingNav />

      <main className="relative mx-auto w-full max-w-[1100px] px-5 pb-24 pt-6 sm:px-10 sm:pb-32">
        {/* ─── Hero ────────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0)}
          className="border-b border-white/[0.08] pb-12 sm:pb-16"
        >
          <div className="flex items-center gap-2">
            <span className="lime-dot h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_4px_rgba(204,255,0,0.4)]" />
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
              Security · how Clear protects you
            </span>
          </div>

          <h1 className="mt-6 text-[clamp(2.25rem,7vw,5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white sm:mt-8">
            Keeping your wallet
            <br />
            <span className="italic-skew">safe</span>.
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-base">
            What we protect, what to watch for, and what to turn on. Pre-alpha,
            so this page is a contract, not a polished marketing claim. The
            full model is in{" "}
            <a
              href="https://github.com/clear-msig/clear-msig/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-[#ccff00]"
            >
              SECURITY.md
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </p>
        </motion.section>

        {/* ─── Watchlist ──────────────────────────────────── */}
        <motion.section {...fadeIn(0.05)} className="mt-12 sm:mt-16">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/50">
            Watchlist · the basics
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            <InfoCard
              Icon={Globe}
              title="Always sign in here"
              body="Bookmark the address bar. Look-alike sites can mint a real wallet under someone else's control while you think you're signing into Clear. If anything in the URL looks off, close the tab."
            />
            <InfoCard
              Icon={ShieldCheck}
              title="Read the destination before signing"
              body="Every send shows the recipient's short address right above the wallet popup. If that address looks wrong, cancel. Contacts can be edited on this device — the address is the truth, the name is the convenience."
            />
          </div>
        </motion.section>

        {/* ─── Account hardening ──────────────────────────── */}
        <motion.section {...fadeIn(0.1)} className="mt-12 sm:mt-16">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/50">
            Harden your account
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            <PasskeyCard />
            <LedgerCard />
          </div>
        </motion.section>

        {/* ─── Pre-alpha disclosure ───────────────────────── */}
        <motion.aside
          {...fadeIn(0.15)}
          className="mt-12 flex items-start gap-3 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md sm:p-6"
        >
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Pre-alpha
          </span>
          <p className="text-sm leading-relaxed text-white/60">
            Some encryption protections in the UI ride on the Encrypt network
            going live. Until then, they show a pre-alpha chip. Read the full
            attack model and current gaps in{" "}
            <a
              href="https://github.com/clear-msig/clear-msig/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-white underline decoration-white/30 underline-offset-4 hover:decoration-[#ccff00]"
            >
              SECURITY.md
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </p>
        </motion.aside>

        {/* ─── CTA ────────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0.2)}
          className="mt-16 flex flex-col items-start gap-4 sm:mt-20 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-sm text-white/60">
            Ready to set up a shared wallet? Defaults are safe you can layer
            on a passkey or Ledger from inside the app any time.
          </p>
          <Link
            href="/welcome"
            className="neon-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-bold tracking-tight"
          >
            Launch app
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </motion.section>
      </main>
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────

function InfoCard({
  Icon,
  title,
  body,
}: {
  Icon: typeof Globe;
  title: string;
  body: string;
}) {
  return (
    <article className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md transition-colors duration-300 hover:border-white/[0.16] sm:p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/20">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-display text-lg leading-tight text-white">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
    </article>
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
