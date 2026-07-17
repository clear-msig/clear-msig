use crate::ID;
use quasar_lang::client::{DynVec, TailBytes};
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ProposeTypedV4Instruction {
    pub payer: Address,
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub system_program: Address,
    pub proposal_index: u64,
    pub signature: [u8; 64],
    pub policy_bytes: DynVec<u8>,
    pub canonical_intent: TailBytes,
}

impl From<ProposeTypedV4Instruction> for Instruction {
    fn from(ix: ProposeTypedV4Instruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.payer, true),
            AccountMeta::new(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new_readonly(ix.system_program, false),
        ];
        let mut data = vec![31];
        wincode::serialize_into(&mut data, &ix.proposal_index).unwrap();
        wincode::serialize_into(&mut data, &ix.signature).unwrap();
        wincode::serialize_into(&mut data, &ix.policy_bytes).unwrap();
        wincode::serialize_into(&mut data, &ix.canonical_intent).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
