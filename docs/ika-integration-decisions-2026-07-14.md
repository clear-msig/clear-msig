# Ika Integration Decisions - 2026-07-14

Source: ClearSig discussion with Ika/Encrypt DevRel on 2026-07-14.

This record turns the discussion into engineering constraints for the
ClearSign v3 and Ika migrations. A discussion item is not marked shipped until
its code, tests, deployment evidence, and trust-boundary documentation exist.

## Decisions

| Area | Decision | Current state | Completion evidence |
| --- | --- | --- | --- |
| Workspace shape | Converge reusable Rust logic under `crates/`; keep binaries and the Solana deployable as thin packages. | In progress. Command, intent, and execution crates exist, but the program client, backend, E2E harness, and settlement service are not fully consolidated. | Workspace tests pass after each move; deploy artifact checksum and program ID remain unchanged unless an intentional upgrade is recorded. |
| Old Solana files | Remove superseded program files only after an ownership and reference inventory proves they are unused. | Not complete. No directory is assumed obsolete from its name alone. | `git ls-files`, workspace manifests, deploy scripts, CI, and live program provenance all agree before deletion. |
| Repository access | Separate public protocol/examples from private product frontend and backend code. Private source control limits repository access but is not a security boundary for browser-delivered JavaScript. | Planned. The current monorepo is public and must not be described as private. | Private repositories, minimal deployment credentials, CODEOWNERS, secret scanning, reproducible public interfaces, and verified Railway/Vercel builds. No secret or trusted enforcement moves into frontend code. |
| Copyrights | Remove legacy ClearSig/Adapt product notices while preserving third-party copyright and license obligations. | Inventory started. Ambiguous `Adapted` wording was removed; Ika/dWallet notices and vendored licenses remain pending provenance/legal confirmation. | Every vendored file maps to an upstream source, revision, license, and retained notice. |
| Clear signing | Use canonical, typed intent documents. Select any hardware profile before hashing and bind the exact displayed bytes into the envelope. | Full and compact v3 rendering is implemented. Network, payload commitment, profile ID/version, purpose, and every destination are bound into the exact readable bytes before the envelope hash. Physical-device qualification remains open. | Cross-language golden vectors and mutation tests pass. Recorded Ledger screens and firmware tests are still required before hardware qualification is complete. |
| Device limits | Negotiate message length from an allowlisted device capability profile. Never accept an arbitrary length or template supplied by the browser, wallet, RPC, or relayer. | Implemented in code with `clearsig-full-v1` (2,048 bytes) and `clearsig-ledger-solana-v1` (1,024 bytes). Unknown, old, malformed, or wrong-key capabilities use the full profile or are rejected by the backend. | Browser, backend, and program accept only registered profile markers. Compact documents retain action, network, amount, destination, payload/policy commitments, and purpose. Physical Ledger limits remain to be measured. |
| Intent library | Extract versioned intent schemas, template identifiers, canonicalization, and test vectors into a reusable crate/library. | Shipped v1. `clear-msig-intent` owns the chain-neutral schema, validation, canonical JSON/hash, built-in registry, renderer, and a managed custom-template manifest with immutable versions, publisher ownership, publish/revoke state, and exact-hash resolution. | Rust verifies every built-in JSON file, generated artifacts, managed-registry tamper rejection, immutable versions, publisher-only revocation, and render vectors. Durable trusted storage and cryptographic publisher authorization for a hosted custom-template service are not yet connected. |
| Ika infrastructure | Track the Solana integration upgrade and testnet mint/burn work as upstream dependencies, not ClearSig security guarantees. | Upstream work in progress per DevRel. | Pinned Ika release, distributed-signing test evidence, failure/retry tests, and testnet execution receipts. |
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
6. Purpose text when the proposer supplied one.

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

1. **Complete:** Deploy ClearSign v3 with strict document parsing, v2-create
   rejection, and narrow v2 approval/cancel compatibility for existing
   proposals.
2. **Complete:** Extract the intent schema and canonical template registry into
   a reusable crate with Rust and TypeScript golden vectors.
3. **Code complete; hardware qualification pending:** The allowlisted device
   capability registry and full/compact templates are implemented across the
   browser, backend, and program. Real Ledger screen capture and supported
   firmware tests remain required before this item is fully complete.
4. Inventory and remove proven-dead Solana files, then consolidate remaining
   reusable Rust modules under `crates/` without mixing deployable ownership.
5. Split private frontend/backend repositories from the public protocol and
   examples after CI, deployment, and interface contracts are reproducible.
6. Adopt the production Ika Solana integration only after distributed-signing,
   mint/burn, retry, replay, and interrupted-operation tests pass.

## Honest Boundary For This Upgrade

ClearSign v3 binds the exact readable document, network, payload hash, policy
commitment, selected display profile, signer, approval state, expiry, and
envelope proof. The Solana program validates document structure and the
registered profile marker, while execution adapters validate action
commitments. The program still does not derive every human-readable sentence
from raw action fields. A compromised trusted preparation path could therefore
produce misleading but structurally valid text; external review and further
onchain semantic derivation remain necessary. Compact rendering is active in
code but is not hardware-qualified until physical-device evidence is recorded.
