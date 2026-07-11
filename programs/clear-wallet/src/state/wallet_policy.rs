use quasar_lang::prelude::*;

pub const WALLET_POLICY_DISCRIMINATOR: u8 = 8;
pub const WALLET_POLICY_CHAIN_SLOTS: usize = 6;
pub const WALLET_POLICY_LEN: usize = 1 + 32 + (32 * WALLET_POLICY_CHAIN_SLOTS) + 8 + 8 + 1;
pub const WALLET_POLICY_SEED: &[u8] = b"wallet_policy";

pub struct WalletPolicy {
    pub wallet: Address,
    pub policy_commitments: [[u8; 32]; WALLET_POLICY_CHAIN_SLOTS],
    pub version: u64,
    pub updated_at: i64,
    pub bump: u8,
}

impl WalletPolicy {
    pub fn read(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < WALLET_POLICY_LEN || data[0] != WALLET_POLICY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut wallet = [0u8; 32];
        wallet.copy_from_slice(&data[1..33]);
        let mut policy_commitments = [[0u8; 32]; WALLET_POLICY_CHAIN_SLOTS];
        let mut offset = 33;
        for commitment in &mut policy_commitments {
            commitment.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }
        let version = u64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        offset += 8;
        let updated_at = i64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        offset += 8;
        Ok(Self {
            wallet: Address::new_from_array(wallet),
            policy_commitments,
            version,
            updated_at,
            bump: data[offset],
        })
    }

    pub fn commitment_for_chain(&self, chain_kind: u8) -> Result<[u8; 32], ProgramError> {
        self.policy_commitments
            .get(chain_kind as usize)
            .copied()
            .ok_or(ProgramError::InvalidInstructionData)
    }

    pub fn set_commitment_for_chain(
        &mut self,
        chain_kind: u8,
        commitment: [u8; 32],
    ) -> Result<(), ProgramError> {
        let slot = self
            .policy_commitments
            .get_mut(chain_kind as usize)
            .ok_or(ProgramError::InvalidInstructionData)?;
        *slot = commitment;
        Ok(())
    }

    pub fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = WALLET_POLICY_DISCRIMINATOR;
            core::ptr::copy_nonoverlapping(self.wallet.as_ref().as_ptr(), ptr.add(1), 32);
            let mut offset = 33;
            for commitment in &self.policy_commitments {
                core::ptr::copy_nonoverlapping(commitment.as_ptr(), ptr.add(offset), 32);
                offset += 32;
            }
            core::ptr::copy_nonoverlapping(self.version.to_le_bytes().as_ptr(), ptr.add(offset), 8);
            offset += 8;
            core::ptr::copy_nonoverlapping(
                self.updated_at.to_le_bytes().as_ptr(),
                ptr.add(offset),
                8,
            );
            offset += 8;
            *ptr.add(offset) = self.bump;
        }
    }
}
