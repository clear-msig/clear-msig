use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedAgentTradeSettlementInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub session: Address,
    pub risk_ledger: Address,
    pub settlement_receipt: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub execution_id_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub closed_notional_raw_le: [u8; 16],
    pub outcome: u8,
    pub pnl_abs_raw_le: [u8; 16],
    pub settlement_sequence: u64,
}

impl From<ExecuteTypedAgentTradeSettlementInstruction> for Instruction {
    fn from(ix: ExecuteTypedAgentTradeSettlementInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.session, false),
            AccountMeta::new(ix.risk_ledger, false),
            AccountMeta::new(ix.settlement_receipt, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![30];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.session_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.execution_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.settlement_artifact_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.oracle_policy_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.closed_notional_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.outcome).unwrap();
        wincode::serialize_into(&mut data, &ix.pnl_abs_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.settlement_sequence).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
