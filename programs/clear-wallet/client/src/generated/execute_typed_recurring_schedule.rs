use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedRecurringScheduleInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub intent: Address,
    pub proposal: Address,
    pub schedule: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub schedule_id_hash: [u8; 32],
    pub recipient: [u8; 32],
    pub amount_lamports: u64,
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    pub status: u8,
}

impl From<ExecuteTypedRecurringScheduleInstruction> for Instruction {
    fn from(ix: ExecuteTypedRecurringScheduleInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.wallet_policy, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.schedule, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![32];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.schedule_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.recipient).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_lamports).unwrap();
        wincode::serialize_into(&mut data, &ix.interval_seconds).unwrap();
        wincode::serialize_into(&mut data, &ix.first_execution_at).unwrap();
        wincode::serialize_into(&mut data, &ix.payment_count).unwrap();
        wincode::serialize_into(&mut data, &ix.status).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
