use quasar_lang::prelude::*;

/// Wallet account.
///
/// Creator-scoped PDA: seeds are `["clear_wallet", creator, sha256(name)]`.
/// Two users can both create a wallet called "Family" without colliding,
/// because the `creator` (the payer at create-time) participates in the
/// seed. The `creator` is also stored on the account so reads can verify
/// the wallet's lineage without re-deriving from external state.
///
/// Migration note: the previous seed was `["clear_wallet", sha256(name)]`
/// (no creator). Wallets created against the old layout live at different
/// PDAs and are orphaned by this change — acceptable on devnet pre-alpha,
/// not acceptable on mainnet. Plan a migration ix before mainnet ship.
#[account(discriminator = 1, set_inner)]
#[seeds(b"clear_wallet", creator: Address, name_hash: Address)]
pub struct ClearWallet<'a> {
    pub bump: u8,
    pub proposal_index: u64,
    pub intent_index: u8,
    /// Original payer at create-time. Used as the creator-scope seed
    /// component above and surfaced on read so callers can identify
    /// the wallet's namespace owner without re-fetching the create tx.
    pub creator: Address,
    pub name: String<'a, 64>,
}
