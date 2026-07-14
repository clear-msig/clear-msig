# Identity & Key Management Findings (post-pull)

## Confirmed

### [CRITICAL] Unauthenticated internal endpoint lets anyone fabricate an on-chain deposit and trigger a real NGN payout from the treasury (theft of funds)
- **OWASP:** A07:2025 Authentication Failures
- **Location:** `rust-settlement/src/http/handlers.rs:65,500-556` (`POST /v1/internal/chain/confirm`, handler `chain_confirm`) — zero auth check anywhere in `build_router` (`handlers.rs:50-69`) or `main.rs:103-105` (only CORS + request logger applied, no auth middleware in the entire service).
- **Attack chain:** (1) attacker calls `POST /v1/ramp/intents` (offramp, own bank account, self-asserted `x-user-id`) → (2) gets treasury deposit address via prepare-signature, never sends crypto → (3) `POST`s a fabricated `ChainTransferConfirmationRequest` (`intent_id` = their intent, any `tx_hash`, `finalized: true`) directly to `/v1/internal/chain/confirm` — a raw `INSERT ... ON CONFLICT` into `ramp_chain_transfers` with no on-chain verification (`handlers.rs:504-536`) → (4) `chain_confirmation::run_chain_confirmation_pass` (`workers/chain_confirmation.rs:4-24`) sees `is_finalized=TRUE`, flips intent to `settlement_completed` unconditionally → (5) `payout_dispatch::run_payout_dispatch_pass` fires a real Paystack/Kora bank transfer, no crypto ever received.
- **Impact:** Direct unauthenticated theft of the settlement provider's NGN float — attacker only needs an `intent_id` they created themselves.
- **Fix:** Remove the endpoint from the public router or gate with a strong shared-secret/mTLS auth header (constant-time compare); independently verify the claimed `tx_hash` against actual chain state before trusting `finalized=true`.
- Cross-confirmed against appsec's independent finding on the same endpoint (both audits traced the full chain independently — high confidence).

### [HIGH] `x-user-id` is a fully self-asserted identity header — no authentication anywhere in `rust-settlement`
- **OWASP:** A07:2025 Authentication Failures
- **Location:** `rust-settlement/src/http/handlers.rs:37-44` (`user_id_from_headers`), used by `create_intent` (:82), `get_intent` (:170), `prepare_signature` (:217), `initialize_payment` (:270). Only requires the header be a valid UUID — not bound to any session/wallet-signature/proof of identity.
- **Attack:** Any caller sets `x-user-id: <victim-uuid>` and can read/advance/drive-to-payment another user's ramp intents — ownership checks (`services/intents.rs:347`, `WHERE id=$1 AND user_id=$2`) only compare against the attacker-supplied value, proving nothing.
- **Impact:** Cross-user IDOR on the entire onramp/offramp lifecycle; combined with the CRITICAL finding, also removes per-user rate limiting/accountability for the theft path.
- **Fix:** Authenticate the caller (wallet-signature challenge or session token bound to a verified wallet pubkey) and derive `user_id` server-side — never trust a client-supplied UUID as the authorization decision.

### [INFO] Treasury signer key management is a single eternal env-var secret, no rotation/HSM
- **Location:** `rust-settlement/src/signer/solana.rs:53-78` (`load_keypair`) — loads full 64-byte secret from `TREASURY_SOL_KEYPAIR_BASE58` or a keyfile, no KMS/HSM, no per-tx spend policy beyond caller-controlled amount, no rotation. No live secret values found in repo — `.env.example` only has empty placeholders.
- **Impact:** A leak of this one env var is a complete, silent, irrevocable treasury compromise — worsened by the fact the CRITICAL finding already lets an attacker drive spends through the legitimate signer without needing the key at all.
- **Fix:** KMS/HSM-backed signer or a policy-limited co-signer/spend-limit service; add a hard per-tx/per-day cap enforced independently of ramp-intent business logic.

## Needs verification

### Kora webhook signature computed over re-serialized `data` subset, not raw payload
- **Location:** `rust-settlement/src/kora/signature.rs:4-29` — parses body, extracts `data`, re-serializes with `serde_json::to_string`, HMACs that instead of raw bytes. Constant-time comparison IS used correctly here (`mac.verify_slice`) — not a timing issue, unlike the concern from the earlier pass.
- **Uncertain:** whether Kora's spec signs only `data` (intentional/correct) or the full raw body (formatting differences could break legit verification, or `event_type` — unsigned per this code's MAC scope — driving `payout_success`/`payment_success` branches at `workers/webhook_processing.rs:48-57` could be a manipulable trust gap).
- **Fix:** confirm against Kora's docs; sign/verify raw bytes if that's the spec, or expand MAC scope to cover `event`.

## Informational / hardening
- Paystack webhook verification (`paystack/signature.rs:16-42`) is solid — raw-body HMAC-SHA512, hex-decode, then compare. Equal-length hex string `==` isn't a meaningful timing risk given HMAC collision resistance, but `subtle`/`ct_codecs` constant-time compare on raw bytes is still better practice.
- `resolve_bank`/`list_banks` (`handlers.rs:329,360`) intentionally unauthenticated, low sensitivity — fine.
- No JWT/OAuth/session infra anywhere in the repo — wallet-pubkey + on-chain-multisig-signature identity model followed consistently; no JWT algorithm-confusion bugs possible since there's no JWT usage.
- **Agent trading vault** (`programs/clear-wallet/src/instructions/typed_agent.rs`, `ExecuteTypedAgentSessionGrant`/`ExecuteTypedAgentTradeApproval`, lines 66-388): enforces expiry (`clock.unix_timestamp.get() < session.expires_at`), notional caps via `checked_sub`/`checked_add` (no overflow bypass found), venue/market/leverage binding, revocation status — all gated behind an approved multisig proposal (`intent.is_approved()`, `proposal.status == Approved`). Looks sound from an identity/key-management angle. **Not verified:** `AgentTradeSettlement` replay-safety against oracle price manipulation — appsec/on-chain-policy lane, not fully traced here.
- No hardcoded private keys/PEM/keystore blobs found in working tree; full `git log -p -S` history scan for rotated-but-committed secrets not run this pass (see Coverage).

## Coverage
- **Checked:** rust-settlement HTTP route auth surface end-to-end, treasury signer key loading (Solana only), webhook HMAC verification (both providers), disbursement/payout/chain-confirmation/webhook-processing workers, agent trading vault session-grant/trade-approval on-chain enforcement, backend-api wallet membership lookup, working-tree secret scan.
- **Not checked:** ClearSign v2 hash-binding domain separation (`clearsign.rs`, `message.rs`, `extract_clear_text_from_vote_message` — appsec's lane); on-chain policy-engine overflow/fail-open analysis (`policy.rs`, `advanced_policy.rs` — appsec's lane); `AgentTradeSettlement` oracle-price replay/staleness; EVM/Bitcoin/Zcash signers (only Solana read in depth); `backend-api/src/{proposals,intents}.rs` route-level auth beyond `wallet/membership.rs`; `git log -p -S 'PRIVATE KEY'` history scan; frontend Dynamic Labs/Ledger token storage.
