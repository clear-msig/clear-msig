// Shared request/response contracts for backend API calls.
//
// Two kinds of write routes exist after Phase 2:
//   - /prepare/**  takes classic inputs, returns a DryRunDescriptor
//   - POST /** takes a `PreSigned` blob + minimal inputs
//
// The browser flow for any signed action is:
//   1. POST to /prepare/... with the classic inputs → DryRunDescriptor.
//   2. wallet.signMessage(hexToBytes(descriptor.message_hex)) → signature.
//   3. POST to the signed submit route with { pre_signed: {...}, ...small inputs }.
//
// The backend forwards the pre-signed bytes to the CLI, which verifies
// the ed25519 signature against the exact message it rebuilds and only
// then submits the on-chain transaction.
export type ApiErrorEnvelope = {
  error: string;
  kind: string;
  code?: number;
  stderr?: string;
  stdout?: string;
  retry_after_secs?: number;
};

/// Bundle of fields the browser must compute and sign client-side.
/// Spread into every signed-submit request body (Rust uses #[serde(flatten)]).
export type PreSignedPayload = {
  /// Base58-encoded ed25519 public key of the signer (user's Solana wallet).
  signer_pubkey: string;
  /// Hex-encoded 64-byte ed25519 signature over the offchain-wrapped message.
  signature: string;
  /// Hex-encoded `params_data` bytes the caller serialised for the CLI to
  /// submit verbatim. Required for intent add / update / proposal create.
  /// Optional for approve / cancel (the proposal already holds those bytes
  /// on-chain).
  params_data_hex?: string;
  /// Unix timestamp at which the signature expires. MUST match the
  /// `expiry` field on the `DryRunDescriptor` the browser used to build
  /// the message it signed.
  expiry: number;
};

/// Shape returned by every /prepare/** route. `message_hex` is the exact
/// payload the user's wallet should `signMessage` over. `params_data_hex`
/// is what the submit route needs in its `pre_signed.params_data_hex`.
export type DryRunDescriptor = {
  action: string;
  wallet_name: string;
  wallet_pubkey: string;
  intent_index: number;
  intent_pubkey: string;
  message_hex: string;
  params_data_hex: string;
  expiry: number;
  proposal_pubkey?: string;
  proposal_index?: number;
};

// ── /prepare/** request bodies ─────────────────────────────────────────

export type PrepareCreateWalletInput = {
  name: string;
  proposers: string[];
  approvers: string[];
  threshold: number;
  cancellation_threshold?: number;
  timelock?: number;
};

export type PrepareAddIntentInput = {
  file: string;
  proposers: string[];
  approvers: string[];
  threshold: number;
  cancellation_threshold?: number;
  timelock?: number;
  expiry?: string;
};

export type PrepareRemoveIntentInput = {
  index: number;
  expiry?: string;
};

export type PrepareUpdateIntentInput = {
  index: number;
  file: string;
  proposers: string[];
  approvers: string[];
  threshold: number;
  cancellation_threshold?: number;
  timelock?: number;
  expiry?: string;
};

export type PrepareCreateProposalInput = {
  intent_index: number;
  params: string[];
  expiry?: string;
};

export type PrepareApproveCancelInput = {
  expiry?: string;
};

// ── Signed submit bodies ───────────────────────────────────────────────
//
// Bootstrap ops that don't require a multisig signature keep their
// classic shape . the backend's sponsored-gas payer handles them.

export type CreateWalletInput = {
  name: string;
  proposers: string[];
  approvers: string[];
  threshold: number;
  cancellation_threshold?: number;
  timelock?: number;
};

export type AddChainInput = {
  chain: string;
  dwallet_program?: string;
  grpc_url?: string;
  existing_dwallet_pubkey?: string;
  existing_dwallet_addr?: string;
};

// Signed shapes . each of these extends PreSignedPayload with the
// route-specific non-signed fields.

export type SignedAddIntentInput = PreSignedPayload & {
  file: string;
};

export type SignedRemoveIntentInput = PreSignedPayload & {
  index: number;
};

export type SignedUpdateIntentInput = PreSignedPayload & {
  index: number;
  file: string;
};

export type SignedCreateProposalInput = PreSignedPayload & {
  intent_index: number;
};

export type SignedApproveCancelInput = PreSignedPayload;

export type ExecuteProposalInput = {
  dwallet_program?: string;
  grpc_url?: string;
  rpc_url?: string;
  broadcast?: boolean;
};

// Back-compat aliases kept while Phase 5 refactors the UI; remove once
// no component imports the old names.
export type AddIntentInput = PrepareAddIntentInput;
export type CreateProposalInput = PrepareCreateProposalInput;
