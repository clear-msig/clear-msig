# clear-msig Product Overview

This document describes the product as it exists in this repository today:
what it does, how the stack fits together, what is implemented, what is still
pre-alpha, and where the novelty actually is.

It is intentionally specific about current behavior. When a capability is not
fully live, this doc says so.

## Product Summary

`clear-msig` is a clear-signing multisig product built around Solana on-chain
policy, a Rust CLI, a Next.js frontend, and an Ika dWallet execution layer.

The core user promise is simple:

- users approve human-readable transaction intent instead of blind hex blobs,
- one shared wallet can drive native transactions on multiple chains,
- the same workflow covers wallet creation, policy setup, proposal approval,
  execution, and cross-chain settlement.

The product also includes adjacent surfaces for:

- wallet management,
- policy creation and editing,
- contacts,
- activity and proposal review,
- on-ramp/off-ramp flows,
- a personal recovery-oriented "Secure" surface built on `ikavery`,
- onboarding, security, and privacy explanation pages.

## Smart Multisig Direction

ClearSig should behave like a smart multisig for asset coordination. A wallet is
not only a set of keys; it is a team operating space where people, policies,
and AI agents can participate with scoped authority.

The intended model is:

- humans approve readable actions and remain the final authority for sensitive
  movement,
- teams define policy once and expect the program to enforce it before value
  moves,
- AI agents can propose or prepare actions inside explicit limits, but policy
  commitments, session allowances, risk limits, and approval thresholds decide
  what can actually execute,
- every participant sees the same ClearSign action, policy commitment, expiry,
  and recipient/amount facts before signing.

This direction is only credible when ClearSign and policy enforcement are
verifiable. New product surfaces should prefer typed actions and program-backed
policy checks over vague `Custom` intents.

## What The App Does

At a high level, the app lets a user:

1. Create or join a shared wallet.
2. Define who can propose and approve actions.
3. Add one or more chain bindings to that wallet.
4. Create transaction intents with readable templates and parameters.
5. Propose an action, collect approvals, then execute it.
6. Use the same wallet to send value on Solana, Ethereum/EVM, Bitcoin, and
   Zcash where the chain adapter exists.
7. View wallet activity, proposals, contacts, settings, and policy state in the
   browser.

There is also a separate personal-key recovery flow called `Secure` that is
presented in the app as a parallel surface, but it is not the same thing as the
shared-wallet product.

## Current User Surfaces

### Public surfaces

- `/` landing page
- `/welcome` first-run wallet creation / onboarding
- `/connect` gate between public and authenticated app surfaces
- `/privacy` privacy explanation page
- `/security` security posture page
- `/changelog` product changelog

### Authenticated app surfaces

- `/app` authenticated entry resolver
- `/app/wallet/new` new shared wallet flow
- `/app/wallet/[name]` wallet detail view
- `/app/wallet/[name]/send/*` chain-specific send flows
- `/app/wallet/[name]/buy`
- `/app/wallet/[name]/sell`
- `/app/wallet/[name]/receive`
- `/app/wallet/[name]/activity`
- `/app/wallet/[name]/members`
- `/app/wallet/[name]/members/add`
- `/app/wallet/[name]/policies`
- `/app/wallet/[name]/policies/new`
- `/app/wallet/[name]/policies/[id]`
- `/app/wallet/[name]/chains`
- `/app/wallet/[name]/chains/add`
- `/app/wallet/[name]/allowances`
- `/app/wallet/[name]/budget`
- `/app/wallet/[name]/rules`
- `/app/wallet/[name]/settings`
- `/app/activity` global activity feed
- `/app/proposals` proposal inbox
- `/app/proposals/[proposal]` proposal detail
- `/app/contacts` local contacts book
- `/app/settings` account and app settings

### Secure surface

- `/app/secure`
- `/app/secure/new`
- `/app/secure/import`
- `/app/secure/[recovery]`
- `/app/secure/[recovery]/enroll`
- `/app/secure/[recovery]/threshold`
- `/app/secure/[recovery]/sweep`

## Product Model

The product has three main concepts:

### Wallet

A wallet is the primary container. It stores:

- the wallet name,
- creator information,
- proposer and approver membership,
- thresholds and cancellation thresholds,
- timelock settings,
- chain bindings,
- intents and proposals.

### Intent

An intent is a reusable transaction blueprint.

An intent includes:

- chain kind,
- transaction template,
- parameters,
- proposers,
- approvers,
- approval thresholds,
- policy-related ciphertext references,
- data segments and seeds for chain-specific execution.

The wallet is initialized with three meta-intents:

- AddIntent
- RemoveIntent
- UpdateIntent

These manage the wallet itself.

### Proposal

A proposal is a concrete instance of an intent with values filled in.

It goes through:

1. creation,
2. approval collection,
3. optional cancellation,
4. execution.

## Stack

### Frontend

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion
- Tanstack Query
- Lucide icons
- Dynamic embedded wallet SDKs
- Ledger browser transport
- Encrypt pre-alpha client

The frontend owns:

- public marketing and onboarding surfaces,
- the authenticated wallet hub,
- policy editing and proposal review UI,
- contact storage and display,
- local privacy/security state,
- most user-facing routing and navigation.

### Backend API

- Rust
- Axum
- CLI wrapper service

This service exposes stable JSON routes for the frontend and translates them
into CLI calls.

### CLI

- Rust
- Solana client libraries
- Quasar-generated client code
- chain adapters for Solana, EVM, Bitcoin, and Zcash

The CLI owns:

- wallet creation,
- intent and proposal instruction assembly,
- signature and preimage handling,
- broadcasting native transactions,
- dWallet-related flows,
- on-chain account parsing.

### On-chain program

- Rust Solana program
- Quasar-based account and instruction layout

This program stores the wallet, intent, proposal, and related state on chain.
It also defines the transaction flow that the CLI and frontend drive.

### Settlement sidecar

- Rust
- Axum
- Postgres
- provider adapters for Paystack and Kora

This service backs `/buy` and `/sell` flows and is intentionally separate from
the main backend API.

## Integrations

### Ika

The project uses Ika dWallet infrastructure for native chain signing. The
repository currently treats this as pre-alpha.

### Dynamic

Dynamic provides embedded wallet support and the authenticated-user identity
layer in the frontend.

### Ledger

Ledger support exists in the browser signing flow for users who connect a
hardware wallet.

### Encrypt

The frontend routes policy inputs through Encrypt's pre-alpha client when the
network is configured, but the system does not yet provide end-to-end
production privacy.

### Paystack / Kora

The settlement sidecar opens hosted checkout flows and watches webhooks to
settle the corresponding asset transfer.

## What Is Implemented Today

### Implemented in the frontend

- landing page and onboarding flow,
- authenticated wallet hub,
- wallet creation flow,
- proposal review and approval flows,
- contacts storage and matching,
- activity feeds,
- policy editor and policy list views,
- chain setup and chain-specific send pages,
- buy/sell/receive flows,
- secure recovery flows,
- security and privacy explanation pages,
- encrypted-policy plumbing through the Encrypt client surface,
- user-facing error handling and validation.

### Implemented in the backend API

- wallet creation,
- intent prepare/submit routes,
- proposal create/approve/cancel/execute routes,
- chain binding routes,
- cleanup and lookup routes,
- standardized JSON error envelopes,
- CLI timeout control and validation.

### Implemented in the CLI and program

- wallet state and intent state handling,
- proposal state handling,
- chain-native transaction construction,
- Solana / EVM / Bitcoin / Zcash support paths,
- preimage and message building,
- on-chain account parsing,
- dWallet binding and ownership logic.

### Implemented in settlement

- ramp intent creation,
- checkout generation,
- webhook processing,
- treasury disbursement,
- state machine and idempotency for settlement requests.

## What Is Not Fully Live Yet

This is the important part.

- Encrypt is wired at the API surface, but the repo explicitly states it is not
  production privacy yet.
- The CLI receives policy ciphertext identifiers but does not yet thread them
  into encrypted on-chain enforcement.
- The Solana program does not yet use FHE-aware handlers.
- Policy approval arithmetic still relies on plaintext program state.
- The "Secure" surface is a separate recovery product path, not the same as
  full multisig privacy.
- The settlement sidecar is pre-alpha and should not be treated as a production
  funds movement service.
- The overall repo is devnet / testnet / demo oriented and should not be used
  with real funds.

## Privacy And Confidentiality Reality

The current codebase does not support a claim that wallet policy values are
fully hidden from outsiders end to end.

What is true today:

- policy values can be submitted through Encrypt's pre-alpha API surface,
- ciphertext identifiers can be persisted and surfaced in the app,
- the UI can reflect that the integration is wired.

What is not true today:

- policy values are not yet enforced as encrypted state on chain,
- the CLI and Solana program do not yet complete the FHE loop,
- the repo itself documents Encrypt as pre-alpha and not production privacy.

That means the correct product wording is "Encrypt-wired" or "pre-alpha policy
surface routed through Encrypt," not "fully private on-chain policies."

## Novelty

The novelty is not any single part by itself. It is the combination:

1. Clear-signing instead of blind hex signing.
2. Shared-wallet policy expressed as readable intent templates.
3. One wallet controlling multiple native chains.
4. dWallet-based signing that avoids wrapped-asset or bridge-centric UX.
5. A browser-first product surface that spans onboarding, policy editing,
   proposal execution, and chain-specific actions.
6. A parallel personal recovery surface that reuses the same product family
   language.
7. A path to agent-managed capital control, where agents can earn bounded
   authority over shared vaults instead of getting unconditional custody.

The stronger claim is product novelty, not cryptographic novelty:

- the UX makes multisig understandable,
- the architecture spans multiple chains in one place,
- the system ties identity, policy, and execution together.

## Scope

### In scope

- shared wallet creation and management,
- chain binding,
- proposal-based execution,
- contacts and activity,
- policy editing,
- buy/sell support,
- personal recovery / vault flows,
- security and privacy UI,
- CLI and backend APIs needed to drive those flows.

### Out of scope or deferred

- production FHE policy enforcement,
- production-grade confidentiality claims,
- production settlement hardening,
- hardware-backed treasury signing for the ramp sidecar,
- any claim that this is safe for mainnet funds today.

## Operating Assumptions

- Solana devnet is the primary demonstration environment.
- The CLI and backend are expected to be present together for the full flow.
- Frontend and backend communicate over JSON HTTP.
- The app assumes browser-based signing for the common path, with Ledger as an
  alternative.
- The demo product is allowed to look finished while still being pre-alpha
  underneath.

## Repository Map

- `frontend/` Next.js app and browser logic
- `backend-api/` JSON adapter over the CLI
- `cli/` transaction assembly and broadcast
- `programs/clear-wallet/` Solana program
- `rust-settlement/` buy/sell settlement sidecar
- `docs/` product and rollout notes
- `examples/intents/` intent templates
- `scripts/` bootstrap and demo flows

## Suggested Reading Order

1. `README.md`
2. `SECURITY.md`
3. `docs/encrypt-prealpha-testing.md`
4. `backend-api/README.md`
5. `rust-settlement/README.md`

## Status Statement

As of this repository state, `clear-msig` is best described as:

> a pre-alpha clear-signing multisig product with multi-chain execution,
> a browser-first policy workflow, a Rust CLI/backend control plane, and
> experimental Encrypt and Ika integration surfaces that are wired but not
> yet fully private end to end.

## Strategic Extension: Agent Trading Vault

The strongest next-stage product direction is `ClearSig Agent Trading Vault`:

- shared capital,
- human and agent members,
- structured trade proposals,
- bounded execution sessions,
- leaderboard-based access,
- revocation and emergency pause,
- testnet-first execution.

The guiding rule is simple:

- agents can propose and earn authority,
- ClearSig enforces policy and risk,
- humans keep the final control surface.

See [docs/agent-trading-vault.md](agent-trading-vault.md) for the locked spec
and [docs/agent-trading-vault-mvp-plan.md](agent-trading-vault-mvp-plan.md)
for the implementation plan.
