use quasar_lang::prelude::*;

pub const WALLET_POLICY_DISCRIMINATOR: u8 = 8;
pub const WALLET_POLICY_LEN: usize = 1 + 32 + 32 + 8 + 8 + 1;
pub const WALLET_POLICY_SEED: &[u8] = b"wallet_policy";

pub struct WalletPolicy {
    pub wallet: Address,
    pub policy_commitment: [u8; 32],
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
        let mut policy_commitment = [0u8; 32];
        policy_commitment.copy_from_slice(&data[33..65]);
        let version = u64::from_le_bytes(
            data[65..73]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        let updated_at = i64::from_le_bytes(
            data[73..81]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        Ok(Self {
            wallet: Address::new_from_array(wallet),
            policy_commitment,
            version,
            updated_at,
            bump: data[81],
        })
    }

    pub fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = WALLET_POLICY_DISCRIMINATOR;
            core::ptr::copy_nonoverlapping(self.wallet.as_ref().as_ptr(), ptr.add(1), 32);
            core::ptr::copy_nonoverlapping(self.policy_commitment.as_ptr(), ptr.add(33), 32);
            core::ptr::copy_nonoverlapping(self.version.to_le_bytes().as_ptr(), ptr.add(65), 8);
            core::ptr::copy_nonoverlapping(self.updated_at.to_le_bytes().as_ptr(), ptr.add(73), 8);
            *ptr.add(81) = self.bump;
        }
    }
}
