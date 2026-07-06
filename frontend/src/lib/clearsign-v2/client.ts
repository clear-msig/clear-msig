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

export interface ClearSignVoteHashes {
  propose: string;
  approve: string;
  cancel: string;
}

export interface BackendClearSignSummary extends ClearSignSummary {
  version: 2;
  kind: ClearSignEnvelope<ClearSignPayload>["kind"];
  actionKindCode: number;
  voteHashes?: ClearSignVoteHashes;
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
    return { ...response, source: "backend" };
  } catch (error) {
    if (options?.fallback === false) {
      throw error;
    }
    const local = summarizeClearSignAction(envelope);
    return {
      ...local,
      version: 2,
      kind: envelope.kind,
      actionKindCode: clearSignActionKindCode(envelope.kind),
      source: "local",
    };
  }
}
