use crate::ID;
use quasar_lang::client::{DynVec, TailBytes};
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ProposeTypedInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub system_program: Address,
    pub proposal_index: u64,
    pub expiry: i64,
    pub action_kind: u8,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub proposer_pubkey: [u8; 32],
    pub signature: [u8; 64],
    pub action_id: [u8; 32],
    pub nonce: [u8; 32],
    pub policy_bytes: DynVec<u8>,
    pub clear_text: TailBytes,
}

impl From<ProposeTypedInstruction> for Instruction {
    fn from(ix: ProposeTypedInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![8];
        wincode::serialize_into(&mut data, &ix.proposal_index).unwrap();
        wincode::serialize_into(&mut data, &ix.expiry).unwrap();
        wincode::serialize_into(&mut data, &ix.action_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.payload_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.proposer_pubkey).unwrap();
        wincode::serialize_into(&mut data, &ix.signature).unwrap();
        wincode::serialize_into(&mut data, &ix.action_id).unwrap();
        wincode::serialize_into(&mut data, &ix.nonce).unwrap();
        wincode::serialize_into(&mut data, &ix.policy_bytes).unwrap();
        wincode::serialize_into(&mut data, &ix.clear_text).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
