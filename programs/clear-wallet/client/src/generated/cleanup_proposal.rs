use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct CleanupProposalInstruction {
    pub proposal: Address,
    pub rent_refund: Address,
}

impl From<CleanupProposalInstruction> for Instruction {
    fn from(ix: CleanupProposalInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.rent_refund, false),
        ];
        let data = vec![5];
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
