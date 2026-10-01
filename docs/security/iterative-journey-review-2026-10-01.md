# Iterative user journey review — 1 October 2026

Starting point: `6c44c0d06542c93c943789aa4208bc3a05336cd7`. All changes are
local review work. Original palette retained. No publishing, real login, wallet
signing, payment, account provisioning or financial operation was performed.

## Review method and iterations

1. **Journey/source review:** an independent proposal/security reviewer, a
   payments/agents/recovery reviewer and an actual Chromium browser reviewer
   challenged the existing landing → entry → wallet → request → approval →
   history flow plus settings, payments, recovery and agents. Existing integration
   gates were read first so they were not confused with new defects.
2. **Fix and adjacent retest:** repaired concrete issues below; exercised actual
   production helpers/hooks/components with explicitly mocked provider boundaries.
   Browser checks used the real public pages and isolated component fixtures,
   blocking external traffic and financial writes.
3. **Second independent look:** caught additional defects in cancellation target
   binding, recovery prose wrapping, emergency-pause synchronization, saved-request
   recovery, policy sentinel/time/velocity semantics, and typed activity labels.
   Fixes were compared against checked-in Rust semantics and retested. Final
   consolidated results and coverage are recorded below/in the handoff logs.

Severity: **high** means misleading financial/security state, hidden material
signing data, substituted signing context or duplicate-operation risk; **medium**
means a broken or misleading journey/accessibility state; it is not a declaration
of exploitability or loss of funds in a deployed system.

## Findings and disposition

| ID | Severity | Route / reproduction | Fix / regression evidence | State |
|---|---|---|---|---|
| J01 | Medium | Proposal: default connected signer is unrelated but a secondary signer is a member | Resolve eligible connected signers; skip members already casting the same vote; pure vote-state + actual page tests | Fixed |
| J02 | High | Proposal: cancel below quorum or cancel after previously approving | Show cancellation vote/count/quorum and reversal semantics; allow protocol-supported cancellation while approved; no false terminal decline | Fixed |
| J03 | Medium | Proposal: RPC fails, or endpoint changes with cached proposal/context | Retryable read error instead of NotFound; endpoint-scoped cache/subscription invalidation | Fixed |
| J04 | High | Proposal overview: feed an account owned by another program or with wrong PDA | Verify owner/PDA/wallet/intent snapshot for displayed state, including terminal history; malicious account fixtures | Fixed |
| J05 | High | Cancellation preparation returns a self-consistent descriptor for another action/request | Exact action/target/signer/quorum/expiry/commitment/document binding; fresh checks before sign/submit; account/network/unmount guard | Fixed |
| J06 | High | Inline typed approval after creation lacks independently reviewed expected data | Explicit trusted-creation binding at all inline sites; derived proposal PDA, exact document/replay/context tests; central signer guard retained | Fixed |
| J07 | High | Send submit/approval/execute fails after a request may have landed; user retries create | Preserve saved/uncertain request identity; resume link and explicit separate-request acknowledgement; account/RPC-scoped persistence and repeated-click guard | Fixed |
| J08 | High | Remote executor returns success-shaped response without transaction ID | Do not claim sent/completed; retain existing request for reconciliation | Fixed |
| J09 | High | Governance/policy fails after request submission, form permits blind repeat | Shared scoped recovery record and wallet notice; same request requires explicit existing-request review, distinct changes remain usable | Fixed |
| J10 | Medium | Supported policy change shows only opaque new-policy commitment | Decode committed CSP1 SOL/CSP2 SPL rules and known advanced v1 conditions; bind new-policy hash/mint/decimals; block unknown/malformed/opaque remote rules | Fixed within documented coverage |
| J11 | High | Buy/sell status polling fails while cached state says settling/paying | Explicit unknown status, preserved payment ID, read-only refresh; no transfer/progress assurances from stale state | Fixed |
| J12 | High | Funded payment requires manual review but screen says failed/try again | Operator-review warning and retained ID; no duplicate-payment advice or false funds-not-received notification | Fixed |
| J13 | High | Recovery approval on mobile shortens source/destination to hover-only text | Full addresses/mint, available quorum, explicit unverified network/unknown fees; mobile rows stack with readable prose | Fixed |
| J14 | Medium | Agent funding read fails or settles without an address | Separate error/unavailable/disconnected from loading; stale address hidden; refresh only | Fixed |
| J15 | High | Save escrow metadata without depositing; card says funded/protected | Recorded amounts and custody disclaimer; save explicitly moves no funds; exact decimal milestone bounds | Fixed |
| J16 | High | Pause synchronization fails or bridge is gated; toast claims all external actions stopped | Distinguish local/ClearSig pause from synchronized state; external positions/orders not confirmed closed/cancelled | Fixed |
| J17 | Medium | Settings describes all on-chain limits as USD and promises future oracle behavior | Correct asset-specific units/illustrative prices; selected-state semantics and ≥44px controls; small-screen label spacing | Fixed |
| J18 | Medium | Connect page under reduced motion remains opacity zero after hydration | Explicit visible reduced-motion animation target; actual 320/390/1440 browser retest and SSR regression | Fixed |
| J19 | High | Agent product/chooser graphics imply a live trading desk or active custody protection | Clearly illustrative/testnet readiness and gated external execution; no fabricated live performance | Fixed |
| J20 | High | Activity query fails; UI says no activity or exports a seemingly complete partial list | Read error/refresh and incomplete-data notice; suppress false empty/totals/export; endpoint-scoped queries | Fixed |
| J21 | Medium | Executed governance/agent request appears as Custom/Sent in history | Preserve all typed action identities; action-neutral execution labels when funds movement is not established | Fixed |

Final browser evidence records 37 flow/viewport cases across eight result files,
plus the initial route captures. All 37 pass; these include actual public pages
and explicitly synthetic component callbacks, not 37 live financial journeys.
The 85-page source inventory is not a claim of 85 executed end-to-end routes.

Second-look corrections are included in the corresponding rows, rather than
counted as separate product features. For policy review, zero base amount cap is
unlimited **but zero proposer allowance blocks that proposer**; delay is measured
after approval plus governance timelock. Duplicate proposer caps are rejected.
Advanced rules use first-match priority and AND conditions. Advanced velocity
requires enabled base tracking with the same window; unsupported bytes never
become approval authority.

## Coverage and honest limits

- **Actual public route rendering:** landing, chooser, connect, product entry
  surfaces and security explainer; desktop/mobile, reduced/default motion,
  no-JavaScript public narrative where supported, keyboard/anchors/back navigation.
  Sign-in unavailable is an expected configuration state, not a tested login.
- **Actual components with synthetic state:** wallet overview, request overview,
  canonical review, display settings, payment unknown/manual-review, recovery
  review, funding error, history error, saved-request recovery. Captures and scripts
  identify their scope; fixture callbacks do not prove real transaction behavior.
- **Production mutation code with mocked boundaries:** creation/inline approval,
  cancellation/approval, signer/account/network switching, stale state, duplicate
  clicks, rejected signatures, saved/uncertain submission and recovery.
- The route inventory is broader than browser execution coverage. Authenticated
  end-to-end route navigation, hardware/embedded/external wallet behavior, provider
  settlement and all chain executors are not claimed tested. Private routes were
  not accessed through live auth bypasses; fixtures exist only outside the repo.

## Consolidated validation

- `npm run verify` with both temporary Redis integration binaries configured:
  **205 Vitest suites / 1,433 tests, plus 14 script tests passed**. All six
  real temporary Redis integration cases ran. Intent/metadata/architecture,
  ESLint and TypeScript checks passed.
- Browser review: **37 passing flow/viewport cases**, with actual public pages
  and explicitly synthetic component/provider boundaries; coverage and raw
  captures are included in the portable handoff.
- The architecture recheck caught and corrected a route-size violation and an
  infrastructure import in render-only UI. Limits were not changed. Two
  whitespace-sensitive source assertions were corrected without changing their
  pending-approval contract. Final verification above includes these fixes.
- Production compilation passed, generating all 50 static pages.
- Unchanged bundle gate **fails**: largest chunk 535.7/506 kB gzip; worst
  standard authenticated route 1,013.5/971; external runtime 1,142.5/1,100;
  legacy Turnkey runtime 1,003.4/954. Proposal route is 990.7/971.
  Compared with the prior checkpoint, required review/recovery code adds about
  3 kB to the worst runtime route and 7.5 kB to the proposal route. This is
  measured cost, not a claim of performance improvement. The main SDK chunk is
  unchanged. Production compilation passing does not make the aggregate build
  command pass while this gate fails.

## Remaining release boundary

Generic inbox approval requires the configured expected genesis and verified
full-profile v4 accounts. Inline approval may reuse this browser's independently
reviewed creation document (including supported compact device profiles) with
strict creation/approval/PDA binding; it cannot derive trust from the backend's
approval response. Legacy/unrecognized generic reviews remain blocked, while
bound cancellation remains available. Known SOL/SPL policy encodings are decoded;
opaque remote identities or unknown future rules remain blocked. No account
layout or program deployment changed.

User decisions remain the restricted/full-close versus concurrent/partial agent
allocation mode and an explicit daily-loss reset timezone. Signed-limit/program
integration, opening/closing allocation, native reconciliation, authenticated
route composition and emergency authority remain separate code work. Atomic
protected entry is still not established; strict gating remains. Trusted RPC,
durable storage and real provider/auth/wallet verification still require target
configuration. Paystack/Korapay and the pricing business model are unchanged.

The secured Dynamic SDK's existing bundle gate remains a release blocker; no
budget relaxation, unsafe SDK imports or vulnerable downgrade was used. Root
Rust/SBF sources remain unchanged after the original frozen transfer and were
not rerun in this environment. No test count establishes that the system is
perfect, fully secure, or fully deployed.

## Bounded agent completion map

The versioned venue-limit schema and 45 binding/validation regressions already
exist in `docs/architecture/venue-limits-manifest-v1.md`; this review did not
replace them or enable trading. The finite boundary is:

| Category | Remaining item | Why it remains |
|---|---|---|
| User policy decision | Wallet-wide one active execution/full close versus concurrent/partial allocation | Changes permitted exposure and attribution; approval remains pending |
| User policy decision | Explicit daily-loss reset IANA timezone | Existing local-midnight calculations disagree across environments; no implicit UTC default assigned |
| Technical code | Canonical signed manifest rendering/resolution and exact v2 descriptor binding | Pure schema validation is not threshold authorization; requires compatible program validation and cross-language tests |
| Technical code | Opening/child-order reconciliation and close-to-opening allocation | Closing-fill evidence exists, but must be joined to the selected execution model before composition |
| Technical code | Authenticated route composition, threshold-authorized emergency close and binding rotation | Existing adapters do not grant operational authority by themselves |
| External capability | Proven native atomic protected entry | Batch/grouped orders have not established the required guarantee; compensation-based fallback is not authorized |
| Target configuration | Pinned deployment/RPC, durable shared storage, approved isolated venue binding | Local synthetic and temporary Redis tests are not production provisioning |
| Target configuration/live testing | Auth/device/wallet providers; executable settlement quotes/auth and trusted deposits | Requires target configuration and separately authorized real integration validation; Paystack/Korapay retained |
| Separate implementation scope | Secured Dynamic headless lifecycle migration if needed for bundle budgets | No safe lighter drop-in entry; current SDK and limits retained |

Already implemented code includes finalized canonical trade/settlement authority
readers, immutable per-wallet venue bindings, durable reservation/handoff and
restart reconciliation, and trusted native closing-fill evidence with immutable
consumption. These are tested with synthetic provider inputs and temporary local
Redis; they do not establish live execution readiness. Root Rust/SBF remains
unchanged. Any program deployment needs separate authorization; credentials
alone cannot resolve missing protocol capability or incomplete composition.

## Subsequent independent-review correction

The c617900 checkpoint missed execution-evidence handling in the inbox recovery
consumer and batch, unmount/A→B→A signing lifetime cases, and legacy setup
producer compatibility. Its J08 completion statement must not be read as
end-to-end coverage of those paths. See
[the correction review](correction-review-2026-10-01.md) for the fixes, exact
remaining capability boundaries and final handoff evidence. Historical counts
above describe the earlier checkpoint, not the correction tree.
