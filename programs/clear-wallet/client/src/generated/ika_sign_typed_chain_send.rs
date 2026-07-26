use crate::ID;
use quasar_lang::client::TailBytes;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct IkaSignTypedChainSendInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub policy_spend: Address,
    pub member_allowance: Address,
    pub intent: Address,
    pub proposal: Address,
    pub ika_config: Address,
    pub dwallet_ownership: Address,
    pub dwallet: Address,
    pub message_approval: Address,
    pub coordinator: Address,
    pub cpi_authority: Address,
    pub caller_program: Address,
    pub dwallet_program: Address,
    pub system_program: Address,
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
    pub message_approval_bump: u8,
    pub cpi_authority_bump: u8,
    pub blake2b_hashes: [u8; 96],
    pub params_data: TailBytes,
}

impl From<IkaSignTypedChainSendInstruction> for Instruction {
    fn from(ix: IkaSignTypedChainSendInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.wallet_policy, false),
            AccountMeta::new(ix.policy_spend, false),
            AccountMeta::new(ix.member_allowance, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.ika_config, false),
            AccountMeta::new_readonly(ix.dwallet_ownership, false),
            AccountMeta::new(ix.dwallet, false),
            AccountMeta::new(ix.message_approval, false),
            AccountMeta::new_readonly(ix.coordinator, false),
            AccountMeta::new_readonly(ix.cpi_authority, false),
            AccountMeta::new_readonly(ix.caller_program, false),
            AccountMeta::new_readonly(ix.dwallet_program, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![25];
        wincode::serialize_into(&mut data, &ix.policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.chain_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.amount_raw_le).unwrap();
        wincode::serialize_into(&mut data, &ix.recipient_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.asset_id_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.tx_template_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.message_approval_bump).unwrap();
        wincode::serialize_into(&mut data, &ix.cpi_authority_bump).unwrap();
        wincode::serialize_into(&mut data, &ix.blake2b_hashes).unwrap();
        wincode::serialize_into(&mut data, &ix.params_data).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
