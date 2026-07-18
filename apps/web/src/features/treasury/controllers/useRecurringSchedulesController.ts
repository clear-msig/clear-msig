"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { clearSignProfileForSigner, prepareClearSignV4Action } from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";
import { useProSchedules, type ProSchedule } from "@/lib/pro/treasury";
import { useConnection, useWallet } from "@/lib/wallet";
import {
  RECURRING_INTERVALS,
  firstRunUnix,
  newScheduleId,
  paymentCount,
  recurringEnvelope,
  solToLamports,
  type RecurringDraft,
} from "@/features/treasury/domain/recurring";
import { fetchRecurringSchedule } from "@/features/treasury/infrastructure/recurringState";

export function useRecurringSchedulesController(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signTypedDescriptor } = useSignWithWallet();
  const schedules = useProSchedules(walletName);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  async function configure(draft: RecurringDraft) {
    const scheduleId = newScheduleId();
    const firstExecutionAt = firstRunUnix(draft.firstRun);
    const count = paymentCount(draft.paymentCount);
    const intervalSeconds = RECURRING_INTERVALS[draft.cadence];
    const row: ProSchedule = {
      id: scheduleId,
      name: draft.name.trim(),
      address: draft.recipient.trim(),
      category: "vendor",
      amount: draft.amount.trim(),
      asset: "SOL",
      cadence: draft.cadence,
      nextRun: new Date(firstExecutionAt * 1000).toISOString(),
      note: draft.note.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intervalSeconds,
      firstExecutionAt,
      paymentCount: count,
    };
    await proposeAndExecute(row, 1);
  }

  async function proposeAndExecute(row: ProSchedule, status: 1 | 2) {
    const selectedIntent = intent?.account;
    const walletData = walletQuery.data;
    if (!selectedIntent || !intent || !walletData) throw new Error("SOL protection is not ready for this treasury.");
    const proposer = wallet.pickSigner(selectedIntent.proposers);
    if (!proposer) throw new Error("A connected proposer is required.");
    if (!row.address || !row.intervalSeconds || !row.firstExecutionAt || !row.paymentCount) {
      throw new Error("Schedule execution details are incomplete.");
    }
    solToLamports(row.amount);
    setBusyId(row.id);
    try {
      const onchain = statesQuery.data?.[row.id] ?? null;
      const firstExecutionAt = status === 2 && onchain ? onchain.nextExecutionAt : row.firstExecutionAt;
      const count = status === 2 && onchain ? onchain.remainingPayments : row.paymentCount;
      const envelope = recurringEnvelope({
        walletName,
        scheduleId: row.id,
        recipient: row.address,
        amount: row.amount,
        intervalSeconds: row.intervalSeconds,
        firstExecutionAt,
        paymentCount: count,
        status: status === 1 ? "active" : "revoked",
        reason: row.note,
      });
      const policy = await resolvePersistentSendPolicy(connection, walletData.pda, walletName, 0);
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
      const persisted = {
        ...row,
        proposalAddress,
        intentAddress: intent.pda.toBase58(),
        updatedAt: Date.now(),
      };
      schedules.upsert(persisted);
      try {
        await backendApi.executeTypedRecurringSchedule(walletName, proposalAddress, {
          scheduleId: row.id,
          recipient: row.address,
          amountLamports: solToLamports(row.amount),
          intervalSeconds: row.intervalSeconds,
          firstExecutionAt,
          paymentCount: count,
          status,
        });
      } catch (error) {
        if (!needsApproval(error)) throw error;
      }
      await statesQuery.refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function retry(row: ProSchedule) {
    if (!row.proposalAddress || !row.address || !row.intervalSeconds || !row.firstExecutionAt || !row.paymentCount) {
      throw new Error("This pending schedule is missing execution metadata.");
    }
    setBusyId(row.id);
    try {
      await backendApi.executeTypedRecurringSchedule(walletName, row.proposalAddress, {
        scheduleId: row.id,
        recipient: row.address,
        amountLamports: solToLamports(row.amount),
        intervalSeconds: row.intervalSeconds,
        firstExecutionAt: row.firstExecutionAt,
        paymentCount: row.paymentCount,
        status: 1,
      });
      await statesQuery.refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function pay(row: ProSchedule) {
    const state = statesQuery.data?.[row.id];
    if (!state) throw new Error("This schedule is not active onchain.");
    setBusyId(row.id);
    try {
      await backendApi.executeRecurringPayment(walletName, {
        intent: state.intent,
        scheduleId: row.id,
        recipient: state.recipient,
      });
      await statesQuery.refetch();
    } finally {
      setBusyId(null);
    }
  }

  return {
    rows: schedules.rows,
    states: statesQuery.data ?? {},
    loading: walletQuery.isLoading || intentsQuery.isLoading,
    busyId,
    configure,
    retry,
    pay,
    revoke: (row: ProSchedule) => proposeAndExecute(row, 2),
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
