use crate::ID;
use quasar_lang::client::DynVec;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ExecuteTypedWalletPolicyUpdateInstruction {
    pub payer: Address,
    pub wallet: Address,
    pub wallet_policy: Address,
    pub intent: Address,
    pub proposal: Address,
    pub system_program: Address,
    pub current_policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub new_policy_bytes: DynVec<u8>,
}

impl From<ExecuteTypedWalletPolicyUpdateInstruction> for Instruction {
    fn from(ix: ExecuteTypedWalletPolicyUpdateInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.wallet_policy, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![26];
        wincode::serialize_into(&mut data, &ix.current_policy_commitment).unwrap();
        wincode::serialize_into(&mut data, &ix.envelope_hash).unwrap();
        wincode::serialize_into(&mut data, &ix.chain_kind).unwrap();
        wincode::serialize_into(&mut data, &ix.new_policy_bytes).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
