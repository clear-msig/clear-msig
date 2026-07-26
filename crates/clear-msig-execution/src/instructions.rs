use clear_wallet_client::generated::approve::ApproveInstruction;
use clear_wallet_client::generated::bind_dwallet::BindDwalletInstruction;
use clear_wallet_client::generated::create_wallet::CreateWalletInstruction;
use clear_wallet_client::generated::execute::ExecuteInstruction;
use clear_wallet_client::generated::ika_sign::IkaSignInstruction;
use clear_wallet_client::generated::propose::ProposeInstruction;
use quasar_lang::client::{DynBytes, DynVec, TailBytes};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

/// The clear-wallet program ID.
pub fn program_id() -> Pubkey {
    // C1earWa11etMSig1111111111111111111111111111
    let addr = clear_wallet_client::ID;
    Pubkey::new_from_array(addr.to_bytes())
}

fn spl_token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

/// Convert a `solana_sdk::Pubkey` to a `solana_address::Address` (used by the
/// vendored quasar client which lives on a different solana crate version).
fn pk_to_addr(p: Pubkey) -> solana_address::Address {
    solana_address::Address::new_from_array(p.to_bytes())
}

/// Convert a `solana_instruction::Instruction` produced by the vendored
/// quasar client (which uses `solana_address::Address`) into the
/// `solana_sdk::Instruction` shape the RPC client expects.
fn sdk_ix_from_ext(ix: solana_instruction::Instruction) -> Instruction {
    Instruction {
        program_id: Pubkey::new_from_array(ix.program_id.to_bytes()),
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: Pubkey::new_from_array(m.pubkey.to_bytes()),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

mod agents;
mod escrow;
mod governance;
mod lifecycle;
mod proposal;
mod recurring;
mod remote;
mod solana;

pub use agents::*;
pub use escrow::*;
pub use governance::*;
pub use lifecycle::*;
pub use proposal::*;
pub use recurring::*;
pub use remote::*;
pub use solana::*;

#[cfg(test)]
#[path = "instructions/tests.rs"]
mod tests;
