export type ClearSignSurfaceStatus =
  | "typed_onchain"
  | "typed_approval_only"
  | "legacy_custom_pending_typed_executor"
  | "local_policy_only";

export interface ClearSignSurfaceCoverage {
  id: string;
  label: string;
  status: ClearSignSurfaceStatus;
  signedPath: string;
  notes: string;
}

export const CLEARSIGN_SURFACE_COVERAGE: ClearSignSurfaceCoverage[] = [
  {
    id: "sol-send",
    label: "SOL send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed SOL execute",
    notes: "Readable text, envelope hash, typed proposal, and SOL movement are all program-verified.",
  },
  {
    id: "sol-batch-send",
    label: "SOL batch send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed SOL batch execute",
    notes: "Each recipient and lamport amount is bound into the typed payload hash.",
  },
  {
    id: "sol-escrow",
    label: "SOL escrow release / return",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed escrow execute",
    notes: "Milestone and return rows are bound into typed ClearSign and verified by program executors.",
  },
  {
    id: "spl-escrow",
    label: "SPL-token escrow release / return",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed SPL escrow execute",
    notes: "Covered at program/CLI level; product UI wiring must keep using typed escrow paths.",
  },
  {
    id: "cross-chain-escrow",
    label: "BTC / EVM / Ika escrow release / return",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed cross-chain escrow execute",
    notes: "Finalizes verified cross-chain artifacts; direct chain sends still need typed executors.",
  },
  {
    id: "private-escrow",
    label: "Encrypted/private escrow release / return",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed private escrow execute",
    notes: "Ciphertext/artifact commitments are bound by typed private escrow executors.",
  },
  {
    id: "typed-approve-cancel",
    label: "Typed proposal approve / cancel",
    status: "typed_onchain",
    signedPath: "typed readable vote message",
    notes: "Approve/cancel signatures are over readable ClearSign v2 text, not vote hashes.",
  },
  {
    id: "btc-send",
    label: "BTC send",
    status: "legacy_custom_pending_typed_executor",
    signedPath: "legacy Custom proposal -> Ika broadcast",
    notes: "Human-readable legacy signing exists, but not typed ClearSign v2 on-chain envelope/executor yet.",
  },
  {
    id: "eth-send",
    label: "ETH / Hyperliquid send",
    status: "legacy_custom_pending_typed_executor",
    signedPath: "legacy Custom proposal -> Ika broadcast",
    notes: "Needs typed cross-chain send action kind and executor before claiming SOL-level ClearSign.",
  },
  {
    id: "erc20-send",
    label: "ERC-20 send",
    status: "legacy_custom_pending_typed_executor",
    signedPath: "legacy Custom proposal -> Ika broadcast",
    notes: "Needs typed token-send payload and executor.",
  },
  {
    id: "zec-send",
    label: "Zcash send",
    status: "legacy_custom_pending_typed_executor",
    signedPath: "legacy Custom proposal -> Ika broadcast",
    notes: "Needs typed Zcash transparent-send payload and executor.",
  },
  {
    id: "members-policy",
    label: "Members, threshold, timelock, setup rules",
    status: "legacy_custom_pending_typed_executor",
    signedPath: "legacy intent update proposal",
    notes: "ClearSign v2 has readable member/policy kinds, but state-changing typed executors are not wired yet.",
  },
  {
    id: "agent-trade-approval",
    label: "Agent trade approval",
    status: "typed_approval_only",
    signedPath: "typed approval model exists; product execution is still off-chain/local",
    notes: "Readable typed action kind exists. Needs product flow wired to typed proposal before live trade execution.",
  },
  {
    id: "agent-settings",
    label: "Agent settings / strategy / sessions",
    status: "local_policy_only",
    signedPath: "local encrypted policy state",
    notes: "Not yet a program-verified typed action surface.",
  },
];

export function clearSignSurfaceById(id: string): ClearSignSurfaceCoverage | null {
  return CLEARSIGN_SURFACE_COVERAGE.find((surface) => surface.id === id) ?? null;
}
