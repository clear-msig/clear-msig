import { apiRequest } from "@/lib/api/client";
import {
  clearSignActionKindCode,
  summarizeClearSignAction,
  type ClearSignEnvelope,
  type ClearSignPayload,
  type ClearSignSummary,
} from "@/lib/clearsign/actions";
import {
  FULL_CLEARSIGN_PROFILE,
  type ClearSignDeviceProfileRequest,
} from "@/lib/clearsign/deviceProfiles";

export interface BackendClearSignSummary extends ClearSignSummary {
  version: 3;
  kind: ClearSignEnvelope<ClearSignPayload>["kind"];
  actionKindCode: number;
  source: "backend" | "local";
}

export async function prepareClearSignAction(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  options?: {
    signal?: AbortSignal;
    fallback?: boolean;
    deviceProfile?: ClearSignDeviceProfileRequest;
  },
): Promise<BackendClearSignSummary> {
  const deviceProfile = options?.deviceProfile ?? FULL_CLEARSIGN_PROFILE;
  const local = summarizeClearSignAction(envelope, deviceProfile);
  try {
    const response = await apiRequest<
      Omit<BackendClearSignSummary, "source">,
      {
        envelope: ClearSignEnvelope<ClearSignPayload>;
        deviceProfile: ClearSignDeviceProfileRequest;
      }
    >(
      "/v1/clearsign/v3/prepare",
      "POST",
      { envelope, deviceProfile },
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
      version: 3,
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
    response.version !== 3 ||
    response.kind !== envelope.kind ||
    response.actionKindCode !== clearSignActionKindCode(envelope.kind) ||
    response.headline !== local.headline ||
    !sameLines ||
    response.payloadHash.toLowerCase() !== local.payloadHash ||
    response.envelopeHash.toLowerCase() !== local.envelopeHash ||
    response.signableText !== local.signableText ||
    response.deviceProfile.id !== local.deviceProfile.id ||
    response.deviceProfile.version !== local.deviceProfile.version ||
    response.deviceProfile.mode !== local.deviceProfile.mode ||
    response.deviceProfile.maxDocumentBytes !==
      local.deviceProfile.maxDocumentBytes
  ) {
    throw new Error(
      "ClearSign verification failed: the backend prepared different transaction details.",
    );
  }
}
