import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  findWalletPolicyAddress,
  findAssetPolicyAddress,
  fromHex,
  parseTypedProposal,
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
import { listAllowances } from "@/lib/retail/allowances";
import {
  appendPolicyExtension,
  encodeTypedRemoteSendPolicy,
  encodeTypedSolPolicy,
  EXT_ADVANCED_RULES,
  type EncodedSolPolicy,
  policyCommitmentHex,
} from "@/lib/policies/onchain";
import { compileAdvancedPolicyRules } from "@/lib/policies/advancedOnchain";
import {
  encodeTypedSplAssetPolicy,
  SOLANA_DEVNET_USDC_MINT,
  SPL_ASSET_POLICY_SCOPE,
} from "@/lib/policies/assetOnchain";
import type {
  MemberAllowanceCap,
  PolicyEnforcementPlan,
} from "@/lib/policies/enforce";

export const EMPTY_POLICY_COMMITMENT =
  "0000000000000000000000000000000000000000000000000000000000000000";

type PolicyTarget = {
  ticker: PolicyChainTicker;
  chainKind: number;
  decimals: number;
  scope: "chain" | "asset";
  assetId?: string;
};

const POLICY_TARGETS: PolicyTarget[] = [
  { ticker: "SOL", chainKind: 0, decimals: 9, scope: "chain" },
  { ticker: "USDC", chainKind: 0, decimals: 6, scope: "asset", assetId: SOLANA_DEVNET_USDC_MINT },
  { ticker: "ETH", chainKind: 1, decimals: 18, scope: "chain" },
  { ticker: "BTC", chainKind: 2, decimals: 8, scope: "chain" },
  { ticker: "ZEC", chainKind: 3, decimals: 8, scope: "chain" },
  { ticker: "HYPE", chainKind: 5, decimals: 18, scope: "chain" },
];

export interface PersistentPolicyTarget {
  ticker: PolicyChainTicker;
  chainKind: number;
  policyBytesHex: string;
  policyCommitmentHex: string;
  summary: string;
  scope: "chain" | "asset";
  assetId?: string;
  scopeKind?: number;
  decimals: number;
}

export async function buildPersistentPersonalPolicyTargets(
  walletName: string,
): Promise<PersistentPolicyTarget[]> {
  return Promise.all(POLICY_TARGETS.map(async (target) => {
    const plan = personalPlanForTarget(walletName, target);
    const advanced = target.scope === "chain"
      ? await compileAdvancedPolicyRules(walletName, target)
      : { payload: null, trackingVelocity: null };
    if (advanced.trackingVelocity) {
      const configuredWindow = plan.onchainLimits.velocityCapDisplay
        ? plan.onchainLimits.velocityWindowSeconds
        : 0;
      if (
        configuredWindow > 0 &&
        configuredWindow !== advanced.trackingVelocity.windowSeconds
      ) {
        throw new Error(
          `${target.ticker} spending protection and advanced checks must use the same velocity window.`,
        );
      }
      if (!plan.onchainLimits.velocityCapDisplay) {
        plan.onchainLimits.velocityCapDisplay = advanced.trackingVelocity.capDisplay;
        plan.onchainLimits.velocityWindowSeconds = advanced.trackingVelocity.windowSeconds;
      }
    }
    let encoded = encodeForTarget(plan, target);
    if (advanced.payload) {
      encoded = appendPolicyExtension(encoded, EXT_ADVANCED_RULES, advanced.payload);
    }
    return {
      ticker: target.ticker,
      chainKind: target.chainKind,
      policyBytesHex: encoded?.hex ?? "",
      policyCommitmentHex: encoded?.commitmentHex ?? EMPTY_POLICY_COMMITMENT,
      summary: policySummary(target.ticker, encoded),
      scope: target.scope,
      assetId: target.assetId,
      scopeKind: target.scope === "asset" ? SPL_ASSET_POLICY_SCOPE : undefined,
      decimals: target.decimals,
    };
  }));
}

export async function persistentSendPolicyForChain(
  walletName: string,
  chainKind: number,
): Promise<Pick<EncodedSolPolicy, "hex" | "commitmentHex"> | null> {
  const target = (await buildPersistentPersonalPolicyTargets(walletName)).find(
    (candidate) => candidate.chainKind === chainKind,
  );
  if (!target || !target.policyBytesHex) return null;
  return {
    hex: target.policyBytesHex,
    commitmentHex: target.policyCommitmentHex,
  };
}

export async function resolvePersistentSendPolicy(
  connection: Connection,
  wallet: PublicKey,
  walletName: string,
  chainKind: number,
): Promise<Pick<EncodedSolPolicy, "hex" | "commitmentHex"> | null> {
  const local = await persistentSendPolicyForChain(walletName, chainKind);
  const activeCommitment = await currentWalletPolicyCommitment(
    connection,
    wallet,
    chainKind,
  );
  if (activeCommitment === EMPTY_POLICY_COMMITMENT) return local;
  if (local?.commitmentHex === activeCommitment) return local;

  const accounts = await connection.getProgramAccounts(CLEAR_WALLET_PROGRAM_ID, {
    commitment: DEFAULT_COMMITMENT,
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.of(6)) } },
      { memcmp: { offset: 1, bytes: wallet.toBase58() } },
    ],
  });
  for (const { account } of accounts) {
    try {
      const proposal = parseTypedProposal(new Uint8Array(account.data));
      if (proposal.actionKind !== 6 || proposal.statusLabel !== "Executed") continue;
      if (!proposal.policyBytesHex) continue;
      const commitmentHex = policyCommitmentHex(fromHex(proposal.policyBytesHex));
      if (commitmentHex === activeCommitment) {
        return { hex: proposal.policyBytesHex, commitmentHex };
      }
    } catch {
      // Ignore unrelated or legacy accounts returned by broad RPC filters.
    }
  }
  throw new Error(
    "The active wallet protection could not be recovered from its on-chain update proposal.",
  );
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

export async function currentAssetPolicyCommitment(
  connection: Connection,
  wallet: PublicKey,
  assetId: string,
): Promise<string> {
  const asset = new PublicKey(assetId);
  const [policyPda] = findAssetPolicyAddress(wallet, asset, CLEAR_WALLET_PROGRAM_ID);
  const info = await connection.getAccountInfo(policyPda, DEFAULT_COMMITMENT);
  if (!info || info.data.length === 0) return EMPTY_POLICY_COMMITMENT;
  const bytes = new Uint8Array(info.data);
  if (
    bytes.length < 114
    || bytes[0] !== 14
    || !bytes.slice(1, 33).every((value, index) => value === wallet.toBytes()[index])
    || !bytes.slice(33, 65).every((value, index) => value === asset.toBytes()[index])
  ) {
    throw new Error("The active asset protection account is malformed.");
  }
  return Array.from(bytes.slice(65, 97), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function resolvePersistentAssetPolicy(
  connection: Connection,
  wallet: PublicKey,
  walletName: string,
  assetId: string,
): Promise<Pick<EncodedSolPolicy, "hex" | "commitmentHex"> | null> {
  const target = (await buildPersistentPersonalPolicyTargets(walletName)).find(
    (candidate) => candidate.scope === "asset" && candidate.assetId === assetId,
  );
  if (!target) return null;
  const active = await currentAssetPolicyCommitment(connection, wallet, assetId);
  if (active === target.policyCommitmentHex) {
    return { hex: target.policyBytesHex, commitmentHex: target.policyCommitmentHex };
  }
  if (active === EMPTY_POLICY_COMMITMENT) {
    throw new Error("Save USDC spending protection on Personal before creating this schedule.");
  }
  const accounts = await connection.getProgramAccounts(CLEAR_WALLET_PROGRAM_ID, {
    commitment: DEFAULT_COMMITMENT,
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.of(6)) } },
      { memcmp: { offset: 1, bytes: wallet.toBase58() } },
    ],
  });
  for (const { account } of accounts) {
    try {
      const proposal = parseTypedProposal(new Uint8Array(account.data));
      if (proposal.actionKind !== 16 || proposal.statusLabel !== "Executed" || !proposal.policyBytesHex) continue;
      const commitmentHex = policyCommitmentHex(fromHex(proposal.policyBytesHex));
      if (commitmentHex === active) return { hex: proposal.policyBytesHex, commitmentHex };
    } catch {}
  }
  throw new Error("The active USDC protection could not be recovered from its onchain update proposal.");
}

function personalPlanForTarget(
  walletName: string,
  target: PolicyTarget,
): PolicyEnforcementPlan {
  const budget = getBudget(walletName);
  const nativeCap = budget?.onchainWeeklyNative?.[target.ticker] ?? null;
  const timeWindow = getTimeWindow(walletName);
  const allowlist = getAllowlist(walletName, target.chainKind);
  const memberAllowances = loadMemberAllowancesForChain(walletName, target);
  return {
    evaluation: null,
    rule: null,
    conditions: [],
    extraApprovers: [],
    extraCooldownSeconds: 0,
    recipientGuard:
      allowlist.mode === "on"
        ? { mode: "allowlist", addresses: allowlist.addresses }
        : null,
    memberAllowances,
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
  if (target.scope === "asset" && target.assetId) {
    return encodeTypedSplAssetPolicy(plan, {
      mint: target.assetId,
      decimals: target.decimals,
      ticker: target.ticker,
    });
  }
  if (target.chainKind === 0) return encodeTypedSolPolicy(plan);
  return encodeTypedRemoteSendPolicy(plan, {
    assetTicker: target.ticker,
    decimals: target.decimals,
  });
}

function loadMemberAllowancesForChain(
  walletName: string,
  target: PolicyTarget,
): MemberAllowanceCap[] {
  // Friend allowances are SOL-denominated in the product UI today. Do not
  // reinterpret a SOL limit as BTC, ZEC, ETH, or HYPE units.
  if (target.ticker !== "SOL") return [];
  return listAllowances(walletName)
    .filter((row) => row.period !== "none")
    .map((row) => {
      const windowSeconds =
        row.period === "monthly" ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
      const amount = Number.isFinite(row.amountSol) ? Math.max(0, row.amountSol) : 0;
      return {
        member: row.friendAddress,
        capDisplay: String(amount),
        windowSeconds,
      };
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
