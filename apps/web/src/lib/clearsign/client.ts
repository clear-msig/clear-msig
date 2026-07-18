import { apiRequest } from "@/lib/api/client";
import {
  FULL_CLEARSIGN_PROFILE,
  type ClearSignDeviceProfileRequest,
} from "@/lib/clearsign/deviceProfiles";
import type {
  ClearSignIntentInput,
  ClearSignPayload,
} from "@/lib/clearsign/intentInput";

export interface BackendClearSignV4Summary {
  version: 4;
  kind: ClearSignIntentInput<ClearSignPayload>["kind"];
  actionKindCode: number;
  headline: string;
  lines: string[];
  payloadHash: string;
  envelopeHash: string;
  canonicalIntentHash: string;
  canonicalIntentHex: string;
  policyCommitment: string;
  signableText: string;
  deviceProfile: {
    id: "clearsig-full-v2" | "clearsig-ledger-solana-v2";
    version: 1;
    mode: "full" | "compact";
    maxDocumentBytes: 1792 | 1024;
  };
  source: "backend";
}

export async function prepareClearSignV4Action(
  intent: ClearSignIntentInput<ClearSignPayload>,
  options: {
    intentIndex: number;
    actorPubkey: string;
    policyBytesHex?: string;
    signal?: AbortSignal;
    deviceProfile?: ClearSignDeviceProfileRequest;
  },
): Promise<BackendClearSignV4Summary> {
  const deviceProfile = options.deviceProfile ?? FULL_CLEARSIGN_PROFILE;
  const { policyCommitment: _browserPolicyAssertion, ...untrustedEnvelope } =
    intent;
  const response = await apiRequest<
    Omit<BackendClearSignV4Summary, "source">,
    {
      envelope: Omit<typeof untrustedEnvelope, "version"> & { version: 4 };
      intentIndex: number;
      actorPubkey: string;
      policyBytesHex?: string;
      deviceProfile: ClearSignDeviceProfileRequest;
    }
  >(
    "/v1/clearsign/v4/prepare",
    "POST",
    {
      envelope: { ...untrustedEnvelope, version: 4 },
      intentIndex: options.intentIndex,
      actorPubkey: options.actorPubkey,
      policyBytesHex: options.policyBytesHex,
      deviceProfile,
    },
    { timeoutMs: 20_000, signal: options.signal },
  );
  if (
    response.version !== 4 ||
    response.kind !== intent.kind ||
    !Number.isSafeInteger(response.actionKindCode) ||
    response.actionKindCode < 1 ||
    response.actionKindCode > 15 ||
    !/^[0-9a-f]{64}$/.test(response.payloadHash) ||
    !/^[0-9a-f]{64}$/.test(response.envelopeHash) ||
    !/^[0-9a-f]{64}$/.test(response.canonicalIntentHash) ||
    !/^(?:[0-9a-f]{2})+$/.test(response.canonicalIntentHex) ||
    !/^[0-9a-f]{64}$/.test(response.policyCommitment) ||
    response.signableText.length === 0
  ) {
    throw new Error("ClearSign v4 preparation returned an invalid binding.");
  }
  return { ...response, source: "backend" };
}
