use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedAgentRiskPolicyInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub session: Address,
    pub risk_ledger: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub max_loss_raw_le: [u8; 16],
    pub status: u8,
}

impl From<ExecuteTypedAgentRiskPolicyInstruction> for Instruction {
    fn from(ix: ExecuteTypedAgentRiskPolicyInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.session, false),
            AccountMeta::new(ix.risk_ledger, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![29];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.session_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.oracle_policy_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.max_loss_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.status).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
