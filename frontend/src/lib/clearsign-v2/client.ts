import { apiRequest } from "@/lib/api/client";
import {
  clearSignActionKindCode,
  summarizeClearSignAction,
  type ClearSignEnvelope,
  type ClearSignPayload,
  type ClearSignSummary,
} from "@/lib/clearsign-v2/actions";

export interface ClearSignVotePrepareInput {
  walletId: string;
  proposalIndex: number;
}

export interface ClearSignVoteMessages {
  propose: string;
  approve: string;
  cancel: string;
}

export interface BackendClearSignSummary extends ClearSignSummary {
  version: 2;
  kind: ClearSignEnvelope<ClearSignPayload>["kind"];
  actionKindCode: number;
  voteMessages?: ClearSignVoteMessages;
  source: "backend" | "local";
}

export async function prepareClearSignAction(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  options?: {
    vote?: ClearSignVotePrepareInput;
    signal?: AbortSignal;
    fallback?: boolean;
  },
): Promise<BackendClearSignSummary> {
  const local = summarizeClearSignAction(envelope);
  try {
    const response = await apiRequest<
      Omit<BackendClearSignSummary, "source">,
      {
        envelope: ClearSignEnvelope<ClearSignPayload>;
        vote?: ClearSignVotePrepareInput;
      }
    >(
      "/v1/clearsign/v2/prepare",
      "POST",
      { envelope, vote: options?.vote },
      { timeoutMs: 10_000, signal: options?.signal },
    );
    assertBackendSummaryMatchesLocal(response, local, envelope);
    return { ...response, source: "backend" };
  } catch (error) {
    if (options?.fallback !== true) {
      throw error;
    }
    return {
      ...local,
      version: 2,
      kind: envelope.kind,
      actionKindCode: clearSignActionKindCode(envelope.kind),
      source: "local",
    };
  }
}

function assertBackendSummaryMatchesLocal(
  response: Omit<BackendClearSignSummary, "source">,
  local: ClearSignSummary,
  envelope: ClearSignEnvelope<ClearSignPayload>,
): void {
  const sameLines =
    response.lines.length === local.lines.length &&
    response.lines.every((line, index) => line === local.lines[index]);
  if (
    response.version !== 2 ||
    response.kind !== envelope.kind ||
    response.actionKindCode !== clearSignActionKindCode(envelope.kind) ||
    response.headline !== local.headline ||
    !sameLines ||
    response.payloadHash.toLowerCase() !== local.payloadHash ||
    response.envelopeHash.toLowerCase() !== local.envelopeHash ||
    response.signableText !== local.signableText
  ) {
    throw new Error(
      "ClearSign verification failed: the backend prepared different transaction details.",
    );
  }
}
