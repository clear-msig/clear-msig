use crate::ID;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub struct CleanupTypedProposalInstruction {
    pub proposal: Address,
    pub rent_refund: Address,
}

impl From<CleanupTypedProposalInstruction> for Instruction {
    fn from(ix: CleanupTypedProposalInstruction) -> Instruction {
        let accounts = vec![
            AccountMeta::new(ix.proposal, false),
            AccountMeta::new(ix.rent_refund, false),
        ];
        let data = vec![16];
        Instruction {
            program_id: ID,
            accounts,
            data,
        }
    }
}
