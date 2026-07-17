use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedPrivateEscrowReturnInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub refund_recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub policy_ciphertexts_hash: [u8; 32],
    pub private_evaluation_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

impl From<ExecuteTypedPrivateEscrowReturnInstruction> for Instruction {
    fn from(ix: ExecuteTypedPrivateEscrowReturnInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
        ];
        let mut data = vec![22];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.escrow_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.refund_recipient_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.asset_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.policy_ciphertexts_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.private_evaluation_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.settlement_artifact_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
