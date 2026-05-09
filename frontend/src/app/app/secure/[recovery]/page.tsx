"use client";

// /app/secure/[recovery] — vault detail.
//
// Read-only view of a single Recovery account: threshold, members,
// proposal counters, dwallet handle. Members are rendered as a
// stack of avatar+short rows; the discriminator byte at index 0 of
// each MemberSlot tells us how to interpret the rest (1 = solana
// address, 2 = secp256k1, 3 = secp256r1 / passkey, 4 = ed25519
// public key, 5 = webauthn).
//
// Two action cards at the bottom: Add device (passkey enrollment,
// stubbed for v3) and Sweep (move funds out, stubbed for v3). The
// stubs explain what the action does and link to ikavery.com when
// the user wants to try it through the upstream demo.

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import {
  SCHEME_SOLANA_ADDRESS,
  SCHEME_ED25519,
  SCHEME_SECP256K1,
  SCHEME_SECP256R1,
  SCHEME_WEBAUTHN,
} from "@/lib/ikavery/constants";

const IKAVERY_LIVE = "https://solana.ikavery.com";

export default function SecureRecoveryPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SecureRecoveryPage />
    </Suspense>
  );
}

function SecureRecoveryPage() {
  const params = useParams<{ recovery: string }>();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();

  const recoveryStr = useMemo(() => {
    const raw = params?.recovery ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.recovery]);

  const recoveryPk = useMemo(() => {
    try {
      return new PublicKey(recoveryStr);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const vaultQuery = useQuery({
    queryKey: ["ikavery-vault", recoveryStr],
    queryFn: () => {
      if (!recoveryPk) throw new Error("Invalid recovery address");
      return fetchVault(connection, recoveryPk);
    },
    enabled: !!recoveryPk,
    staleTime: 30_000,
  });

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  if (!recoveryPk) {
    return (
      <div className="flex flex-col gap-6">
        <div className="px-gutter md:hidden">
          <BackToWallets label="Wallets" />
        </div>
        <div className="px-gutter">
          <Link
            href="/app/secure"
            className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to Secure
          </Link>
        </div>
        <p className="text-sm text-text-soft">Invalid vault address.</p>
      </div>
    );
  }

  const vault = vaultQuery.data;
  const recoveryShort = `${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`;

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      <div className="px-gutter">
        <Link
          href="/app/secure"
          className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to Secure
        </Link>
      </div>

      <PageEyebrow label="Vault · powered by Ika" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
          Vault {recoveryShort}
        </h1>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <CopyAddressPill address={recoveryStr} />
          <a
            href={`https://explorer.solana.com/address/${recoveryStr}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className={
              "inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
          >
            Explorer
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </PageEyebrow>

      {vaultQuery.isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Reading vault state…
        </div>
      )}

      {vaultQuery.isError && (
        <div className="rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
          <p className="font-medium text-text-strong">
            Couldn&rsquo;t load this vault.
          </p>
          <p className="mt-1">
            {String(vaultQuery.error instanceof Error ? vaultQuery.error.message : vaultQuery.error)}
          </p>
        </div>
      )}

      {vault && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Threshold"
              value={`${vault.account.threshold} of ${vault.account.members.length}`}
            />
            <Stat
              label="Sweeps proposed"
              value={String(vault.account.proposalCount)}
            />
            <Stat
              label="Roster changes"
              value={String(vault.account.rosterChangeCount)}
            />
          </section>

          <section>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Members · {vault.account.members.length}
            </p>
            <ul className="flex flex-col gap-2">
              {vault.account.members.map((slot, i) => (
                <MemberRow
                  key={i}
                  index={i}
                  slot={slot}
                  isUser={
                    !!wallet.publicKey &&
                    slot[0] === SCHEME_SOLANA_ADDRESS &&
                    pubkeyMatchesSlot(wallet.publicKey, slot)
                  }
                />
              ))}
            </ul>
          </section>

          {/* Action cards — Add device + Sweep, both stubbed.
              Each links to solana.ikavery.com so the user can try
              the action upstream while the in-app flow is being
              built. The card design mirrors the empty-state CTA on
              /app/secure: accent rule + caps eyebrow + headline +
              detail + outbound link. */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionStub
              Icon={Fingerprint}
              eyebrow="// 04 · device"
              title="Add a device"
              body="Enroll a passkey from your phone, laptop, or YubiKey to expand the quorum. Coming in v3."
            />
            <ActionStub
              Icon={KeyRound}
              eyebrow="// 05 · sweep"
              title="Sweep funds"
              body="Move funds out of the vault to a destination wallet, signed by your threshold. Coming in v3."
            />
          </section>

          <motion.aside
            {...fadeIn(0.20)}
            className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft sm:p-5"
          >
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-warning"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="leading-snug">
              <span className="font-medium text-text-strong">Pre-alpha.</span>{" "}
              The dWallet handle is a v2 placeholder. Real DKG against the Ika
              pre-alpha network lands when device enrollment ships, alongside
              the in-app sweep flow. Until then, sweeps work upstream at{" "}
              <a
                href={IKAVERY_LIVE}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-hover"
              >
                solana.ikavery.com
              </a>
              .
            </p>
          </motion.aside>
        </>
      )}
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 font-numerals text-xl font-semibold text-text-strong tabular-nums">
        {value}
      </p>
    </div>
  );
}

interface MemberRowProps {
  index: number;
  slot: Uint8Array;
  isUser: boolean;
}

function MemberRow({ index, slot, isUser }: MemberRowProps) {
  const scheme = slot[0] ?? 0;
  let label = "Unknown";
  let address = "";

  if (scheme === SCHEME_SOLANA_ADDRESS) {
    address = new PublicKey(slot.slice(1, 33)).toBase58();
    label = "Solana wallet";
  } else if (scheme === SCHEME_ED25519) {
    address = bytesToHexShort(slot.slice(1, 33));
    label = "ed25519 key";
  } else if (scheme === SCHEME_SECP256K1) {
    address = bytesToHexShort(slot.slice(1, 34));
    label = "secp256k1 key";
  } else if (scheme === SCHEME_SECP256R1) {
    address = bytesToHexShort(slot.slice(1, 34));
    label = "Passkey (secp256r1)";
  } else if (scheme === SCHEME_WEBAUTHN) {
    address = bytesToHexShort(slot.slice(1, 17));
    label = "WebAuthn passkey";
  }

  const short = address
    ? address.length > 16
      ? `${address.slice(0, 4)}…${address.slice(-4)}`
      : address
    : `slot ${index}`;

  const canCopy = !!address;
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — silent */
    }
  };
  return (
    <li
      className={
        "flex items-center gap-3 rounded-card border bg-surface-raised p-3 shadow-card-rest " +
        (isUser ? "border-accent/40" : "border-border-soft")
      }
    >
      <MemberAvatar address={address || `slot-${index}`} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="font-display text-sm font-semibold text-text-strong">
            {short}
          </span>
          {isUser && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              You
            </span>
          )}
        </span>
        <span className="text-[11px] text-text-soft">
          {label} · slot{" "}
          <span className="font-numerals tabular-nums">{index}</span>
        </span>
      </span>
      {canCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          title={`Copy ${address}`}
          className={
            "inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-soft text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
}

function ActionStub({
  Icon,
  eyebrow,
  title,
  body,
}: {
  Icon: typeof Fingerprint;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={IKAVERY_LIVE}
      target="_blank"
      rel="noreferrer"
      className={
        "group flex flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest opacity-90 " +
        "transition-[border-color,opacity,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/40 hover:opacity-100 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
        {eyebrow}
      </p>
      <h3 className="mt-1 font-display text-base font-semibold text-text-strong">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-text-soft text-pretty">{body}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
        Try upstream
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </span>
    </a>
  );
}

function pubkeyMatchesSlot(pk: PublicKey, slot: Uint8Array): boolean {
  if (slot[0] !== SCHEME_SOLANA_ADDRESS) return false;
  if (slot.length < 33) return false;
  const bytes = pk.toBytes();
  for (let i = 0; i < 32; i++) if (bytes[i] !== slot[1 + i]) return false;
  return true;
}

function CopyAddressPill({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — silent */
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${address}`}
      className={
        "mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 font-mono text-[11px] text-text-soft " +
        "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-accent" aria-hidden="true" />
          <span className="text-accent">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden="true" />
          {`${address.slice(0, 8)}…${address.slice(-8)}`}
        </>
      )}
    </button>
  );
}

function bytesToHexShort(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return s;
}

