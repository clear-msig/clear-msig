use crate::ID;
use quasar_lang::client::TailBytes;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedIntentGovernanceInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub target_intent: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub action_kind: u8,
    pub target_intent_index: u8,
    pub new_intent_body: TailBytes,
}

impl From<ExecuteTypedIntentGovernanceInstruction> for Instruction {
    fn from(ix: ExecuteTypedIntentGovernanceInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.target_intent, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![27];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.action_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.target_intent_index).unwrap();
        wincode::serialize_into(&mut data, &ix.new_intent_body).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
