use crate::ID;
use quasar_lang::client::TailBytes;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use std::vec::Vec;

pub struct ExecuteTypedEscrowReturnInstruction {
    pub wallet: Address,
    pub vault: Address,
    pub intent: Address,
    pub proposal: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub amount_lamports_le: TailBytes,
    pub remaining_accounts: Vec<AccountMeta>,
}

impl From<ExecuteTypedEscrowReturnInstruction> for Instruction {
    fn from(ix: ExecuteTypedEscrowReturnInstruction) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.vault, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        accounts.extend(ix.remaining_accounts);
        let mut data = vec![13];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_lamports_le).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
