use quasar_lang::prelude::*;

pub const AGENT_SESSION_DISCRIMINATOR: u8 = 9;
pub const AGENT_SESSION_STATUS_ACTIVE: u8 = 1;
pub const AGENT_SESSION_STATUS_REVOKED: u8 = 2;
pub const AGENT_SESSION_SEED: &[u8] = b"agent_session";

/// Bound agent trading session grant. Created by typed ClearSign grant;
/// consumed by typed agent trade approval.
pub struct AgentSession {
    pub wallet: Address,
    pub session_id_hash: [u8; 32],
    pub agent_id_hash: [u8; 32],
    pub venue_hash: [u8; 32],
    /// Zero hash means any market.
    pub market_hash: [u8; 32],
    pub policy_commitment: [u8; 32],
    pub max_notional_raw_le: [u8; 16],
    pub max_leverage_x100: u32,
    pub expires_at: i64,
    pub spent_notional_raw_le: [u8; 16],
    pub status: u8,
    pub bump: u8,
}

impl AgentSession {
    pub fn read(data: &[u8]) -> Result<Self, ProgramError> {
        // disc(1) + body
        if data.len() < 1 + 32 + 32 + 32 + 32 + 32 + 32 + 16 + 4 + 8 + 16 + 1 + 1 {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != AGENT_SESSION_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut offset = 1;
        let take32 = |off: &mut usize| -> [u8; 32] {
            let mut out = [0u8; 32];
            out.copy_from_slice(&data[*off..*off + 32]);
            *off += 32;
            out
        };
        let wallet_bytes = take32(&mut offset);
        let session_id_hash = take32(&mut offset);
        let agent_id_hash = take32(&mut offset);
        let venue_hash = take32(&mut offset);
        let market_hash = take32(&mut offset);
        let policy_commitment = take32(&mut offset);
        let mut max_notional_raw_le = [0u8; 16];
        max_notional_raw_le.copy_from_slice(&data[offset..offset + 16]);
        offset += 16;
        let max_leverage_x100 = u32::from_le_bytes(
            data[offset..offset + 4]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        offset += 4;
        let expires_at = i64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        offset += 8;
        let mut spent_notional_raw_le = [0u8; 16];
        spent_notional_raw_le.copy_from_slice(&data[offset..offset + 16]);
        offset += 16;
        let status = data[offset];
        offset += 1;
        let bump = data[offset];
        Ok(Self {
            wallet: Address::new_from_array(wallet_bytes),
            session_id_hash,
            agent_id_hash,
            venue_hash,
            market_hash,
            policy_commitment,
            max_notional_raw_le,
            max_leverage_x100,
            expires_at,
            spent_notional_raw_le,
            status,
            bump,
        })
    }

    pub fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = AGENT_SESSION_DISCRIMINATOR;
            let mut offset = 1usize;
            core::ptr::copy_nonoverlapping(self.wallet.as_ref().as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.session_id_hash.as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.agent_id_hash.as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.venue_hash.as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.market_hash.as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.policy_commitment.as_ptr(), ptr.add(offset), 32);
            offset += 32;
            core::ptr::copy_nonoverlapping(self.max_notional_raw_le.as_ptr(), ptr.add(offset), 16);
            offset += 16;
            core::ptr::copy_nonoverlapping(
                self.max_leverage_x100.to_le_bytes().as_ptr(),
                ptr.add(offset),
                4,
            );
            offset += 4;
            core::ptr::copy_nonoverlapping(
                self.expires_at.to_le_bytes().as_ptr(),
                ptr.add(offset),
                8,
            );
            offset += 8;
            core::ptr::copy_nonoverlapping(
                self.spent_notional_raw_le.as_ptr(),
                ptr.add(offset),
                16,
            );
            offset += 16;
            *ptr.add(offset) = self.status;
            offset += 1;
            *ptr.add(offset) = self.bump;
        }
    }

    pub fn max_notional_raw(&self) -> u128 {
        u128::from_le_bytes(self.max_notional_raw_le)
    }

    pub fn spent_notional_raw(&self) -> u128 {
        u128::from_le_bytes(self.spent_notional_raw_le)
    }

    pub fn set_spent_notional_raw(&mut self, value: u128) {
        self.spent_notional_raw_le = value.to_le_bytes();
    }

    pub fn is_active(&self) -> bool {
        self.status == AGENT_SESSION_STATUS_ACTIVE
    }
}
