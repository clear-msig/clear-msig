use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct ApproveTypedInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub approver_index: u8,
    pub signature: [u8; 64],
}

impl From<ApproveTypedInstruction> for Instruction {
    fn from(ix: ApproveTypedInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new_readonly(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
        ];
        let mut data = vec![9];
        wincode::serialize_into(&mut data, &ix.approver_index).unwrap();
        wincode::serialize_into(&mut data, &ix.signature).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
