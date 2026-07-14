# Audit Scope Map (post-pull, HEAD c171aa3)

## Stack
- **On-chain program**: Rust (`programs/clear-wallet`), custom framework `quasar_lang` (not Anchor), `no_std`/`alloc` — Solana multisig wallet program.
- **Backend API #1** (`backend-api/`): Rust/Axum. Links `clear-msig-execution` and `clear-msig-command-contract` crates in-process. Serves ClearSign proposals/intents/pro tiers.
- **Backend API #2** (`rust-settlement/`): Rust/Axum, Postgres, Paystack/Kora fiat rails, treasury signer, background workers. Separate service, same Dockerfile.
- **Frontend** (`frontend/`): Next.js 15 + React 19, TS. `@dynamic-labs/*` (embedded/WaaS), `@ledgerhq/hw-app-solana`, `@solana/web3.js`, `tweetnacl`, `bs58`, `@noble/*`, `@encrypt.xyz/pre-alpha-solana-client` (new pre-alpha dep). Mobile wrapper dirs (android/ios).
- **CLI** (`cli/`), **e2e** (`e2e/`), shared crates `crates/clear-msig-command-contract`, `crates/clear-msig-execution`, vendored `deps/solana-curve25519`.
- Lockfiles committed: root `Cargo.lock`, `rust-settlement/Cargo.lock`, `frontend/package-lock.json`.

## Entrypoints
| Path | Type | Untrusted input? |
|---|---|---|
| `backend-api/src/{clearsign,intents,proposals,pro,wallet}.rs` | Axum handlers | Yes — proposal/intent submission, ClearSign envelopes |
| `backend-api/src/runner.rs`, `runtime.rs` | Execution runner for on-chain instructions | Indirect |
| `rust-settlement/src/http/handlers.rs` | Axum routes, settlement/fiat | Yes |
| `rust-settlement/src/kora/{client,events,signature}.rs` | Kora webhook ingestion | Yes — external webhook |
| `rust-settlement/src/paystack/{client,events,signature}.rs` | Paystack webhook ingestion | Yes — external webhook |
| `rust-settlement/src/workers/*.rs` | Background pollers (chain_confirmation, disbursement, payout_dispatch, webhook_processing) | Processes previously-ingested data async |
| `frontend/src/app/api/*` | Next.js API routes | Yes |
| `frontend/src/app/app/**/page.tsx` | Client tx-construction pages | Yes |
| `programs/clear-wallet/src/instructions/*` | On-chain instruction handlers | Yes — final trust boundary |
| `cli/src` | CLI entrypoint | Operator |

## Trust Boundaries
| From | To | Crossing point | Validation? |
|---|---|---|---|
| Public internet | backend-api | `backend-api/src/validation.rs`, `cors.rs`, `rate_limit.rs` | Explicit `ensure_*` validators, rate limiter, CORS allowlist |
| Public internet | rust-settlement | `main.rs` (`build_cors_layer`, `RAMP_ALLOWED_ORIGIN`/`CLEAR_MSIG_ALLOWED_ORIGIN`) | Origin allowlist only — verify per-route validation |
| Paystack webhook | rust-settlement | `paystack/signature.rs` | HMAC present — verify strength |
| Kora/relayer webhook | rust-settlement | `kora/signature.rs` | Signature verification present |
| Frontend (client-signed tx) | On-chain program | `instructions/*`, `utils/policy.rs`, `utils/message.rs` | Program enforces policy/threshold/ClearSign hash-binding — the authoritative boundary, not the backend |
| Off-chain ClearSign text | On-chain approval vote | `utils/clearsign.rs`, `message.rs` | Hash-binds clear text to payload |
| rust-settlement | Solana RPC (treasury hot wallet) | `signer/solana.rs` | Server holds/loads a real Solana keypair, signs autonomously — **outside** the multisig approval flow |
| App → Dynamic Labs/Ledger SDKs | Third-party wallet infra | `frontend/src/lib/hooks/use*` | Client-side trust in vendor SDK |

## Integrated Services
| Service | Access layer | Credential source |
|---|---|---|
| Postgres | `rust-settlement/src/db.rs`, `migrations/` | `DATABASE_URL` |
| Upstash Redis | referenced in `render.yaml` | `UPSTASH_REDIS_REST_URL`/`TOKEN` (sync:false) |
| Solana RPC | `signer/solana.rs`, program clients | `CLEAR_MSIG_URL`/`SOLANA_RPC_URL` |
| Kora | `rust-settlement/src/kora/*` | `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM`, `CLEAR_MSIG_DEFAULT_GRPC_URL` (sync:false) |
| Paystack | `paystack/client.rs` | `paystack_secret_key` env |
| Treasury signer (custodial hot wallet) | `signer/{solana,engine}.rs` | `TREASURY_SOL_KEYPAIR_BASE58`/`_PATH`, `CLEAR_MSIG_KEYPAIR_BASE64`, `CLEAR_MSIG_SIGNER_BASE64` (sync:false) |
| Ledger hardware wallet | `@ledgerhq/hw-app-solana` | N/A (hardware) |
| Dynamic Labs WaaS | `@dynamic-labs/*` | Dynamic API key (frontend env) |
| `@encrypt.xyz/pre-alpha-solana-client` | new pre-alpha third-party dep, referenced in `clearsign.rs` (`hash_private_escrow_*`) | TBD — flag for supply-chain |

## Auth
- No traditional session/OAuth for API; wallet-pubkey identity + on-chain multisig approval signatures. Frontend uses Dynamic Labs/Ledger for wallet-level auth.
- Enforcement: CORS allowlist + input validators at HTTP edge; ultimate authorization is on-chain policy/threshold checks (`utils/policy.rs`), NOT the backend.
- AuthZ model: multisig threshold + typed wallet policy (allow/blocklist recipients, velocity caps, member allowances, time windows, advanced rule engine) enforced in `programs/clear-wallet/src/utils/{policy.rs,advanced_policy.rs}`. **The rust-settlement treasury signer operates OUTSIDE this on-chain policy — a separate, less-constrained custodial rail. Flag as distinct privileged path for identity/appsec.**

## Agentic Surface
- No MCP server/client/LLM-agent-loop code found. "Agent" in this repo = **trading-agent product feature** (autonomous trading vault sessions): `AgentTradeApproval`, `AgentSessionGrant`, `AgentRiskPolicy`, `AgentTradeSettlement` in `clearsign.rs`; `docs/agent-trading-vault*.md`, `docs/agent-vault-security.md`, `frontend/src/app/agent(s)`, `examples/agent-signal-runner`, `examples/hyperliquid-testnet-executor`.
- **Skip MCP/prompt-injection domain.** Appsec/identity should review the agent-session grant/settlement flow as a privileged-delegation feature (session notional/leverage caps, oracle-bound settlement) instead.

## Infra Surface
- `Dockerfile` (root, builds backend-api + rust-settlement)
- `render.yaml` — recently modified: disk config, expanded secrets list (`UPSTASH_REDIS_REST_*`, `CLEAR_MSIG_KEYPAIR_BASE64`, `CLEAR_MSIG_SIGNER_BASE64`, `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM`, `CLEAR_MSIG_DEFAULT_GRPC_URL`, `CLEAR_MSIG_DEFAULT_DEST_RPC_URL`, all sync:false); `autoDeployTrigger: commit` with a comment acknowledging CI-gating fragility.
- `fly.toml`, `railway.json` — alternative/legacy deploy targets, verify which is live.
- `.github/workflows/{ci,deploy-fly,deploy-railway,release,security,smoke-live}.yml` — note new `security.yml`, check what it runs.
- `ops/entrypoint.sh`.
- No Terraform/K8s/Helm/docker-compose.

## Secrets Handling
- `.env` gitignored everywhere; only `.env.example` variants committed.
- Production secrets via Render dashboard `sync:false` vars — no secrets manager/HSM/KMS.
- Treasury/settlement keys as raw base64/base58 env vars.

## Hotspots (audit first)
1. `rust-settlement/src/signer/solana.rs` (+`signer/engine.rs`) — custodial hot-wallet signing outside multisig policy; modified this update.
2. `programs/clear-wallet/src/utils/policy.rs` — NEW typed policy engine (velocity, member allowance, advanced rules, time windows); check unsafe byte-slice casts (`bytes_to_keys`/`keys` via `core::slice::from_raw_parts`) for alignment/soundness.
3. `programs/clear-wallet/src/utils/advanced_policy.rs` — NEW rule-effect parser (deny/allow/extra-approvers/cooldown), same unsafe key-casting pattern.
4. `programs/clear-wallet/src/utils/clearsign.rs` — NEW ClearSign v2 envelope/hash scheme binding UI text to on-chain payload; check `extract_clear_text_from_vote_message` for injection/truncation.
5. `programs/clear-wallet/src/utils/message.rs` — heavily modified (+166 lines); check hash/domain-separation regressions.
6. `programs/clear-wallet/src/state/{policy_spend,member_allowance,wallet_policy,typed_proposal}.rs` — NEW state layouts; check PDA derivation and account-ownership checks in `enforce_wallet_policy_account`.
7. `rust-settlement/src/paystack/signature.rs`, `kora/signature.rs` — webhook signature verification.
8. `rust-settlement/src/workers/{disbursement,payout_dispatch}.rs` — automated fund movement; check idempotency/replay handling.
9. `render.yaml` — expanded secret surface; verify no plaintext defaults.
10. `backend-api/src/validation.rs`, `rate_limit.rs`, `cors.rs` — primary input-sanitization layer.

## Domains present
appsec: yes | supply-chain: yes (new `@encrypt.xyz/pre-alpha-solana-client`, rust-settlement Cargo deps changed) | identity: yes (wallet auth, on-chain policy, treasury signer as separate privileged path) | agentic: no — skip MCP auditor, but appsec/identity should review agent-trading-vault delegation flow | infra: yes (Dockerfile, Render/Fly/Railway, GH Actions incl. new `security.yml`)
