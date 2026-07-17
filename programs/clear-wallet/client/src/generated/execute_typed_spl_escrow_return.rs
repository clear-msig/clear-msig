use crate::ID;
use quasar_lang::client::TailBytes;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use std::vec::Vec;

pub struct ExecuteTypedSplEscrowReturnInstruction {
    pub wallet: Address,
    pub vault: Address,
    pub intent: Address,
    pub proposal: Address,
    pub mint: Address,
    pub source_token: Address,
    pub token_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub amount_tokens_le: TailBytes,
    pub remaining_accounts: Vec<AccountMeta>,
}

impl From<ExecuteTypedSplEscrowReturnInstruction> for Instruction {
    fn from(ix: ExecuteTypedSplEscrowReturnInstruction) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.vault, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.mint, false),
            AccountMeta::new(ix.source_token, false),
            AccountMeta::new_readonly(ix.token_program, false),
        ];
        accounts.extend(ix.remaining_accounts);
        let mut data = vec![18];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_tokens_le).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
