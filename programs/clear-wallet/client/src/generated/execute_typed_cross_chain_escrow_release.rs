use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedCrossChainEscrowReleaseInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub ika_config: Address,
    pub dwallet: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub route_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

impl From<ExecuteTypedCrossChainEscrowReleaseInstruction> for Instruction {
    fn from(ix: ExecuteTypedCrossChainEscrowReleaseInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.ika_config, false),
            AccountMeta::new_readonly(ix.dwallet, false),
        ];
        let mut data = vec![19];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.chain_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.milestone_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.recipient_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.asset_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.route_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.tx_template_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.settlement_artifact_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
