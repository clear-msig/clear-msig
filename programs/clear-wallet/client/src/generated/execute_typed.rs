use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub action_kind: u8,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
}

impl From<ExecuteTypedInstruction> for Instruction {
    fn from(ix: ExecuteTypedInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
        ];
        let mut data = vec![11];
        wincode::serialize_into(&mut data, &ix.action_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.payload_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
