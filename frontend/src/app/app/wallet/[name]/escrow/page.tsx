"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
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
import {
  buildProEscrowReturnRows,
  escrowFundedAmount,
  escrowReleasedAmount,
  saveProBatchPrefill,
  useProEscrows,
  type ProEscrowFunder,
  type ProEscrowMilestone,
  type ProEscrowProject,
} from "@/lib/pro/escrow";
import { toDisplayName } from "@/lib/retail/walletNames";

interface EscrowDraft {
  title: string;
  counterparty: string;
  funderName: string;
  funderAddress: string;
  fundedAmount: string;
  milestoneTitle: string;
  recipient: string;
  milestoneAmount: string;
}

const emptyDraft: EscrowDraft = {
  title: "",
  counterparty: "",
  funderName: "",
  funderAddress: "",
  fundedAmount: "",
  milestoneTitle: "",
  recipient: "",
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
    const funderAddress = draft.funderAddress.trim();
    const fundedAmount = draft.fundedAmount.trim();
    const milestoneTitle = draft.milestoneTitle.trim();
    const recipient = draft.recipient.trim();
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
  const router = useRouter();
  const toast = useToast();
  const encoded = encodeURIComponent(walletName);
  const funded = escrowFundedAmount(project);
  const released = escrowReleasedAmount(project);
  const remaining = Math.max(0, funded - released);
  const plannedMilestone =
    project.milestones.find((milestone) => milestone.status === "planned") ??
    null;
  const returnRows = buildProEscrowReturnRows(project);
  const [funderDraft, setFunderDraft] = useState({
    name: "",
    address: "",
    amount: "",
  });

  const prepareReturn = () => {
    if (returnRows.length === 0) {
      toast.error("Nothing to return yet");
      return;
    }
    const prefill = saveProBatchPrefill(walletName, returnRows);
    router.push(`/app/wallet/${encoded}/send/batch?prefill=${prefill}`);
  };
  const addFunder = () => {
    const name = funderDraft.name.trim();
    const address = funderDraft.address.trim();
    const amount = funderDraft.amount.trim();
    if (!address || !isPositiveAmount(amount)) {
      toast.error("Add a funder address and amount");
      return;
    }
    const nextFunder: ProEscrowFunder = {
      id: randomId(),
      name: name || "Funder",
      address,
      amount,
      asset: "SOL",
    };
    onUpdate(project.id, {
      funders: [...project.funders, nextFunder],
      status: "active",
    });
    setFunderDraft({ name: "", address: "", amount: "" });
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
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-xs font-semibold capitalize text-text-soft">
          {project.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Funded" value={`${formatSol(funded)} SOL`} />
        <Metric label="Released" value={`${formatSol(released)} SOL`} />
        <Metric label="Returnable" value={`${formatSol(remaining)} SOL`} />
      </div>

      {plannedMilestone ? (
        <MilestoneRow
          walletName={walletName}
          project={project}
          milestone={plannedMilestone}
          onRelease={onRelease}
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
          disabled={returnRows.length === 0}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Return funds
        </Button>
        <details className="rounded-soft border border-border-soft bg-canvas/70 px-3 py-2 text-sm text-text-soft">
          <summary className="cursor-pointer font-medium text-text-strong">
            Details
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {project.funders.map((funder) => (
              <li key={funder.id} className="flex justify-between gap-3">
                <span className="truncate">{funder.name}</span>
                <span className="font-numerals tabular-nums">
                  {funder.amount} {funder.asset}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-[1fr_1.3fr_0.7fr_auto]">
            <MiniInput
              label="Name"
              value={funderDraft.name}
              placeholder="Funder"
              onChange={(name) =>
                setFunderDraft((current) => ({ ...current, name }))
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
    </article>
  );
}

function MilestoneRow({
  walletName,
  project,
  milestone,
  onRelease,
}: {
  walletName: string;
  project: ProEscrowProject;
  milestone: ProEscrowMilestone;
  onRelease: (projectId: string, milestoneId: string) => void;
}) {
  const encoded = encodeURIComponent(walletName);
  const params = new URLSearchParams({
    recipient: milestone.recipient,
    amount: milestone.amount,
    note: `${project.title} - ${milestone.title}`,
  });
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
        </div>
        <Link
          href={`/app/wallet/${encoded}/send?${params.toString()}`}
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-accent px-3 text-sm font-semibold text-text-on-accent transition hover:bg-accent-hover"
        >
          Release
        </Link>
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
