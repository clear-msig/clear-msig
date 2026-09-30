"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { clearSignProfileForSigner, prepareClearSignV4Action } from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import {
  resolvePersistentAssetPolicy,
  resolvePersistentSendPolicy,
} from "@/lib/policies/persistentWalletPolicy";
import { SOLANA_DEVNET_USDC_MINT } from "@/lib/policies/assetOnchain";
import { useProSchedules, type ProSchedule } from "@/lib/pro/treasury";
import { useConnection, useWallet } from "@/lib/wallet";
import {
  RECURRING_INTERVALS,
  firstRunUnix,
  newScheduleId,
  paymentCount,
  recurringAmountToRaw,
  recurringEnvelope,
  type RecurringDraft,
} from "@/features/treasury/domain/recurring";
import { fetchRecurringSchedule } from "@/features/treasury/infrastructure/recurringState";
import { resolveRecurringUsdcAccounts } from "@/features/treasury/infrastructure/recurringTokenAccounts";
import { requireRecurringExecution, recurringExecutionApplied } from "@/features/treasury/domain/recurringExecution";
import { executeRecurringOperation } from "@/features/treasury/infrastructure/executeRecurringOperation";

export function useRecurringSchedulesController(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signTypedDescriptor } = useSignWithWallet();
  const schedules = useProSchedules(walletName);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: !!walletName,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: () => walletQuery.data
      ? listIntents(connection, walletQuery.data.pda, walletQuery.data.account.intentIndex)
      : [],
    enabled: !!walletQuery.data,
  });
  const intent = useMemo(
    () => intentsQuery.data?.find((row) =>
      row.account?.intentType === IntentType.Custom
      && row.account.chainKind === 0
      && row.account.approved,
    ) ?? null,
    [intentsQuery.data],
  );
  const statesQuery = useQuery({
    queryKey: ["recurring-states", walletQuery.data?.pda.toBase58(), schedules.rows.map((row) => row.id).join(",")],
    queryFn: async () => {
      if (!walletQuery.data) return {};
      const entries = await Promise.all(schedules.rows.map(async (row) => [
        row.id,
        await fetchRecurringSchedule(connection, walletQuery.data!.pda, row.id),
      ] as const));
      return Object.fromEntries(entries);
    },
    enabled: !!walletQuery.data,
    refetchInterval: 15_000,
  });

  // A later poll (or another browser's approval) can settle an operation that
  // initially needed more signatures. Clear only after observing chain state.
  useEffect(() => {
    if (!statesQuery.data) return;
    for (const row of schedules.rows) {
      if (!row.pendingExecution) continue;
      try {
        const pending = requireRecurringExecution(row);
        if (recurringExecutionApplied(pending, statesQuery.data[row.id])) {
          schedules.upsert({ ...row, pendingExecution: undefined, updatedAt: Date.now() });
        }
      } catch {
        // Keep corrupt/legacy records visible for manual proposal review.
      }
    }
  }, [statesQuery.data, schedules]);

  async function runExclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (inFlight.current) throw new Error("Another schedule action is still running.");
    inFlight.current = true;
    setBusyId(id);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }

  async function refreshOperation(row: ProSchedule) {
    const result = await statesQuery.refetch();
    const pending = requireRecurringExecution(row);
    if (recurringExecutionApplied(pending, result.data?.[row.id])) {
      schedules.upsert({ ...row, pendingExecution: undefined, updatedAt: Date.now() });
    }
  }

  async function configure(draft: RecurringDraft) {
    const walletData = walletQuery.data;
    if (!walletData) throw new Error("This treasury is still loading.");
    const scheduleId = newScheduleId();
    const firstExecutionAt = firstRunUnix(draft.firstRun);
    const count = paymentCount(draft.paymentCount);
    const intervalSeconds = RECURRING_INTERVALS[draft.cadence];
    const tokenAccounts = draft.asset === "USDC"
      ? await resolveRecurringUsdcAccounts(connection, draft.recipient, walletData.pda)
      : null;
    const row: ProSchedule = {
      id: scheduleId,
      name: draft.name.trim(),
      address: draft.recipient.trim(),
      category: "vendor",
      amount: draft.amount.trim(),
      asset: draft.asset,
      cadence: draft.cadence,
      nextRun: new Date(firstExecutionAt * 1000).toISOString(),
      note: draft.note.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intervalSeconds,
      firstExecutionAt,
      paymentCount: count,
      mint: tokenAccounts?.mint,
      sourceToken: tokenAccounts?.sourceToken,
      destinationToken: tokenAccounts?.destinationToken,
      recipientOwner: tokenAccounts?.recipientOwner,
      policyVersion: draft.asset === "USDC" ? "CSP2" : undefined,
    };
    await proposeAndExecute(row, 1);
  }

  async function proposeAndExecute(row: ProSchedule, status: 1 | 2) {
    if (row.pendingExecution && !recurringExecutionApplied(requireRecurringExecution(row), statesQuery.data?.[row.id])) {
      throw new Error("This schedule already has a pending request. Retry or review that proposal first.");
    }
    if (status === 2 && statesQuery.data?.[row.id]?.status !== "active") {
      throw new Error("Load the active onchain schedule before creating a revocation.");
    }
    const selectedIntent = intent?.account;
    const walletData = walletQuery.data;
    if (!selectedIntent || !intent || !walletData) throw new Error("Solana protection is not ready for this treasury.");
    const proposer = wallet.pickSigner(selectedIntent.proposers);
    if (!proposer) throw new Error("A connected proposer is required.");
    if (!row.address || !row.intervalSeconds || !row.firstExecutionAt || !row.paymentCount) {
      throw new Error("Schedule execution details are incomplete.");
    }
    const asset = row.asset === "USDC" ? "USDC" : "SOL";
    recurringAmountToRaw(row.amount, asset);
    if (asset === "USDC" && (!row.mint || !row.sourceToken || !row.destinationToken || !row.recipientOwner)) {
      throw new Error("This USDC schedule is missing its bound token accounts.");
    }
    {
      const onchain = statesQuery.data?.[row.id] ?? null;
      const firstExecutionAt = status === 2 && onchain ? onchain.nextExecutionAt : row.firstExecutionAt;
      const count = status === 2 && onchain ? onchain.remainingPayments : row.paymentCount;
      if (!Number.isSafeInteger(firstExecutionAt) || firstExecutionAt <= 0
        || !Number.isSafeInteger(count) || count <= 0 || count > 1_000) {
        throw new Error("The schedule timing or remaining payment count is invalid.");
      }
      const envelope = recurringEnvelope({
        walletName,
        scheduleId: row.id,
        recipient: row.address,
        amount: row.amount,
        asset,
        mint: row.mint,
        sourceToken: row.sourceToken,
        destinationToken: row.destinationToken,
        intervalSeconds: row.intervalSeconds,
        firstExecutionAt,
        paymentCount: count,
        status: status === 1 ? "active" : "revoked",
        reason: row.note,
      });
      const legacyTokenSchedule = asset === "USDC"
        && status === 2
        && onchain?.policyVersion === "CSP1";
      const policy = asset === "USDC" && !legacyTokenSchedule
        ? await resolvePersistentAssetPolicy(
            connection,
            walletData.pda,
            walletName,
            row.mint ?? SOLANA_DEVNET_USDC_MINT,
          )
        : await resolvePersistentSendPolicy(connection, walletData.pda, walletName, 0);
      const summary = await prepareClearSignV4Action(envelope, {
        intentIndex: selectedIntent.intentIndex,
        actorPubkey: proposer.toBase58(),
        policyBytesHex: policy?.hex,
        deviceProfile: clearSignProfileForSigner(wallet, proposer),
      });
      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: selectedIntent.intentIndex,
        action_kind: summary.actionKindCode,
        policy_commitment: summary.policyCommitment,
        payload_hash: summary.payloadHash,
        envelope_hash: summary.envelopeHash,
        action_id: envelope.actionId,
        nonce: envelope.nonce,
        policyBytesHex: policy?.hex,
        signable_text: summary.signableText,
        canonical_intent_hex: summary.canonicalIntentHex,
        expiry: formatUnixSigningExpiry(envelope.expiresAt),
        actor_pubkey: proposer.toBase58(),
      });
      const signed = await signTypedDescriptor(dry, {
        preferSigner: proposer,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });
      const created = await backendApi.submit.createTypedProposal(walletName, {
        ...signed,
        expiry: dry.expiry,
        intent_index: dry.intent_index,
        action_kind: dry.action_kind,
        policy_commitment: dry.policy_commitment_hex,
        payload_hash: dry.payload_hash_hex,
        envelope_hash: dry.envelope_hash_hex,
        action_id: dry.action_id,
        nonce: dry.nonce,
        policyBytesHex: policy?.hex,
        canonical_intent_hex: dry.canonical_intent_hex,
      });
      const proposalAddress = stringField(created, "proposal");
      if (!proposalAddress) throw new Error("The schedule proposal address was not returned.");
      const persisted: ProSchedule = {
        ...row,
        proposalAddress,
        policyVersion: asset === "USDC" && !legacyTokenSchedule ? "CSP2" : "CSP1",
        pendingExecution: {
          version: 1,
          proposalAddress,
          scheduleId: row.id,
          status,
          asset,
          recipient: row.address,
          amount: row.amount,
          intervalSeconds: row.intervalSeconds,
          firstExecutionAt,
          paymentCount: count,
          policyVersion: asset === "USDC" && !legacyTokenSchedule ? "CSP2" : "CSP1",
          mint: row.mint,
          sourceToken: row.sourceToken,
          destinationToken: row.destinationToken,
          recipientOwner: row.recipientOwner,
        },
        intentAddress: intent.pda.toBase58(),
        updatedAt: Date.now(),
      };
      schedules.upsert(persisted);
      try {
        await executeRecurringOperation(walletName, requireRecurringExecution(persisted));
      } catch (error) {
        if (!needsApproval(error)) throw error;
      }
      await refreshOperation(persisted);
    }
  }

  async function retry(row: ProSchedule) {
    const pending = requireRecurringExecution(row);
    if (recurringExecutionApplied(pending, statesQuery.data?.[row.id])) {
      schedules.upsert({ ...row, pendingExecution: undefined, updatedAt: Date.now() });
      return;
    }
    await executeRecurringOperation(walletName, pending);
    await refreshOperation(row);
  }

  async function pay(row: ProSchedule) {
    const state = statesQuery.data?.[row.id];
    if (!state || state.status !== "active") throw new Error("This schedule is not active onchain.");
    if (row.pendingExecution && !recurringExecutionApplied(requireRecurringExecution(row), state)) {
      throw new Error("Finish the pending schedule request before making another payment.");
    }
    {
      if (state.asset === "USDC") {
        if (!state.mint || !state.sourceToken || !state.destinationToken) {
          throw new Error("The onchain USDC schedule is incomplete.");
        }
        const executePayment = state.policyVersion === "CSP2"
          ? backendApi.executeRecurringAssetPayment
          : backendApi.executeRecurringTokenPayment;
        await executePayment(walletName, {
          intent: state.intent,
          scheduleId: row.id,
          mint: state.mint,
          sourceToken: state.sourceToken,
          destinationToken: state.destinationToken,
          recipientOwner: state.recipient,
        });
      } else {
        await backendApi.executeRecurringPayment(walletName, {
          intent: state.intent,
          scheduleId: row.id,
          recipient: state.recipient,
        });
      }
      await statesQuery.refetch();
    }
  }

  return {
    rows: schedules.rows,
    states: statesQuery.data ?? {},
    loading: walletQuery.isLoading || intentsQuery.isLoading || statesQuery.isLoading,
    error: walletQuery.error || intentsQuery.error || statesQuery.error,
    busyId,
    configure: (draft: RecurringDraft) => runExclusive("new", () => configure(draft)),
    retry: (row: ProSchedule) => runExclusive(row.id, () => retry(row)),
    pay: (row: ProSchedule) => runExclusive(row.id, () => pay(row)),
    revoke: (row: ProSchedule) => runExclusive(row.id, () => proposeAndExecute(row, 2)),
    remove: schedules.remove,
  };
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : null;
}

function needsApproval(error: unknown): boolean {
  return /not approved|ProposalNotApproved|must be 'Approved'|needs approval/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
