# AppSec Findings (post-pull, semgrep + manual)

## Confirmed

### [CRITICAL] Unauthenticated endpoint lets anyone fake a finalized on-chain deposit and drain the custodial treasury via fiat payout
- **OWASP:** A01:2025 Broken Access Control + A06 Insecure Design
- **Location:** `apps/settlement/src/http/handlers.rs:65` (route), `:500-556` (`chain_confirm` handler); `build_router` (`:50-69`) applies no auth middleware; `main.rs:103-105` only layers CORS + request logging.
- Attacker-controlled `ChainTransferConfirmationRequest` (including `finalized`) → raw upsert into `ramp_chain_transfers` (`:504-536`) → `chain_confirmation` worker flips intent to `settlement_completed` solely on `is_finalized=TRUE` → `payout_dispatch` fires a real Paystack/Kora payout for `estimated_ngn_amount_minor`.
- **Full self-serve exploit path:** create an offramp intent with own bank account + `x-user-id` (see next finding), then POST a forged `finalized:true` to `/v1/internal/chain/confirm` with a matching `intent_id` — no crypto ever sent, no on-chain evidence checked.
- **Fix:** strong auth (mTLS/HMAC/shared API key, constant-time check) on this route; or switch to a pull model where the service verifies deposits itself via RPC/indexer; at minimum cross-check `tx_hash`/`amount_minor`/`sender_wallet` against expected values before setting `is_finalized=true`.
- Independently corroborated by identity's audit — same root cause, traced separately.

### [CRITICAL] `x-user-id` header is treated as authentication with no verification
- **OWASP:** A01:2025 Broken Access Control
- **Location:** `apps/settlement/src/http/handlers.rs:37-44` (`user_id_from_headers`), used in `create_intent` (:87-99) and other user-scoped handlers.
- Untrusted `x-user-id` header parsed as a UUID and trusted as the caller's identity — no session/JWT/API-key validation anywhere.
- **Impact:** any caller can impersonate any user for ramp-intent read/create, and combined with the chain-confirm CRITICAL, complete fraudulent payouts as anyone.
- **Fix:** replace with a verified session token/signed JWT (e.g. against Dynamic Labs WaaS session claims), reject unauthenticated requests before they reach handlers.
- Same finding independently reached by identity's audit (there as a HIGH — appsec rates CRITICAL given direct compounding with finding #1; advisory synthesis should reconcile).

### [MEDIUM] Offramp fiat payout amount derived from client-supplied `usd_amount_cents`, never reconciled against actual confirmed transfer
- **OWASP:** A06:2025 Insecure Design
- **Location:** `apps/settlement/src/contracts/api.rs:22-35`, `services/intents.rs:88-236` (quote computed from client input), `workers/webhook_processing.rs:172-200` (marks `payment_confirmed` by reference match only, no amount cross-check), `payout_dispatch.rs` (pays `estimated_ngn_amount_minor` from the quote, not from a verified deposit amount).
- **Impact:** even independent of the CRITICAL auth gaps, the payout amount is never reconciled against a trusted independently-observed amount — compounds finding #1 to let an attacker set an arbitrary payout amount.
- **Fix:** re-verify actual settled amount from a trusted source before payout; reconcile against quote within tolerance; flag mismatches for manual review instead of paying unconditionally.

## Needs verification

### [?] Non-constant-time Paystack HMAC comparison
- `apps/settlement/src/paystack/signature.rs:37` — `if expected == provided_lower`. Kora correctly uses `mac.verify_slice` (constant-time) at `kora/signature.rs:28`. Low exploitability (network jitter dominates), still worth fixing for defense in depth.

### [?] `backend-api` validation/rate-limit/CORS coverage across every route — not fully enumerated
- `apps/api/src/{validation,rate_limit,cors}.rs` and route registrations in `{clearsign,intents,proposals,pro,wallet}.rs`. Confirmed the on-chain program independently re-verifies ClearSign signatures server-side-equivalent (`typed_proposal.rs:392-439`), so a backend-api bug can't forge an on-chain approval — but did not confirm middleware is attached to literally every route. Follow-up needed.

### [?] `apps/api/src/cors.rs` permissive fallback in misconfigured environments
- `:14-40` — falls back to `CorsLayer::permissive()` rather than failing closed when no allow-list configured/parses. Confirm production always sets `CLEAR_MSIG_ALLOWED_ORIGIN`; recommend fail-closed instead.

## Informational / hardening — good news, on-chain core logic reviewed sound

- **On-chain policy engine (`policy.rs`, `advanced_policy.rs`) is well-built:** bounds-checked parsing throughout (`checked_add`/`checked_mul`, explicit length checks before slice access); `unsafe` casts in `bytes_to_keys`/`keys` are sound (`[u8;32]` has alignment 1, length validated as multiple of 32 first). Rule-effect parser **fails closed**: unknown action codes, unknown condition kinds, truncated/malformed extensions all rejected with `WalletError::InvalidPolicy` rather than defaulting to allow. Velocity/allowance math uses `checked_add` throughout — no overflow bypass found.
- **ClearSign v2 envelope binding (`clearsign.rs`) is sound as wired:** on-chain handlers never trust caller-extracted clear text — they deterministically reconstruct the exact signed `vote_message` server-side (`typed_proposal.rs:427-438`) and verify the ed25519 signature against the reconstruction. `envelope_hash` is checked against `hash_envelope(...)` of `policy_commitment`/`payload_hash`/`clear_text_hash` before signature verification — no WYSIWYS divergence possible through this path. `extract_clear_text_from_vote_message` is unused outside tests (off-chain tooling only).
- **`message.rs` domain separation:** distinct hash domains per purpose (`CLEARSIGN_V2_DOMAIN`, payload/policy domains) prevent cross-action hash collisions (verified by `escrow_release_and_return_hashes_are_not_interchangeable` test). No diff against pre-update version available, but current file internally consistent.
- **`signer/solana.rs`:** no TLS-skip issues; SPL token transfers explicitly unimplemented (fails loudly) rather than silently mishandled — correct fail-closed behavior. The exposure is entirely in what can *reach* this signer (see Confirmed above), not in the signer itself.
- **Advanced rule engine cooldown/window math:** `u32`-bounded, `checked_add` throughout — no overflow-based timelock bypass.
- **CI/workflow (semgrep):** mutable action tags, some `run-shell-injection`/`gha-curl-pipe-shell` patterns in deploy workflows — not in the fund-movement critical path, standard hardening (cross-reference infra/supply-chain).

## Coverage
- **Tools run:** semgrep 1.169.0 (`p/owasp-top-ten`, `p/security-audit`, `p/rust`, `p/typescript`, `p/nodejs`, `p/secrets`) — 35 results, ALL in `.github/workflows/*.yml`; zero hits in `programs/`, `apps/api/`, `apps/settlement/`, `apps/web/` source — consistent with the real bugs being access-control/business-logic issues scanners can't catch.
- **Checked (manual, hotspot-prioritized):** `policy.rs`, `advanced_policy.rs`, `clearsign.rs` (full read + call-site trace into `typed_proposal.rs`); `signer/{solana,engine}.rs`, all rust-settlement workers, full `http/handlers.rs` route surface + `main.rs` router wiring, both webhook signature verifiers.
- **Not checked (gaps):** `message.rs` diff against pre-update scheme (no prior version to diff); `state/*.rs` PDA/account-ownership checks beyond `enforce_wallet_policy_account` (reviewed, looks correct); full `backend-api` route enumeration for middleware coverage; agent trading vault session-grant replay/extension/cap-bypass logic in instruction handlers (only confirmed hash-binding functions exist, didn't trace full replay safety — recommend follow-up); frontend Next.js API routes; `@encrypt.xyz/pre-alpha-solana-client` dependency not reviewed (supply-chain's lane).
