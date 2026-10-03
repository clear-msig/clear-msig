import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection } from "@solana/web3.js";
import type { ProEscrowProject } from "@/lib/pro/escrow";
import { useToast } from "@/components/ui/Toast";
import {
  escrowOperationKey,
  loadEscrowOperation,
  saveEscrowOperation,
  readEscrowEvidence,
  executeSavedEscrow,
  submitEscrowExecution,
  type EscrowOperation,
} from "../infrastructure/escrowOperation";
export type { EscrowOperation } from "../infrastructure/escrowOperation";
export function useEscrowOperationController({
  walletName,
  project,
  connection,
  onRelease,
  onUpdate,
}: {
  walletName: string;
  project: ProEscrowProject;
  connection: Connection;
  onRelease: (projectId: string, milestoneId: string) => void;
  onUpdate: (projectId: string, patch: Partial<ProEscrowProject>) => void;
}) {
  const toast = useToast();
  const identity = useRequestIdentity();
  const scope = JSON.stringify([walletName, project.id]);
  const lifetime = useRef({ scope, generation: 0 });
  if (lifetime.current.scope !== scope)
    lifetime.current = { scope, generation: lifetime.current.generation + 1 };
  const captureIdentity = () => {
    const captured = identity.capture();
    const generation = lifetime.current.generation;
    return () => {
      captured.assertCurrent();
      if (generation !== lifetime.current.generation)
        throw new Error(
          "Escrow project changed. Review the saved request before continuing.",
        );
    };
  };
  const [submitting, setSubmitting] = useState(false);
  const operationKey = escrowOperationKey(
    walletName,
    project.id,
    connection.rpcEndpoint,
  );
  const loadSaved = useCallback(() => {
    const record = loadEscrowOperation(operationKey);
    if (
      record &&
      (record.walletName !== walletName ||
        record.execute.escrowId !== project.id)
    )
      throw new Error(
        "Saved escrow recovery belongs to a different wallet or project.",
      );
    return record;
  }, [operationKey, walletName, project.id]);
  const [operation, setOperation] = useState<EscrowOperation | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const load = () => {
      try {
        setOperation(loadSaved());
        setRecoveryError(null);
      } catch (error) {
        setRecoveryError(
          error instanceof Error
            ? error.message
            : "Escrow recovery is unavailable.",
        );
      }
      setRecoveryReady(true);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, [loadSaved]);
  const isExternal = (record: EscrowOperation) =>
    /^(cross_chain|private)_/.test(record.execute.kind);
  const operationMilestoneId =
    operation && "milestoneId" in operation.execute
      ? operation.execute.milestoneId
      : null;
  const alreadyRecorded =
    operation?.phase === "cancelled" ||
    (operation?.phase === "confirmed" &&
      !isExternal(operation) &&
      ("milestoneId" in operation.execute
        ? project.milestones.some(
            (milestone) =>
              milestone.id === operationMilestoneId &&
              milestone.status === "released",
          )
        : project.status === "returned"));
  const blocked =
    !recoveryReady ||
    !!recoveryError ||
    (!!operation && !alreadyRecorded) ||
    submitting;
  const saveOperation = (record: EscrowOperation) => {
    saveEscrowOperation(operationKey, record);
    setOperation(record);
  };
  const applyConfirmed = (record: EscrowOperation) => {
    if (record.phase !== "confirmed") return;
    if (!isExternal(record)) {
      if ("milestoneId" in record.execute)
        onRelease(record.execute.escrowId, record.execute.milestoneId);
      else onUpdate(record.execute.escrowId, { status: "returned" });
    }
    toast.info(
      isExternal(record)
        ? "Execution recorded on Solana; external settlement remains unverified"
        : "Escrow execution verified on Solana",
    );
  };
  const executeSaved = async (
    record: EscrowOperation,
    assertCurrent = captureIdentity(),
  ) => {
    assertCurrent();
    const result = await executeSavedEscrow(record, {
      read: async (saved) => {
        assertCurrent();
        const evidence = await readEscrowEvidence(connection, saved);
        assertCurrent();
        return evidence;
      },
      submit: (saved) => {
        assertCurrent();
        return submitEscrowExecution(saved);
      },
      // Save accepted or uncertain evidence even when navigation occurs during POST.
      save: saveOperation,
    });
    assertCurrent();
    return result;
  };
  const resumeOperation = async (execute: boolean) => {
    if (inFlight.current || !operation) return;
    const assertCurrent = captureIdentity();
    inFlight.current = true;
    setSubmitting(true);
    setRecoveryError(null);
    try {
      const saved = loadSaved();
      if (!saved)
        throw new Error(
          "Saved request details are missing. Review proposal history before proceeding.",
        );
      if (execute) {
        const result = await executeSaved(saved, assertCurrent);
        applyConfirmed(result);
      } else {
        const evidence = await readEscrowEvidence(connection, saved);
        assertCurrent();
        const updated: EscrowOperation = {
          ...saved,
          phase:
            evidence.status === 2
              ? "confirmed"
              : evidence.status === 3
                ? "cancelled"
                : saved.phase === "creating"
                  ? "created"
                  : saved.phase,
        };
        saveOperation(updated);
        applyConfirmed(updated);
      }
    } catch (error) {
      setRecoveryError(
        error instanceof Error
          ? error.message
          : "The existing request could not be verified.",
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return {
    operation,
    submitting,
    setSubmitting,
    recoveryError,
    inFlight,
    isExternal,
    alreadyRecorded,
    blocked,
    saveOperation,
    applyConfirmed,
    resumeOperation,
    loadSaved,
    executeSaved,
    captureIdentity,
  };
}
