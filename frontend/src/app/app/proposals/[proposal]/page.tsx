"use client";

// Request detail — retail rebuild (locked 2026-04-30).
//
// The page a member opens when they tap "Needs your approval" on the
// dashboard or the wallet detail. Replaces the legacy 5-panel proposal
// console (status hero, action summary, proposal meta, action panel,
// signable preview, approval bitmap) with what a retail user actually
// needs:
//
//   - What's this request? (intent template, friendly label)
//   - Where is it? ("in Roommates", with a link back)
//   - Who created it? ("by you" / "by another member")
//   - Where are we? ("1 of 2 approved" + relative time)
//   - What can I do? (Approve / Decline) — only shown while Active
//
// Power-user surfaces (raw bitmaps, signable preview hex, PDA
// inspection) are intentionally not rendered here.

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { fetchProposal } from "@/lib/chain/proposals";
import { fetchWalletByPda } from "@/lib/chain/wallets";
import {
  parseIntent,
  ProposalStatus,
  type IntentAccount,
  type ProposalAccount,
  type WalletAccount,
} from "@/lib/msig";
import { useProposalSubscription } from "@/lib/hooks/useProposalSubscription";
import { useProposalWorkflow } from "@/lib/hooks/useProposalWorkflow";
import { friendlyError } from "@/lib/api/errors";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { relativeTime } from "@/lib/util/relativeTime";

export default function RequestDetailPage() {
  const params = useParams<{ proposal: string }>();
  const proposalPda = useMemo(() => {
    try {
      return decodeURIComponent(params?.proposal ?? "");
    } catch {
      return params?.proposal ?? "";
    }
  }, [params?.proposal]);

  const { connection } = useConnection();
  const reduce = useReducedMotion();

  // Live updates push the bitmap straight into the proposal cache.
  useProposalSubscription(proposalPda);

  const proposalQuery = useQuery<ProposalAccount | null>({
    queryKey: ["proposal", proposalPda],
    queryFn: async () => {
      try {
        return await fetchProposal(connection, new PublicKey(proposalPda));
      } catch {
        return null;
      }
    },
    enabled: proposalPda.length > 0,
    staleTime: 10_000,
  });

  const proposal = proposalQuery.data ?? null;

  const contextQuery = useQuery<{
    wallet: WalletAccount;
    intent: IntentAccount;
  } | null>({
    queryKey: ["proposal-context", proposal?.wallet, proposal?.intent],
    queryFn: async () => {
      if (!proposal) return null;
      const wallet = await fetchWalletByPda(
        connection,
        new PublicKey(proposal.wallet),
      );
      if (!wallet) return null;
      const info = await connection.getAccountInfo(
        new PublicKey(proposal.intent),
        "confirmed",
      );
      if (!info) return null;
      return { wallet, intent: parseIntent(new Uint8Array(info.data)) };
    },
    enabled: Boolean(proposal),
    staleTime: 30_000,
  });

  const context = contextQuery.data ?? null;

  if (proposalQuery.isLoading || (proposal && contextQuery.isLoading)) {
    return <RequestSkeleton />;
  }
  if (!proposal || !context) {
    return <NotFound />;
  }

  return (
    <Loaded
      proposal={proposal}
      intent={context.intent}
      walletName={context.wallet.name}
      proposalPda={proposalPda}
      reduce={!!reduce}
      onChanged={() => {
        proposalQuery.refetch();
        contextQuery.refetch();
      }}
    />
  );
}

// ─── Loaded view (the real content) ────────────────────────────────

interface LoadedProps {
  proposal: ProposalAccount;
  intent: IntentAccount;
  walletName: string;
  proposalPda: string;
  reduce: boolean;
  onChanged: () => void;
}

function Loaded({
  proposal,
  intent,
  walletName,
  proposalPda,
  reduce,
  onChanged,
}: LoadedProps) {
  const wallet = useWallet();
  const toast = useToast();
  const workflow = useProposalWorkflow(walletName, proposalPda);

  const approverCount = intent.approvers.length;
  const approvalsCollected = countBits(proposal.approvalBitmap);
  const isActive = proposal.status === ProposalStatus.Active;

  const myAddress = wallet.publicKey?.toBase58() ?? "";
  const isApprover = myAddress.length > 0 && intent.approvers.includes(myAddress);
  const isProposer = myAddress.length > 0 && proposal.proposer === myAddress;

  const myApproverIndex = intent.approvers.indexOf(myAddress);
  const alreadyApproved =
    myApproverIndex >= 0 &&
    (proposal.approvalBitmap & (1 << myApproverIndex)) !== 0;

  const proposerLabel = proposerName(proposal.proposer, myAddress);
  const intentLabel = friendlyIntentLabel(intent.template);
  const statusLabel = friendlyStatus(proposal.status);
  const createdAgo = relativeTime(Number(proposal.proposedAt) * 1000);

  const handleApprove = async () => {
    try {
      await workflow.approveMutation.mutateAsync();
      toast.success("Approved");
      onChanged();
    } catch (err) {
      surfaceWriteError(err, toast, "approve");
    }
  };

  const handleDecline = async () => {
    try {
      await workflow.cancelMutation.mutateAsync();
      toast.success("Declined");
      onChanged();
    } catch (err) {
      surfaceWriteError(err, toast, "decline");
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const isWorking =
    workflow.approveMutation.isPending || workflow.cancelMutation.isPending;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}`}
        className={
          "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {walletName}
      </Link>

      {/* Hero */}
      <section className="flex flex-col items-center rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8">
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] " +
            statusChipClasses(proposal.status)
          }
        >
          {proposal.status === ProposalStatus.Active && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          )}
          {statusLabel}
        </span>

        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          {intentLabel}
        </h1>
        <p className="mt-2 text-base text-text-soft">
          in <span className="font-medium text-text-strong">{walletName}</span>{" "}
          · created {createdAgo} {proposerLabel && `· ${proposerLabel}`}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <ApprovalProgress
            collected={approvalsCollected}
            total={approverCount}
          />
          <p className="text-sm font-medium text-text-strong">
            {approvalsCollected} of {approverCount} approved
          </p>
        </div>
      </section>

      {/* Actions — only while Active */}
      {isActive && isApprover && !alreadyApproved && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            fullWidth
            onClick={handleApprove}
            disabled={isWorking}
          >
            {workflow.approveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Approving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" aria-hidden="true" />
                Approve
              </>
            )}
          </Button>
          <Button
            size="lg"
            variant="ghost"
            fullWidth
            onClick={handleDecline}
            disabled={isWorking}
          >
            {workflow.cancelMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Declining…
              </>
            ) : (
              <>
                <X className="h-4 w-4" aria-hidden="true" />
                Decline
              </>
            )}
          </Button>
        </div>
      )}

      {isActive && isApprover && alreadyApproved && (
        <InfoCard
          title="You've approved this"
          body={`Waiting on ${approverCount - approvalsCollected} more friend${
            approverCount - approvalsCollected === 1 ? "" : "s"
          } to approve.`}
        />
      )}

      {isActive && !isApprover && !isProposer && (
        <InfoCard
          title="You're watching this request"
          body="Only the friends listed on this wallet can approve."
        />
      )}

      {!isActive && (
        <InfoCard
          title={`This request is ${statusLabel.toLowerCase()}`}
          body={
            proposal.status === ProposalStatus.Executed
              ? "The money has been sent."
              : proposal.status === ProposalStatus.Approved
                ? "Enough friends have approved. It's about to send."
                : "No further action is needed."
          }
        />
      )}
    </motion.div>
  );
}

// ─── Bits & pieces ─────────────────────────────────────────────────

function ApprovalProgress({
  collected,
  total,
}: {
  collected: number;
  total: number;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-valuenow={collected}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${collected} of ${total} approved`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            "h-2 w-6 rounded-full transition-colors duration-base ease-out-soft " +
            (i < collected ? "bg-accent" : "bg-border-soft")
          }
        />
      ))}
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <p className="font-display text-base text-text-strong">{title}</p>
      <p className="mt-1 text-sm text-text-soft">{body}</p>
    </div>
  );
}

function RequestSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="-ml-2 h-7 w-24 animate-pulse rounded bg-border-soft" />
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 shadow-card-rest">
        <div className="h-5 w-28 animate-pulse rounded-full bg-border-soft" />
        <div className="mt-3 h-9 w-2/3 animate-pulse rounded bg-border-soft" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-border-soft" />
        <div className="mt-5 h-2 w-32 animate-pulse rounded-full bg-border-soft" />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/app/wallet"
        className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft hover:text-text-strong"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Wallets
      </Link>
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
        <h1 className="font-display text-display-xs text-text-strong">
          We couldn&rsquo;t find that request
        </h1>
        <p className="mt-2 max-w-md text-text-soft">
          It may have already been completed, declined, or you may not be a
          member of the wallet it belongs to.
        </p>
        <Link href="/app/wallet" className="mt-6 inline-block">
          <Button size="md">Back to wallets</Button>
        </Link>
      </div>
    </div>
  );
}

function surfaceWriteError(
  err: unknown,
  toast: ReturnType<typeof useToast>,
  action: "approve" | "decline",
) {
  console.error(`[request-${action}]`, err);
  const fe = friendlyError(err, action);
  toast.error(fe.title, { details: fe.body });
}

function statusChipClasses(s: ProposalStatus): string {
  switch (s) {
    case ProposalStatus.Active:
      return "border-warning/30 bg-warning/10 text-warning";
    case ProposalStatus.Approved:
      return "border-accent/30 bg-accent/10 text-accent";
    case ProposalStatus.Executed:
      return "border-success/30 bg-success/10 text-success";
    case ProposalStatus.Cancelled:
      return "border-border-soft bg-canvas text-text-soft";
    default:
      return "border-border-soft bg-canvas text-text-soft";
  }
}

function countBits(n: number): number {
  let count = 0;
  let v = n >>> 0;
  while (v) {
    count += v & 1;
    v >>>= 1;
  }
  return count;
}

// "by you" if connected user is the proposer; otherwise "by another
// member" — until a contacts/names layer exists, we don't render
// addresses on screen per the retail rules.
function proposerName(proposer: string, me: string): string {
  if (!proposer) return "";
  if (me && proposer === me) return "by you";
  return "by another member";
}
