use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedSplEscrowReleaseInstruction {
    pub wallet: Address,
    pub vault: Address,
    pub intent: Address,
    pub proposal: Address,
    pub mint: Address,
    pub source_token: Address,
    pub destination_token: Address,
    pub recipient_owner: Address,
    pub token_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_tokens: u64,
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
}

impl From<ExecuteTypedSplEscrowReleaseInstruction> for Instruction {
    fn from(ix: ExecuteTypedSplEscrowReleaseInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.vault, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.mint, false),
            AccountMeta::new(ix.source_token, false),
            AccountMeta::new(ix.destination_token, false),
            AccountMeta::new_readonly(ix.recipient_owner, false),
            AccountMeta::new_readonly(ix.token_program, false),
        ];
        let mut data = vec![17];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_tokens).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.milestone_id_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
