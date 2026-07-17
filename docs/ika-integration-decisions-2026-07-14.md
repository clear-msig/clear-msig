# Ika Integration Decisions - 2026-07-14

Source: ClearSig discussion with Ika/Encrypt DevRel on 2026-07-14.

This record turns the discussion into engineering constraints for the
ClearSign v4 and Ika migrations. A discussion item is not marked shipped until
its code, tests, deployment evidence, and trust-boundary documentation exist.

## Decisions

| Area | Decision | Current state | Completion evidence |
| --- | --- | --- | --- |
| Workspace shape | Converge reusable Rust logic under `crates/`; keep binaries and the Solana deployable as thin packages. | In-repository consolidation complete: runnable products are under `apps/`, reusable Rust under `crates/`, and the program plus generated client under `programs/`. CI enforces the boundaries. | Workspace tests pass after each move; deploy artifact checksum and program ID remain unchanged unless an intentional upgrade is recorded. |
| Old Solana files | Remove superseded program files only after an ownership and reference inventory proves they are unused. | Complete for proven duplicates. Two stale generated clients, nested lockfiles, and a redundant package-local Quasar manifest were removed. One active program and one checked generated client remain. | `git ls-files`, workspace manifests, deploy scripts, CI, and live program provenance agree before deletion. |
| Repository access | Separate public protocol/examples from private product frontend and backend code. Private source control limits repository access but is not a security boundary for browser-delivered JavaScript. | Extraction-ready, not privately split. Web, API, settlement, CLI, and E2E have explicit app roots and import gates; the current GitHub repository and its history remain public. | Private repositories, minimal deployment credentials, CODEOWNERS, secret scanning, reproducible public interfaces, and verified Railway/Vercel builds. No secret or trusted enforcement moves into frontend code. |
| Copyrights | Remove legacy product notices while preserving third-party copyright and license obligations. | Complete for ClearSig-owned source. A root `BSD-3-Clause-Clear` license was added and active legacy product attribution removed. dWallet/Ika and vendored notices remain intentionally. | Every vendored file maps to an upstream source, revision, license, and retained notice. |
| Clear signing | Use canonical, typed intent documents. Select any hardware profile before hashing and bind the exact displayed bytes into the envelope. | ClearSign v4 fixed-order canonical bytes now drive payload hashing, full/compact rendering, backend verification, and onchain verification. The program derives the exact signer document and executor payload from the same bytes. Physical-device qualification remains open. | Golden vector and adversarial Rust/backend/SBF tests pass. Recorded Ledger screens and firmware tests are still required before hardware qualification is complete. |
| Device limits | Negotiate message length from an allowlisted device capability profile. Never accept an arbitrary length or template supplied by the browser, wallet, RPC, or relayer. | Implemented with `clearsig-full-v2@1` (2,048 bytes) and `clearsig-ledger-solana-v2@1` (1,024 bytes). Unknown profile codes are rejected. The compact template retains mandatory authority fields and fails rather than falling back to hash-only signing. | Shared crate, backend, and program accept registered profile markers. Compact documents retain full amounts, assets, destinations, network, proposal, expiry, threshold, policy, and execution evidence. Physical Ledger limits remain to be measured. |
| Intent library | Extract versioned intent schemas, template identifiers, canonicalization, and test vectors into reusable crates. | `clear-msig-intent` owns chain transaction templates and the managed custom-template domain. `clear-msig-signing` owns canonical approval bytes, payload/envelope commitments, rendering, device profiles, executable/review-only registry, and the normative v4 vector. | Rust validates the canonical vector and mutation matrix. The browser intentionally does not implement the authority hash. Durable trusted storage and cryptographic publisher authorization for hosted custom templates remain unconnected. |
| Ika infrastructure | Track the Solana integration upgrade and testnet mint/burn work as upstream dependencies, not ClearSig security guarantees. | Upstream work in progress per DevRel. The backend rejects browser substitution of its configured dWallet program and coordinator and reports `prealpha_mock`, `unverified_external`, or `not_configured` signing assurance in health output. No mode is labeled distributed. | Pinned production Solana Ika release, distributed-signing test evidence, failure/retry tests, and testnet execution receipts. |
| State proofs | Proprietary state proofs may be used for internal validation only until independently specified and reviewed. | Internal-only constraint accepted. | No user-facing or security claim relies on an unpublished proof system; external trust-boundary documentation remains complete. |
| Launch timing | August is a target, with September acceptable if testing requires it. Security gates override calendar dates. | Planning input only. | No launch until critical tests, external review, incident controls, and deployment rehearsals pass. |

## Hardware Template Contract

The canonical intent is the source of truth. A future device profile may choose
a full or compact rendering, but the selected profile ID, version, and exact
rendered bytes must be committed before any signature request is created.

Every profile must preserve these user-verifiable facts:

1. Action and destination chain.
2. Asset, human amount, and raw amount commitment.
3. Full destination or an explicit device-supported verification flow.
4. Approval and policy effect, including timelock when applicable.
5. Exact expiry and replay-resistant envelope commitment.
6. Purpose text in the full profile. The constrained profile may omit it only
   after retaining every mandatory authorization field.

Truncation, host-only fields, silent fallback, and post-preview template changes
are forbidden. A compact profile is a separately versioned canonical template,
not a shortened string produced ad hoc.

Ledger capability discovery uses the Solana app's reported configuration. The
compact profile requires app version 1.14.0 or newer; a missing or malformed
version stays on the full profile. The profile is selected for the actual
authorized signing key, not merely because a Ledger is connected. This follows
Ledger's official Solana signer and migration guidance:

- <https://developers.ledger.com/docs/device-interaction/references/signers/solana>
- <https://developers.ledger.com/docs/device-interaction/integration/migrations/signers/solana/hw_app_solana_to_dmk>

## Managed Custom Templates

Custom templates are shareable only as immutable `(template_id, version,
canonical_hash)` records. The managed registry rejects built-in ID shadowing,
content changes under an existing version, duplicate imported versions, hash
substitution, and revocation by a different recorded publisher.

The current implementation is the reusable domain contract. It is not a hosted
template marketplace: durable backend storage, cryptographic publisher
authorization, organizational review, and a public distribution API remain
separate work. Browser-provided template text is never trusted as a published
template.

## Migration Order

1. **Code complete; deployment deferred:** Implement ClearSign v4 canonical
   parsing and rendering, reject new v2/v3 creation, and retain narrow v2/v3
   approval/cancel compatibility for existing
   proposals.
2. **Complete:** Extract the intent schema and canonical template registry into
   a reusable crate with Rust and TypeScript golden vectors.
3. **Code complete; hardware qualification pending:** The allowlisted device
   capability registry and full/compact templates are implemented across the
   browser, backend, and program. Real Ledger screen capture and supported
   firmware tests remain required before this item is fully complete.
4. Inventory and remove proven-dead Solana files, then consolidate remaining
   reusable Rust modules under `crates/` without mixing deployable ownership.
5. Split private apps/web/backend repositories from the public protocol and
   examples after CI, deployment, and interface contracts are reproducible.
6. Adopt the production Ika Solana integration only after distributed-signing,
   mint/burn, retry, replay, and interrupted-operation tests pass.

## Honest Boundary For This Upgrade

ClearSign v4 binds the exact readable document, network, payload hash, policy
commitment, selected display profile, signer, approval state, expiry, and
envelope proof. The Solana program parses the canonical bytes, renders the exact
document, and recomputes action-specific execution commitments. The former v3
prose/payload semantic gap is closed for implemented v4 actions. Swap, staking,
arbitrary contract interactions, and governance votes remain review-only until
they have authoritative executors. Compact rendering is active in code but is
not hardware-qualified until physical-device evidence is recorded.
