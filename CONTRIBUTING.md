# Contributing to ClearSig

ClearSig coordinates authorization for treasury funds. Treat signing text,
canonical bytes, policy evaluation, proposal lifecycle, and execution adapters
as security-critical code.

## Boundaries

- The frontend collects intent, presents trusted preparation results, requests
  signatures, and displays chain state. It must not invent authoritative v4
  payloads or policy results.
- `backend-api` authenticates and bounds transport input, derives trusted chain
  context, and invokes typed command contracts.
- `clear-msig-signing` owns canonical approval bytes, commitments, rendering,
  device profiles, and golden vectors.
- `clear-msig-execution` owns infrastructure adapters and transaction assembly.
- `programs/clear-wallet` is the final authority for threshold, policy,
  timelock, replay, and transaction-to-intent matching.

Review [the trust boundaries](docs/security/trust-boundaries.md) and
[v4 binding contract](docs/signing/intent-binding.md) before changing a signing
or execution path.

## Change rules

1. Add an adversarial test before changing canonical bytes or execution hashes.
2. Version wire-format changes. Never reinterpret an existing version.
3. Do not add a readable template without an executor that independently
   reconstructs the same authoritative fields. Mark unsupported actions
   review-only.
4. Never use JavaScript numbers for atomic token amounts.
5. Never log or commit RPC credentials, keypairs, tokens, mnemonics, or real
   deployment configuration. Start from `.env.example` files.
6. Preserve third-party notices and licenses. See the attribution audit.
7. Do not deploy from an unvalidated working tree.

## Local gates

Run the applicable repository gates before requesting review:

```bash
bash scripts/check-backend-architecture.sh
bash scripts/check-intent-architecture.sh
bash scripts/check-signing-architecture.sh
bash scripts/check-secrets.sh
cargo fmt --all -- --check
cargo clippy -p clear-msig-backend-api -p clear-msig-command-contract -p clear-msig-intent -p clear-msig-signing -p clear-msig-cli --all-targets --no-deps -- -D warnings
cargo test --workspace
cargo build-sbf --manifest-path programs/clear-wallet/Cargo.toml
cargo test -p clear-wallet --lib
cd apps/web && npm run build
```

Also run `git diff --check` and the configured dependency/secret scans. Record
any gate not run; do not describe unrun checks as passing.
