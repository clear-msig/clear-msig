use quasar_lang::prelude::*;

pub const AGENT_RISK_LEDGER_DISCRIMINATOR: u8 = 10;
pub const AGENT_RISK_STATUS_ACTIVE: u8 = 1;
pub const AGENT_RISK_STATUS_PAUSED: u8 = 2;
pub const AGENT_RISK_LEDGER_SEED: &[u8] = b"agent_risk";
pub const AGENT_RISK_LEDGER_LEN: usize = 1 + 32 + 32 + 32 + 16 + 16 + 16 + 8 + 32 + 1 + 1;
pub const AGENT_SETTLEMENT_RECEIPT_DISCRIMINATOR: u8 = 11;
pub const AGENT_SETTLEMENT_RECEIPT_SEED: &[u8] = b"agent_settlement";
pub const AGENT_SETTLEMENT_RECEIPT_LEN: usize = 1 + 32 + 32 + 32 + 32 + 8 + 1;

/// Program-owned accounting for one bounded agent session.
///
/// The session tracks cumulative authorization. This ledger separately tracks
/// concurrent open exposure and realized losses, both of which are mutated
/// atomically by the Solana runtime.
pub struct AgentRiskLedger {
    pub wallet: Address,
    pub session_id_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub max_loss_raw_le: [u8; 16],
    pub realized_loss_raw_le: [u8; 16],
    pub open_notional_raw_le: [u8; 16],
    pub next_settlement_sequence: u64,
    pub last_settlement_artifact_hash: [u8; 32],
    pub status: u8,
    pub bump: u8,
}

impl AgentRiskLedger {
    pub fn read(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < AGENT_RISK_LEDGER_LEN || data[0] != AGENT_RISK_LEDGER_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut offset = 1usize;
        let wallet = Address::new_from_array(take::<32>(data, &mut offset)?);
        let session_id_hash = take::<32>(data, &mut offset)?;
        let oracle_policy_hash = take::<32>(data, &mut offset)?;
        let max_loss_raw_le = take::<16>(data, &mut offset)?;
        let realized_loss_raw_le = take::<16>(data, &mut offset)?;
        let open_notional_raw_le = take::<16>(data, &mut offset)?;
        let next_settlement_sequence = u64::from_le_bytes(take::<8>(data, &mut offset)?);
        let last_settlement_artifact_hash = take::<32>(data, &mut offset)?;
        let status = data[offset];
        offset += 1;
        let bump = data[offset];
        Ok(Self {
            wallet,
            session_id_hash,
            oracle_policy_hash,
            max_loss_raw_le,
            realized_loss_raw_le,
            open_notional_raw_le,
            next_settlement_sequence,
            last_settlement_artifact_hash,
            status,
            bump,
        })
    }

    /// # Safety
    ///
    /// `ptr` must be non-null and writable for `AGENT_RISK_LEDGER_LEN` bytes.
    /// The caller must hold exclusive access to the account data.
    pub unsafe fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = AGENT_RISK_LEDGER_DISCRIMINATOR;
            let mut offset = 1usize;
            write(ptr, &mut offset, self.wallet.as_ref());
            write(ptr, &mut offset, &self.session_id_hash);
            write(ptr, &mut offset, &self.oracle_policy_hash);
            write(ptr, &mut offset, &self.max_loss_raw_le);
            write(ptr, &mut offset, &self.realized_loss_raw_le);
            write(ptr, &mut offset, &self.open_notional_raw_le);
            write(
                ptr,
                &mut offset,
                &self.next_settlement_sequence.to_le_bytes(),
            );
            write(ptr, &mut offset, &self.last_settlement_artifact_hash);
            *ptr.add(offset) = self.status;
            offset += 1;
            *ptr.add(offset) = self.bump;
        }
    }

    pub fn max_loss_raw(&self) -> u128 {
        u128::from_le_bytes(self.max_loss_raw_le)
    }

    pub fn realized_loss_raw(&self) -> u128 {
        u128::from_le_bytes(self.realized_loss_raw_le)
    }

    pub fn open_notional_raw(&self) -> u128 {
        u128::from_le_bytes(self.open_notional_raw_le)
    }

    pub fn set_realized_loss_raw(&mut self, value: u128) {
        self.realized_loss_raw_le = value.to_le_bytes();
    }

    pub fn set_open_notional_raw(&mut self, value: u128) {
        self.open_notional_raw_le = value.to_le_bytes();
    }

    pub fn is_active(&self) -> bool {
        self.status == AGENT_RISK_STATUS_ACTIVE && self.realized_loss_raw() < self.max_loss_raw()
    }
}

fn take<const N: usize>(data: &[u8], offset: &mut usize) -> Result<[u8; N], ProgramError> {
    let end = offset
        .checked_add(N)
        .ok_or(ProgramError::InvalidAccountData)?;
    let bytes = data
        .get(*offset..end)
        .ok_or(ProgramError::InvalidAccountData)?;
    let mut out = [0u8; N];
    out.copy_from_slice(bytes);
    *offset = end;
    Ok(out)
}

unsafe fn write(ptr: *mut u8, offset: &mut usize, bytes: &[u8]) {
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(*offset), bytes.len());
    }
    *offset += bytes.len();
}

pub struct AgentSettlementReceipt {
    pub wallet: Address,
    pub session_id_hash: [u8; 32],
    pub execution_id_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
    pub settlement_sequence: u64,
    pub bump: u8,
}

impl AgentSettlementReceipt {
    /// # Safety
    ///
    /// `ptr` must be non-null and writable for
    /// `AGENT_SETTLEMENT_RECEIPT_LEN` bytes with exclusive access.
    pub unsafe fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = AGENT_SETTLEMENT_RECEIPT_DISCRIMINATOR;
            let mut offset = 1usize;
            write(ptr, &mut offset, self.wallet.as_ref());
            write(ptr, &mut offset, &self.session_id_hash);
            write(ptr, &mut offset, &self.execution_id_hash);
            write(ptr, &mut offset, &self.settlement_artifact_hash);
            write(ptr, &mut offset, &self.settlement_sequence.to_le_bytes());
            *ptr.add(offset) = self.bump;
        }
    }
}
