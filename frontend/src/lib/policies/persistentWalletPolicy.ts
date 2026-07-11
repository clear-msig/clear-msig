import { Connection, PublicKey } from "@solana/web3.js";
import {
  findWalletPolicyAddress,
  parseWalletPolicy,
  WALLET_POLICY_CHAIN_SLOTS,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";
import {
  POLICY_CHAIN_TICKERS,
  getBudget,
  type PolicyChainTicker,
} from "@/lib/retail/spendingBudget";
import { getAllowlist, getTimeWindow } from "@/lib/retail/policy";
import {
  encodeTypedRemoteSendPolicy,
  encodeTypedSolPolicy,
  type EncodedSolPolicy,
} from "@/lib/policies/onchain";
import type { PolicyEnforcementPlan } from "@/lib/policies/enforce";

export const EMPTY_POLICY_COMMITMENT =
  "0000000000000000000000000000000000000000000000000000000000000000";

type PolicyTarget = {
  ticker: PolicyChainTicker;
  chainKind: number;
  decimals: number;
};

const POLICY_TARGETS: PolicyTarget[] = [
  { ticker: "SOL", chainKind: 0, decimals: 9 },
  { ticker: "ETH", chainKind: 1, decimals: 18 },
  { ticker: "BTC", chainKind: 2, decimals: 8 },
  { ticker: "ZEC", chainKind: 3, decimals: 8 },
  { ticker: "HYPE", chainKind: 5, decimals: 18 },
];

export interface PersistentPolicyTarget {
  ticker: PolicyChainTicker;
  chainKind: number;
  policyBytesHex: string;
  policyCommitmentHex: string;
  summary: string;
}

export function buildPersistentPersonalPolicyTargets(
  walletName: string,
): PersistentPolicyTarget[] {
  return POLICY_TARGETS.map((target) => {
    const plan = personalPlanForTarget(walletName, target);
    const encoded = encodeForTarget(plan, target);
    return {
      ticker: target.ticker,
      chainKind: target.chainKind,
      policyBytesHex: encoded?.hex ?? "",
      policyCommitmentHex: encoded?.commitmentHex ?? EMPTY_POLICY_COMMITMENT,
      summary: policySummary(target.ticker, encoded),
    };
  });
}

export async function currentWalletPolicyCommitment(
  connection: Connection,
  wallet: PublicKey,
  chainKind: number,
): Promise<string> {
  if (
    !Number.isInteger(chainKind) ||
    chainKind < 0 ||
    chainKind >= WALLET_POLICY_CHAIN_SLOTS
  ) {
    throw new Error("Unsupported policy chain kind.");
  }
  const [policyPda] = findWalletPolicyAddress(wallet, CLEAR_WALLET_PROGRAM_ID);
  const info = await connection.getAccountInfo(policyPda, DEFAULT_COMMITMENT);
  if (!info || info.data.length === 0) return EMPTY_POLICY_COMMITMENT;
  const parsed = parseWalletPolicy(new Uint8Array(info.data));
  return parsed.policyCommitments[chainKind] ?? EMPTY_POLICY_COMMITMENT;
}

function personalPlanForTarget(
  walletName: string,
  target: PolicyTarget,
): PolicyEnforcementPlan {
  const budget = getBudget(walletName);
  const nativeCap = budget?.onchainWeeklyNative?.[target.ticker] ?? null;
  const timeWindow = getTimeWindow(walletName);
  const allowlist = target.chainKind === 0 ? getAllowlist(walletName) : null;
  return {
    evaluation: null,
    rule: null,
    conditions: [],
    extraApprovers: [],
    extraCooldownSeconds: 0,
    recipientGuard:
      allowlist?.mode === "on"
        ? { mode: "allowlist", addresses: allowlist.addresses }
        : null,
    allowedTimeWindow: timeWindow.enabled
      ? {
          startHour: timeWindow.startHour,
          endHour: timeWindow.daysOfWeek.length === 0
            ? timeWindow.startHour
            : timeWindow.endHour,
          daysOfWeek: timeWindow.daysOfWeek,
          utcOffsetMinutes: new Date().getTimezoneOffset(),
        }
      : null,
    onchainLimits: {
      velocityCapDisplay:
        typeof nativeCap === "string" && nativeCap.trim().length > 0
          ? nativeCap
          : null,
      velocityWindowSeconds: 7 * 24 * 60 * 60,
      maxSendCount: Math.max(0, Math.floor(budget?.velocityPerDay ?? 0)),
      countWindowSeconds: 24 * 60 * 60,
    },
  };
}

function encodeForTarget(
  plan: PolicyEnforcementPlan,
  target: PolicyTarget,
): EncodedSolPolicy | null {
  if (target.chainKind === 0) return encodeTypedSolPolicy(plan);
  return encodeTypedRemoteSendPolicy(plan, {
    assetTicker: target.ticker,
    decimals: target.decimals,
  });
}

function policySummary(
  ticker: PolicyChainTicker,
  encoded: EncodedSolPolicy | null,
): string {
  return encoded
    ? `Update ${ticker} spending protection`
    : `Clear ${ticker} spending protection`;
}

export function policyTargetsForConfiguredTickers(
  targets: PersistentPolicyTarget[],
): PersistentPolicyTarget[] {
  const configured = new Set<PolicyChainTicker>(POLICY_CHAIN_TICKERS);
  return targets.filter((target) => configured.has(target.ticker));
}
