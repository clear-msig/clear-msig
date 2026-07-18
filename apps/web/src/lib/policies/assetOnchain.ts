import { PublicKey } from "@solana/web3.js";
import { toHex } from "@/lib/msig/hash";
import type { PolicyEnforcementPlan } from "@/lib/policies/enforce";
import {
  encodeTypedRemoteSendPolicy,
  policyCommitmentHex,
  type EncodedSolPolicy,
} from "@/lib/policies/onchain";

const CSP2_MAGIC = new Uint8Array([0x43, 0x53, 0x50, 0x32]);
const CSP1_EMPTY = new Uint8Array([
  0x43, 0x53, 0x50, 0x31,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

export const SPL_ASSET_POLICY_SCOPE = 1;
export const SOLANA_DEVNET_USDC_MINT =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function encodeTypedSplAssetPolicy(
  plan: PolicyEnforcementPlan,
  options: { mint: string; decimals: number; ticker: string },
): EncodedSolPolicy {
  const mint = new PublicKey(options.mint);
  const inner = encodeTypedRemoteSendPolicy(plan, {
    assetTicker: options.ticker,
    decimals: options.decimals,
    normalizeRecipient: (value) => new PublicKey(value).toBase58(),
    encodeRecipient: (value) => new PublicKey(value).toBytes(),
  });
  const body = inner?.bytes ?? CSP1_EMPTY;
  const bytes = new Uint8Array(4 + 1 + 1 + 32 + body.length);
  bytes.set(CSP2_MAGIC, 0);
  bytes[4] = SPL_ASSET_POLICY_SCOPE;
  bytes[5] = options.decimals;
  bytes.set(mint.toBytes(), 6);
  bytes.set(body, 38);
  return {
    bytes,
    hex: toHex(bytes),
    commitmentHex: policyCommitmentHex(bytes),
  };
}
