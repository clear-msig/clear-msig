import { PublicKey } from "@solana/web3.js";
export const member = new PublicKey(new Uint8Array(32).fill(1)).toBase58();
export const walletKey = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
export const intentKey = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
export const proposalKey = new PublicKey(new Uint8Array(32).fill(4)).toBase58();
const other = new PublicKey(new Uint8Array(32).fill(5)).toBase58();
const membership = {
  wallet: walletKey,
  wallet_name: "operations",
  wallet_creator: member,
  roles: ["proposer", "approver"],
  intent_indexes: [3],
};
const account = {
  bump: 254,
  proposalIndex: 1n,
  intentIndex: 3,
  creator: member,
  name: "operations",
};
const wallet = {
  name: "operations",
  pda: new PublicKey(walletKey),
  bump: 254,
  account,
};
const intent = {
  wallet: walletKey,
  bump: 255,
  intentIndex: 3,
  intentType: 3,
  chainKind: 0,
  approved: true,
  approvalThreshold: 2,
  cancellationThreshold: 2,
  timelockSeconds: 0,
  templateOffset: 0,
  templateLen: 0,
  txTemplateOffset: 0,
  txTemplateLen: 0,
  activeProposalCount: 1,
  proposers: [member],
  approvers: [
    member,
    other,
    new PublicKey(new Uint8Array(32).fill(6)).toBase58(),
  ],
  params: [],
  accounts: [],
  instructions: [],
  dataSegments: [],
  seeds: [],
  policyCiphertexts: new Uint8Array(),
  policyCiphertextIds: [],
  bytePool: new Uint8Array(),
  template: "Send 0.3 SOL",
};
const proposal = {
  typed: true,
  wallet: walletKey,
  intent: intentKey,
  proposalIndex: 1n,
  proposer: member,
  status: 0,
  statusLabel: "Active",
  actionKind: 1,
  proposedAt: 1791288000n,
  approvedAt: 0n,
  expiresAt: 1893456000n,
  bump: 255,
  approvalBitmap: 1,
  cancellationBitmap: 0,
  rentRefund: member,
  policyCommitment: "11".repeat(32),
  payloadHash: "22".repeat(32),
  envelopeHash: "33".repeat(32),
  actionId: "fixture-only",
  nonce: "fixture-only",
  policyBytesHex: "",
};
const intentRows = [
  { pda: new PublicKey(intentKey), index: 3, account: intent },
];
const proposalRows = [
  {
    pda: new PublicKey(proposalKey),
    account: proposal,
    intentIndex: 3,
    proposalIndex: 1n,
  },
];
const details = `From wallet: Operations\nNetwork: Solana Devnet\nAmount: 0.3 SOL\nTo: ${other}`;
const review = {
  reviewId: "synthetic-review-only",
  proposalAddress: proposalKey,
  walletName: "Operations",
  headline: "Send 0.3 SOL",
  network: "Solana Devnet",
  document: `ClearSig Approval\n\nACTION\nSend 0.3 SOL\n\nDETAILS\n${details}\n\nPOLICY\n2 signatures required\n\nRISK\nSynthetic UI fixture. No chain verification performed.`,
  sections: [
    { title: "ACTION", text: "Send 0.3 SOL" },
    { title: "DETAILS", text: details },
    {
      title: "POLICY",
      text: "2 signatures required. This is synthetic fixture evidence, not on-chain authorization.",
    },
    {
      title: "RISK",
      text: "Review full destination and amount. Nothing can be signed in this fixture.",
    },
  ],
  envelopeHash: proposal.envelopeHash,
  payloadHash: proposal.payloadHash,
  threshold: 2,
  timelockSeconds: 0,
  expiresAt: proposal.expiresAt,
  binding: {
    wallet: walletKey,
    intent: intentKey,
    index: 1n,
    intentIndex: 3,
    actionKind: 1,
    policy: proposal.policyCommitment,
    actionId: "fixture-only",
    nonce: "fixture-only",
    approvers: intent.approvers,
    approvalBitmap: 1,
  },
};
function mode() {
  return typeof window === "undefined"
    ? "ready"
    : new URLSearchParams(window.location.search).get("fixtureState") ||
        "ready";
}
export async function fixtureQuery(key) {
  const type = String(key?.[0]);
  const state = mode();
  if (state === "bank-error" && type === "ramp-banks")
    throw new Error("Synthetic bank lookup unavailable");
  if (state === "bank-empty" && type === "ramp-banks") return [];
  if (state === "review-error" && type === "canonical-proposal-review")
    throw new Error("Synthetic canonical review unavailable");
  if (state === "review-loading" && type === "canonical-proposal-review")
    return new Promise(() => {});
  if (typeof window !== "undefined") {
    window.__fixtureQueryKeys ??= [];
    if (!window.__fixtureQueryKeys.includes(type))
      window.__fixtureQueryKeys.push(type);
  }
  if (state === "loading") return new Promise(() => {});
  if (state === "error")
    throw new Error(
      "Synthetic read failure. Refresh to retry; no live request occurred.",
    );
  if (type === "my-organizations" || type === "notification-memberships")
    return state === "empty" ? [] : [membership];
  if (type === "wallet") return wallet;
  if (type === "agent-local-scope-wallet")
    return { wallet, genesisHash: new PublicKey(new Uint8Array(32).fill(9)).toBase58() };
  if (type === "solana-token-holdings" || type === "erc20-holdings") return [];
  if (type === "ramp-banks")
    return [{ name: "Fixture Bank", code: "999", slug: "fixture-bank" }];
  if (type === "wallet-account-by-pda") return { membership, account };
  if (type === "wallet-intents") return intentRows;
  if (type === "wallet-intents-all") return { membership, rows: intentRows };
  if (type === "wallet-proposals-recent")
    return { membership, rows: state === "empty" ? [] : proposalRows };
  if (type === "proposals") return state === "empty" ? [] : proposalRows;
  if (type === "proposal") return proposal;
  if (type === "proposal-display") return { proposal, wallet: account, intent };
  if (type === "canonical-proposal-review") return review;
  if (type === "proposal-vote-history")
    return {
      rows: [],
      scannedTransactions: 0,
      unavailableTransactions: 0,
      failedTransactions: 0,
      innerVoteInstructions: 0,
      stoppedAtLimit: false,
      scanError: false,
      chainIdentity: "synthetic-only",
    };
  if (type === "wallet-vault-balance-lamports") return 25000000000n;
  if (type === "wallet-balance") return 25000000000;
  if (type === "connected-wallet-balance") return 2000000000;
  if (type === "dashboard-balances") return new Map([[walletKey, 25000000000]]);
  if (type === "wallet-other-chain-balances") return new Map();
  if (type === "wallet-chains-api")
    return {
      wallet_name: "operations",
      chains: [
        { chain_kind: 0, dwallet: walletKey, solana_address: walletKey },
      ],
    };
  if (type === "recurring-states") return {};
  if (type === "ikavery-vaults" || type === "ikavery-proposals") return [];
  if (type === "ikavery-vault-balance") return 0;
  if (type.includes("notification")) return [];
  if (type.includes("price")) return {};
  throw new Error(
    `Synthetic fixture has no read mapping for ${type}. No external request made.`,
  );
}
