# Venue limits manifest v1

`venueLimitsManifest.ts` defines a strict, versioned commitment format for the
existing user-visible agent controls. It does not sign anything, replace an
existing policy hash, or enable execution. The live bridge still rejects all
external submissions. No default amounts, enabled flags or economic choices
are inserted. Encrypted/missing controls cannot be treated as plaintext bounds.

## Exact format and mapping

Canonical serialization uses a fixed field order, sorted unique allowlists,
ASCII domain `clearsig.agent.venue-limits.v1` followed by NUL and UTF-8 JSON,
then SHA-256. Unknown versions/fields and missing fields are rejected. Returned
objects and lists are immutable copies. The format is bounded to 8 KiB and each
allowlist to 256 entries; these are representation bounds, not risk allowances.

| Existing control / identity | Manifest field | Rule |
|---|---|---|
| Canonical deployment/wallet | `chainGenesisHash`, `programId`, `walletPda` | Exact base58 identities; names/endpoints do not confer authority |
| Current governance | `intentPda`, `approvalThreshold` | Explicit 1–16 threshold; must match trusted finalized context |
| Agent identity | `agentIdHash` | Nonzero 32-byte digest, not display name |
| Enabled / emergency pause | `enabled`, `emergencyPaused` | Required booleans; binding rejects disabled/paused policy |
| Venue / market allowlists | `allowedVenues`, `allowedMarkets` | Explicit nonempty unique sets; v1 supports Hyperliquid testnet external descriptors only; paper settings remain separate |
| Maximum trade size | `maxNotionalUsdRaw` | Positive u128 decimal string, 6 USD decimals; `venueUsdToRaw` rejects rounding/truncation |
| Maximum leverage | `maxLeverageX100` | Exact integer hundredths, >=100; native market limits must additionally be checked at integration |
| Stop / take profit | `requireStopLoss`, `requireTakeProfit` | Stop must be true; take-profit choice explicitly copied from controls |
| Position count | `maxOpenPositionsPerAgent` | Positive integer; retains existing per-agent meaning |
| Cooldown | `cooldownSeconds`, `cooldownStart` | Nonnegative integer seconds; v1 explicitly binds `entry_fill`, preserving existing opened-trade timing |
| Session duration | `maxSessionSeconds` | Positive exact integer seconds derived from the entered hours; no rounding |
| Daily loss cap | `dailyLossCapUsdRaw` | Positive exact u128, six-decimal USD |
| Daily reset | `dailyLossWindow`, `dailyLossTimeZone` | Calendar day and explicit valid IANA timezone; never server/browser implicit local time |
| Existing PnL semantics | `lossBasis`, `lossAggregation` | Required literals `realized_gross` and `net_pnl`; preserves gross realized PnL, with gains offsetting losses |
| Settlement scope | `executionMode` | Explicit `single_full_close` or `allocated_partial_close`; restricted mode additionally requires count=1; neither mode is enabled by this validator |

`assertVenueLimitsBinding` compares the manifest digest and deployment, wallet,
agent, governance intent and threshold to a supplied trusted context. It is an
ordinary pure binding check, not a signature verifier. The context must come
from finalized canonical authority when integrated; a client cannot supply it.

The schema deliberately rejects a switch to fee/funding-adjusted PnL,
losses-only aggregation, a rolling loss window or close-triggered cooldown.
Those would change existing economics and need an explicit future schema or
product change. They are not extra decisions needed to preserve today's model.
Existing risk amounts, leverage, market choices, duration and take-profit choice
come from the user's saved controls; the assistant does not select them.

## Remaining genuine choices

1. The user's restricted one-active-execution-per-wallet/full-close decision is
   pending. That mode imposes a wallet-wide single execution in addition to the
   existing per-agent count. Validation alone never applies that restriction.
2. The daily reset timezone is absent from today's policy. Current browser and
   server calculations call local-midnight APIs and can disagree. An explicit
   wallet policy timezone must be selected/confirmed; do not silently inherit
   the server's timezone. UTC is a possible setting, not an assigned default.

Strict stop protection is already decided and retained. No compensation model
or alternative venue is introduced. Gross realized accounting and entry-based
cooldown are mapped from existing behavior rather than reopening them as new
user questions. Allocating a close to an opening execution remains dependent on
the pending restricted/concurrent execution decision.

## Compatibility and integration work

- The new domain is distinct from legacy browser `vault-policy` v1 hashes,
  typed-send policy commitments, and `riskCheckHash`. No legacy bytes are
  reinterpreted; no automatic migration occurs.
- A future versioned external-order descriptor can include this separate
  commitment. Its digest can fit the existing canonical route field without
  changing that field's account layout. Merely showing an opaque route digest,
  however, is insufficient human-readable review of new policy controls.
- Full integration must extend the canonical signing input and deterministic
  signer document so the required controls are readable and bound. Current
  on-chain validation/rendering must recognize that versioned format. Existing
  account layout changes are not assumed necessary until the selected encoding
  is checked against size limits; 8 KiB manifest support does not imply today's
  2 KiB canonical-intent/policy fields can store it.
- Parser/renderer, exact descriptor binding, policy resolution and authenticated
  route composition are technical implementation work, not a request for the
  user to design a schema. Cross-language Rust/SBF tests are required and the
  toolchain is unavailable in this executor. Any program deployment requires
  separate authorization. No on-chain layout or deployment changed here.
- A real native atomic-protection mechanism remains an external capability
  blocker regardless of the manifest. Credentials cannot enable the gate.
