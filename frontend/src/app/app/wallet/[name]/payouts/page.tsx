"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileUp, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { appConfig } from "@/lib/config";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType, toHex } from "@/lib/msig";
import { rampApi } from "@/lib/ramp/client";
import type { BankListItem, ProPayoutBatchResponse } from "@/lib/ramp/types";
import { shortAddress } from "@/lib/retail/contacts";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { useToast } from "@/components/ui/Toast";

const SOL_TRANSFER_TEMPLATE = "transfer {1:10^9} SOL to {0}";
const MAX_ROWS = 200;

type Stage = "compose" | "submitting" | "done";

interface PayoutRow {
  id: string;
  amount: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  email: string;
  narration: string;
  reference: string;
}

export default function ProPayoutPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <ProPayoutPage />
    </Suspense>
  );
}

function ProPayoutPage() {
  const route = useParams<{ name: string }>();
  const search = useSearchParams();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const queryClient = useQueryClient();
  const toast = useToast();
  const reduce = useReducedMotion();

  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  const walletDisplay = toDisplayName(walletName);
  const isProSurface = search.get("surface") === "pro";

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
      return listIntents(connection, walletQuery.data.pda, walletQuery.data.account.intentIndex);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const banksQuery = useQuery({
    queryKey: ["pro-banks", "nigeria"],
    queryFn: () => rampApi.listProBanks("nigeria"),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const solIntent = useMemo(() => {
    return (
      (intentsQuery.data ?? []).find(
        (it) =>
          it.account?.intentType === IntentType.Custom &&
          it.account.template === SOL_TRANSFER_TEMPLATE,
      ) ?? null
    );
  }, [intentsQuery.data]);

  const [stage, setStage] = useState<Stage>("compose");
  const [rows, setRows] = useState<PayoutRow[]>(() => [emptyRow()]);
  const [assetAmount, setAssetAmount] = useState("");
  const [batchNarration, setBatchNarration] = useState("");
  const [batchReference, setBatchReference] = useState("");
  const [lastBatch, setLastBatch] = useState<ProPayoutBatchResponse | null>(null);

  const totalNgnMinor = useMemo(
    () => rows.reduce((sum, row) => sum + (parseNgnMinor(row.amount) ?? 0), 0),
    [rows],
  );
  const assetLamports = useMemo(() => parseSolLamports(assetAmount), [assetAmount]);
  const canSubmit =
    isProSurface &&
    !!wallet.publicKey &&
    !!solIntent?.account &&
    !!appConfig.settlementTreasury.solana &&
    assetLamports !== null &&
    assetLamports > 0n &&
    rows.length > 0 &&
    rows.every((row) => validateRow(row) === null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!solIntent?.account) throw new Error("Enable the Pro SOL transfer rule first");
      if (!appConfig.settlementTreasury.solana) {
        throw new Error("NEXT_PUBLIC_SETTLEMENT_SOL_TREASURY_ADDRESS is not configured");
      }
      if (!assetLamports || assetLamports <= 0n) throw new Error("Enter the SOL amount to fund");

      const resolvedRows = await resolveMissingNames(rows, banksQuery.data ?? []);
      setRows(resolvedRows);

      const batch = await rampApi.createProPayoutBatch(wallet.publicKey.toBase58(), {
        wallet_name: walletName,
        wallet_address: walletQuery.data?.pda.toBase58(),
        chain_family: "solana",
        chain_id: "devnet",
        asset_symbol: "SOL",
        asset_amount_minor: Number(assetLamports),
        reference: clean(batchReference) || undefined,
        narration: clean(batchNarration) || undefined,
        metadata: {
          funding_destination: appConfig.settlementTreasury.solana,
          surface: "pro",
        },
        items: resolvedRows.map((row) => ({
          amount_minor: parseNgnMinor(row.amount)!,
          bank_code: row.bankCode,
          bank_account_number: row.accountNumber,
          account_name: clean(row.accountName) || undefined,
          customer_email: clean(row.email) || undefined,
          narration: clean(row.narration) || clean(batchNarration) || undefined,
          reference: clean(row.reference) || undefined,
        })),
      });

      const params = [
        `destination=${appConfig.settlementTreasury.solana}`,
        `amount=${assetLamports.toString()}`,
      ];
      if (solIntent.account.params.length >= 3) {
        params.push(`nonce_value=${generateNonceHex()}`);
      }

      const actorPubkey = wallet.publicKey.toBase58();
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: solIntent.account.intentIndex,
        params,
        actor_pubkey: actorPubkey,
      });
      const signerPk = solIntent.account
        ? wallet.pickSigner(solIntent.account.proposers)
        : wallet.publicKey;
      const signed = await signDescriptor(dry, { preferSigner: signerPk ?? undefined });
      const submitted = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: solIntent.account.intentIndex,
      });
      const proposal =
        typeof submitted.proposal === "string" ? submitted.proposal : undefined;
      if (!proposal) throw new Error("Backend did not return a proposal address");

      let linked = await rampApi.linkProPayoutProposal(actorPubkey, batch.id, {
        proposal_address: proposal,
      });

      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(walletName, proposal, {
          actor_pubkey: actorPubkey,
        });
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: wallet.pickSigner(solIntent.account.approvers) ?? undefined,
        });
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      const afterApproval = await approveIfNeeded(connection, proposal);
      if (!afterApproval.needsApproveSignature) {
        await backendApi.executeProposal(walletName, proposal, {});
        linked = await rampApi.verifyProPayoutBatch(actorPubkey, batch.id);
      }

      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      return linked;
    },
    onMutate: () => setStage("submitting"),
    onSuccess: (batch) => {
      setLastBatch(batch);
      setStage("done");
      toast.success("Payout batch created", {
        details:
          batch.status === "ready_for_disbursement" || batch.status === "disbursing"
            ? "The funding proposal executed. Settlement will dispatch Kora payouts."
            : "The batch is waiting for the remaining multisig approvals.",
      });
    },
    onError: (err) => {
      console.error("[pro-payouts]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      setStage("compose");
    },
  });

  const needsSetup =
    isProSurface &&
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !!walletQuery.data &&
    !solIntent;

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <motion.section {...motionProps} transition={{ duration: 0.25 }} className="flex flex-col gap-5">
        {!isProSurface ? (
          <GateCard walletName={walletName} />
        ) : needsSetup ? (
          <SetupCard walletName={walletName} walletDisplay={walletDisplay} />
        ) : stage === "submitting" ? (
          <WorkingCard />
        ) : stage === "done" && lastBatch ? (
          <DoneCard batch={lastBatch} walletName={walletName} />
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Pro payouts
              </p>
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
                    Bank payouts from {walletDisplay}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-text-soft">
                    One multisig funding request, then Kora disburses NGN to every account in the batch.
                  </p>
                </div>
                <div className="rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm text-text-soft shadow-card-rest">
                  Settlement wallet{" "}
                  <span className="font-mono text-text-strong">
                    {appConfig.settlementTreasury.solana
                      ? shortAddress(appConfig.settlementTreasury.solana)
                      : "Not configured"}
                  </span>
                </div>
              </div>
            </header>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-strong">Recipients</p>
                    <p className="text-xs text-text-soft">CSV columns: amount, bank_code, account_number, account_name, email, narration, reference.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent">
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void importCsv(file, setRows, toast);
                      }}
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  {rows.map((row, index) => (
                    <PayoutRowEditor
                      key={row.id}
                      row={row}
                      index={index}
                      banks={banksQuery.data ?? []}
                      onChange={(patch) =>
                        setRows((all) => all.map((item) => (item.id === row.id ? { ...item, ...patch } : item)))
                      }
                      onResolve={async () => {
                        try {
                          const resolved = await resolveRow(row);
                          setRows((all) => all.map((item) => (item.id === row.id ? resolved : item)));
                        } catch (err) {
                          const fe = friendlyError(err, "send");
                          toast.error(fe.title, { details: fe.body });
                        }
                      }}
                      onRemove={() =>
                        setRows((all) => (all.length === 1 ? [emptyRow()] : all.filter((item) => item.id !== row.id)))
                      }
                    />
                  ))}
                </div>

                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => setRows((all) => (all.length >= MAX_ROWS ? all : [...all, emptyRow()]))}
                  disabled={rows.length >= MAX_ROWS}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add recipient
                </Button>
              </div>

              <aside className="flex flex-col gap-4">
                <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
                  <p className="text-sm font-medium text-text-strong">Funding</p>
                  <label className="mt-3 block text-xs font-medium text-text-soft" htmlFor="asset-amount">
                    SOL to send to settlement
                  </label>
                  <input
                    id="asset-amount"
                    value={assetAmount}
                    onChange={(event) => setAssetAmount(sanitizeDecimal(event.target.value))}
                    inputMode="decimal"
                    className="mt-1 w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none transition-colors focus:border-accent"
                    placeholder="0.00"
                  />
                  <label className="mt-3 block text-xs font-medium text-text-soft" htmlFor="batch-reference">
                    Reference
                  </label>
                  <input
                    id="batch-reference"
                    value={batchReference}
                    onChange={(event) => setBatchReference(event.target.value)}
                    className="mt-1 w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none transition-colors focus:border-accent"
                    placeholder="Payroll June"
                  />
                  <label className="mt-3 block text-xs font-medium text-text-soft" htmlFor="batch-narration">
                    Narration
                  </label>
                  <textarea
                    id="batch-narration"
                    value={batchNarration}
                    onChange={(event) => setBatchNarration(event.target.value)}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none transition-colors focus:border-accent"
                    placeholder="Team payout"
                  />
                </div>

                <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
                  <p className="text-sm font-medium text-text-strong">Review</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <Row label="Recipients" value={String(rows.length)} />
                    <Row label="NGN total" value={formatNgn(totalNgnMinor)} />
                    <Row label="SOL funding" value={assetAmount.trim() ? `${assetAmount} SOL` : "0 SOL"} />
                  </dl>
                  {!appConfig.settlementTreasury.solana && (
                    <p className="mt-3 text-xs text-warning">
                      Configure NEXT_PUBLIC_SETTLEMENT_SOL_TREASURY_ADDRESS before creating payouts.
                    </p>
                  )}
                  <Button
                    className="mt-4"
                    fullWidth
                    onClick={() => submit.mutate()}
                    disabled={!canSubmit || submit.isPending}
                  >
                    {submit.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Creating payout
                      </>
                    ) : (
                      <>
                        Create payout
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </aside>
            </section>
          </>
        )}
      </motion.section>
    </div>
  );
}

function PayoutRowEditor({
  row,
  index,
  banks,
  onChange,
  onResolve,
  onRemove,
}: {
  row: PayoutRow;
  index: number;
  banks: BankListItem[];
  onChange: (patch: Partial<PayoutRow>) => void;
  onResolve: () => void;
  onRemove: () => void;
}) {
  const error = validateRow(row);
  return (
    <div className="rounded-card border border-border-soft bg-canvas p-3">
      <div className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_150px]">
        <input
          value={row.amount}
          onChange={(event) => onChange({ amount: sanitizeDecimal(event.target.value) })}
          inputMode="decimal"
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="NGN"
          aria-label={`Row ${index + 1} NGN amount`}
        />
        <select
          value={row.bankCode}
          onChange={(event) => onChange({ bankCode: event.target.value, accountName: "" })}
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          aria-label={`Row ${index + 1} bank`}
        >
          <option value="">Bank</option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
        <input
          value={row.accountNumber}
          onChange={(event) =>
            onChange({ accountNumber: event.target.value.replace(/\D/g, "").slice(0, 16), accountName: "" })
          }
          inputMode="numeric"
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Account number"
          aria-label={`Row ${index + 1} account number`}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <input
          value={row.accountName}
          onChange={(event) => onChange({ accountName: event.target.value })}
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Account name"
          aria-label={`Row ${index + 1} account name`}
        />
        <input
          value={row.email}
          onChange={(event) => onChange({ email: event.target.value })}
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Email"
          aria-label={`Row ${index + 1} email`}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input
          value={row.narration}
          onChange={(event) => onChange({ narration: event.target.value })}
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Narration"
          aria-label={`Row ${index + 1} narration`}
        />
        <input
          value={row.reference}
          onChange={(event) => onChange({ reference: event.target.value })}
          className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Reference"
          aria-label={`Row ${index + 1} reference`}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onResolve}
            className="inline-flex h-10 items-center gap-1.5 rounded-soft border border-border-soft px-3 text-xs font-medium text-text-strong transition-colors hover:border-accent"
          >
            <Landmark className="h-4 w-4" aria-hidden="true" />
            Resolve
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-10 w-10 items-center justify-center rounded-soft border border-border-soft text-text-soft transition-colors hover:border-danger hover:text-danger"
            aria-label={`Remove row ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-warning">{error}</p> : null}
    </div>
  );
}

function GateCard({ walletName }: { walletName: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">Pro operation</p>
      <p className="mt-2 text-sm text-text-strong">
        Bank payouts live in Pro so personal wallets stay focused on simple sends.
      </p>
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/payouts?surface=pro`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest"
      >
        Open in Pro
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function SetupCard({ walletName, walletDisplay }: { walletName: string; walletDisplay: string }) {
  return (
    <div className="rounded-card border border-warning/30 bg-warning/[0.06] p-5 shadow-card-rest">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">Enable Pro payouts</p>
      <p className="mt-2 text-sm text-text-strong">
        <strong>{walletDisplay}</strong> needs the Pro SOL funding rule before it can create Kora bank payouts.
      </p>
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/setup?surface=pro`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest"
      >
        Enable Pro payouts
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function WorkingCard() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <BrandLoader label="Creating payout" />
      <p className="mt-4 max-w-sm text-sm text-text-soft">
        Creating the Kora batch, asking your wallet for one funding signature, and checking whether the threshold is met.
      </p>
    </div>
  );
}

function DoneCard({ batch, walletName }: { batch: ProPayoutBatchResponse; walletName: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-text-on-accent">
        <Check className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-display-sm text-text-strong">Payout batch created</h1>
      <p className="mt-2 text-sm text-text-soft">
        Status: <span className="font-medium text-text-strong">{humanBatchStatus(batch.status)}</span>
      </p>
      <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
        <Row label="Recipients" value={String(batch.items.length)} />
        <Row label="NGN total" value={formatNgn(batch.ngn_amount_minor)} />
        <Row label="Proposal" value={batch.proposal_address ? shortAddress(batch.proposal_address) : "Pending"} />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {batch.proposal_address ? (
          <Link
            href={`/app/proposals/${encodeURIComponent(batch.proposal_address)}`}
            className="inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent"
          >
            View proposal
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}?surface=pro`}
          className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3.5 py-2 text-sm font-medium text-text-strong"
        >
          Back to wallet
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft bg-canvas px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-text-soft">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-text-strong">{value}</dd>
    </div>
  );
}

async function resolveMissingNames(rows: PayoutRow[], banks: BankListItem[]): Promise<PayoutRow[]> {
  const knownBankCodes = new Set(banks.map((bank) => bank.code));
  const resolved: PayoutRow[] = [];
  for (const row of rows) {
    if (row.accountName.trim() || !knownBankCodes.has(row.bankCode)) {
      resolved.push(row);
      continue;
    }
    resolved.push(await resolveRow(row));
  }
  return resolved;
}

async function resolveRow(row: PayoutRow): Promise<PayoutRow> {
  if (!row.bankCode || row.accountNumber.length < 10) return row;
  const resolved = await rampApi.resolveProBank(row.accountNumber, row.bankCode);
  return { ...row, accountName: resolved.account_name };
}

async function importCsv(
  file: File,
  setRows: (updater: (rows: PayoutRow[]) => PayoutRow[]) => void,
  toast: ReturnType<typeof useToast>,
) {
  const text = await file.text();
  const imported = parseCsvRows(text);
  if (imported.length === 0) {
    toast.error("No payout rows found");
    return;
  }
  setRows(() => imported.slice(0, MAX_ROWS));
  toast.success("CSV imported", { details: `${Math.min(imported.length, MAX_ROWS)} rows loaded.` });
}

function parseCsvRows(text: string): PayoutRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = splitCsvLine(line);
      const looksLikeHeader = index === 0 && cells.some((cell) => /amount|bank|account/i.test(cell));
      if (looksLikeHeader) return null;
      return {
        id: crypto.randomUUID(),
        amount: cells[0]?.trim() ?? "",
        bankCode: cells[1]?.trim() ?? "",
        accountNumber: (cells[2]?.trim() ?? "").replace(/\D/g, "").slice(0, 16),
        accountName: cells[3]?.trim() ?? "",
        email: cells[4]?.trim() ?? "",
        narration: cells[5]?.trim() ?? "",
        reference: cells[6]?.trim() ?? "",
      };
    })
    .filter((row): row is PayoutRow => row !== null);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function validateRow(row: PayoutRow): string | null {
  const amount = parseNgnMinor(row.amount);
  if (!amount || amount <= 0) return "Enter an NGN amount.";
  if (!row.bankCode) return "Choose a bank.";
  if (!/^\d{10,16}$/.test(row.accountNumber)) return "Enter a valid account number.";
  return null;
}

function emptyRow(): PayoutRow {
  return {
    id: crypto.randomUUID(),
    amount: "",
    bankCode: "",
    accountNumber: "",
    accountName: "",
    email: "",
    narration: "",
    reference: "",
  };
}

function parseNgnMinor(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

function parseSolLamports(value: string): bigint | null {
  const cleaned = value.trim();
  if (!/^\d+(\.\d{0,9})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9));
}

function formatNgn(minor: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function sanitizeDecimal(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function clean(value: string): string {
  return value.trim();
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

function humanBatchStatus(status: ProPayoutBatchResponse["status"]): string {
  switch (status) {
    case "awaiting_proposal":
      return "Waiting for funding proposal";
    case "awaiting_execution":
      return "Waiting for remaining approvals";
    case "ready_for_disbursement":
      return "Ready for Kora payout";
    case "disbursing":
      return "Disbursing";
    case "completed":
      return "Completed";
    case "partially_failed":
      return "Partially failed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "manual_review_required":
      return "Manual review required";
    default:
      return status;
  }
}
