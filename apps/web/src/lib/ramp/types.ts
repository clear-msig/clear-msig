// TypeScript mirrors of `rust-settlement`'s `contracts/api.rs` shape.
//
// Kept in lock-step with the Rust source. The wire format is JSON with
// snake_case keys (per the Serde rename); we keep the same casing
// here so a single point of translation isn't needed at every call
// site.

export type IntentType = "onramp" | "offramp";

export type ChainFamily = "solana" | "evm" | "bitcoin" | "zcash";

export type IntentStatus =
  | "intent_created"
  | "awaiting_user_transfer_signature"
  | "awaiting_user_transfer_confirmation"
  | "awaiting_payment"
  | "payment_confirmed"
  | "settlement_queued"
  | "settlement_in_progress"
  | "settlement_completed"
  | "payout_in_progress"
  | "payout_completed"
  | "expired"
  | "failed"
  | "cancelled"
  | "manual_review_required";

export const TERMINAL_STATUSES: readonly IntentStatus[] = [
  "expired",
  "failed",
  "cancelled",
  "manual_review_required",
  "payout_completed",
];

export interface CreateRampIntentRequest {
  intent_type: IntentType;
  chain_family: ChainFamily;
  chain_id: string;
  asset_symbol: string;
  asset_amount_minor: number;
  /// USD value in cents (e.g. $5.00 = 500). Required for onramp,
  /// recommended for offramp so the quote uses the same FX path.
  usd_amount_cents?: number;
  destination_wallet?: string;
  source_wallet?: string;
  bank_code?: string;
  bank_account_number?: string;
}

export interface CreateRampIntentResponse {
  intent_id: string;
  status: IntentStatus;
  quote_id: string;
  idempotency_replayed: boolean;
}

export interface IntentDetailResponse {
  intent_id: string;
  user_id: string;
  intent_type: IntentType;
  status: IntentStatus;
  chain_family: ChainFamily;
  chain_id: string;
  asset_symbol: string;
  asset_amount_minor: number;
  quote_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitializePaymentResponse {
  intent_id: string;
  authorization_url: string;
  access_code: string;
  payment_provider: string;
  payment_reference: string;
  provider_status: string;
  ngn_amount_minor: number;
}

export interface PrepareSignatureResponse {
  intent_id: string;
  treasury_address: string;
  chain_family: ChainFamily;
  chain_id: string;
  asset_symbol: string;
  status: IntentStatus;
}

export interface BankResolveResponse {
  account_number: string;
  account_name: string;
}

export interface BankListItem {
  name: string;
  code: string;
  slug: string | null;
  country: string | null;
  currency: string | null;
}

export interface ChainTransferConfirmationRequest {
  intent_id: string;
  chain_family: ChainFamily;
  chain_id: string;
  tx_hash: string;
  event_index: number;
  sender_wallet: string;
  asset_symbol: string;
  amount_minor: number;
  confirmations: number;
  finalized: boolean;
}

/// Standard envelope every endpoint wraps responses in.
export interface RampApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface RampApiErrorEnvelope {
  success: false;
  error: string;
}
