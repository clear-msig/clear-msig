# Migration: creator-scoped wallet PDAs

This branch (`feat/creator-scoped-wallet-pda`) replaces the
`["clear_wallet", sha256(name)]` PDA seed with
`["clear_wallet", creator_pubkey, sha256(name)]`. Two users picking the
same display name no longer collide on chain — each lands at a different
PDA. The current client-side `#XXXXXX` suffix workaround on the
frontend becomes redundant once this lands.

## What's done on this branch

- `programs/clear-wallet/src/state/wallet.rs` — adds `creator: Address`
  field; updates `#[seeds(...)]` to include creator.
- `programs/clear-wallet/src/instructions/create_wallet.rs` — passes
  `payer` into the seed and stores `*self.payer.address()` as `creator`
  on the new account.
- `programs/clear-wallet/client/src/pda.rs` — updates
  `find_wallet_address` signature to take `creator: &Address`.
- `programs/clear-wallet/src/tests.rs` — every test call site updated
  to pass `payer.to_bytes()` as the creator.

The on-chain program **builds clean** with `quasar build`. The .so
is 319.5 KB, +352 B vs. main (the size of the new `creator` field
plus tiny serialization-prologue growth).

## Known issue: tests regress

`cargo test -p clear-wallet` now fails 17 of 24 tests with
`Custom(6013) = WalletError::InvalidSignature` from the propose /
approve / cancel / execute / cleanup paths. The 6 create-wallet tests
pass cleanly. The signature mismatch suggests `wallet.name()` (the
on-chain accessor) returns different bytes from what the off-chain
test pre-builds, which means Quasar's account-field accessor is
reading the `name` field at the wrong byte offset given the new
layout.

I tried `cargo clean -p clear-wallet && quasar build` to force the
macro to regenerate accessors. Same failure. This needs a closer
look at Quasar's `account_macro` — specifically how it computes
field offsets for `Address`-then-dynamic-`String<N>` layouts.

Don't deploy this branch's program until the test suite is green.

## What still needs work after the program landing

Each item is a "won't compile / won't run until updated" cascade.
Estimated total: ~2-3 hours of additional plumbing.

### CLI (12 call sites + flag)

Every `clear_wallet_client::pda::find_wallet_address(&name, &pid)`
needs `&creator` as a second arg.

- `cli/src/commands/wallet.rs` — 4 sites.
- `cli/src/commands/intent.rs` — 4 sites.
- `cli/src/commands/proposal.rs` — 4 sites.

Strategy: add `--creator <PUBKEY>` to the relevant subcommand groups,
defaulting to the configured `--signer`'s pubkey. Most demo flows
have `signer = creator`, so the default makes the new flag invisible
to the common case.

### Backend API (route shape)

Routes keyed on `/wallets/{name}/...` need a way to learn the creator
so the CLI can derive the PDA. Two options:

- **Query param**: `/wallets/{name}/intents/add?creator=<pubkey>`.
  Keeps URL shape; threads creator into every CLI invocation that
  takes a wallet name.
- **Path segment**: `/wallets/{creator}/{name}/...`. More REST-y,
  bigger refactor.

Recommend query-param route; smaller blast radius.

### Frontend

- `frontend/src/lib/msig/pda.ts::findWalletAddress` — new signature
  matching the on-chain layout.
- Every caller of `fetchWalletByName` needs to know the creator.
  - Options: store creator-per-wallet in localStorage at create time
    (frontend already has wallet appearance per name), OR look up the
    wallet PDA via memberships query (which returns the PDA directly,
    no name+creator derivation needed) and use `fetchWalletByPda`.
  - The second is cleaner: switch all reads to PDA-based, drop
    name-based lookup entirely.
- `frontend/src/lib/msig/accounts.ts::parseWallet` — add the
  `creator` field to the parsed account record. Bump byte-offset
  consumers (e.g., `backend-api/src/main.rs::parse_wallet_name` is
  the same pattern in Rust on the backend).

### Backend memberships parser (1 site)

`backend-api/src/main.rs::parse_wallet_name` reads the wallet's name
at a hard-coded offset:

```
discriminator(1) + bump(1) + proposal_index(8) + intent_index(1)
                                                    = offset 11
```

After the migration, `creator (32)` slides in between intent_index
and name, so:

```
discriminator(1) + bump(1) + proposal_index(8) + intent_index(1)
  + creator(32)                                     = offset 43
```

Update the offset arithmetic.

### Existing wallets on devnet

Wallets created against the old PDA shape are orphaned by this
change — their PDAs don't match the new derivation, so the program
can't load them via the new seeds. For pre-alpha devnet, this is
acceptable (test data, throwaway). Production migration would need
a one-time `migrate_wallet` ix that:

1. Reads the old account at the old PDA.
2. Re-creates a new account at the new PDA with the same data + a
   `creator` field set to the original payer.
3. Deletes (or marks invalid) the old account.

Out of scope for this branch.

## Why bother

- Removes the global wallet-name namespace (the cause of "wallet
  name already taken" errors users have been hitting).
- Lets the frontend drop the `#XXXXXX` suffix workaround entirely;
  display names match on-chain names everywhere.
- A reviewer reading `programs/clear-wallet/src/state/wallet.rs`
  expects multi-tenant scoping; this delivers it.
