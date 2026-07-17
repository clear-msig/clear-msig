use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedAgentSessionGrantInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub session: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub agent_id_hash: [u8; 32],
    pub venue_hash: [u8; 32],
    pub market_hash: [u8; 32],
    pub max_notional_raw_le: [u8; 16],
    pub max_leverage_x100: u32,
    pub expires_at: i64,
    pub status: u8,
}

impl From<ExecuteTypedAgentSessionGrantInstruction> for Instruction {
    fn from(ix: ExecuteTypedAgentSessionGrantInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.session, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![28];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.session_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.agent_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.venue_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.market_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.max_notional_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.max_leverage_x100).unwrap();
        wincode::serialize_into(&mut data, &ix.expires_at).unwrap();
        wincode::serialize_into(&mut data, &ix.status).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
