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
// Action cards at the bottom: Add device, Sweep, and threshold lock
// down. The detail cards explain what each action does and where the
// upstream demo still differs from this product.

import { Suspense, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { QRCodeSVG } from "qrcode.react";
import {
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
  Users,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { UsdHint } from "@/components/retail/UsdHint";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import {
  downloadAttestationBackup,
  importAttestationBackup,
  loadAttestation,
} from "@/lib/ikavery/clearmsig-attestations";
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
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-gutter">
        <p className="text-sm text-text-soft">Invalid vault address.</p>
      </div>
    );
  }

  const vault = vaultQuery.data;
  const recoveryShort = `${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`;
  const attestation = loadAttestation(recoveryStr);

  const handleDownloadBackup = () => {
    if (!attestation) {
      setBackupError("No attestation is cached on this device yet.");
      return;
    }
    downloadAttestationBackup(recoveryStr, attestation);
    setBackupMessage("Backup downloaded.");
    setBackupError(null);
  };

  const handleImportBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !recoveryPk) return;
    try {
      const text = await file.text();
      await importAttestationBackup(connection, recoveryPk, text);
      setBackupMessage("Backup imported.");
      setBackupError(null);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : String(err));
      setBackupMessage(null);
    }
  };

  return (
    <motion.div
      {...fadeIn(0)}
      className="mx-auto flex w-full max-w-3xl flex-col gap-8"
    >
      {/* Page hero - mono eyebrow + display title + chips row.
          Mirrors the Account / Secure / Wizard headers so the
          workspace reads as one product surface. The Header bar's
          back button handles back-navigation; no inline back link
          here. */}
      <header className="px-gutter">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Secure vault
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong">
          Vault {recoveryShort}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
      </header>

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
              two actions they're going to take from this page ,
              Receive and Sweep.
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
              accent
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

          {/* Members card - header strip + ordered roster. Wrapping
              the list in a single bordered card with a divide-y body
              reads as a refined spec sheet rather than scattered rows. */}
          <section className="overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
            <header className="flex items-center justify-between border-b border-border-soft px-5 py-3 sm:px-6">
              <span className="inline-flex items-center gap-2">
                <Users
                  className="h-3.5 w-3.5 text-text-soft"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
                  Members
                </span>
              </span>
              <span className="font-numerals text-[11px] font-semibold tabular-nums text-text-strong">
                {vault.account.members.length}
              </span>
            </header>
            <ul className="divide-y divide-border-soft">
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
              chain. Empty-state noise on a brand-new vault adds
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

          {/* Action cards - Add device + Sweep. Eyebrow uses the
              clean "Action · device" style instead of the casual
              `// 04 ·` slash form so the card reads as a real
              product affordance. */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionCard
              href={`/app/secure/${encodeURIComponent(recoveryStr)}/enroll`}
              Icon={Fingerprint}
              eyebrow="Action · device"
              title="Add a passkey"
              body="Enroll a Touch ID, Face ID, or security key on this device. One signature, on-chain in seconds."
              cta="Enroll"
            />
            <ActionCard
              href={`/app/secure/${encodeURIComponent(recoveryStr)}/sweep`}
              Icon={KeyRound}
              eyebrow="Action · sweep"
              title="Sweep funds"
              body="Move funds from this recovery vault to a wallet you choose."
              cta="Open"
            />
            {/* Threshold bump. The page now drives the roster-change
                flow directly so users can lock a vault to a higher
                quorum from here. */}
            {vault.account.members.length > 1 &&
              vault.account.threshold >= 1 && (
                <ActionCard
                  href={`/app/secure/${encodeURIComponent(recoveryStr)}/threshold`}
                  Icon={Lock}
                  eyebrow="Action · protection"
                  title="Lock down"
                  body={`Require ${vault.account.threshold} of ${vault.account.members.length} approvals today. Adjust it when you want stronger protection.`}
                  cta="Open"
                />
              )}
          </section>

          <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
                  Recovery backup
                </p>
                <p className="mt-1 text-sm text-text-soft">
                  Save a backup so this vault can be restored on another device.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download backup
                </button>
                <label className="inline-flex min-h-tap cursor-pointer items-center gap-2 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  Import backup
                  <input
                    type="file"
                    aria-label="Import vault backup"
                    accept="application/json"
                    className="hidden"
                    onChange={handleImportBackup}
                  />
                </label>
              </div>
            </div>
            {(backupMessage || backupError) && (
              <p
                className={
                  "mt-3 text-xs " +
                  (backupError ? "text-warning" : "text-accent")
                }
              >
                {backupError ?? backupMessage}
              </p>
            )}
          </section>

          {/* Testnet details stay available without interrupting the vault. */}
          <motion.aside
            {...fadeIn(0.2)}
            className="rounded-card border border-border-soft bg-surface-raised/60 p-4 text-xs text-text-soft sm:p-5"
          >
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-text-soft transition-colors hover:text-text-strong">
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-warning"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Details
              </summary>
              <p className="mt-2 pl-6 leading-relaxed">
                This vault is for testing. Use test funds only. More details
                are available at{" "}
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
            </details>
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
      /* clipboard blocked. Silent */
    }
  };

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      <div className="flex flex-wrap items-end justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Vault balance
          </p>
          <p className="font-mono text-[11px] text-text-soft">
            {`${address.slice(0, 4)}…${address.slice(-4)}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <p className="flex items-baseline gap-1.5 font-numerals text-2xl font-semibold tabular-nums text-text-strong">
            {loading ? "…" : balanceSol != null ? balanceSol : ","}
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
          {balanceLamports != null && balanceLamports > 0 && (
            <UsdHint
              amount={BigInt(Math.round(balanceLamports))}
              smallestPerWhole={1_000_000_000n}
              ticker="SOL"
              variant="plain"
              className="font-numerals text-[11px] tabular-nums text-text-soft"
            />
          )}
        </div>
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
            Receive SOL
          </p>
          <div className="rounded-soft bg-white p-3 shadow-card-rest">
            <QRCodeSVG
              value={address}
              size={168}
              level="M"
              marginSize={0}
              aria-label="QR code for the vault address"
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
            Test funds only.
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

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-card border bg-surface-raised p-5 shadow-card-rest " +
        (accent ? "border-accent/40" : "border-border-soft")
      }
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
        {label}
      </p>
      <p
        className={
          "mt-2 font-numerals text-2xl font-semibold tabular-nums " +
          (accent ? "text-accent" : "text-text-strong")
        }
      >
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
        "flex items-center gap-3 px-5 py-3 sm:px-6 " +
        (isUser ? "bg-accent/[0.03]" : "")
      }
    >
      <MemberAvatar address={address || `slot-${index}`} size="md" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex items-center gap-2">
          <span className="truncate font-display text-[14px] font-semibold tracking-[-0.01em] text-text-strong">
            {short}
          </span>
          {isUser && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
              You
            </span>
          )}
        </span>
        <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-soft">
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
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-soft bg-canvas text-text-soft " +
            "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
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
        "group flex flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6 " +
        "transition-[border-color,box-shadow,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-text-soft">
        {eyebrow}
      </p>
      <h3 className="mt-1.5 font-display text-base font-semibold tracking-[-0.01em] text-text-strong">
        {title}
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft text-pretty">
        {body}
      </p>
      <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
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
        "inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 font-mono text-[11px] text-text-soft " +
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
