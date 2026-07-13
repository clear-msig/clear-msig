// Barrel . public surface of the msig byte-exact library.
//
// Consumers import from "@/lib/msig" rather than sub-paths. Keeps the
// UI code stable when we reorganise modules internally.

export { sha256, keccak256, toHex, fromHex } from "@/lib/msig/hash";
export {
  formatTimestamp,
  formatTimestampBytes,
} from "@/lib/msig/datetime";
export {
  OFFCHAIN_DOMAIN,
  OFFCHAIN_HEADER_LEN,
  wrapOffchain,
  unwrapOffchain,
} from "@/lib/msig/offchain";
export {
  ParamType,
  ConstraintType,
  AccountSourceType,
  SegmentType,
  SeedType,
  DataEncoding,
  paramByteSize,
  paramOffsetAt,
  type ParamEntry,
  type AccountEntry,
  type InstructionEntry,
  type DataSegmentEntry,
  type SeedEntry,
} from "@/lib/msig/definition";
export { encodeParams, type EncodeParamsContext } from "@/lib/msig/encode";
export {
  renderTemplate,
  renderTemplateToString,
  type RenderContext,
} from "@/lib/msig/render";
export {
  IntentType,
  buildMessageBody,
  buildSignableMessage,
  type Action,
  type BuildMessageInput,
  type SignableIntent,
} from "@/lib/msig/message";
export {
  rebuildAndVerifyMessage,
  MessageVerificationError,
} from "@/lib/msig/verify";
export {
  parseWallet,
  parseIntent,
  parseProposal,
  parseAnyProposal,
  parseTypedProposal,
  parseWalletPolicy,
  parseIkaConfig,
  parseDwalletOwnership,
  ProposalStatus,
  type WalletAccount,
  type IntentAccount,
  type ProposalAccount,
  type TypedProposalAccount,
  type WalletPolicyAccount,
  type AnyProposalAccount,
  type IkaConfigAccount,
  type DwalletOwnershipAccount,
  DISC_CLEAR_WALLET,
  DISC_INTENT,
  DISC_PROPOSAL,
  DISC_TYPED_PROPOSAL,
  DISC_WALLET_POLICY,
  WALLET_POLICY_CHAIN_SLOTS,
  DISC_IKA_CONFIG,
  DISC_DWALLET_OWNERSHIP,
} from "@/lib/msig/accounts";
export {
  findWalletAddress,
  findVaultAddress,
  findIntentAddress,
  findProposalAddress,
  findTypedProposalAddress,
  findIkaConfigAddress,
  findWalletPolicyAddress,
  findAgentRiskAddress,
  findDwalletOwnershipAddress,
  findCpiAuthority,
  deriveWalletPdas,
  type WalletPdas,
} from "@/lib/msig/pda";
