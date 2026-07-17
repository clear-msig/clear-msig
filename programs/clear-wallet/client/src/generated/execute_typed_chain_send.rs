use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedChainSendInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub policy_spend: Address,
    pub member_allowance: Address,
    pub intent: Address,
    pub proposal: Address,
    pub ika_config: Address,
    pub dwallet: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
}

impl From<ExecuteTypedChainSendInstruction> for Instruction {
    fn from(ix: ExecuteTypedChainSendInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.wallet_policy, false),
            AccountMeta::new(ix.policy_spend, false),
            AccountMeta::new(ix.member_allowance, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.ika_config, false),
            AccountMeta::new_readonly(ix.dwallet, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![24];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.chain_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.recipient_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.asset_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.tx_template_hash).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
