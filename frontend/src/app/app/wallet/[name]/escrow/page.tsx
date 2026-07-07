"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { listIntents } from "@/lib/chain/intents";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  buildProEscrowReleaseEnvelope,
  buildProEscrowReturnEnvelope,
  buildProEscrowReturnRows,
  escrowFundedAmount,
  escrowReleasedAmount,
  previewProEscrowRelease,
  previewProEscrowReturn,
  recordProEscrowUnwindPrepared,
  useProEscrows,
  type ProEscrowFunder,
  type ProEscrowMilestone,
  type ProEscrowProject,
} from "@/lib/pro/escrow";
import {
  prepareClearSignAction,
  type BackendClearSignSummary,
} from "@/lib/clearsign-v2";
import { IntentType } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useConnection, useWallet } from "@/lib/wallet";
import type { TypedDryRunDescriptor } from "@/lib/api/types";

interface EscrowDraft {
  title: string;
  counterparty: string;
  funderName: string;
  funderEntity: string;
  funderAddress: string;
  fundedAmount: string;
  milestoneTitle: string;
  recipient: string;
  recipientEntity: string;
  milestoneAmount: string;
}

interface PreparedEscrowAction {
  title: string;
  summary: BackendClearSignSummary;
  dry: TypedDryRunDescriptor;
  cta: string;
  execute:
    | {
        kind: "release";
        recipient: string;
        amountLamports: number;
        escrowId: string;
        milestoneId: string;
      }
    | {
        kind: "return";
        escrowId: string;
        returns: Array<{ recipient: string; amountLamports: number }>;
      };
}

const emptyDraft: EscrowDraft = {
  title: "",
  counterparty: "",
  funderName: "",
  funderEntity: "",
  funderAddress: "",
  fundedAmount: "",
  milestoneTitle: "",
  recipient: "",
  recipientEntity: "",
  milestoneAmount: "",
};

export default function ProEscrowPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const walletName = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [params?.name]);
  const encoded = encodeURIComponent(walletName);
  const walletDisplay = toDisplayName(walletName);
  const escrows = useProEscrows(walletName);
  const [draft, setDraft] = useState<EscrowDraft>(emptyDraft);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const createProject = () => {
    const title = draft.title.trim();
    const counterparty = draft.counterparty.trim();
    const funderEntity = draft.funderEntity.trim();
    const funderAddress = draft.funderAddress.trim();
    const fundedAmount = draft.fundedAmount.trim();
    const milestoneTitle = draft.milestoneTitle.trim();
    const recipient = draft.recipient.trim();
    const recipientEntity = draft.recipientEntity.trim();
    const milestoneAmount = draft.milestoneAmount.trim();

    if (!title || !counterparty) {
      toast.error("Name the escrow");
      return;
    }
    if (!funderAddress || !recipient) {
      toast.error("Add the funder and recipient addresses");
      return;
    }
    if (!isPositiveAmount(fundedAmount) || !isPositiveAmount(milestoneAmount)) {
      toast.error("Enter valid SOL amounts");
      return;
    }
    if (Number(milestoneAmount) > Number(fundedAmount)) {
      toast.error("Milestone is larger than the escrow balance");
      return;
    }

    const project = escrows.add({
      title,
      counterparty,
      status: "active",
      funders: [
        {
          id: randomId(),
          name: draft.funderName.trim() || counterparty,
          entity: funderEntity || undefined,
          address: funderAddress,
          asset: "SOL",
          amount: fundedAmount,
        },
      ],
      milestones: [
        {
          id: randomId(),
          title: milestoneTitle || "Milestone 1",
          recipient,
          recipientEntity: recipientEntity || undefined,
          asset: "SOL",
          amount: milestoneAmount,
          status: "planned",
        },
      ],
    });
    setDraft(emptyDraft);
    toast.success("Escrow project saved");
    router.replace(`/app/wallet/${encoded}/escrow#${project.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 pb-28 pt-5 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-3">
        <Link
          href={`/app/wallet/${encoded}`}
          className="inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 text-sm font-medium text-text-soft transition hover:border-accent/40 hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Treasury
        </Link>
        <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          Pro
        </span>
      </header>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.22 }}
        className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              {walletDisplay}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold leading-tight text-text-strong">
              Project escrow
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              Hold funds for milestones. If work stops, prepare a clean return
              to the original funder.
            </p>
          </div>
        </div>
      </motion.section>

      {escrows.rows.length > 0 ? (
        <section className="grid gap-3">
          {escrows.rows.map((project) => (
            <EscrowProjectCard
              key={project.id}
              walletName={walletName}
              project={project}
              onUpdate={escrows.update}
              onRelease={escrows.markMilestoneReleased}
              onRemove={() => escrows.remove(project.id)}
            />
          ))}
        </section>
      ) : null}

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              New escrow
            </p>
            <h2 className="mt-1 text-lg font-semibold text-text-strong">
              Set the first milestone
            </h2>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <EscrowInput
            label="Project"
            value={draft.title}
            placeholder="Website redesign"
            onChange={(title) => setDraft((current) => ({ ...current, title }))}
          />
          <EscrowInput
            label="Client"
            value={draft.counterparty}
            placeholder="Acme"
            onChange={(counterparty) =>
              setDraft((current) => ({ ...current, counterparty }))
            }
          />
          <EscrowInput
            label="Funder"
            value={draft.funderName}
            placeholder="Who funded it?"
            onChange={(funderName) =>
              setDraft((current) => ({ ...current, funderName }))
            }
          />
          <EscrowInput
            label="Fund entity"
            value={draft.funderEntity}
            placeholder="Fund / investor SPV"
            onChange={(funderEntity) =>
              setDraft((current) => ({ ...current, funderEntity }))
            }
          />
          <EscrowInput
            label="Funder address"
            value={draft.funderAddress}
            placeholder="Solana address"
            onChange={(funderAddress) =>
              setDraft((current) => ({ ...current, funderAddress }))
            }
          />
          <EscrowInput
            label="Escrow amount"
            value={draft.fundedAmount}
            placeholder="10"
            inputMode="decimal"
            suffix="SOL"
            onChange={(fundedAmount) =>
              setDraft((current) => ({ ...current, fundedAmount }))
            }
          />
          <EscrowInput
            label="Milestone"
            value={draft.milestoneTitle}
            placeholder="Design approved"
            onChange={(milestoneTitle) =>
              setDraft((current) => ({ ...current, milestoneTitle }))
            }
          />
          <EscrowInput
            label="Recipient"
            value={draft.recipient}
            placeholder="Solana address"
            onChange={(recipient) =>
              setDraft((current) => ({ ...current, recipient }))
            }
          />
          <EscrowInput
            label="Recipient entity"
            value={draft.recipientEntity}
            placeholder="Construction / Cooperative"
            onChange={(recipientEntity) =>
              setDraft((current) => ({ ...current, recipientEntity }))
            }
          />
          <EscrowInput
            label="Release amount"
            value={draft.milestoneAmount}
            placeholder="2.5"
            inputMode="decimal"
            suffix="SOL"
            onChange={(milestoneAmount) =>
              setDraft((current) => ({ ...current, milestoneAmount }))
            }
          />
        </div>

        <div className="mt-4">
          <Button size="lg" fullWidth onClick={createProject}>
            Save escrow
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </section>
    </main>
  );
}

function EscrowProjectCard({
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
  const funded = escrowFundedAmount(project);
  const released = escrowReleasedAmount(project);
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
          row.account.chainKind === 0 &&
          row.account.approved,
      ) ?? null
    );
  }, [intentsQuery.data]);

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
    const summary = await prepareClearSignAction(envelope, {
      fallback: false,
    });
    const dry = await backendApi.prepare.createTypedProposal(walletName, {
      intent_index: intent.intentIndex,
      action_kind: summary.actionKindCode,
      policy_commitment: envelope.policyCommitment,
      payload_hash: summary.payloadHash,
      envelope_hash: summary.envelopeHash,
      action_id: envelope.actionId,
      nonce: envelope.nonce,
      signable_text: summary.signableText,
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
      let executeReturns = returnRows.map((row) => ({
        recipient: row.recipient,
        amountLamports: solToLamportsNumber(row.amount),
      }));
      let signingProject = project;
      try {
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
        // Render may not be redeployed yet. Keep the existing local preview
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
          kind: "return",
          escrowId: signingProject.id,
          returns: executeReturns,
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
      let amountLamports = solToLamportsNumber(milestone.amount);
      try {
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
          kind: "release",
          recipient: signingMilestone.recipient,
          amountLamports,
          escrowId: signingProject.id,
          milestoneId: signingMilestone.id,
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
      });
      const proposalAddress = getStringField(created, "proposal");
      if (!proposalAddress) {
        throw new Error("Approval was created, but no proposal address returned.");
      }
      try {
        if (prepared.execute.kind === "release") {
          await backendApi.executeTypedEscrowRelease(
            walletName,
            proposalAddress,
            {
              recipient: prepared.execute.recipient,
              amountLamports: prepared.execute.amountLamports,
              escrowId: prepared.execute.escrowId,
              milestoneId: prepared.execute.milestoneId,
            },
          );
          onRelease(prepared.execute.escrowId, prepared.execute.milestoneId);
          toast.success("Milestone released");
        } else {
          await backendApi.executeTypedEscrowReturn(walletName, proposalAddress, {
            escrowId: prepared.execute.escrowId,
            returns: prepared.execute.returns,
          });
          onUpdate(prepared.execute.escrowId, { status: "returned" });
          toast.success("Funds returned");
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
    if (!address || !isPositiveAmount(amount)) {
      toast.error("Add a funder address and amount");
      return;
    }
    const nextFunder: ProEscrowFunder = {
      id: randomId(),
      name: name || "Funder",
      entity: entity || undefined,
      address,
      amount,
      asset: "SOL",
    };
    onUpdate(project.id, {
      funders: [...project.funders, nextFunder],
      status: "active",
    });
    setFunderDraft({ name: "", entity: "", address: "", amount: "" });
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
        <Metric label="Funded" value={`${formatSol(funded)} SOL`} />
        <Metric label="Released" value={`${formatSol(released)} SOL`} />
        <Metric label="Returnable" value={`${formatSol(remaining)} SOL`} />
      </div>

      {plannedMilestone ? (
        <MilestoneRow
          project={project}
          milestone={plannedMilestone}
          onRelease={onRelease}
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
          <div className="mt-3 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-[1fr_1fr_1.3fr_0.7fr_auto]">
            <MiniInput
              label="Name"
              value={funderDraft.name}
              placeholder="Funder"
              onChange={(name) =>
                setFunderDraft((current) => ({ ...current, name }))
              }
            />
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
  project,
  milestone,
  onRelease,
  onPrepareRelease,
  preparing,
}: {
  project: ProEscrowProject;
  milestone: ProEscrowMilestone;
  onRelease: (projectId: string, milestoneId: string) => void;
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
        <button
          type="button"
          onClick={() => onRelease(project.id, milestone.id)}
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised px-3 text-sm font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
          aria-label={`Mark ${milestone.title} released`}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
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

function EscrowInput({
  label,
  value,
  placeholder,
  inputMode,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputMode?: "decimal" | "text";
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-soft">
        {label}
      </span>
      <span className="flex min-h-tap items-center rounded-soft border border-border-soft bg-canvas px-3 transition focus-within:border-accent/50">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-text-strong placeholder:text-text-soft/60 focus:outline-none"
        />
        {suffix ? (
          <span className="ml-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-soft">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className="min-h-10 min-w-0 rounded-soft border border-border-soft bg-surface-raised px-3 text-xs text-text-strong placeholder:text-text-soft/50 focus:border-accent/50 focus:outline-none"
      />
    </label>
  );
}

function isPositiveAmount(value: string): boolean {
  const amount = Number(value.trim());
  return Number.isFinite(amount) && amount > 0;
}

function formatSol(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
