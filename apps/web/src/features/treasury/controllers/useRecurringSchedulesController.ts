"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  removeRecurringJournal,
  readRecurringJournal,
  writeRecurringJournal,
} from "@/features/treasury/infrastructure/recurringJournal";
import {
  assertSubmittedCreation,
  reviewedCreationProposalAddress,
} from "@/lib/clearsign/inlineApproval";
import { readCanonicalProposalReview } from "@/lib/clearsign/readProposalReview";
import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import {
  clearSignProfileForSigner,
  prepareClearSignV4Action,
} from "@/lib/clearsign";
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
import {
  requireRecurringExecution,
  recurringExecutionApplied,
} from "@/features/treasury/domain/recurringExecution";
import { executeRecurringOperation } from "@/features/treasury/infrastructure/executeRecurringOperation";

export function useRecurringSchedulesController(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signTypedDescriptor } = useSignWithWallet();
  const schedules = useProSchedules(walletName);
  const [journal, setJournal] = useState<ProSchedule[]>([]);
  const [journalError, setJournalError] = useState<Error | null>(null);
  useEffect(() => {
    try {
      setJournal(readRecurringJournal(walletName, connection.rpcEndpoint));
      setJournalError(null);
    } catch (error) {
      setJournalError(
        error instanceof Error
          ? error
          : new Error("Recurring recovery unavailable"),
      );
    }
  }, [walletName, connection.rpcEndpoint]);
  const rows = useMemo(() => {
    const saved = new Map(schedules.rows.map((row) => [row.id, row]));
    for (const row of journal) saved.set(row.id, row);
    return [...saved.values()];
  }, [schedules.rows, journal]);
  const persist = (row: ProSchedule) => {
    setJournal(writeRecurringJournal(walletName, connection.rpcEndpoint, row));
    schedules.upsert(row);
  };
  const savedRow = (row: ProSchedule) =>
    readRecurringJournal(walletName, connection.rpcEndpoint).find(
      (saved) => saved.id === row.id,
    ) ?? row;

  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: !!walletName,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: () =>
      walletQuery.data
        ? listIntents(
            connection,
            walletQuery.data.pda,
            walletQuery.data.account.intentIndex,
          )
        : [],
    enabled: !!walletQuery.data,
  });
  const intent = useMemo(
    () =>
      intentsQuery.data?.find(
        (row) =>
          row.account?.intentType === IntentType.Custom &&
          row.account.chainKind === 0 &&
          row.account.approved,
      ) ?? null,
    [intentsQuery.data],
  );
  const statesQuery = useQuery({
    queryKey: [
      "recurring-states",
      walletQuery.data?.pda.toBase58(),
      rows.map((row) => row.id).join(","),
    ],
    queryFn: async () => {
      if (!walletQuery.data) return {};
      const entries = await Promise.all(
        rows.map(
          async (row) =>
            [
              row.id,
              await fetchRecurringSchedule(
                connection,
                walletQuery.data!.pda,
                row.id,
              ),
            ] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
    enabled: !!walletQuery.data,
    refetchInterval: 15_000,
  });

  async function runExclusive<T>(
    id: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (inFlight.current)
      throw new Error("Another schedule action is still running.");
    inFlight.current = true;
    setBusyId(id);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }

  async function verifiedOperation(row: ProSchedule) {
    const pending = requireRecurringExecution(row);
    if (!pending.envelopeHash || !pending.payloadHash)
      throw new Error(
        "This older request has no saved canonical commitment. Review its proposal; automatic execution is unavailable.",
      );
    const review = await readCanonicalProposalReview(
      connection,
      pending.proposalAddress,
      walletName,
    );
    if (
      review.envelopeHash !== pending.envelopeHash ||
      review.payloadHash !== pending.payloadHash ||
      review.binding.actionKind !== 15
    )
      throw new Error(
        "Recurring proposal does not match its saved canonical request.",
      );
    const details =
      review.sections
        .find((section) => section.title === "DETAILS")
        ?.text.split("\n") ?? [];
    if (
      details.filter((line) => line.startsWith("Schedule: ")).length !== 1 ||
      !details.includes(`Schedule: ${pending.scheduleId}`)
    )
      throw new Error(
        "Saved recurring schedule identity differs from the canonical document.",
      );
    if (review.status === 2 || review.status === 3) {
      persist({ ...row, pendingExecution: undefined, updatedAt: Date.now() });
      await statesQuery.refetch();
      return true;
    }
    return false;
  }

  async function configure(draft: RecurringDraft) {
    if (
      readRecurringJournal(walletName, connection.rpcEndpoint).some(
        (row) => row.pendingExecution?.phase === "creating",
      )
    )
      throw new Error(
        "An earlier schedule creation has an uncertain outcome. Refresh its existing request before creating another.",
      );
    const walletData = walletQuery.data;
    if (!walletData) throw new Error("This treasury is still loading.");
    const scheduleId = newScheduleId();
    const firstExecutionAt = firstRunUnix(draft.firstRun);
    const count = paymentCount(draft.paymentCount);
    const intervalSeconds = RECURRING_INTERVALS[draft.cadence];
    const tokenAccounts =
      draft.asset === "USDC"
        ? await resolveRecurringUsdcAccounts(
            connection,
            draft.recipient,
            walletData.pda,
          )
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
    if (
      row.pendingExecution &&
      !recurringExecutionApplied(
        requireRecurringExecution(row),
        statesQuery.data?.[row.id],
      )
    ) {
      throw new Error(
        "This schedule already has a pending request. Retry or review that proposal first.",
      );
    }
    if (status === 2 && statesQuery.data?.[row.id]?.status !== "active") {
      throw new Error(
        "Load the active onchain schedule before creating a revocation.",
      );
    }
    const selectedIntent = intent?.account;
    const walletData = walletQuery.data;
    if (!selectedIntent || !intent || !walletData)
      throw new Error("Solana protection is not ready for this treasury.");
    const proposer = wallet.pickSigner(selectedIntent.proposers);
    if (!proposer) throw new Error("A connected proposer is required.");
    if (
      !row.address ||
      !row.intervalSeconds ||
      !row.firstExecutionAt ||
      !row.paymentCount
    ) {
      throw new Error("Schedule execution details are incomplete.");
    }
    const asset = row.asset === "USDC" ? "USDC" : "SOL";
    recurringAmountToRaw(row.amount, asset);
    if (
      asset === "USDC" &&
      (!row.mint ||
        !row.sourceToken ||
        !row.destinationToken ||
        !row.recipientOwner)
    ) {
      throw new Error(
        "This USDC schedule is missing its bound token accounts.",
      );
    }
    {
      const onchain = statesQuery.data?.[row.id] ?? null;
      const firstExecutionAt =
        status === 2 && onchain
          ? onchain.nextExecutionAt
          : row.firstExecutionAt;
      const count =
        status === 2 && onchain ? onchain.remainingPayments : row.paymentCount;
      if (
        !Number.isSafeInteger(firstExecutionAt) ||
        firstExecutionAt <= 0 ||
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        count > 1_000
      ) {
        throw new Error(
          "The schedule timing or remaining payment count is invalid.",
        );
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
      const legacyTokenSchedule =
        asset === "USDC" && status === 2 && onchain?.policyVersion === "CSP1";
      const policy =
        asset === "USDC" && !legacyTokenSchedule
          ? await resolvePersistentAssetPolicy(
              connection,
              walletData.pda,
              walletName,
              row.mint ?? SOLANA_DEVNET_USDC_MINT,
            )
          : await resolvePersistentSendPolicy(
              connection,
              walletData.pda,
              walletName,
              0,
            );
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
      const proposalAddress = reviewedCreationProposalAddress(dry, summary);
      const persisted: ProSchedule = {
        ...row,
        proposalAddress,
        policyVersion:
          asset === "USDC" && !legacyTokenSchedule ? "CSP2" : "CSP1",
        pendingExecution: {
          version: 1,
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          phase: "creating",
          proposalAddress,
          scheduleId: row.id,
          status,
          asset,
          recipient: row.address,
          amount: row.amount,
          intervalSeconds: row.intervalSeconds,
          firstExecutionAt,
          paymentCount: count,
          policyVersion:
            asset === "USDC" && !legacyTokenSchedule ? "CSP2" : "CSP1",
          mint: row.mint,
          sourceToken: row.sourceToken,
          destinationToken: row.destinationToken,
          recipientOwner: row.recipientOwner,
        },
        intentAddress: intent.pda.toBase58(),
        updatedAt: Date.now(),
      };
      persist(persisted);
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
      assertSubmittedCreation(dry, summary, stringField(created, "proposal"));
      const accepted: ProSchedule = {
        ...persisted,
        pendingExecution: { ...persisted.pendingExecution!, phase: "created" },
      };
      persist(accepted);
      await retry(accepted);
    }
  }

  async function retry(input: ProSchedule) {
    const row = savedRow(input);
    if (row.pendingPayment) {
      await verifyPayment(row);
      return;
    }
    const pending = requireRecurringExecution(row);
    if (await verifiedOperation(row)) return;
    const review = await readCanonicalProposalReview(
      connection,
      pending.proposalAddress,
      walletName,
    );
    if (pending.phase === "attempted")
      throw new Error(
        "Execution outcome is still unconfirmed. No repeat transaction was sent; refresh this existing request later.",
      );
    if (pending.phase === "creating") {
      persist({ ...row, pendingExecution: { ...pending, phase: "created" } });
      return;
    }
    if (review.status !== 1) return;
    const attempted: ProSchedule = {
      ...row,
      pendingExecution: { ...pending, phase: "attempted" },
    };
    persist(attempted);
    const response = await executeRecurringOperation(walletName, pending);
    const txid = solanaSubmissionTxid(response, {
      proposal: pending.proposalAddress,
      requireProposal: true,
    });
    persist({
      ...attempted,
      pendingExecution: { ...attempted.pendingExecution!, txid },
    });
    if (!(await verifiedOperation(attempted)))
      throw new Error(
        "Schedule execution submitted; finalized verification remains pending. Refresh the existing request, not a new one.",
      );
  }

  const paymentFingerprint = (
    state: NonNullable<Awaited<ReturnType<typeof fetchRecurringSchedule>>>,
  ) =>
    JSON.stringify([
      state.intent,
      state.recipient,
      state.asset,
      state.amountRaw.toString(),
      state.mint,
      state.sourceToken,
      state.destinationToken,
      state.intervalSeconds,
    ]);
  async function verifyPayment(row: ProSchedule) {
    if (!row.pendingPayment || !walletQuery.data)
      throw new Error("Payment recovery details are missing.");
    const state = await fetchRecurringSchedule(
      connection,
      walletQuery.data.pda,
      row.id,
    );
    const pending = row.pendingPayment;
    if (
      !state ||
      state.address !== pending.address ||
      paymentFingerprint(state) !== pending.fingerprint ||
      state.executedPayments !== pending.executedPayments + 1 ||
      state.remainingPayments !== pending.remainingPayments - 1
    )
      throw new Error(
        "The scheduled payment is not yet verified at finalized commitment. Do not pay again; refresh its status.",
      );
    persist({ ...row, pendingPayment: undefined, updatedAt: Date.now() });
    await statesQuery.refetch();
  }

  async function pay(input: ProSchedule) {
    const row = savedRow(input);
    if (row.pendingPayment) {
      await verifyPayment(row);
      return;
    }
    if (!walletQuery.data) throw new Error("Treasury is still loading.");
    const state = await fetchRecurringSchedule(
      connection,
      walletQuery.data.pda,
      row.id,
    );
    if (!state || state.status !== "active")
      throw new Error("This schedule is not active onchain.");
    if (
      row.pendingExecution &&
      !recurringExecutionApplied(requireRecurringExecution(row), state)
    ) {
      throw new Error(
        "Finish the pending schedule request before making another payment.",
      );
    }
    {
      if (state.nextExecutionAt > Math.floor(Date.now() / 1000))
        throw new Error("This scheduled payment is not due yet.");
      const attempted: ProSchedule = {
        ...row,
        pendingPayment: {
          executedPayments: state.executedPayments,
          remainingPayments: state.remainingPayments,
          address: state.address,
          fingerprint: paymentFingerprint(state),
        },
      };
      persist(attempted);
      let response: Record<string, unknown>;
      if (state.asset === "USDC") {
        if (!state.mint || !state.sourceToken || !state.destinationToken) {
          throw new Error("The onchain USDC schedule is incomplete.");
        }
        const executePayment =
          state.policyVersion === "CSP2"
            ? backendApi.executeRecurringAssetPayment
            : backendApi.executeRecurringTokenPayment;
        response = await executePayment(
          walletName,
          {
            intent: state.intent,
            scheduleId: row.id,
            mint: state.mint,
            sourceToken: state.sourceToken,
            destinationToken: state.destinationToken,
            recipientOwner: state.recipient,
          },
          { retry: false },
        );
      } else {
        response = await backendApi.executeRecurringPayment(
          walletName,
          {
            intent: state.intent,
            scheduleId: row.id,
            recipient: state.recipient,
          },
          { retry: false },
        );
      }
      const txid = solanaSubmissionTxid(response);
      if (
        response.schedule !== state.address ||
        response.schedule_id !== row.id
      )
        throw new Error(
          "Payment response names a different schedule; outcome remains unknown.",
        );
      persist({
        ...attempted,
        pendingPayment: { ...attempted.pendingPayment!, txid },
      });
      await verifyPayment(attempted);
    }
  }

  return {
    rows,
    states: statesQuery.data ?? {},
    loading:
      walletQuery.isLoading || intentsQuery.isLoading || statesQuery.isLoading,
    error:
      journalError ||
      walletQuery.error ||
      intentsQuery.error ||
      statesQuery.error,
    busyId,
    configure: (draft: RecurringDraft) =>
      runExclusive("new", () => configure(draft)),
    retry: (row: ProSchedule) => runExclusive(row.id, () => retry(row)),
    pay: (row: ProSchedule) => runExclusive(row.id, () => pay(row)),
    revoke: (row: ProSchedule) =>
      runExclusive(row.id, () => proposeAndExecute(row, 2)),
    remove: (id: string) => {
      const saved = readRecurringJournal(
        walletName,
        connection.rpcEndpoint,
      ).find((row) => row.id === id);
      if (saved?.pendingExecution || saved?.pendingPayment)
        throw new Error(
          "Resolve the saved request before removing its recovery details.",
        );
      setJournal(
        removeRecurringJournal(walletName, connection.rpcEndpoint, id),
      );
      schedules.remove(id);
    },
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
