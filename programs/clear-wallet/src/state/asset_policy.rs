use quasar_lang::prelude::*;

pub const ASSET_POLICY_DISCRIMINATOR: u8 = 14;
pub const ASSET_POLICY_LEN: usize = 1 + 32 + 32 + 32 + 8 + 8 + 1;
pub const ASSET_POLICY_SEED: &[u8] = b"asset_policy";

pub struct AssetPolicy {
    pub wallet: Address,
    pub asset_id: Address,
    pub policy_commitment: [u8; 32],
    pub version: u64,
    pub updated_at: i64,
    pub bump: u8,
}

impl AssetPolicy {
    pub fn read(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < ASSET_POLICY_LEN || data[0] != ASSET_POLICY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut wallet = [0u8; 32];
        wallet.copy_from_slice(&data[1..33]);
        let mut asset_id = [0u8; 32];
        asset_id.copy_from_slice(&data[33..65]);
        let mut policy_commitment = [0u8; 32];
        policy_commitment.copy_from_slice(&data[65..97]);
        let version = u64::from_le_bytes(
            data[97..105]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        let updated_at = i64::from_le_bytes(
            data[105..113]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        Ok(Self {
            wallet: Address::new_from_array(wallet),
            asset_id: Address::new_from_array(asset_id),
            policy_commitment,
            version,
            updated_at,
            bump: data[113],
        })
    }

    /// # Safety
    /// `ptr` must be writable for at least `ASSET_POLICY_LEN` bytes.
    pub unsafe fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = ASSET_POLICY_DISCRIMINATOR;
            core::ptr::copy_nonoverlapping(self.wallet.as_ref().as_ptr(), ptr.add(1), 32);
            core::ptr::copy_nonoverlapping(self.asset_id.as_ref().as_ptr(), ptr.add(33), 32);
            core::ptr::copy_nonoverlapping(self.policy_commitment.as_ptr(), ptr.add(65), 32);
            core::ptr::copy_nonoverlapping(self.version.to_le_bytes().as_ptr(), ptr.add(97), 8);
            core::ptr::copy_nonoverlapping(self.updated_at.to_le_bytes().as_ptr(), ptr.add(105), 8);
            *ptr.add(113) = self.bump;
        }
    }
}
