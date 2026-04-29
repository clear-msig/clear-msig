"use client";

// Proposal detail deep-link . /app/proposals/<pda>.
//
// Every proposal has a copyable URL so signers can share a single link
// that lands them directly on the "approve / cancel / execute" view.
// The page:
//   - Reads the PDA from the route params.
//   - Fetches the proposal, parent intent, and wallet directly from
//     Solana RPC.
//   - Subscribes to the proposal account via `onAccountChange`, so the
//     ApprovalBitmap animates in real time when co-signers sign.
//   - Renders a human-readable summary of the action, the exact signed
//     bytes, and the appropriate action panel for the current status.
//
// All write paths (approve / cancel / execute) funnel through the same
// /prepare → wallet.signMessage → /submit rails as the rest of Phase 5.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Hash,
  Loader2,
  PlayCircle,
  Share2,
  ShieldAlert,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ApprovalBitmap } from "@/components/proposals/ApprovalBitmap";
import { SignablePreview } from "@/components/proposals/SignablePreview";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useProposalSubscription } from "@/lib/hooks/useProposalSubscription";
import { useSignWithWallet, WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { backendApi, executeProposalStreamUrl } from "@/lib/api/endpoints";
import { fetchProposal } from "@/lib/chain/proposals";
import { fetchWalletByPda } from "@/lib/chain/wallets";
import {
  buildSignableMessage,
  fromHex,
  IntentType,
  parseIntent,
  ProposalStatus,
  renderTemplateToString,
  toHex,
  type IntentAccount,
  type ProposalAccount,
  type WalletAccount,
} from "@/lib/msig";
import { appConfig } from "@/lib/config";

export default function ProposalDetailPage() {
  const params = useParams<{ proposal: string }>();
  const proposalPda = decodeURIComponent(params.proposal ?? "");
  const { connection } = useConnection();

  useProposalSubscription(proposalPda);

  const proposalQuery = useQuery<ProposalAccount | null>({
    queryKey: ["proposal", proposalPda],
    queryFn: async () => {
      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(proposalPda);
      } catch {
        return null;
      }
      return fetchProposal(connection, pubkey);
    },
    enabled: isValidPubkey(proposalPda),
    staleTime: 10_000,
  });

  const proposal = proposalQuery.data ?? null;

  // Fetch the parent wallet + intent once we know the proposal.
  const contextQuery = useQuery<{ wallet: WalletAccount; intent: IntentAccount } | null>({
    queryKey: ["proposal-context", proposal?.wallet, proposal?.intent],
    queryFn: async () => {
      if (!proposal) return null;
      const walletPk = new PublicKey(proposal.wallet);
      const wallet = await fetchWalletByPda(connection, walletPk);
      if (!wallet) return null;
      // The intent PDA can be derived from the intent field; just fetch it directly.
      const info = await connection.getAccountInfo(new PublicKey(proposal.intent), "confirmed");
      if (!info) return null;
      return { wallet, intent: parseIntent(new Uint8Array(info.data)) };
    },
    enabled: Boolean(proposal),
    staleTime: 30_000,
  });

  const context = contextQuery.data ?? null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      <Breadcrumb proposalPda={proposalPda} />

      {proposalQuery.isLoading || contextQuery.isLoading ? (
        <LoadingSkeleton />
      ) : !proposal ? (
        <NotFoundState proposalPda={proposalPda} />
      ) : (
        <Loaded
          proposal={proposal}
          intent={context?.intent ?? null}
          wallet={context?.wallet ?? null}
          proposalPda={proposalPda}
          onRefresh={() => {
            proposalQuery.refetch();
            contextQuery.refetch();
          }}
        />
      )}
    </motion.section>
  );
}

// ── breadcrumb + empty / loading states ──────────────────────────────

function Breadcrumb({ proposalPda }: { proposalPda: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <Link
        href="/app/proposals"
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-semibold uppercase tracking-wide text-white/70 transition-colors hover:border-brand-green/40 hover:text-brand-green"
      >
        <ArrowLeft size={12} /> Proposals
      </Link>
      <span className="text-white/30">/</span>
      <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] text-white/70">
        {shortPda(proposalPda)}
      </span>
      <ShareProposalButton proposalPda={proposalPda} />
    </div>
  );
}

/// "Copy share link" button. Real treasury teams operate by sharing
/// proposal URLs in Slack/Telegram, so the multisig UX needs first-class
/// shareability. Click → copies the canonical /app/proposals/<pda> URL
/// for the current host.
function ShareProposalButton({ proposalPda }: { proposalPda: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      const url = `${window.location.origin}/app/proposals/${encodeURIComponent(proposalPda)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (private mode etc.) — silent noop */
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-green/15 px-3 py-1 text-[11px] font-semibold text-brand-green transition-colors hover:bg-brand-green/25"
      aria-label={copied ? "Share link copied" : "Copy share link"}
    >
      {copied ? (
        <>
          <Check size={11} /> copied
        </>
      ) : (
        <>
          <Share2 size={11} /> share
        </>
      )}
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Skeleton tone="dark" className="h-[420px] w-full rounded-3xl" />
      <Skeleton tone="dark" className="h-[420px] w-full rounded-3xl" />
    </div>
  );
}

function NotFoundState({ proposalPda }: { proposalPda: string }) {
  return (
    <EmptyState
      title="Proposal not found"
      description={
        proposalPda
          ? `No account on-chain at ${shortPda(proposalPda)}. It may have been cleaned up.`
          : "The proposal address in the URL looks empty."
      }
      action={{ label: "Back to proposals", href: "/app/proposals" }}
    />
  );
}

// ── loaded view ──────────────────────────────────────────────────────

function Loaded({
  proposal,
  intent,
  wallet,
  proposalPda,
  onRefresh,
}: {
  proposal: ProposalAccount;
  intent: IntentAccount | null;
  wallet: WalletAccount | null;
  proposalPda: string;
  onRefresh: () => void;
}) {
  const renderedAction = useMemo(() => {
    if (!intent) return null;
    try {
      return renderTemplateToString(
        { params: intent.params, bytePool: intent.bytePool, template: intent.template },
        proposal.paramsData
      );
    } catch (err) {
      return `(decode error: ${err instanceof Error ? err.message : String(err)})`;
    }
  }, [intent, proposal.paramsData]);

  const signablePreview = useMemo(() => {
    if (!intent || !wallet) return null;
    try {
      const built = buildSignableMessage({
        action: "approve",
        expiry: Math.floor(Date.now() / 1000) + 300,
        walletName: wallet.name,
        proposalIndex: proposal.proposalIndex,
        intent: {
          intentType: intent.intentType as IntentType,
          template: intent.template,
          params: intent.params,
          bytePool: intent.bytePool,
        },
        paramsData: proposal.paramsData,
      });
      return { body: built.bodyText, hex: toHex(built.wrapped) };
    } catch (err) {
      return { body: `(preview error: ${err instanceof Error ? err.message : String(err)})`, hex: "" };
    }
  }, [intent, wallet, proposal.paramsData, proposal.proposalIndex]);

  const status = proposal.status;

  return (
    <div className="flex flex-col gap-4">
      <StatusHero proposal={proposal} intent={intent} renderedAction={renderedAction} proposalPda={proposalPda} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Main column. */}
        <div className="flex flex-col gap-4">
          <ActionSummary
            proposal={proposal}
            intent={intent}
            renderedAction={renderedAction}
          />
          <SignablePreview
            bodyText={signablePreview?.body ?? null}
            messageHex={signablePreview?.hex ?? null}
            context={{
              action: "approve",
              wallet: wallet?.name,
              chain: intent ? chainKindLabel(intent.chainKind) : undefined,
              threshold: intent
                ? {
                    current: popcount(proposal.approvalBitmap),
                    total: intent.approvers.length,
                  }
                : undefined,
            }}
            statusChip={
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                approve action
              </span>
            }
          />
          <ProposalMeta proposal={proposal} wallet={wallet} proposalPda={proposalPda} />
        </div>

        {/* Sidebar. */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            {intent ? (
              <ApprovalBitmap
                approvers={intent.approvers}
                approvalBitmap={proposal.approvalBitmap}
                cancellationBitmap={proposal.cancellationBitmap}
                threshold={intent.approvalThreshold}
                proposer={proposal.proposer}
              />
            ) : (
              <p className="text-xs text-text-muted">
                Waiting for intent metadata…
              </p>
            )}
          </div>

          {wallet && (
            <ActionPanel
              proposal={proposal}
              walletName={wallet.name}
              proposalPda={proposalPda}
              status={status}
              onRefresh={onRefresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── status hero ──────────────────────────────────────────────────────

function StatusHero({
  proposal,
  intent,
  renderedAction,
  proposalPda,
}: {
  proposal: ProposalAccount;
  intent: IntentAccount | null;
  renderedAction: string | null;
  proposalPda: string;
}) {
  const chip = statusChip(proposal.status);
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-6 ${chip.surfaceClass}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 opacity-60 blur-3xl ${chip.glowClass}`}
      />
      <div className="relative z-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/60">
            Proposal #{proposal.proposalIndex.toString(10)}
            <CopyButton text={proposalPda} />
          </div>
          <h1 className="mt-1 text-xl font-bold text-brand-white sm:text-2xl">
            {renderedAction ?? "Loading action…"}
          </h1>
          {intent && (
            <p className="mt-1 text-xs text-white/50">
              Against intent #{intent.intentIndex} · chain{" "}
              <span className="font-mono">{chainKindLabel(intent.chainKind)}</span>
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${chip.pillClass}`}
        >
          <chip.Icon size={12} />
          {chip.label}
        </span>
      </div>
    </div>
  );
}

function statusChip(status: ProposalStatus): {
  label: string;
  Icon: typeof Check;
  surfaceClass: string;
  glowClass: string;
  pillClass: string;
} {
  switch (status) {
    case ProposalStatus.Active:
      return {
        label: "Active",
        Icon: Clock,
        surfaceClass: "border-amber-400/30 bg-amber-400/5",
        glowClass: "bg-amber-400/15",
        pillClass: "border-amber-400/30 bg-amber-400/15 text-amber-300",
      };
    case ProposalStatus.Approved:
      return {
        label: "Approved",
        Icon: BadgeCheck,
        surfaceClass: "border-brand-green/30 bg-brand-green/5",
        glowClass: "bg-brand-green/20",
        pillClass: "border-brand-green/30 bg-brand-green/15 text-brand-green",
      };
    case ProposalStatus.Executed:
      return {
        label: "Executed",
        Icon: CheckCircle2,
        surfaceClass: "border-sky-400/30 bg-sky-400/5",
        glowClass: "bg-sky-400/15",
        pillClass: "border-sky-400/30 bg-sky-400/15 text-sky-300",
      };
    case ProposalStatus.Cancelled:
      return {
        label: "Cancelled",
        Icon: X,
        surfaceClass: "border-rose-400/30 bg-rose-400/5",
        glowClass: "bg-rose-400/15",
        pillClass: "border-rose-400/30 bg-rose-400/15 text-rose-300",
      };
    default:
      return {
        label: "Unknown",
        Icon: ShieldAlert,
        surfaceClass: "border-white/10 bg-white/[0.02]",
        glowClass: "bg-white/5",
        pillClass: "border-white/10 bg-white/5 text-white/50",
      };
  }
}

// ── body pieces ──────────────────────────────────────────────────────

function ActionSummary({
  proposal,
  intent,
  renderedAction,
}: {
  proposal: ProposalAccount;
  intent: IntentAccount | null;
  renderedAction: string | null;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-brand-green">
        What's being proposed
      </div>
      <p className="mt-2 font-mono text-sm leading-relaxed text-white/90">
        {renderedAction ?? "·"}
      </p>
      {intent && (
        <div className="mt-4 grid gap-3 text-xs text-white/70 sm:grid-cols-3">
          <Labelled label="Template">
            <span className="font-mono text-white/80">{intent.template}</span>
          </Labelled>
          <Labelled label="Chain">
            <span className="font-mono">{chainKindLabel(intent.chainKind)}</span>
          </Labelled>
          <Labelled label="Params bytes">
            <span className="font-mono">{proposal.paramsData.length}</span>
          </Labelled>
        </div>
      )}
    </div>
  );
}

function ProposalMeta({
  proposal,
  wallet,
  proposalPda,
}: {
  proposal: ProposalAccount;
  wallet: WalletAccount | null;
  proposalPda: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
        Metadata
      </div>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <MetaRow
          icon={Wallet}
          label="Wallet"
          value={wallet ? `${wallet.name} (#${proposal.proposalIndex.toString(10)})` : "loading…"}
        />
        <MetaRow
          icon={Hash}
          label="Proposer"
          value={shortPda(proposal.proposer)}
          copyable={proposal.proposer}
        />
        <MetaRow
          icon={Clock}
          label="Proposed"
          value={formatUnixTime(proposal.proposedAt)}
        />
        <MetaRow
          icon={BadgeCheck}
          label="Approved"
          value={proposal.approvedAt > 0n ? formatUnixTime(proposal.approvedAt) : "·"}
        />
        <MetaRow
          icon={Hash}
          label="Proposal PDA"
          value={shortPda(proposalPda)}
          copyable={proposalPda}
        />
        <MetaRow
          icon={Hash}
          label="Intent PDA"
          value={shortPda(proposal.intent)}
          copyable={proposal.intent}
        />
      </div>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
  copyable,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
  copyable?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={12} className="mt-0.5 text-text-muted" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="flex items-center gap-1 truncate font-mono text-xs text-white/80">
          {value}
          {copyable && <CopyButton text={copyable} />}
        </span>
      </div>
    </div>
  );
}

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

// ── action panel ─────────────────────────────────────────────────────

function ActionPanel({
  walletName,
  proposalPda,
  status,
  onRefresh,
}: {
  proposal: ProposalAccount;
  walletName: string;
  proposalPda: string;
  status: ProposalStatus;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const { signBytes, canSign } = useSignWithWallet();
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);

  const doVote = async (kind: "approve" | "cancel") => {
    try {
      setBusy(kind);
      const prepare =
        kind === "approve"
          ? await backendApi.prepare.approveProposal(walletName, proposalPda, {})
          : await backendApi.prepare.cancelProposal(walletName, proposalPda, {});
      const { signer_pubkey, signature } = await signBytes(
        fromHex(prepare.message_hex)
      );
      const res =
        kind === "approve"
          ? await backendApi.submit.approveProposal(walletName, proposalPda, {
              signer_pubkey,
              signature,
              expiry: prepare.expiry,
            })
          : await backendApi.submit.cancelProposal(walletName, proposalPda, {
              signer_pubkey,
              signature,
              expiry: prepare.expiry,
            });
      toast.success(
        kind === "approve" ? "Approval signed" : "Cancellation signed",
        { link: explorerLink(res) }
      );
      onRefresh();
    } catch (err) {
      if (err instanceof WalletSignError) {
        toast.error(
          err.code === "rejected" ? "Wallet rejected the signature" : err.message
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : "Submit failed",
          { details: describeError(err) }
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const [executing, setExecuting] = useState(false);
  const [execLog, setExecLog] = useState<string[]>([]);
  const [execError, setExecError] = useState<string | null>(null);

  const startExecute = () => {
    const url = executeProposalStreamUrl(walletName, proposalPda, {
      dwallet_program: appConfig.preAlpha.dwalletProgramId,
      grpc_url: appConfig.preAlpha.grpcUrl,
      rpc_url: appConfig.preAlpha.solanaRpcUrl,
      broadcast: true,
    });
    setExecuting(true);
    setExecLog([]);
    setExecError(null);
    const src = new EventSource(url);
    src.addEventListener("progress", (ev) => {
      try {
        const data = (ev as MessageEvent).data as string;
        setExecLog((prev) => [...prev, data.trim()]);
      } catch {
        /* noop */
      }
    });
    src.addEventListener("done", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data as string);
        toast.success("Proposal executed", {
          link: explorerLink(data),
          details: "The backend relayed the Ika MPC signatures on-chain.",
        });
      } catch {
        toast.success("Proposal executed");
      }
      src.close();
      setExecuting(false);
      onRefresh();
    });
    src.addEventListener("error", (ev) => {
      const data = (ev as MessageEvent).data;
      setExecError(typeof data === "string" ? data : "Stream closed unexpectedly");
      toast.error("Execution failed", {
        details: typeof data === "string" ? data : undefined,
      });
      src.close();
      setExecuting(false);
    });
  };

  const cleanup = async () => {
    try {
      await backendApi.cleanupProposal(proposalPda);
      toast.success("Proposal cleaned up", {
        details: "Rent refunded to the proposer.",
      });
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cleanup failed", {
        details: describeError(err),
      });
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
        Actions
      </div>

      {status === ProposalStatus.Active && (
        <div className="flex flex-col gap-2">
          <ActionButton
            onClick={() => doVote("approve")}
            disabled={busy !== null || !canSign}
            busy={busy === "approve"}
            tone="green"
            Icon={Check}
          >
            Sign approval
          </ActionButton>
          <ActionButton
            onClick={() => doVote("cancel")}
            disabled={busy !== null || !canSign}
            busy={busy === "cancel"}
            tone="amber"
            Icon={X}
          >
            Sign cancel
          </ActionButton>
          {!canSign && (
            <p className="text-xs text-text-muted">
              Connect a wallet that supports signMessage.
            </p>
          )}
        </div>
      )}

      {status === ProposalStatus.Approved && (
        <div className="flex flex-col gap-2">
          <ActionButton
            onClick={startExecute}
            disabled={executing}
            busy={executing}
            tone="green"
            Icon={PlayCircle}
          >
            Execute via Ika MPC
          </ActionButton>
          <p className="text-xs text-text-muted">
            The relayer streams Ika MPC progress back to this panel.
          </p>
        </div>
      )}

      {(status === ProposalStatus.Executed || status === ProposalStatus.Cancelled) && (
        <ActionButton
          onClick={cleanup}
          disabled={false}
          busy={false}
          tone="neutral"
          Icon={Trash2}
        >
          Clean up + refund rent
        </ActionButton>
      )}

      <AnimatePresence>
        {(executing || execLog.length > 0 || execError) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden rounded-xl border border-brand-green/20 bg-black/70"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-brand-green">
              <span className="inline-flex items-center gap-1.5">
                {executing ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                MPC execution stream
              </span>
              {!executing && (
                <button
                  onClick={() => setExecLog([])}
                  className="text-white/40 hover:text-white/70"
                >
                  clear
                </button>
              )}
            </div>
            <pre className="max-h-48 overflow-auto px-3 py-2 text-[11px] leading-snug text-white/70">
              {execLog.join("\n") || (executing ? "waiting for first event…" : "·")}
              {execError && (
                <span className="block pt-2 text-rose-300">{execError}</span>
              )}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  busy,
  tone,
  Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  tone: "green" | "amber" | "neutral";
  Icon: typeof Check;
}) {
  const toneClass = {
    green:
      "bg-brand-green text-black shadow-glow hover:bg-emerald-300 hover:shadow-glow-hover",
    amber:
      "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/25",
    neutral:
      "bg-white/5 text-white/80 ring-1 ring-white/10 hover:bg-white/10 hover:text-white",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {children}
    </button>
  );
}

// ── tiny utilities ───────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      /* noop */
    }
  };
  return (
    <button
      onClick={onCopy}
      aria-label="Copy"
      className="rounded-full p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
    >
      {copied ? <CheckCircle2 size={11} className="text-brand-green" /> : <Copy size={11} />}
    </button>
  );
}

function isValidPubkey(s: string): boolean {
  if (!s || s.length < 32) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

function shortPda(s: string): string {
  if (!s) return "·";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function chainKindLabel(k: number): string {
  switch (k) {
    case 0:
      return "solana";
    case 1:
      return "evm_1559";
    case 2:
      return "bitcoin_p2wpkh";
    case 3:
      return "zcash";
    case 4:
      return "evm_1559_erc20";
    default:
      return `chain_${k}`;
  }
}

function formatUnixTime(unix: bigint): string {
  if (unix <= 0n) return "·";
  const ms = Number(unix) * 1000;
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function explorerLink(
  res: Record<string, unknown>
): { label: string; href: string } | undefined {
  const txid = res.txid as string | undefined;
  if (!txid) return undefined;
  return {
    label: `tx ${txid.slice(0, 8)}…`,
    href: `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
  };
}

function describeError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { payload?: Record<string, unknown> };
  if (!e.payload) return undefined;
  try {
    return JSON.stringify(e.payload, null, 2);
  } catch {
    return undefined;
  }
}

/// Local popcount for the approval/cancellation bitmaps. Mirrors the
/// helper in ApprovalBitmap.tsx; kept inline to avoid tightly coupling
/// this page to that component's internals.
function popcount(n: number): number {
  let v = n >>> 0;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

