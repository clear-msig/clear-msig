use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedAgentTradeApprovalInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub session: Address,
    pub risk_ledger: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub agent_id_hash: [u8; 32],
    pub venue_hash: [u8; 32],
    pub market_hash: [u8; 32],
    pub side_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub max_leverage_x100: u32,
    pub session_id_hash: [u8; 32],
    pub route_hash: [u8; 32],
    pub risk_check_hash: [u8; 32],
}

impl From<ExecuteTypedAgentTradeApprovalInstruction> for Instruction {
    fn from(ix: ExecuteTypedAgentTradeApprovalInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.session, false),
            AccountMeta::new(ix.risk_ledger, false),
        ];
        let mut data = vec![23];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.agent_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.venue_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.market_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.side_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.asset_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.max_leverage_x100).unwrap();
        wincode::serialize_into(&mut data, &ix.session_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.route_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.risk_check_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
