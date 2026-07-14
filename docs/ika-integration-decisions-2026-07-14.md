# Ika Integration Decisions - 2026-07-14

Source: ClearSig discussion with Ika/Encrypt DevRel on 2026-07-14.

This record turns the discussion into engineering constraints for the
ClearSign v3 and Ika migrations. A discussion item is not marked shipped until
its code, tests, deployment evidence, and trust-boundary documentation exist.

## Decisions

| Area | Decision | Current state | Completion evidence |
| --- | --- | --- | --- |
| Workspace shape | Converge reusable Rust logic under `crates/`; keep binaries and the Solana deployable as thin packages. | In progress. Command and execution crates exist, but the program client, backend, E2E harness, and settlement service are not consolidated. | Workspace tests pass after each move; deploy artifact checksum and program ID remain unchanged unless an intentional upgrade is recorded. |
| Old Solana files | Remove superseded program files only after an ownership and reference inventory proves they are unused. | Not complete. No directory is assumed obsolete from its name alone. | `git ls-files`, workspace manifests, deploy scripts, CI, and live program provenance all agree before deletion. |
| Repository access | Separate public protocol/examples from private product frontend and backend code. Private source control limits repository access but is not a security boundary for browser-delivered JavaScript. | Planned. The current monorepo is public and must not be described as private. | Private repositories, minimal deployment credentials, CODEOWNERS, secret scanning, reproducible public interfaces, and verified Railway/Vercel builds. No secret or trusted enforcement moves into frontend code. |
| Copyrights | Remove legacy ClearSig/Adapt product notices while preserving third-party copyright and license obligations. | Inventory started. Ambiguous `Adapted` wording was removed; Ika/dWallet notices and vendored licenses remain pending provenance/legal confirmation. | Every vendored file maps to an upstream source, revision, license, and retained notice. |
| Clear signing | Use canonical, typed intent documents. Select any hardware profile before hashing and bind the exact displayed bytes into the envelope. | ClearSign v3 canonical full document shipped in code; hardware capability profiles are not implemented. | Cross-language golden vectors, mutation tests, device screenshots, and hardware tests prove preview bytes equal signed bytes. |
| Device limits | Negotiate message length from an allowlisted device capability profile. Never accept an arbitrary length or template supplied by the browser, wallet, RPC, or relayer. | Planned. Current v3 document is capped at 2,048 bytes. | Unknown devices fail closed or use a tested full profile; compact profiles retain action, asset, amount, destination, chain, policy effect, expiry, and proof commitment. |
| Intent library | Extract versioned intent schemas, template identifiers, canonicalization, and test vectors into a reusable crate/library. | Seed exists in `programs/clear-wallet/client/src/intent_json.rs` and `examples/intents/`, including `erc20_transfer.json`; it is not yet an independent shared library. | Frontend preparation, backend, CLI, E2E, and program verification consume the same versioned schema or generated vectors without duplicated renderers. |
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

## Migration Order

1. Deploy ClearSign v3 with strict document parsing, v2-create rejection, and
   narrow v2 approval/cancel compatibility for existing proposals.
2. Extract the intent schema and canonical template registry into a reusable
   crate with Rust and TypeScript golden vectors.
3. Add an allowlisted device capability registry and full/compact templates;
   test real Ledger and supported wallet firmware.
4. Inventory and remove proven-dead Solana files, then consolidate remaining
   reusable Rust modules under `crates/` without mixing deployable ownership.
5. Split private frontend/backend repositories from the public protocol and
   examples after CI, deployment, and interface contracts are reproducible.
6. Adopt the production Ika Solana integration only after distributed-signing,
   mint/burn, retry, replay, and interrupted-operation tests pass.

## Honest Boundary For This Upgrade

ClearSign v3 binds the exact readable document, payload hash, policy commitment,
signer, approval state, expiry, and envelope proof. The Solana program validates
the document structure and execution commitments. It does not yet derive every
human-readable sentence from raw action fields, and no hardware-specific compact
template or independent intent-library package is active in this release.
