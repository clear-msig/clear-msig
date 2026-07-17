use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct CancelTypedInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub canceller_index: u8,
    pub signature: [u8; 64],
}

impl From<CancelTypedInstruction> for Instruction {
    fn from(ix: CancelTypedInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
        ];
        let mut data = vec![10];
        wincode::serialize_into(&mut data, &ix.canceller_index).unwrap();
        wincode::serialize_into(&mut data, &ix.signature).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
