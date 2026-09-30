import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgentSignalPayload } from "@/lib/agents/intake";

export const AGENT_SIGNAL_SIGNATURE_SCHEME = "hmac_sha256_v2";

export interface AgentSignalSignatureTarget {
  walletAddress: string;
  agentId: string;
  programId: string;
  network: string;
}

export interface AgentSignalSignatureInput {
  target: AgentSignalSignatureTarget;
  signal: AgentSignalPayload;
  signalKey: string;
}

export interface AgentSignalSignatureVerification {
  ok: boolean;
  scheme: typeof AGENT_SIGNAL_SIGNATURE_SCHEME;
  message: string;
}

export function signAgentSignalPayload({
  signal,
  signalKey,
  target,
}: AgentSignalSignatureInput): string {
  if (!target?.walletAddress || !target.agentId || !target.programId || !target.network ||
      !signal.clientSignalId || !Number.isSafeInteger(signal.submittedAt) || signal.submittedAt! <= 0) {
    throw new Error("Signed signal requires a canonical target, nonce and timestamp.");
  }
  return createHmac("sha256", signalKey)
    .update(JSON.stringify(stableValue({ domain: "clearsig.agent.signal", scheme: AGENT_SIGNAL_SIGNATURE_SCHEME, target, signal })))
    .digest("hex");
}

export function verifyAgentSignalSignature({
  signal,
  signalKey,
  signature,
  target,
}: AgentSignalSignatureInput & {
  signature: string;
}): AgentSignalSignatureVerification {
  const normalizedSignature = signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedSignature)) {
    return {
      ok: false,
      scheme: AGENT_SIGNAL_SIGNATURE_SCHEME,
      message: "Signal signature must be a 64-character hex HMAC.",
    };
  }
  let expected: string;
  try { expected = signAgentSignalPayload({ signal, signalKey, target }); }
  catch { return { ok: false, scheme: AGENT_SIGNAL_SIGNATURE_SCHEME, message: "Signed signal target or replay metadata is invalid." }; }
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(normalizedSignature, "hex");
  const ok =
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes);
  return {
    ok,
    scheme: AGENT_SIGNAL_SIGNATURE_SCHEME,
    message: ok
      ? "Signed decision verified."
      : "Signed decision did not match the submitted signal.",
  };
}

export function canonicalAgentSignalPayload(signal: AgentSignalPayload): string {
  return JSON.stringify(stableValue(signal));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}
