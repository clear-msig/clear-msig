import { describe, expect, it } from "vitest";
import {
  bindAgentVaultPolicyHash,
  computeAgentVaultPolicyHash,
  decryptAgentVaultPolicy,
  defaultAgentVaultPolicy,
  encryptAgentVaultPolicy,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent policy hash binding", () => {
  it("is deterministic across venue and market ordering", () => {
    const first = defaultAgentVaultPolicy("vault", now);
    const second = {
      ...first,
      allowedVenues: [...first.allowedVenues].reverse(),
      allowedMarkets: [...first.allowedMarkets].reverse(),
    };

    expect(computeAgentVaultPolicyHash(first)).toBe(
      computeAgentVaultPolicyHash(second),
    );
  });

  it("changes when private policy controls change", () => {
    const base = defaultAgentVaultPolicy("vault", now);
    const tighter = {
      ...base,
      maxNotionalUsd: "100",
    };

    expect(computeAgentVaultPolicyHash(base)).not.toBe(
      computeAgentVaultPolicyHash(tighter),
    );
  });

  it("does not change when emergency pause changes", () => {
    const base = defaultAgentVaultPolicy("vault", now);
    const paused = {
      ...base,
      emergencyPaused: true,
    };

    expect(computeAgentVaultPolicyHash(base)).toBe(
      computeAgentVaultPolicyHash(paused),
    );
  });

  it("preserves encrypted policy commitments across storage normalization", async () => {
    const policy = defaultAgentVaultPolicy("vault", now);
    const encrypted = await encryptAgentVaultPolicy(policy);
    const normalized = bindAgentVaultPolicyHash(encrypted);
    const decrypted = await decryptAgentVaultPolicy(normalized);

    expect(encrypted.policyHash).toBe(policy.policyHash);
    expect(normalized.policyHash).toBe(policy.policyHash);
    expect(decrypted.policyHash).toBe(policy.policyHash);
  });

  it("retains enforcement controls while Encrypt is still pre-alpha", async () => {
    const policy = defaultAgentVaultPolicy("vault", now);
    const encrypted = await encryptAgentVaultPolicy(policy);

    expect(encrypted.encryptedMaxNotionalUsd).toBeTruthy();
    expect(encrypted.maxNotionalUsd).toBe(policy.maxNotionalUsd);
    expect(encrypted.allowedMarkets).toEqual(policy.allowedMarkets);
    expect(encrypted.requireStopLoss).toBe(true);
  });

  it("recomputes the policy commitment when encrypted policy controls change", async () => {
    const encrypted = await encryptAgentVaultPolicy(
      defaultAgentVaultPolicy("vault", now),
    );
    const changed = await encryptAgentVaultPolicy({
      ...encrypted,
      maxNotionalUsd: "125",
    });

    expect(changed.policyHash).not.toBe(encrypted.policyHash);
  });
});
