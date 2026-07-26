# Security readiness and release gates

Assessment date: 2026-07-18. This document describes the repository and
devnet deployments; it is not an audit report, warranty, or mainnet approval.

## Executive verdict

ClearSig has a serious technical foundation: ClearSign v4 derives the readable
approval and execution commitment from one canonical intent, the Solana program
enforces supported wallet governance and policy actions, and recurring SOL and
USDC authorities are bounded onchain. It is still a **devnet/pre-alpha system
and is not ready to custody material production capital**.

The main blockers are not presentation work. They are an independent program
audit, hardened upgrade governance, broader asset-scoped policy coverage, production
distributed signing for non-Solana assets, independently verifiable destination
settlement, hardware qualification, and institutional operating controls.

## What is implemented now

- ClearSign v4 canonical intent bytes bind the readable signer document,
  network, policy, threshold, expiry, replay values, and action-specific
  execution commitment.
- Typed Solana wallet creation, members, thresholds, timelocks, SOL transfers,
  selected wallet policies, recurring SOL, and recurring devnet USDC execute in
  the Clear Wallet program.
- Recurring USDC is restricted to Circle's published Solana devnet mint. The
  signed intent binds the recipient owner, six-decimal raw amount, mint, vault
  source token account, recipient destination token account, cadence, first
  execution, and maximum payment count.
  Circle's address registry is the deployment source of truth:
  <https://developers.circle.com/stablecoins/usdc-contract-addresses>.
- New recurring USDC schedules use CSP2. An AssetPolicy PDA binds the wallet to
  the exact mint and policy commitment, while one AssetPolicySpend PDA per
  wallet and mint enforces raw six-decimal amount, velocity, send-count,
  recipient, and allowed-hours rules across all schedules. This behavior is
  active on devnet at slot `477230343`; it is not a mainnet qualification.
- Any caller can submit a due recurring payment. No caller can change its bound
  terms, and schedule advancement is atomic with the SOL/SPL transfer. ClearSig
  does not yet operate a redundant keeper network, so execution still requires
  an external caller.
- Redis delivery leases and receipts reduce duplicate backend delivery, but
  Redis remains operational infrastructure rather than authorization truth.
- CI performs architecture checks, lint/type checks, tests, production builds,
  route-aware bundle budgets, secret scanning, CodeQL, `cargo-audit`,
  `cargo-deny`, and production npm dependency auditing.
- Public release endpoints expose RPC provider labels rather than configured
  endpoints. Browser RPC values in `NEXT_PUBLIC_*` variables remain observable
  and require provider-side origin/method restrictions or a server proxy.

## Recurring USDC qualification

CSP1 numeric fields remain SOL-lamport scoped and are never reinterpreted as
token units. New USDC schedules require CSP2 bytes containing the SPL mint and
decimals, and enforce:

- exact threshold-approved amount, cadence, and maximum payment count;
- exact mint, vault source, destination token account, and recipient owner;
- per-payment amount cap and recipient allow/block rules;
- wallet-and-mint velocity and send-count windows shared across schedules; and
- allowed hours using the committed UTC offset and day mask.

Recurring CSP2 still rejects member allowances, proposal-dependent extra
approvers, cooldowns, and advanced-rule payloads because a permissionless
future payment cannot safely reconstruct proposal-local authority. Existing
CSP1 USDC schedules retain their legacy executor for migration compatibility.

## Seven questions serious users should ask

| Question | Honest answer today | Required evidence before serious funds |
| --- | --- | --- |
| 1. Who can move funds? | Supported Solana actions require the configured onchain threshold and policy. The backend pays fees and relays but cannot forge signatures. Non-Solana signing still depends on experimental Ika/operator paths. | Production distributed MPC, key ceremony evidence, signer rotation/recovery drills, and direct independent execution instructions. |
| 2. Can the readable approval differ from execution? | For implemented v4 executors, the program derives or recomputes the execution payload from the same canonical intent. USDC recurring also binds exact token accounts. Review-only or mock actions do not move funds. | External review of every action codec/executor pair, maintained mutation vectors, and a published supported-action registry. |
| 3. Which rules are truly onchain? | Thresholds, timelocks, supported send policies, recurring bounds, agent ledgers, and typed execution checks are program state. Contacts, labels, notifications, marketplace data, automation, and some settlement artifacts are browser/Redis/backend state. | A machine-readable authority matrix, UI labels generated from that matrix, and tests that reject any security claim without a program executor. |
| 4. What happens if ClearSig, Redis, an RPC, or a relayer fails or lies? | Onchain approvals remain intact and the relayer cannot alter committed payloads. Availability, destination delivery, automation, and owner-attested venue truth can still fail or be censored. | Multiple independent RPCs/relayers/keepers, permissionless runbooks, chain reconciliation, tested failover, and cryptographic venue proofs rather than owner attestations. |
| 5. Has the code been independently audited? | No completed external Solana/Rust audit is claimed. Internal adversarial tests and automated dependency/static checks are useful but not substitutes. The program remains upgradeable. | Two-pass independent audit after architecture freeze, all critical/high findings closed, reproducible artifact verification, and public deployment provenance. |
| 6. How are upgrades, incidents, and recovery controlled? | A known upgrade authority and deployment provenance are documented; recovery is devnet/pre-alpha. A single operational authority remains a material governance risk. | Multisig/timelocked upgrade authority, emergency policy, monitoring/on-call, incident communications, key rotation, backup restore, and quarterly recovery exercises. |
| 7. Is the product institution-ready? | No. It lacks mainnet operating history, audited MPC/destination adapters, SLA evidence, insurance/custody opinions, formal compliance controls, and completed privacy infrastructure. | Limited-cap pilot terms, legal/regulatory review, vendor risk package, SOC 2-oriented controls, uptime/latency history, support escalation, and explicit loss/allocation limits. |

## Work ClearSig can complete independently

1. Extend the shipped wallet-and-mint CSP2 model beyond recurring devnet USDC
   only where each asset has authoritative identity, decimals, and execution
   semantics. Per-member token ledgers remain unimplemented.
2. Expand property/fuzz/state-machine tests for every codec and executor, including
   account substitution, replay, stale policy, duplicate calls, clock edges,
   overflow, interrupted relayers, and adversarial RPC responses.
3. Put the program upgrade authority behind an independently controlled
   multisig and timelock; document freeze/rollback policy and rehearse it.
4. Operate at least two independent permissionless keepers with idempotent
   scheduling, health alerts, missed-payment alerts, and no custody secrets.
5. Make builds reproducible and publish program binary hashes, source commit,
   toolchain lock, program-data address, authority, and verified deployment slot.
6. Complete physical Ledger/firmware qualification for full and compact
   ClearSign templates and record every screen for release evidence.
7. Remove owner-attested venue settlement from production claims; require
   signed venue receipts or independently verifiable state proofs.
8. Commission the external audit only after the executor set and upgrade model
   freeze, then run a restricted-value Solana SOL/USDC pilot.
9. Finish private repository separation, least-privilege CI/deploy credentials,
   CODEOWNERS, branch protection, secret rotation, dependency ownership, and
   incident-response exercises.

## Upstream-dependent work

### Ika

Ika mainnet itself is live on Sui, but Ika's current official documentation
still marks Solana support as coming soon. ClearSig must not describe its
pre-alpha Solana coordinator as production Ika mainnet. Adoption requires a
pinned supported Solana release, audited program/CPI interface, production
distributed signatures, DKG/import/recovery evidence, fee and liveness limits,
and retry/replay tests against the final network.

- Ika mainnet announcement: <https://ika.xyz/blog/ika-launch>
- Current Ika documentation: <https://docs.ika.xyz/>
- Current Sui-oriented SDK: <https://www.npmjs.com/package/@ika.xyz/sdk>

### Encrypt

Encrypt's official developer guide labels the current release pre-alpha,
states that there is no real encryption, warns that data is plaintext onchain,
and says state will be wiped for Alpha 1. ClearSig's current ciphertext IDs and
fallback stub are integration scaffolding, not privacy. Production adoption
depends on Alpha 1/final key and trust models, stable Solana program APIs,
audited FHE/decryption infrastructure, published benchmarks and whitepaper,
and program-side encrypted policy enforcement.

- Pre-alpha disclaimer and SDK: <https://docs.encrypt.xyz/getting-started/installation>
- Encrypt architecture and pending evidence: <https://encrypt.xyz/>

## Release ladder

1. **Current devnet:** test funds only; preserve explicit pre-alpha labels.
2. **Audit candidate:** freeze v4/CSP2 executors, upgrade governance, build
   provenance, keeper failover, property tests, and hardware evidence.
3. **Restricted Solana pilot:** audited SOL/USDC only, low per-wallet caps,
   allowlisted participants, multisig upgrades, continuous monitoring, and a
   defined incident/loss process.
4. **Cross-chain alpha:** only after the final Ika-on-Solana production path and
   destination adapters pass independent review and live failure drills.
5. **Privacy alpha:** only after Encrypt Alpha provides real confidentiality
   and ClearSig enforces encrypted policies in the program.
6. **General availability:** requires operating history, repeat audit, legal and
   compliance review, institutional support controls, and transparent limits.

Calendar targets must never override these gates.
