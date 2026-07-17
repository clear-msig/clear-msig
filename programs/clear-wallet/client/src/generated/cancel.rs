use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct CancelInstruction {
    pub wallet: Address,
    pub intent: Address,
    pub proposal: Address,
    pub expiry: i64,
    pub canceller_index: u8,
    pub signature: [u8; 64],
}

impl From<CancelInstruction> for Instruction {
    fn from(ix: CancelInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(ix.wallet, false),
            AccountMeta::new(ix.intent, false),
            AccountMeta::new(ix.proposal, false),
        ];
        let mut data = vec![3];
        wincode::serialize_into(&mut data, &ix.expiry).unwrap();
        wincode::serialize_into(&mut data, &ix.canceller_index).unwrap();
        wincode::serialize_into(&mut data, &ix.signature).unwrap();
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
