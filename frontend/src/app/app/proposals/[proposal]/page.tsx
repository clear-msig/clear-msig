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

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  useConnection,
  useWallet,
} from "@/lib/wallet";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Link2,
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
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import { useContacts } from "@/lib/hooks/useContacts";
import { appConfig } from "@/lib/config";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { avatarInitials } from "@/lib/retail/avatar";

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
  const queryClient = useQueryClient();
  const workflow = useProposalWorkflow(walletName, proposalPda);
  const walletDisplay = toDisplayName(walletName);

  const approverCount = intent.approvers.length;
  // The number that actually matters: how many approvals does the
  // program need to flip the proposal to Approved? Without this we
  // were rendering "1 of 3" when threshold = 2, making people think
  // they were 2 approvals away when they were really only 1 away.
  const approvalThreshold = intent.approvalThreshold;
  const approvalsCollected = countBits(proposal.approvalBitmap);
  const approvalsRemaining = Math.max(
    0,
    approvalThreshold - approvalsCollected,
  );
  const isActive = proposal.status === ProposalStatus.Active;

  const myAddress = wallet.publicKey?.toBase58() ?? "";
  const isApprover = myAddress.length > 0 && intent.approvers.includes(myAddress);
  const isProposer = myAddress.length > 0 && proposal.proposer === myAddress;

  const myApproverIndex = intent.approvers.indexOf(myAddress);
  const alreadyApproved =
    myApproverIndex >= 0 &&
    (proposal.approvalBitmap & (1 << myApproverIndex)) !== 0;

  // Local-first nickname lookup. When a viewer has saved a contact
  // for a member, prefer that name in the proposer line + the
  // approvers breakdown below. Without this, every multi-member
  // proposal reads as "by another member" and the breakdown is just
  // a wall of base58 prefixes.
  const { contacts } = useContacts();
  const contactByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contacts) map.set(c.address, c.name);
    return map;
  }, [contacts]);

  const proposerLabel = proposerName(
    proposal.proposer,
    myAddress,
    contactByAddress,
  );
  const intentLabel = friendlyIntentLabel(intent.template);
  const statusLabel = friendlyStatus(proposal.status);
  const createdAgo = relativeTime(proposal.proposedAt);

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

  // Execute-now retry. The send pages call execute inline on the
  // happy path, but if their execute step blew up (or the user
  // closed the tab between Approved and Executed) the proposal
  // sits in Approved state with no money having actually moved.
  // chain_kind=0 routes through the program's `execute_custom`
  // CPI (no extra options); kinds 1–4 are Ika-driven and need the
  // dWallet/gRPC/RPC config so the backend can sign+broadcast.
  const isIkaChain = intent.chainKind !== 0;
  const handleExecute = async () => {
    try {
      await workflow.executeMutation.mutateAsync(
        isIkaChain
          ? {
              broadcast: true,
              dwallet_program: appConfig.preAlpha.dwalletProgramId,
              grpc_url: appConfig.preAlpha.grpcUrl,
              rpc_url: appConfig.preAlpha.destinationRpcUrl,
            }
          : {},
      );
      toast.success("Sent");
      // Refresh wallet balances so the dashboard reflects the
      // post-execute state on next mount. Multiple keys for the
      // same vault balance — invalidate all of them.
      queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-vault-balance-lamports"],
      });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-eth-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-erc20-balance"],
      });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      onChanged();
    } catch (err) {
      console.error("[request-execute]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
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
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <StickyTopBar offset="header">
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}`}
          className={
            "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {walletDisplay}
        </Link>
      </StickyTopBar>

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
          in <span className="font-medium text-text-strong">{walletDisplay}</span>{" "}
          · created {createdAgo} {proposerLabel && `· ${proposerLabel}`}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <ApprovalProgress
            collected={Math.min(approvalsCollected, approvalThreshold)}
            total={approvalThreshold}
          />
          <p className="text-sm font-medium text-text-strong">
            {approvalsCollected} of {approvalThreshold} approved
          </p>
        </div>
        {approverCount > approvalThreshold && (
          <p className="mt-1 text-xs text-text-soft">
            {approverCount} approvers eligible · {approvalThreshold}{" "}
            approval{approvalThreshold === 1 ? "" : "s"} required
          </p>
        )}
        <div className="mt-5">
          <ShareProposalButton />
        </div>
      </section>

      <ApproversBreakdown
        approvers={intent.approvers}
        approvalBitmap={proposal.approvalBitmap}
        myAddress={myAddress}
        contactByAddress={contactByAddress}
      />

      {/* Actions: only while Active */}
      {isActive && isApprover && !alreadyApproved && (
        <div className="flex flex-col gap-3">
          <SignPayloadPreview
            action={`Approve: ${intentLabel}`}
            details={[
              { label: "In wallet", value: walletDisplay },
              {
                label: "Approvals so far",
                value: `${approvalsCollected} of ${approvalThreshold}`,
              },
              {
                label: "Created",
                value: createdAgo,
              },
              {
                label: "Your role",
                value: isProposer ? "Proposer + approver" : "Approver",
              },
            ]}
          />
          <WalletPopupNarration action="approve this request" />
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
        </div>
      )}

      {isActive && isApprover && alreadyApproved && (
        <InfoCard
          title="You've approved this"
          body={
            approvalsRemaining === 0
              ? "Threshold reached — about to send."
              : `Waiting on ${approvalsRemaining} more approval${
                  approvalsRemaining === 1 ? "" : "s"
                }.`
          }
        />
      )}

      {isActive && !isApprover && !isProposer && (
        <InfoCard
          title="You're watching this request"
          body="Only the friends listed on this wallet can approve."
        />
      )}

      {!isActive && proposal.status !== ProposalStatus.Approved && (
        <InfoCard
          title={`This request is ${statusLabel.toLowerCase()}`}
          body={
            proposal.status === ProposalStatus.Executed
              ? "The money has been sent."
              : "No further action is needed."
          }
        />
      )}

      {/* Approved but not yet Executed — typical when the inline
          execute step on the send page failed (or the user closed
          the tab between approve and execute). Any approver can
          push the button to retry the broadcast. */}
      {proposal.status === ProposalStatus.Approved && (
        <div className="flex flex-col gap-3">
          <InfoCard
            title="Ready to send"
            body={
              isApprover
                ? "Threshold reached. Tap below to broadcast the request and finish the send."
                : "Threshold reached. Any approver on this wallet can finish the send."
            }
          />
          {isApprover && (
            <Button
              size="lg"
              fullWidth
              onClick={handleExecute}
              disabled={workflow.executeMutation.isPending}
            >
              {workflow.executeMutation.isPending ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Sending…
                </>
              ) : (
                <>
                  Send now
                  <ArrowLeft
                    className="h-4 w-4 rotate-180"
                    aria-hidden="true"
                  />
                </>
              )}
            </Button>
          )}
        </div>
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

// Copy-link affordance. The proposal PDA is the slug, so the URL
// is stable and shareable — paste it in the wallet's group chat
// and members land on this page logged in to their own wallet.
// Shows a transient "Copied" state on success and falls back to
// the document.execCommand path for browsers (or contexts like
// HTTP localhost) where the Clipboard API is unavailable.
function ShareProposalButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow — surfaced as no-state-change to the user */
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-text-soft " +
        "transition-[border-color,color,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      }
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
          Link copied
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Copy link to share
        </>
      )}
    </button>
  );
}

// Per-approver status row. Multisig collaboration UX — when a
// member shares a proposal link in a group chat, the recipient
// can see at a glance who's already approved and who's blocking.
// Each row shows avatar + name + an Approved / Waiting pill.
function ApproversBreakdown({
  approvers,
  approvalBitmap,
  myAddress,
  contactByAddress,
}: {
  approvers: string[];
  approvalBitmap: number;
  myAddress: string;
  contactByAddress: Map<string, string>;
}) {
  if (approvers.length === 0) return null;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        Approvers
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {approvers.map((address, i) => {
          const approved = (approvalBitmap & (1 << i)) !== 0;
          const isYou = !!myAddress && address === myAddress;
          const nickname = contactByAddress.get(address);
          const displayName = isYou
            ? "You"
            : nickname ?? `Member ${avatarInitials(address)}`;
          return (
            <li
              key={address}
              className="flex items-center gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2.5"
            >
              <MemberAvatar address={address} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong">
                {displayName}
              </span>
              <span
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                  (approved
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border-soft bg-surface-raised text-text-soft")
                }
              >
                {approved ? (
                  <>
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    Approved
                  </>
                ) : (
                  "Waiting"
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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

// "by you" if connected user is the proposer, "by Sarah" when the
// viewer has saved a contact for the proposer's address, otherwise
// "by another member". Per the retail rules we never render raw
// base58 addresses inline.
function proposerName(
  proposer: string,
  me: string,
  contactByAddress: Map<string, string>,
): string {
  if (!proposer) return "";
  if (me && proposer === me) return "by you";
  const named = contactByAddress.get(proposer);
  if (named) return `by ${named}`;
  return "by another member";
}
