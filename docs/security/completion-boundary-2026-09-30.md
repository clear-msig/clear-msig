# ClearSig completion boundary — September 30, 2026

No production or preview release is authorized by this report. All new source
stays local. Existing original colors, Paystack/Korapay, pricing model and
fail-closed execution guards remain. No live financial/account operations were
performed. This report supersedes earlier blanket adapter-missing lists.

## Venue capability decision

The official [Hyperliquid TP/SL documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl)
states that children are placed after a full parent fill, or after partial fill
followed by cancellation for insufficient margin. Other partial-fill states can
leave children unplaced; cancelling a partially filled parent can cancel its
children. Market TP/SL also has documented slippage tolerance; a limit stop can
remain unfilled. The [exchange API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
exposes grouping and IOC, while [error responses](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses)
are normally per-order. Neither grouping nor a successful batch response is
sufficient evidence of all-or-nothing protected entry.

**Conclusion:** the current adapter cannot truthfully set
`supportsAtomicProtection = true` for the approved invariant. No submission
adapter is enabled or invented.

Concrete choices for the parent/user:

1. Keep the strict invariant and external trading gated until an independently
   verified venue mechanism meets it. Paper trading and proposal review remain.
2. Separately approve a different risk model: entry may temporarily lack
   protection, with explicit partial-fill sizing, exposure/time limits,
   cancellation/flattening authority and outage handling. This requires new
   signed semantics, an emergency-close design and dedicated tests. Compensating
   orders are not atomic and can themselves fail. No such change was made.

No alternative venue or quote provider was selected.

## Work completed in the continuation

- Native settlement info requests now use the documented numeric order ID
  shape, reject IDs that JavaScript cannot serialize exactly, prohibit redirects,
  bound response size and reject inexact numeric response identities.
- Filled reduce-only order evidence must have zero remaining size. Native fills
  must sum exactly to its original size. Duplicate fill IDs, incomplete or
  potentially truncated history, incorrect direction/accounting, and invalid
  query bounds fail closed. Monetary decimals must remain exact strings.
- Freshly verified evidence carries process-local provenance; JSON copies or
  modified objects cannot be persisted as trusted evidence. Redis atomically
  binds an immutable evidence record to a dedicated canonical wallet account
  and execution/session identity. Native order/fill reuse is blocked across
  claims and deployments using the shared registry, including after restart.
- `serverSolanaSettlementAuthority.ts` reads actual finalized proposal/wallet/
  intent accounts using pinned chain/program identities and the same shared
  owner/PDA/threshold verifier as trades. It checks the exact v4 settlement
  payload, envelope, policy, session, execution, artifact/oracle hashes, size,
  PnL/outcome and sequence. It reads evidence only; it never signs or executes.
  Expiry does not erase proof of an already executed settlement.

These are real adapter implementations with synthetic RPC/HTTP tests and real
local Redis tests, not live venue or deployed-program integration claims. The
recorded native evidence hash is not silently substituted for the protocol's
settlement artifact hash. Existing routes remain blocked.

## Complete gap inventory and stop conditions

| Area | Current state | Remaining boundary / classification |
|---|---|---|
| Per-trade chain authorization | Finalized canonical reader implemented and tested | **Config/live test:** trusted pinned RPC, deployed-program compatibility and real governance/wallet verification. Rust hash mirrors still need a cross-language/live-program integration run. |
| Dedicated venue accounts and delivery | Immutable initial bindings, atomic handoff/reservations and recovery implemented | **Config:** durable shared Redis/no eviction and reviewed assignments. **Code/product:** rotation, abandoned-reservation recovery and operational repair procedures. No accounts or keys provisioned. |
| Venue limits | Current policy hash does not encode cooldown, max positions or all venue rules | **Protocol/product decision:** define a versioned signed manifest/fields, signer display and commitment anchoring. Do not reinterpret an existing risk-check hash or treat a server assertion as wallet approval. After that, encoding/resolution/UI are code work. |
| Atomic protected entry | Documentation does not establish the required guarantee | **External capability/product decision:** strict gate or separately approved compensation model described above. Credentials cannot fix this. |
| Native order reconciliation | Read-only filled closing-order verification implemented | **Dependent code:** opening/child order reconciliation and exposure monitoring need the approved submission/partial-fill model and exact quantity/rounding commitments. A current open stop is not proof entry was atomically protected. |
| Settlement evidence | Complete native closing-order evidence, durable consumption and canonical executed-settlement reader implemented | **Accounting/product:** prove allocation to a particular opening execution in a netted position; define multiple/partial close handling and fee/funding allocation. Existing `closedPnl` gross semantics are preserved. No invented net PnL or reserved-notional conversion. Promotion waits for this mapping. |
| Close / emergency stop | Legacy unprotected helpers blocked | **Protocol/product:** separate threshold/delegated emergency authorization, exact execution binding and reconciliation; post-fill settlement is not advance close permission. |
| Agent HTTP composition | Real components exist, no execution route enabled | **Dependent code:** authenticated v2 order preparation/composition after the above semantics are resolved; never assign v2 authority to legacy descriptors. Read-only existing gates remain safe. |
| Payment/settlement service | Earlier auth/deposit-evidence fixes preserved | **Config/live test:** executable quote/auth configuration, trusted provider deposit evidence, PostgreSQL/provider integration in the target environment. Paystack/Korapay kept. Quote-provider replacement is deferred, not a hidden implementation task. |
| Auth/wallet/device providers | Secured SDK and guards retained; local synthetic flows tested | **Config/live test:** real login/MFA/device/embedded/external-wallet behavior. No live authentication was simulated as success. |
| Landing/UI | Original palette restored, progressive reveals/navigation and representative component flows tested | **Possible local code/testing:** remaining route/state fixture coverage and verified flow fixes. 85 route inventory is source coverage, not 85 rendered end-to-end passes. Real authenticated flows need config. No further redesign is required. |
| Bundle budgets | Production compile passes, unchanged budgets fail with secured SDK | **Separate scoped code project:** measured headless migration requires lifecycle/MFA/onboarding/recovery work. No safe drop-in lighter entry established; no deep-import hack, threshold relaxation or vulnerable downgrade. |
| Rust/SBF checks | No source change since validated transfer snapshot | **Tooling:** unavailable locally; don't rerun unchanged code just to fill a checklist. |
| Preview/release | Screenshot artifacts already delivered | **Coordination:** no further source push/deployment. The existing Vercel failure belongs to the parent's deployment investigation. |

A reasonable endpoint for this branch is reviewable security/flow changes and
coherent read-only evidence adapters with execution visibly gated. Completing
external trading now requires the explicit decisions above; continually adding
unwired submit stubs would not make the product safer or functional.

## Known conservative bounds

History pages at the provider's 2,000-fill cap are rejected rather than assumed
complete; the official [info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
limits response/history availability. Evidence records above 50 KB and numeric
order IDs above JavaScript's exact range are rejected. Larger history requires
an independently reviewed lossless/paginated archive path. No approximate IDs,
amounts, or inferred missing fills are accepted.

## Final local validation

- `npm run verify` with local Redis integration enabled: **178 Vitest files /
  1,087 tests**, plus **14 script tests** passed; intent/metadata/architecture,
  lint and TypeScript passed. Six cases use a real loopback Redis process.
- The additional native evidence test covers concurrent consumption, database
  restart/retrieval, wrong-wallet claims, a reused fill under another order ID,
  and rejection of deserialized evidence as fresh provenance.
- Production compilation passed; all 50 static pages were generated. The
  secured-SDK bundle gate remains failing at the same measurements: largest
  chunk 535.7/506 kB gzip, standard authenticated route 1009.0/971, external
  runtime 1137.9/1100, Turnkey 998.8/954. No budget was loosened.
- No UI/palette change in this continuation, so prior actual-component browser
  results and original-color screenshot artifacts remain applicable; no new
  live/authenticated coverage is implied.
- No root Rust/SBF source changed. No live RPC account/venue financial call,
  transaction, credential/account setup, push or deployment was performed.

Concrete accounting choices are also needed before promotion: a deliberately
restricted first release could permit one active execution per dedicated
account and full closure only, with explicitly approved gross-PnL semantics.
Keeping concurrent/partial executions instead requires a durable allocation
ledger for entry/closing fills plus an explicit fee/funding policy. Neither
restriction nor attribution rule was silently imposed here. Implementing the
new signed-limit format also requires the Rust/SBF toolchain to validate the
cross-language protocol changes; that toolchain is unavailable in this executor.
