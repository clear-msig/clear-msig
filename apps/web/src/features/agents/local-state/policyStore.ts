"use client";

import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { bindAgentVaultPolicyHash } from "@/lib/agents/policyHash";
import type { AgentVaultPolicy } from "@/lib/agents/types";
import { readAgentState as readAll, writeAgentState as writeAll } from "@/features/agents/local-state/repository";
import { appendEvent, newAgentEventId } from "@/features/agents/local-state/stateSupport";

export function getAgentVaultPolicy(walletName: string): AgentVaultPolicy {
  return normalizePolicy(
    readAll().policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName),
  );
}

export function saveAgentVaultPolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  const shape = readAll();
  const updated = normalizePolicy(policy);
  shape.policiesByWallet[policy.walletName] = updated;
  writeAll(shape);
  return updated;
}

export function setAgentVaultEmergencyPause(
  walletName: string,
  emergencyPaused: boolean,
): AgentVaultPolicy {
  const shape = readAll();
  const current = normalizePolicy(
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName),
  );
  const updated: AgentVaultPolicy = {
    ...current,
    emergencyPaused,
    updatedAt: Date.now(),
  };
  const bound = normalizePolicy(updated);
  shape.policiesByWallet[walletName] = bound;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    kind: "policy_emergency_pause_changed",
    message: emergencyPaused
      ? "Agent Trading kill switch turned on."
      : "Agent Trading kill switch turned off.",
    createdAt: bound.updatedAt,
    version: 1,
  });
  writeAll(shape);
  return bound;
}

function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
  });
}
