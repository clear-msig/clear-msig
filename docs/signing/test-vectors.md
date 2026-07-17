# ClearSign v4 test vectors

## Normative vector

`tests/fixtures/clearsign-v4-transfer.txt` is the normative v4 transfer vector.
It contains:

- exact canonical binary bytes as lowercase hex,
- action payload hash,
- SHA-256 signer-document hash,
- v4 envelope hash,
- exact full-profile document bytes.

The input is a 0.3 SOL transfer on Solana Devnet from `Team treasury`, proposal
6, requiring two approvals, with deterministic wallet, actor, action, nonce,
expiry, recipient, and policy values.

The unit test
`transfer_golden_vector_locks_bytes_document_and_commitments` regenerates every
value from the shared no-std crate and compares byte-for-byte.

## Adversarial coverage

The signing crate and SBF-backed program tests reject changes to recipient,
amount, network, asset, wallet, actor, proposal index, action ID, nonce, expiry,
policy commitment, approval threshold, execution template, escrow evidence, and
any ordered batch row. They also cover malformed addresses, Unicode
confusables, newline injection, unknown device/network/action codes, trailing
bytes, exact decimal rendering, replay, duplicate execution, timelocks, and
expired signatures.

The browser does not generate commitments. It receives canonical bytes and
rendered text from the trusted API, then signs the exact typed vote bytes. This
deliberately avoids maintaining a second TypeScript hashing implementation.

Fiat snapshot tests prove that a fresh estimate changes canonical review proof
and rendered text without changing the executable payload hash, while stale or
future snapshots are rejected by trusted preparation.
