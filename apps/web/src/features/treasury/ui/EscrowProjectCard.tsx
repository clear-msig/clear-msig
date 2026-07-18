"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileCheck2, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { listIntents } from "@/lib/chain/intents";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { clearSignProfileForSigner, prepareClearSignV4Action } from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { buildProEscrowReleaseEnvelope, buildProEscrowReturnEnvelope, buildProEscrowReturnRows, escrowFundedAmount, escrowReleasedAmount, previewProEscrowRelease, previewProEscrowReturn, recordProEscrowUnwindPrepared, type ProEscrowFunder, type ProEscrowMilestone, type ProEscrowProject } from "@/lib/pro/escrow";
import { useConnection, useWallet } from "@/lib/wallet";
import type { PreparedEscrowAction } from "@/features/treasury/domain/escrowTypes";
import {
  buildReleaseExecution,
  buildReturnExecution,
} from "@/features/treasury/domain/escrowExecution";
import { formatSol, isPositiveAmount, randomId } from "@/features/treasury/domain/escrowUtils";

export function EscrowProjectCard({
  walletName,
  project,
  onUpdate,
  onRelease,
  onRemove,
}: {
  walletName: string;
  project: ProEscrowProject;
  onUpdate: (id: string, patch: Partial<ProEscrowProject>) => void;
  onRelease: (projectId: string, milestoneId: string) => void;
  onRemove: () => void;
}) {
  const toast = useToast();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const projectAsset = project.milestones[0]?.asset ?? project.funders[0]?.asset ?? "SOL";
  const funded = escrowFundedAmount(project, projectAsset);
  const released = escrowReleasedAmount(project, projectAsset);
  const remaining = Math.max(0, funded - released);
  const plannedMilestone =
    project.milestones.find((milestone) => milestone.status === "planned") ??
    null;
  const returnRows = buildProEscrowReturnRows(project);
  const [funderDraft, setFunderDraft] = useState({
    name: "",
    entity: "",
    address: "",
    amount: "",
    tokenAccount: "",
  });
  const [prepared, setPrepared] = useState<PreparedEscrowAction | null>(null);
  const [preparing, setPreparing] = useState<"release" | "return" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (row) =>
          row.account !== null &&
          row.account.intentType === IntentType.Custom &&
          row.account.chainKind === (project.execution?.chainKind ?? 0) &&
          row.account.approved,
      ) ?? null
    );
  }, [intentsQuery.data, project.execution?.chainKind]);

  const prepareTypedAction = async (
    envelope:
      | ReturnType<typeof buildProEscrowReleaseEnvelope>
      | ReturnType<typeof buildProEscrowReturnEnvelope>,
  ) => {
    const intent = firstIntent?.account;
    if (!intent) {
      throw new Error("Turn on protection before using escrow actions.");
    }
    const proposerPk = wallet.pickSigner(intent.proposers);
    if (!proposerPk) {
      throw new Error("This wallet cannot propose actions for this treasury.");
    }
    const summary = await prepareClearSignV4Action(envelope, {
      intentIndex: intent.intentIndex,
      actorPubkey: proposerPk.toBase58(),
      deviceProfile: clearSignProfileForSigner(wallet, proposerPk),
    });
    const dry = await backendApi.prepare.createTypedProposal(walletName, {
      intent_index: intent.intentIndex,
      action_kind: summary.actionKindCode,
      policy_commitment: summary.policyCommitment,
      payload_hash: summary.payloadHash,
      envelope_hash: summary.envelopeHash,
      action_id: envelope.actionId,
      nonce: envelope.nonce,
      signable_text: summary.signableText,
      canonical_intent_hex: summary.canonicalIntentHex,
      expiry: formatUnixSigningExpiry(envelope.expiresAt),
      actor_pubkey: proposerPk.toBase58(),
    });
    return { summary, dry };
  };

  const prepareReturn = async () => {
    if (returnRows.length === 0) {
      toast.error("Nothing to return yet");
      return;
    }
    setPreparing("return");
    try {
      let rows = returnRows;
      let executeReturns = project.execution
        ? []
        : returnRows.map((row) => ({
            recipient: row.recipient,
            amountLamports: solToLamportsNumber(row.amount),
          }));
      let signingProject = project;
      if (project.execution && project.execution.mode !== "spl" && returnRows.length !== 1) {
        throw new Error("Cross-chain and private returns require exactly one recorded funder.");
      }
      if (!project.execution) try {
        const preview = await previewProEscrowReturn(walletName, project);
        rows = preview.returns.map((row) => ({
          recipient: row.recipient,
          amount: row.amount,
        }));
        executeReturns = preview.returns.map((row) => ({
          recipient: row.recipient,
          amountLamports: rawLamportsToNumber(row.rawAmount),
        }));
        signingProject = { ...project, policy: preview.policy };
      } catch {
        // The backend may not be redeployed yet. Keep the existing local preview
        // path alive, but prefer backend-owned math whenever it is available.
      }
      const { summary, dry } = await prepareTypedAction(
        buildProEscrowReturnEnvelope({
          walletName,
          project: signingProject,
          rows,
        }),
      );
      void recordProEscrowUnwindPrepared({
        walletName,
        project: signingProject,
        rows,
      });
      setPrepared({
        title: "Return funds",
        summary,
        dry,
        cta: "Approve return",
        execute: {
          ...buildReturnExecution(signingProject, rows, executeReturns),
        },
      });
    } catch (err) {
      const fe = friendlyError(err, "generic");
      toast.error(fe.title, { details: fe.body, durationMs: fe.durationMs });
    } finally {
      setPreparing(null);
    }
  };

  const prepareRelease = async (milestone: ProEscrowMilestone) => {
    setPreparing("release");
    try {
      let signingProject = project;
      let signingMilestone = milestone;
      let amountLamports = project.execution
        ? 0
        : solToLamportsNumber(milestone.amount);
      if (!project.execution) try {
        const preview = await previewProEscrowRelease(
          walletName,
          project,
          milestone,
        );
        signingProject = { ...project, policy: preview.policy };
        signingMilestone = {
          ...milestone,
          amount: preview.amount,
          asset: preview.asset,
          recipient: preview.recipient,
          recipientEntity: preview.recipientEntity,
        };
        amountLamports = rawLamportsToNumber(preview.rawAmount);
      } catch {
        // See prepareReturn: backend preview is preferred, local flow remains
        // available for local/dev deployments that have not caught up.
      }
      const { summary, dry } = await prepareTypedAction(
        buildProEscrowReleaseEnvelope({
          walletName,
          project: signingProject,
          milestone: signingMilestone,
        }),
      );
      setPrepared({
        title: "Release milestone",
        summary,
        dry,
        cta: "Approve release",
        execute: {
          ...buildReleaseExecution(signingProject, signingMilestone, amountLamports),
        },
      });
    } catch (err) {
      const fe = friendlyError(err, "generic");
      toast.error(fe.title, { details: fe.body, durationMs: fe.durationMs });
    } finally {
      setPreparing(null);
    }
  };

  const approvePrepared = async () => {
    if (!prepared || submitting) return;
    const intent = firstIntent?.account;
    if (!intent) {
      toast.error("Turn on protection before using escrow actions.");
      return;
    }
    const proposerPk = wallet.pickSigner(intent.proposers);
    if (!proposerPk) {
      toast.error("This wallet cannot propose actions for this treasury.");
      return;
    }
    setSubmitting(true);
    try {
      const signed = await signTypedDescriptor(prepared.dry, {
        preferSigner: proposerPk,
        expectedTyped: {
          envelopeHash: prepared.summary.envelopeHash,
          payloadHash: prepared.summary.payloadHash,
          signableText: prepared.summary.signableText,
        },
      });
      const created = await backendApi.submit.createTypedProposal(walletName, {
        ...signed,
        expiry: prepared.dry.expiry,
        intent_index: prepared.dry.intent_index,
        action_kind: prepared.dry.action_kind,
        policy_commitment: prepared.dry.policy_commitment_hex,
        payload_hash: prepared.dry.payload_hash_hex,
        envelope_hash: prepared.dry.envelope_hash_hex,
        action_id: prepared.dry.action_id,
        nonce: prepared.dry.nonce,
        canonical_intent_hex: prepared.dry.canonical_intent_hex,
      });
      const proposalAddress = getStringField(created, "proposal");
      if (!proposalAddress) {
        throw new Error("Approval was created, but no proposal address returned.");
      }
      try {
        switch (prepared.execute.kind) {
          case "release":
            await backendApi.executeTypedEscrowRelease(walletName, proposalAddress, {
              recipient: prepared.execute.recipient,
              amountLamports: prepared.execute.amountLamports,
              escrowId: prepared.execute.escrowId,
              milestoneId: prepared.execute.milestoneId,
            });
            onRelease(prepared.execute.escrowId, prepared.execute.milestoneId);
            toast.success("Milestone released");
            break;
          case "return":
            await backendApi.executeTypedEscrowReturn(walletName, proposalAddress, prepared.execute);
            onUpdate(prepared.execute.escrowId, { status: "returned" });
            toast.success("Funds returned");
            break;
          case "spl_release":
            await backendApi.executeTypedSplEscrowRelease(walletName, proposalAddress, prepared.execute);
            onRelease(prepared.execute.escrowId, prepared.execute.milestoneId);
            toast.success("Token milestone released");
            break;
          case "spl_return":
            await backendApi.executeTypedSplEscrowReturn(walletName, proposalAddress, prepared.execute);
            onUpdate(prepared.execute.escrowId, { status: "returned" });
            toast.success("Tokens returned");
            break;
          case "cross_chain_release":
            await backendApi.executeTypedCrossChainEscrowRelease(walletName, proposalAddress, prepared.execute);
            onRelease(prepared.execute.escrowId, prepared.execute.milestoneId);
            toast.success("Settlement recorded");
            break;
          case "cross_chain_return":
            await backendApi.executeTypedCrossChainEscrowReturn(walletName, proposalAddress, prepared.execute);
            onUpdate(prepared.execute.escrowId, { status: "returned" });
            toast.success("Return settlement recorded");
            break;
          case "private_release":
            await backendApi.executeTypedPrivateEscrowRelease(walletName, proposalAddress, prepared.execute);
            onRelease(prepared.execute.escrowId, prepared.execute.milestoneId);
            toast.success("Private settlement recorded");
            break;
          case "private_return":
            await backendApi.executeTypedPrivateEscrowReturn(walletName, proposalAddress, prepared.execute);
            onUpdate(prepared.execute.escrowId, { status: "returned" });
            toast.success("Private return recorded");
            break;
        }
        setPrepared(null);
      } catch (executeError) {
        if (needsMoreApprovals(executeError)) {
          toast.success("Approval requested");
          setPrepared(null);
          return;
        }
        throw executeError;
      }
    } catch (err) {
      const fe = friendlyError(err, "generic");
      toast.error(fe.title, { details: fe.body, durationMs: fe.durationMs });
    } finally {
      setSubmitting(false);
    }
  };

  const addFunder = () => {
    const name = funderDraft.name.trim();
    const entity = funderDraft.entity.trim();
    const address = funderDraft.address.trim();
    const amount = funderDraft.amount.trim();
    const tokenAccount = funderDraft.tokenAccount.trim();
    if (!address || !isPositiveAmount(amount)) {
      toast.error("Add a funder address and amount");
      return;
    }
    if (project.execution?.mode === "spl" && !tokenAccount) {
      toast.error("Add the funder's return token account");
      return;
    }
    if (project.execution && project.execution.mode !== "spl") {
      toast.error("This settlement rail supports one recorded funder");
      return;
    }
    const nextFunder: ProEscrowFunder = {
      id: randomId(),
      name: name || "Funder",
      entity: entity || undefined,
      address,
      amount,
      asset: projectAsset,
      tokenAccount: tokenAccount || undefined,
    };
    onUpdate(project.id, {
      funders: [...project.funders, nextFunder],
      status: "active",
    });
    setFunderDraft({ name: "", entity: "", address: "", amount: "", tokenAccount: "" });
    toast.success("Funder added");
  };

  return (
    <article
      id={project.id}
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            {project.counterparty}
          </p>
          <h2 className="mt-1 truncate text-xl font-semibold text-text-strong">
            {project.title}
          </h2>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-xs font-semibold capitalize text-text-soft">
            {project.status}
          </span>
          <span className="rounded-full border border-accent/35 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
            Approval protected
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Funded" value={`${formatSol(funded)} ${projectAsset}`} />
        <Metric label="Released" value={`${formatSol(released)} ${projectAsset}`} />
        <Metric label="Returnable" value={`${formatSol(remaining)} ${projectAsset}`} />
      </div>

      {plannedMilestone ? (
        <MilestoneRow
          milestone={plannedMilestone}
          onPrepareRelease={prepareRelease}
          preparing={preparing === "release"}
        />
      ) : (
        <div className="mt-4 rounded-soft border border-border-soft bg-canvas/70 p-3 text-sm text-text-soft">
          All saved milestones are marked released.
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Button
          variant="secondary"
          fullWidth
          onClick={prepareReturn}
          disabled={returnRows.length === 0 || preparing === "return"}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {preparing === "return" ? "Reviewing..." : "Return funds"}
        </Button>
        <details className="rounded-soft border border-border-soft bg-canvas/70 px-3 py-2 text-sm text-text-soft">
          <summary className="cursor-pointer font-medium text-text-strong">
            Details
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {project.funders.map((funder) => (
              <li key={funder.id} className="flex justify-between gap-3">
                <span className="truncate">
                  {funder.name}
                  {funder.entity ? ` · ${funder.entity}` : ""}
                </span>
                <span className="font-numerals tabular-nums">
                  {funder.amount} {funder.asset}
                </span>
              </li>
            ))}
          </ul>
          {project.policy?.commitment ? (
            <p className="mt-3 break-all rounded-soft border border-border-soft bg-surface-raised px-3 py-2 font-mono text-[10px] leading-relaxed text-text-soft">
              Policy {project.policy.commitment.slice(0, 18)}...
            </p>
          ) : null}
          <div className="mt-3 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_0.7fr_auto]">
            <MiniInput
              label="Name"
              value={funderDraft.name}
              placeholder="Funder"
              onChange={(name) =>
                setFunderDraft((current) => ({ ...current, name }))
              }
            />
            {project.execution?.mode === "spl" ? (
              <MiniInput
                label="Token account"
                value={funderDraft.tokenAccount}
                placeholder="Return destination"
                onChange={(tokenAccount) =>
                  setFunderDraft((current) => ({ ...current, tokenAccount }))
                }
              />
            ) : null}
            <MiniInput
              label="Entity"
              value={funderDraft.entity}
              placeholder="Fund"
              onChange={(entity) =>
                setFunderDraft((current) => ({ ...current, entity }))
              }
            />
            <MiniInput
              label="Address"
              value={funderDraft.address}
              placeholder="Solana address"
              onChange={(address) =>
                setFunderDraft((current) => ({ ...current, address }))
              }
            />
            <MiniInput
              label="Amount"
              value={funderDraft.amount}
              placeholder="1"
              inputMode="decimal"
              onChange={(amount) =>
                setFunderDraft((current) => ({ ...current, amount }))
              }
            />
            <button
              type="button"
              onClick={addFunder}
              className="min-h-10 rounded-soft bg-accent px-3 text-xs font-semibold text-text-on-accent transition hover:bg-accent-hover"
            >
              Add
            </button>
          </div>
        </details>
        <Button variant="ghost" onClick={onRemove} aria-label="Remove escrow">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {prepared ? (
        <ClearSignReview
          prepared={prepared}
          submitting={submitting}
          onApprove={approvePrepared}
          onDismiss={() => setPrepared(null)}
        />
      ) : null}
    </article>
  );
}

function getStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const maybe = (value as Record<string, unknown>)[key];
  return typeof maybe === "string" && maybe.trim() ? maybe.trim() : null;
}

function needsMoreApprovals(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return /must be 'Approved'|ProposalNotApproved|not approved|needs approval/i.test(
    text,
  );
}

function rawLamportsToNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Escrow amount is too large for this browser.");
  }
  return parsed;
}

function solToLamportsNumber(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
    throw new Error("Enter a SOL amount with up to 9 decimals.");
  }
  const [whole, frac = ""] = normalized.split(".");
  const lamports =
    BigInt(whole) * 1_000_000_000n +
    BigInt((frac + "000000000").slice(0, 9));
  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Escrow amount is too large for this browser.");
  }
  return Number(lamports);
}

function MilestoneRow({
  milestone,
  onPrepareRelease,
  preparing,
}: {
  milestone: ProEscrowMilestone;
  onPrepareRelease: (milestone: ProEscrowMilestone) => void;
  preparing: boolean;
}) {
  return (
    <section className="mt-4 rounded-soft border border-border-soft bg-canvas/70 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-strong">
            {milestone.title}
          </p>
          <p className="mt-1 font-numerals text-sm tabular-nums text-text-soft">
            {milestone.amount} {milestone.asset}
          </p>
          {milestone.recipientEntity ? (
            <p className="mt-1 truncate text-xs text-text-soft">
              {milestone.recipientEntity}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onPrepareRelease(milestone)}
          disabled={preparing}
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-accent px-3 text-sm font-semibold text-text-on-accent transition hover:bg-accent-hover"
        >
          {preparing ? "Reviewing..." : "Release"}
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas/70 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 font-numerals text-sm font-semibold tabular-nums text-text-strong">
        {value}
      </p>
    </div>
  );
}

function ClearSignReview({
  prepared,
  submitting,
  onApprove,
  onDismiss,
}: {
  prepared: PreparedEscrowAction;
  submitting: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const visibleLines = prepared.summary.lines.slice(0, 5);
  return (
    <section className="mt-4 rounded-soft border border-accent/35 bg-accent/10 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-text-on-accent">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
            {prepared.title}
          </p>
          <h3 className="mt-1 text-base font-semibold leading-snug text-text-strong">
            {prepared.summary.headline}
          </h3>
          <ul className="mt-2 grid gap-1 text-sm leading-relaxed text-text-soft">
            {visibleLines.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <button
              type="button"
              onClick={onApprove}
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-text-on-accent transition hover:bg-accent-hover"
            >
              {submitting ? "Approving..." : prepared.cta}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={submitting}
              className="min-h-11 rounded-full border border-border-soft bg-surface-raised px-4 text-sm font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniInput({
  label,
  value,
  placeholder,
  inputMode,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputMode?: "decimal" | "text";
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </span>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className="min-h-10 min-w-0 rounded-soft border border-border-soft bg-surface-raised px-3 text-xs text-text-strong placeholder:text-text-soft/50 focus:border-accent/50 focus:outline-none"
      />
    </label>
  );
}
