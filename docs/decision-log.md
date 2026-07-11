# ClearSig Decision Log

This document tracks product and engineering decisions for ClearSig. It is written for team review and CTO visibility, so entries should be short, specific, and tied to business or product impact.

## Operating Rule

Before any implementation:

1. Inspect the relevant code or product surface.
2. Explain the finding.
3. Recommend the exact change.
4. Get approval before editing files or changing behavior.
5. Record the decision here after approval.

Read-only diagnosis is allowed without approval. Code changes, destructive git actions, dependency changes, migrations, and product behavior changes require approval first.

## Approved Decisions

| Date | Area | Decision | Reason | Status |
| --- | --- | --- | --- | --- |
| 2026-07-07 | Workflow | Use approval-first implementation for all future ClearSig updates. | Keeps product changes accountable and avoids accidental scope drift. | Active |
| 2026-07-07 | Documentation | Maintain this decision log in `docs/decision-log.md`. | Gives the team a clear handoff record for future sessions and CTO review. | Active |
| 2026-07-07 | Product routing | Remove query-based product wallet destinations for Personal, Pro, and Agent. | Users should land on a specific product wallet after login, or choose between matching wallets when there is more than one. | Done |
| 2026-07-08 | Wallet navigation | Remove the global Back chip from selected wallet home screens and prevent browser back from reopening the product wallet chooser. | Once a user chooses a product wallet, the wallet home should be the entry point, not a reversible selection step. | Done |
| 2026-07-08 | Auth boundary | Redirect authenticated users away from public/product pages back into the wallet shell. | Browser history should not let a connected user leave the protected wallet experience without disconnecting. | Done |
| 2026-07-08 | Connect routing | Let connected wallets redirect even while the Dynamic SDK is finishing hydration. | A real connected session should not get stuck on `/connect` when a safe `next` wallet route is already known. | Done |
| 2026-07-10 | Wallet entry | Remove the exact `/app/wallet` hub and make `/app` resolve into a selected wallet, with switching handled inside the wallet balance card. | Keeps desktop and mobile focused on the active wallet workspace instead of a duplicate workspace list. | Done |

## Pending Decisions

| Date | Area | Question | Owner | Status |
| --- | --- | --- | --- | --- |
| 2026-07-07 | Secure routing | Decide whether Secure should keep `/app/secure` or resolve into a specific recovery wallet. | Secure has a different flow and is intentionally outside the current routing refactor. | Waiting |

## Decision Entry Template

Use this format when a new decision is approved:

| Date | Area | Decision | Reason | Status |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD | Product area | What was approved. | Why it matters. | Planned, Active, Done, or Reversed |

## Notes

- Keep entries plain and direct.
- Record decisions, not every small code edit.
- If a decision is reversed, add a new row instead of deleting history.
- Link to PRs, issues, or files only when they help review.
