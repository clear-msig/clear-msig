"use client";

// Settings — minimal retail account screen.
//
// What a non-technical user needs from a settings surface:
//   - Confirmation they're connected, with a copyable identity.
//   - Which network ("Test network" — the preview banner says the
//     same, this is a quieter restatement).
//   - A clear way to sign out.
//
// Everything else (chain switching, RPC URL, intent template editor,
// raw address display) is a power-user concern. Out of scope here.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@/lib/wallet";
import {
  ArrowRight,
  Check,
  Contact,
  Copy,
  ExternalLink,
  Lock,
  LogOut,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";

export default function SettingsPage() {
  const router = useRouter();
  const wallet = useWallet();
  const reduce = useReducedMotion();

  const address = wallet.publicKey?.toBase58() ?? "";
  const short = useMemo(
    () => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : ""),
    [address],
  );

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect();
    } finally {
      router.replace("/");
    }
  };

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header className="text-center">
        <h1 className="font-display text-display-xs leading-tight text-text-strong">
          Settings
        </h1>
        <p className="mt-1 text-base text-text-soft">
          Your account and connection.
        </p>
      </header>

      {/* Connected identity card */}
      <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Your wallet
        </p>

        {address ? (
          <>
            <div className="mt-3 flex items-center gap-3">
              <MemberAvatar address={address} size="lg" />
              <p className="inline-flex items-center gap-2 text-base text-text-strong">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Connected
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Address copied" : "Copy your wallet address"}
              className={
                "group mt-4 flex w-full items-center justify-between gap-3 rounded-card " +
                "border border-border-soft bg-canvas px-4 py-3 " +
                "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              <span className="font-mono text-sm text-text-strong">{short}</span>
              <span
                className={
                  "flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-base ease-out-soft " +
                  (copied
                    ? "text-accent"
                    : "text-text-soft group-hover:text-accent")
                }
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </span>
            </button>
            <p className="mt-2 text-xs text-text-soft">
              Friends use this when they want to send you money outside a
              shared wallet.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-text-soft">
            You&rsquo;re not connected.
          </p>
        )}
      </section>

      {/* Contacts row — your local address book. */}
      <Link
        href="/app/contacts"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Contact className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Contacts</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Names you&rsquo;ve saved for sending money.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      {/* Privacy row — links to the explainer. Status flips
          automatically when Encrypt's network goes live. */}
      <Link
        href="/privacy"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Lock className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Private policies
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Your wallet&rsquo;s rules are encrypted on-chain.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      {/* Network indicator */}
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-strong">Test network</p>
          <p className="mt-0.5 text-xs text-text-soft">
            You&rsquo;re on Solana devnet. Money here isn&rsquo;t real.
          </p>
        </div>
      </section>

      {/* Account actions */}
      <section className="rounded-card border border-border-soft bg-surface-raised p-2 shadow-card-rest">
        <button
          type="button"
          onClick={handleDisconnect}
          className={
            "flex w-full items-center gap-3 rounded-card px-4 py-3 text-left text-sm font-medium text-rose-600 " +
            "transition-colors duration-base ease-out-soft hover:bg-rose-500/5 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </section>

      {/* About row */}
      <Link
        href="/"
        className={
          "group inline-flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-5 py-3 text-sm shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span className="text-text-strong">What is Clear?</span>
        <ArrowRight
          className="h-4 w-4 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </motion.div>
  );
}
