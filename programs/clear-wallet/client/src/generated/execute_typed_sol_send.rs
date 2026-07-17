use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedSolSendInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub policy_spend: Address,
    pub member_allowance: Address,
    pub vault: Address,
    pub intent: Address,
    pub proposal: Address,
    pub recipient: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_lamports: u64,
}

impl From<ExecuteTypedSolSendInstruction> for Instruction {
    fn from(ix: ExecuteTypedSolSendInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.wallet_policy, false),
            AccountMeta::new(ix.policy_spend, false),
            AccountMeta::new(ix.member_allowance, false),
            AccountMeta::new(ix.vault, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.recipient, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![14];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_lamports).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
