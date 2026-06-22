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

/// Response from `GET /wallets/{name}/chains`. The backend's CLI walks
/// every known `chain_kind` (0-5), returns the ones that have an
/// IkaConfig binding on chain, and includes chain-native addresses
/// derived from each dWallet's pubkey (Ethereum/Hyperliquid 0x…, Bitcoin bc1q…,
/// Zcash t1…). Solana's address is just the dWallet pubkey itself.
export interface ChainBindingResponse {
  chain: string;
  chain_kind: number;
  ika_config: string;
  dwallet: string;
  user_pubkey_hex: string;
  signature_scheme: number;
  /// Set when the underlying dWallet account exists on chain.
  secp256k1_pubkey_hex?: string;
  /// Solana - chain_kind 0.
  solana_address?: string;
  /// Ethereum / ERC-20 / Hyperliquid - chain_kind 1, 4, 5.
  evm_address?: string;
  /// Bitcoin P2WPKH - chain_kind 2.
  btc_p2wpkh_mainnet?: string;
  btc_p2wpkh_testnet?: string;
  /// Zcash transparent - chain_kind 3.
  zcash_t_addr_mainnet?: string;
  zcash_t_addr_testnet?: string;
}

export interface WalletChainsResponse {
  /// Wallet PDA (base58).
  wallet: string;
  chains: ChainBindingResponse[];
}

/// Bundle of fields the browser must compute and sign client-side.
/// Spread into every signed-submit request body (Rust uses #[serde(flatten)]).
export type PreSignedPayload = {
  /// Base58-encoded ed25519 public key of the signer (user's Solana wallet).
  signer_pubkey: string;
  /// Hex-encoded 64-byte ed25519 signature over `message_flavor` bytes.
  signature: string;
  /// Exact byte layout that was signed. Software wallets use plain_v2;
  /// Ledger uses offchain_v1 so the device can display the message.
  message_flavor?: "offchain_v1" | "plain_v2";
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
  /// See `CreateWalletInput::policy_ciphertexts`.
  policy_ciphertexts?: string[];
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
  /// See `CreateWalletInput::policy_ciphertexts`.
  policy_ciphertexts?: string[];
};

export type PrepareCreateProposalInput = {
  intent_index: number;
  params: string[];
  expiry?: string;
  /// Connected wallet's pubkey (base58). Used by the CLI's dry-run
  /// proposer/approver validation. Without it the CLI falls back to
  /// its filesystem keypair, which isn't in any user's intent -
  /// every prepare call would fail "signer is not a proposer".
  actor_pubkey?: string;
};

export type PrepareApproveCancelInput = {
  expiry?: string;
  /// See `PrepareCreateProposalInput::actor_pubkey`.
  actor_pubkey?: string;
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
  /// Encrypt ciphertext identifiers covering the policy fields
  /// (proposers / approvers / threshold). Forward-compat: today the
  /// backend logs them; once the program is FHE-aware they replace
  /// the plaintext fields in the on-chain instruction.
  policy_ciphertexts?: string[];
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
  /// Must match the prepare request when the updated intent stores
  /// encrypted policy metadata. Keeping it on submit prevents backend
  /// rebuild paths from silently dropping policy bytes.
  policy_ciphertexts?: string[];
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
