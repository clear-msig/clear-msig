# Inline approval and interrupted-request review

Local review scope: existing creation → inline approval → execution callers. No wallet, signing, broadcast, account provisioning, or live provider calls were made. Browser fixtures use actual UI components with synthetic request IDs and callbacks.

## Findings and fixes

| Finding | Severity | Reproduction | Fix / regression |
|---|---|---|---|
| Inline approval omitted `expectedTyped` after the central signer began requiring it | High functional regression | Create a proposal requiring an explicit approver signature | Shared `inlineApprovalOptions` carries the original browser-prepared summary; verifies the original creation document, approval document, envelope/payload, context, replay identity, and configured-program-derived typed proposal PDA. Central signer protection remains. |
| A substituted submit address could drive subsequent approval/execution | High | Mock create response with another request address | Derive and compare the expected PDA; also check returned address when auto-approval skips inline signing. |
| Interrupted remote sends allowed blind creation retries; lost response treated like an ordinary failure | High duplicate-payment risk | Drop create response, reject approval, or fail execution; press send again / reload | Record expected request before submission as **unknown**, mark **submitted** only after matching response. Scope by SDK subject / connected signer / configured program+genesis / wallet / RPC / destination network. Same-tab/session retry guard; explicit existing-request recovery. |
| Remote send completion could be reported without a transaction ID | High misleading status | Execute returns no `broadcast.tx_id` | Keep saved request and report unconfirmed execution instead of the success screen. A transaction ID is submission evidence, not independently verified finality. |
| Governance/protection failures could create a duplicate change on retry | High | Approval/execution fails after successful create, or create response is lost | Common recovery store keyed by account, RPC, canonical wallet and exact desired payload; shared wallet-layout notice. Exact retry blocked; distinct changes remain usable. Deliberate separate-request acknowledgement is bound to request identity. |
| Pending governance/protection advertised as added/active/on chain | Medium | Quorum not met after member/policy creation | Member add routes to existing request without saving an active member contact. Policy form/budget/allowlist/allowed-hours copy explicitly distinguishes proposed/pending activation. Local rules list describes browser storage, not verified enforcement. |
| Account/network switch could revive an old attempt after switching back | High | Open signing flow, switch identity A→B→A | Generation-based identity checks and pre-submit/pre-approval/pre-execution checks reject old attempts. Original accepted request remains in original scoped recovery metadata. |
| Recovery acknowledgement carried to another request and incorrect text tokens | Medium | Switch fixture request after checking acknowledgement | Request-bound acknowledgement; established original palette text tokens. Independent browser review at 320/390/1440 confirmed contrast, full address, no overflow, keyboard and replacement-request reset. |

## Complete inline caller inventory

| Production caller | Inline approval sites | Original trusted summary |
|---|---:|---|
| `features/send/infrastructure/finalizeSolanaSend.ts` | 2 | `summary` + original creation `dry`, propagated from `prepareSolanaSendProposal` |
| `features/send/routes/EthSendPage.tsx` | 2 | `summary` |
| `features/send/routes/Erc20SendPage.tsx` | 2 | `summary` |
| `features/send/routes/BtcSendPage.tsx` | 2 | `summary` |
| `features/send/routes/ZecSendPage.tsx` | 2 | `summary` |
| `lib/hooks/useBatchSend.ts` | 1 | `summary` |
| `lib/hooks/completeTypedGovernance.ts` | 1 | `summary`; covers member add/remove/role, threshold, timelock |
| `lib/hooks/usePersistWalletPolicy.ts` | 1 | `summary`; covers policy/budget/allowance callers |
| `lib/agents/useAgentTypedClearSignApproval.ts` | 1 | `summary` |
| `lib/agents/useAgentTypedSessionGrant.ts` | 1 | `prepared` |
| `lib/agents/useAgentTypedRiskPolicy.ts` | 1 | `prepared` |
| `lib/agents/useAgentTypedTradeSettlement.ts` | 1 | `prepared` |

Total: **17 inline approval sites in 12 callers**. `useProposalWorkflow` is the separate finalized canonical-account inbox workflow. Legacy `useBatchApprove` has no individual review and remains blocked by the central signer; its obsolete “Approve all” implementation comment was corrected, not its authorization widened.

## Compatibility and evidence boundary

- Inline v4 approval has stronger local original-intent evidence than a later inbox: the independently prepared creation summary and its verified creation descriptor are still in this invocation. This preserves original reviewed full/compact documents and policy kinds 6/16 without using the backend response as its own authority. No summary is cached or reused across requests.
- Generic inbox review remains subject to its separately documented canonical-account, supported-profile and pinned-genesis requirements. Inline verification is not a claim that finalized RPC ownership, live authentication, or wallet hardware was independently exercised.
- Replay IDs are checked against v4's stored SHA-256 label bytes exposed by the server through UTF-8-lossy conversion; BOM bytes are preserved to match Rust.
- Recovery state stores public request IDs, outcome, wallet/RPC labels and hashed identity keys. It stores no signature, policy plaintext or raw SDK auth subject. It is a UX retry barrier, not a financial authorization or cross-device idempotency service. Browser storage denial retains in-memory protection; a separate browser/session cannot be coordinated by it.
- Three agent creation hooks preserve the accepted proposal record on later inline failure, allowing their existing caller persistence to resume that request. Settlement already has `onProposalState` persistence. Lost initial agent-create responses still depend on backend/request reconciliation; no durable financial idempotency capability is claimed.
- No business risk semantics changed. Existing external execution/protection/account/quote/configuration gates remain. No source publication or deployment was performed.

## Validation

Focused checks cover actual verifier/PDA binding, field mutations, full/compact v4 compatibility, batch cancellation, scoped recovery, response-loss, accepted-then-failed execution, missing transaction evidence, identity changes, duplicate admission, storage failure and the real governance orchestrator with explicitly mocked providers. Independent browser results are in the parent consolidation's `send-recovery-results.json` with desktop/mobile captures. Final aggregate counts and production/bundle checks belong to the consolidated report.
