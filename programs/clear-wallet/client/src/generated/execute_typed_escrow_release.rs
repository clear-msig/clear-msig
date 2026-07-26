use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedEscrowReleaseInstruction {
    pub wallet: Address,
    pub vault: Address,
    pub intent: Address,
    pub proposal: Address,
    pub recipient: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_lamports: u64,
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
}

impl From<ExecuteTypedEscrowReleaseInstruction> for Instruction {
    fn from(ix: ExecuteTypedEscrowReleaseInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.vault, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.recipient, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![12];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_lamports).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.milestone_id_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
