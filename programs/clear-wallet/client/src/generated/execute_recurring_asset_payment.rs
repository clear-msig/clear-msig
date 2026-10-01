use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteRecurringAssetPaymentInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub asset_policy: Address,
    pub asset_policy_spend: Address,
    pub vault: Address,
    pub intent: Address,
    pub schedule: Address,
    pub mint: Address,
    pub source_token: Address,
    pub destination_token: Address,
    pub recipient_owner: Address,
    pub token_program: Address,
    pub system_program: Address,
    pub schedule_id_hash: [u8; 32],
}

impl From<ExecuteRecurringAssetPaymentInstruction> for Instruction {
    fn from(ix: ExecuteRecurringAssetPaymentInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.asset_policy, false),
            AccountMeta::new(ix.asset_policy_spend, false),
            AccountMeta::new_readonly(ix.vault, false),
            AccountMeta::new_readonly(ix.intent, false),
            AccountMeta::new(ix.schedule, false),
            AccountMeta::new_readonly(ix.mint, false),
            AccountMeta::new(ix.source_token, false),
            AccountMeta::new(ix.destination_token, false),
            AccountMeta::new_readonly(ix.recipient_owner, false),
            AccountMeta::new_readonly(ix.token_program, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![38];
        wincode::serialize_into(&mut data, &ix.schedule_id_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
