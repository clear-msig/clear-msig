"use client";

// /app/secure/[recovery] - vault detail.
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
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";
import { listProposals, type ProposalEntry } from "@/lib/ikavery/proposals";
import {
  STATUS_ACTIVE,
  STATUS_APPROVED,
  STATUS_EXECUTED,
} from "@/lib/ikavery/constants";
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

  // dWallet pubkey lives in the locally-saved DKG attestation. The
  // balance is what users sweep from; surfacing it inline saves a
  // hop into Solana Explorer to know "do I actually have anything
  // to move".
  const dwalletPubkey = useMemo(() => {
    if (!recoveryStr) return null;
    const att = loadAttestation(recoveryStr);
    if (!att) return null;
    try {
      return new PublicKey(att.publicKey);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const dwalletBalance = useQuery({
    queryKey: ["ikavery-dwallet-balance", dwalletPubkey?.toBase58() ?? "none"],
    queryFn: async () => {
      if (!dwalletPubkey) return null;
      return connection.getBalance(dwalletPubkey, "confirmed");
    },
    enabled: !!dwalletPubkey,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // Recent sweeps. We list every Proposal PDA derived from the Recovery's
  // proposalCount, batch-fetch via getMultipleAccountsInfo, and render
  // newest-first. Refetches when a sweep finishes (proposalCount goes up
  // → React Query sees a new query key from the vault refetch).
  const proposalCount = vaultQuery.data?.account.proposalCount ?? 0;
  const proposalsQuery = useQuery({
    queryKey: ["ikavery-proposals", recoveryStr, proposalCount],
    queryFn: () => {
      if (!recoveryPk) return Promise.resolve([]);
      return listProposals(connection, recoveryPk, proposalCount);
    },
    enabled: !!recoveryPk && proposalCount > 0,
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
          {/* Balance card + actions. The one number a user will check
              on every visit ("do I have anything to sweep?") plus the
              two actions they're going to take from this page —
              Receive (fund the dWallet) and Sweep (move funds out).
              The receive QR is collapsed by default so the page
              doesn't feel front-loaded. */}
          {dwalletPubkey && (
            <BalancePanel
              dwallet={dwalletPubkey}
              balanceLamports={
                typeof dwalletBalance.data === "number"
                  ? dwalletBalance.data
                  : null
              }
              loading={dwalletBalance.isLoading}
              onRefresh={() => void dwalletBalance.refetch()}
              refreshing={dwalletBalance.isFetching && !dwalletBalance.isLoading}
              recoveryStr={recoveryStr}
            />
          )}

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

          {/* Recent sweeps. Hidden when there are zero proposals on
              chain — empty-state noise on a brand-new vault adds
              nothing. Shows up to 5 newest, with a status pill. */}
          {proposalCount > 0 && (
            <section>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Recent sweeps · {proposalCount}
              </p>
              {proposalsQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-text-soft">
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Reading sweep history…
                </div>
              )}
              {proposalsQuery.data && proposalsQuery.data.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {proposalsQuery.data.slice(0, 5).map((p) => (
                    <ProposalRow key={p.proposal.toBase58()} entry={p} />
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Action cards - Add device wired in v3b, Sweep wired in
              v3c (propose only; execute defers to upstream until the
              Ika dWallet on-chain coordinator binding lands). The
              card design mirrors the empty-state CTA on /app/secure:
              accent rule + caps eyebrow + headline + detail. */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionCard
              href={`/app/secure/${encodeURIComponent(recoveryStr)}/enroll`}
              Icon={Fingerprint}
              eyebrow="// 04 · device"
              title="Add a passkey"
              body="Enroll a Touch ID, Face ID, or security key on this device. One signature, on-chain in seconds."
              cta="Enroll"
            />
            <ActionCard
              href={`/app/secure/${encodeURIComponent(recoveryStr)}/sweep`}
              Icon={KeyRound}
              eyebrow="// 05 · sweep"
              title="Sweep funds"
              body="Authorise a transfer of funds from the dWallet to a destination wallet, signed by your threshold."
              cta="Open"
            />
            {/* Threshold-bump card. Disabled at v3l-fix1: the
                deployed ikavery program at 6kdyWi8… predates the
                staging-PDA pattern (`stage_roster_change_payload`,
                disc 10), so any roster-change attempt fails with
                `InvalidInstructionData` at simulation time.
                Confirmed by inspecting the deployed ELF — only
                execute_roster_change.rs ships, no
                stage_roster_change.rs. The action layer
                (clearmsig-roster.ts) and the threshold page stay
                intact so the feature relights as soon as upstream
                redeploys. */}
            {vault.account.members.length > 1 &&
              vault.account.threshold === 1 && (
                <DisabledActionCard
                  Icon={Lock}
                  eyebrow="// 06 · roster"
                  title="Lock down"
                  body={`Today any 1 of ${vault.account.members.length} can sign. Bumping the threshold needs an upstream program redeploy — coming soon.`}
                  cta="Awaiting redeploy"
                />
              )}
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
              The dWallet was minted by Ika&rsquo;s pre-alpha network and lives
              on-chain. Device enrollment and in-app sweep are the next pieces
              landing; until then, sweeps work upstream at{" "}
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

interface BalancePanelProps {
  dwallet: PublicKey;
  balanceLamports: number | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  recoveryStr: string;
}

function BalancePanel({
  dwallet,
  balanceLamports,
  loading,
  refreshing,
  onRefresh,
  recoveryStr,
}: BalancePanelProps) {
  const [showReceive, setShowReceive] = useState(false);
  const [copied, setCopied] = useState(false);
  const address = dwallet.toBase58();
  const balanceSol =
    balanceLamports != null
      ? (balanceLamports / 1e9).toFixed(4)
      : null;

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
    <section className="rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      <div className="flex flex-wrap items-end justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            dWallet balance
          </p>
          <p className="font-mono text-[11px] text-text-soft">
            {`${address.slice(0, 4)}…${address.slice(-4)}`}
          </p>
        </div>
        <p className="flex items-baseline gap-1.5 font-numerals text-2xl font-semibold tabular-nums text-text-strong">
          {loading ? "…" : balanceSol != null ? balanceSol : "—"}
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            SOL
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            aria-label="Refresh balance"
            title="Refresh balance"
            className={
              "ml-1 inline-flex h-7 w-7 items-center justify-center rounded-soft text-text-soft " +
              "transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong " +
              "disabled:cursor-not-allowed disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            }
          >
            <RefreshCw
              className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")}
              aria-hidden="true"
            />
          </button>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden border-t border-border-soft bg-border-soft">
        <button
          type="button"
          onClick={() => setShowReceive((v) => !v)}
          aria-expanded={showReceive}
          className={
            "group flex min-h-tap items-center justify-center gap-2 bg-surface-raised px-4 py-3 text-sm font-medium text-text-strong " +
            "transition-colors duration-base ease-out-soft hover:bg-canvas " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          }
        >
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {showReceive ? "Hide" : "Receive"}
        </button>
        <Link
          href={`/app/secure/${encodeURIComponent(recoveryStr)}/sweep`}
          className={
            "group flex min-h-tap items-center justify-center gap-2 bg-surface-raised px-4 py-3 text-sm font-medium text-accent " +
            "transition-colors duration-base ease-out-soft hover:bg-accent/[0.06] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          }
        >
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Sweep
        </Link>
      </div>

      {showReceive && (
        <div className="flex flex-col items-center gap-3 border-t border-border-soft p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Send SOL here to fund the vault
          </p>
          <div className="rounded-soft bg-white p-3 shadow-card-rest">
            <QRCodeSVG
              value={address}
              size={168}
              level="M"
              marginSize={0}
              aria-label={`QR code for the dWallet address`}
            />
          </div>
          <p className="break-all rounded-soft border border-border-soft bg-canvas px-3 py-2 text-center font-mono text-[11px] leading-relaxed text-text-strong">
            {address}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className={
              "inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                Copy address
              </>
            )}
          </button>
          <p className="text-center text-[11px] text-text-soft">
            Devnet only · funds sent here will only sweep with this vault&rsquo;s
            roster
          </p>
        </div>
      )}
    </section>
  );
}

function ProposalRow({ entry }: { entry: ProposalEntry }) {
  const { account } = entry;
  let label = "Active";
  let pillCls = "border-border-soft bg-canvas text-text-soft";
  if (account.status === STATUS_EXECUTED) {
    label = "Executed";
    pillCls = "border-accent/40 bg-accent/[0.06] text-accent";
  } else if (account.status === STATUS_APPROVED) {
    label = "Approved";
    pillCls = "border-accent/30 bg-accent/[0.04] text-accent";
  } else if (account.status === STATUS_ACTIVE) {
    label = "Active";
    pillCls = "border-warning/40 bg-warning/[0.06] text-warning";
  }
  const proposalShort = `${entry.proposal.toBase58().slice(0, 4)}…${entry.proposal
    .toBase58()
    .slice(-4)}`;
  return (
    <li>
      <a
        href={`https://explorer.solana.com/address/${entry.proposal.toBase58()}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest " +
          "transition-[border-color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/40 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span className="font-numerals text-sm font-semibold tabular-nums text-text-strong">
          #{account.proposalIndex}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[11px] text-text-strong">
            {proposalShort}
          </span>
          <span className="text-[10px] text-text-soft">
            {account.intentDigests.length} tx ·{" "}
            <span className="font-numerals tabular-nums">
              {account.approvalCount}
            </span>{" "}
            approval{account.approvalCount === 1 ? "" : "s"}
          </span>
        </span>
        <span
          className={
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            pillCls
          }
        >
          {label}
        </span>
        <ExternalLink
          className="h-3.5 w-3.5 shrink-0 text-text-soft transition-colors group-hover:text-accent"
          aria-hidden="true"
        />
      </a>
    </li>
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
      /* clipboard blocked - silent */
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

function ActionCard({
  href,
  Icon,
  eyebrow,
  title,
  body,
  cta,
}: {
  href: string;
  Icon: typeof Fingerprint;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
        "transition-[border-color,box-shadow,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised " +
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
        {cta}
        <ArrowRight
          className="h-3 w-3 transition-transform duration-base ease-out-soft group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function DisabledActionCard({
  Icon,
  eyebrow,
  title,
  body,
  cta,
}: {
  Icon: typeof Fingerprint;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <div
      className={
        "flex flex-col rounded-card border border-dashed border-border-soft bg-surface-raised/60 p-5 " +
        "opacity-80"
      }
      aria-disabled="true"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-text-soft/10 text-text-soft">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
        {eyebrow}
      </p>
      <h3 className="mt-1 font-display text-base font-semibold text-text-soft">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-text-soft text-pretty">{body}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-soft">
        {cta}
      </span>
    </div>
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
      /* clipboard blocked - silent */
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

