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
  clearSignProfileForSigner,
  prepareClearSignV4Action,
  type BackendClearSignV4Summary,
} from "@/lib/clearsign";
import { IntentType } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useConnection, useWallet } from "@/lib/wallet";
import type { EscrowDraft } from "@/features/treasury/domain/escrowTypes";
import { isPositiveAmount, randomId } from "@/features/treasury/domain/escrowUtils";
import { EscrowInput } from "@/features/treasury/ui/EscrowInput";
import { EscrowProjectCard } from "@/features/treasury/ui/EscrowProjectCard";

const emptyDraft: EscrowDraft = {
  executionMode: "sol",
  network: "Solana devnet",
  chainKind: "0",
  asset: "SOL",
  assetId: "SOL",
  decimals: "9",
  mint: "",
  sourceToken: "",
  funderTokenAccount: "",
  recipientTokenAccount: "",
  routeHash: "",
  settlementArtifactHash: "",
  privateEvaluationHash: "",
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
    const decimals = Number(draft.decimals);
    const chainKind = Number(draft.chainKind);
    const asset = draft.asset.trim().toUpperCase();

    if (!title || !counterparty) {
      toast.error("Name the escrow");
      return;
    }
    if (!funderAddress || !recipient) {
      toast.error("Add the funder and recipient addresses");
      return;
    }
    if (!isPositiveAmount(fundedAmount) || !isPositiveAmount(milestoneAmount)) {
      toast.error("Enter valid escrow amounts");
      return;
    }
    if (Number(milestoneAmount) > Number(fundedAmount)) {
      toast.error("Milestone is larger than the escrow balance");
      return;
    }
    if (!asset || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      toast.error("Add a valid asset and decimals");
      return;
    }
    if (draft.executionMode !== "sol" && !draft.assetId.trim()) {
      toast.error("Add the executable asset identifier");
      return;
    }
    if (
      draft.executionMode === "spl" &&
      (!draft.mint.trim() ||
        !draft.sourceToken.trim() ||
        !draft.funderTokenAccount.trim() ||
        !draft.recipientTokenAccount.trim())
    ) {
      toast.error("Add the SPL mint and token accounts");
      return;
    }
    if (
      draft.executionMode === "cross_chain" &&
      (!draft.routeHash.trim() || !draft.settlementArtifactHash.trim())
    ) {
      toast.error("Add the verified route and settlement artifact hashes");
      return;
    }
    if (
      draft.executionMode === "private" &&
      (!draft.privateEvaluationHash.trim() ||
        !draft.settlementArtifactHash.trim())
    ) {
      toast.error("Add the private evaluation and settlement artifact hashes");
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
          asset,
          amount: fundedAmount,
          tokenAccount: draft.funderTokenAccount.trim() || undefined,
        },
      ],
      milestones: [
        {
          id: randomId(),
          title: milestoneTitle || "Milestone 1",
          recipient,
          recipientEntity: recipientEntity || undefined,
          asset,
          amount: milestoneAmount,
          status: "planned",
          tokenAccount: draft.recipientTokenAccount.trim() || undefined,
        },
      ],
      execution:
        draft.executionMode === "sol"
          ? undefined
          : {
              mode: draft.executionMode,
              network: draft.network,
              chainKind,
              decimals,
              assetId:
                draft.executionMode === "spl"
                  ? draft.mint.trim()
                  : draft.assetId.trim(),
              mint: draft.mint.trim() || undefined,
              sourceToken: draft.sourceToken.trim() || undefined,
              routeHash: draft.routeHash.trim() || undefined,
              settlementArtifactHash:
                draft.settlementArtifactHash.trim() || undefined,
              privateEvaluationHash:
                draft.privateEvaluationHash.trim() || undefined,
            },
    });
    setDraft(emptyDraft);
    toast.success("Escrow project saved");
    router.replace(`/app/wallet/${encoded}/escrow#${project.id}`);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 pb-28 pt-5 sm:px-6 lg:px-8">
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
          <label className="grid gap-1.5 text-sm text-text-soft">
            Settlement rail
            <select
              value={draft.executionMode}
              onChange={(event) => {
                const executionMode = event.target.value as EscrowDraft["executionMode"];
                setDraft((current) => ({
                  ...current,
                  executionMode,
                  network: executionMode === "spl" || executionMode === "sol" ? "Solana devnet" : current.network,
                  chainKind: executionMode === "spl" || executionMode === "sol" ? "0" : current.chainKind === "0" ? "1" : current.chainKind,
                  asset: executionMode === "sol" ? "SOL" : current.asset,
                  assetId: executionMode === "sol" ? "SOL" : current.assetId,
                  decimals: executionMode === "sol" ? "9" : current.decimals,
                }));
              }}
              className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-text-strong outline-none focus:border-accent"
            >
              <option value="sol">SOL</option>
              <option value="spl">Solana token</option>
              <option value="cross_chain">Cross-chain settlement</option>
              <option value="private">Private settlement</option>
            </select>
          </label>
          {draft.executionMode === "cross_chain" || draft.executionMode === "private" ? (
            <label className="grid gap-1.5 text-sm text-text-soft">
              Network
              <select
                value={`${draft.chainKind}:${draft.network}`}
                onChange={(event) => {
                  const [chainKind, network] = event.target.value.split(":") as [string, EscrowDraft["network"]];
                  setDraft((current) => ({ ...current, chainKind, network }));
                }}
                className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-text-strong outline-none focus:border-accent"
              >
                <option value="1:Ethereum Sepolia">Ethereum</option>
                <option value="2:Bitcoin testnet">Bitcoin</option>
                <option value="3:Zcash testnet">Zcash</option>
                <option value="5:Hyperliquid testnet">Hyperliquid</option>
              </select>
            </label>
          ) : null}
          {draft.executionMode !== "sol" ? (
            <>
              <EscrowInput label="Asset symbol" value={draft.asset} placeholder="USDC" onChange={(asset) => setDraft((current) => ({ ...current, asset }))} />
              <EscrowInput label={draft.executionMode === "spl" ? "Mint" : "Asset identifier"} value={draft.executionMode === "spl" ? draft.mint : draft.assetId} placeholder={draft.executionMode === "spl" ? "Mint address" : "USDC"} onChange={(value) => setDraft((current) => draft.executionMode === "spl" ? ({ ...current, mint: value, assetId: value }) : ({ ...current, assetId: value }))} />
              <EscrowInput label="Decimals" value={draft.decimals} placeholder="6" inputMode="decimal" onChange={(decimals) => setDraft((current) => ({ ...current, decimals }))} />
            </>
          ) : null}
          {draft.executionMode === "spl" ? (
            <>
              <EscrowInput label="Treasury token account" value={draft.sourceToken} placeholder="Source token account" onChange={(sourceToken) => setDraft((current) => ({ ...current, sourceToken }))} />
              <EscrowInput label="Funder token account" value={draft.funderTokenAccount} placeholder="Return destination" onChange={(funderTokenAccount) => setDraft((current) => ({ ...current, funderTokenAccount }))} />
              <EscrowInput label="Recipient token account" value={draft.recipientTokenAccount} placeholder="Release destination" onChange={(recipientTokenAccount) => setDraft((current) => ({ ...current, recipientTokenAccount }))} />
            </>
          ) : null}
          {draft.executionMode === "cross_chain" ? (
            <EscrowInput label="Route hash" value={draft.routeHash} placeholder="64-character hash" onChange={(routeHash) => setDraft((current) => ({ ...current, routeHash }))} />
          ) : null}
          {draft.executionMode === "private" ? (
            <EscrowInput label="Private evaluation hash" value={draft.privateEvaluationHash} placeholder="64-character hash" onChange={(privateEvaluationHash) => setDraft((current) => ({ ...current, privateEvaluationHash }))} />
          ) : null}
          {draft.executionMode === "cross_chain" || draft.executionMode === "private" ? (
            <EscrowInput label="Settlement artifact hash" value={draft.settlementArtifactHash} placeholder="64-character hash" onChange={(settlementArtifactHash) => setDraft((current) => ({ ...current, settlementArtifactHash }))} />
          ) : null}
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
    </div>
  );
}
