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
    notes: "Finalizes verified cross-chain artifacts through program-verified typed execution.",
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
    status: "typed_onchain",
    signedPath: "typed proposal -> typed chain-send proof -> Ika broadcast",
    notes: "The send UI uses typed proposal creation and approval; the program verifies recipient, asset, amount, chain binding, and tx template before Ika signing.",
  },
  {
    id: "eth-send",
    label: "ETH send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed chain-send proof -> Ika broadcast",
    notes: "The send UI uses typed proposal creation and approval; the program verifies recipient, asset, amount, chain binding, and tx template before Ika signing.",
  },
  {
    id: "hyperliquid-send",
    label: "Hyperliquid send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed chain-send proof -> Ika / venue broadcast",
    notes: "HYPE movement is wired to typed proposal creation and program-verified chain-send execution; venue-specific agent policy payloads remain separate.",
  },
  {
    id: "erc20-send",
    label: "ERC-20 send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed chain-send proof -> Ika broadcast",
    notes: "Same typed remote path as ETH; program verifies token contract, recipient, amount, and chain binding before Ika signing.",
  },
  {
    id: "zec-send",
    label: "Zcash send",
    status: "typed_onchain",
    signedPath: "typed proposal -> typed chain-send proof -> Ika broadcast",
    notes: "The send UI uses typed proposal creation and approval; the program verifies the transparent recipient, asset, amount, chain binding, and tx template before Ika signing.",
  },
  {
    id: "wallet-policy",
    label: "Wallet policy (limits / protection)",
    status: "typed_onchain",
    signedPath: "typed proposal -> execute_typed_wallet_policy_update",
    notes: "SetProtection binds the WalletPolicy PDA commitment per chain.",
  },
  {
    id: "members-policy",
    label: "Members, threshold, timelock",
    status: "typed_onchain",
    signedPath: "typed proposal -> execute_typed_intent_governance",
    notes: "Add/remove member and threshold/timelock rewrites bind the final proposers/approvers/thresholds on-chain.",
  },
  {
    id: "agent-trade-approval",
    label: "Agent trade approval",
    status: "typed_onchain",
    signedPath: "typed proposal -> agent session PDA notional debit",
    notes: "Program gates trade finalizer on an active AgentSession (expiry, venue/market, leverage, remaining notional).",
  },
  {
    id: "agent-session-grant",
    label: "Agent bounded session grant / revoke",
    status: "typed_onchain",
    signedPath: "typed proposal -> execute_typed_agent_session_grant",
    notes: "Creates or revokes program-owned AgentSession PDA bound by ClearSign AgentSessionGrant payload.",
  },
  {
    id: "member-allowances",
    label: "Per-member spend allowances",
    status: "typed_onchain",
    signedPath: "CSP1 EXT_MEMBER_ALLOWANCE + MemberAllowanceLedger window",
    notes: "SOL friend allowances encode into typed policy bytes (tag 4). The program tracks each matching proposer in an independent MemberAllowanceLedger row.",
  },
  {
    id: "agent-settings",
    label: "Agent settings / strategy / UI sessions",
    status: "local_policy_only",
    signedPath: "local encrypted policy state + optional session grant",
    notes: "Strategy editors remain local; on-chain session grants are the authoritative bound for trade finalization.",
  },
];

export function clearSignSurfaceById(id: string): ClearSignSurfaceCoverage | null {
  return CLEARSIGN_SURFACE_COVERAGE.find((surface) => surface.id === id) ?? null;
}
