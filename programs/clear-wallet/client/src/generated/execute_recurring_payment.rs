use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteRecurringPaymentInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub policy_spend: Address,
    pub vault: Address,
    pub intent: Address,
    pub schedule: Address,
    pub recipient: Address,
    pub system_program: Address,
    pub schedule_id_hash: [u8; 32],
}

impl From<ExecuteRecurringPaymentInstruction> for Instruction {
    fn from(ix: ExecuteRecurringPaymentInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.wallet_policy, false),
            AccountMeta::new(ix.policy_spend, false),
            AccountMeta::new(ix.vault, false),
            AccountMeta::new_readonly(ix.intent, false),
            AccountMeta::new(ix.schedule, false),
            AccountMeta::new(ix.recipient, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![33];
        wincode::serialize_into(&mut data, &ix.schedule_id_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
