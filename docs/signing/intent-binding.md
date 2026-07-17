# ClearSign v4 transaction-to-intent binding

## Domains and hashes

ClearSign v4 uses SHA-256 with length-prefixed domain components.

- Canonical intent: `clearsig:canonical-intent:v4`
- Envelope: `clearsig:policy-engine:v4`
- Executable payload compatibility: `clearsig:policy-engine:v2:payload`
- Typed policy: `clearsig:policy-engine:v2:policy`

Canonical bytes are fixed-order binary bytes described in
`intent-schema.md`; JSON serialization is not used for authorization.

## Binding sequence

1. The trusted API reads wallet, intent, proposal index, threshold, current
   policy, and remote transaction-template state from Solana.
2. It normalizes user input into canonical v4 bytes.
3. The shared crate parses those bytes and derives the action payload hash.
4. The same crate renders the exact signer-facing document.
5. `document_hash = SHA256(rendered_document)`.
6. The envelope commits to action kind, network, proposal index, wallet name and
   ID, actor, action ID, nonce, expiry, required approvals, policy commitment,
   payload hash, and document hash.
7. The wallet signs the readable document inside the typed vote message. The
   vote suffix also shows decision, proposal, wallet, requester, threshold,
   post-vote status, expiry, version, and full envelope.
8. The program parses canonical bytes, renders the document again, derives the
   envelope again, verifies the signature, and stores canonical bytes and
   commitments in the typed proposal account.
9. At execution, the action-specific program instruction recomputes the payload
   from actual accounts and instruction arguments. Execution proceeds only when
   that payload, envelope, policy, state, threshold, timelock, and replay status
   match the stored proposal.

An optional fiat snapshot is bound to canonical and signer-document hashes but
excluded from the executable payload hash. It can therefore prove what estimate
was reviewed without changing the amount or asset that execution authorizes.

Remote-chain transfers additionally bind the immutable onchain intent
transaction-template hash. SPL escrow binds mint and token accounts.
Cross-chain escrow binds chain kind, Ika configuration, dWallet, route,
transaction template, and settlement artifact. Private escrow binds policy
ciphertexts, private evaluation, and settlement artifact.

## Replay and downgrade behavior

Action ID and nonce are hashed replay labels stored in the canonical intent.
Proposal index, expiry, actor, wallet, and network are independently bound by
the envelope. Executed proposals cannot execute twice. New v2/v3 proposal
creation is rejected; existing v2/v3 approvals and cancellations remain
compatible for already-created accounts.

## Trusted verification points

- Backend v4 prepare derives trusted chain context.
- Backend proposal lifecycle independently recomputes canonical assertions,
  rendered text, document hash, and envelope before invoking the CLI.
- CLI verifies externally supplied Ed25519 signatures against the exact expected
  typed vote bytes.
- Solana is the final authority for proposal creation and execution.

## Test vector

The normative transfer vector is
`tests/fixtures/clearsign-v4-transfer.txt`. It fixes canonical bytes, payload
hash, document hash, envelope hash, and exact rendered text. The Rust golden test
regenerates all five values. No TypeScript implementation generates authority
commitments, so there is intentionally no second browser commitment algorithm
to drift from Rust.
