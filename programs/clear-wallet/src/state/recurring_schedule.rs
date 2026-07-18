use quasar_lang::prelude::*;

pub const RECURRING_SCHEDULE_DISCRIMINATOR: u8 = 12;
pub const RECURRING_SCHEDULE_SEED: &[u8] = b"recurring";
pub const RECURRING_SCHEDULE_STATUS_ACTIVE: u8 = 1;
pub const RECURRING_SCHEDULE_STATUS_REVOKED: u8 = 2;
pub const RECURRING_SCHEDULE_STATUS_COMPLETE: u8 = 3;
// Recurring schedules reject proposal-dependent member and advanced-rule
// extensions. The largest supported CSP1 policy (16 recipients plus reusable
// velocity, count, and time controls) fits comfortably inside this bound.
pub const MAX_RECURRING_POLICY_BYTES: usize = 640;
pub const RECURRING_SCHEDULE_LEN: usize = 833;

/// Program-owned recurring SOL payment authority. Human labels remain app
/// metadata; every security-relevant field is stored and checked onchain.
pub struct RecurringSchedule {
    pub wallet: Address,
    pub intent: Address,
    pub schedule_id_hash: [u8; 32],
    pub recipient: Address,
    pub policy_commitment: [u8; 32],
    pub amount_lamports: u64,
    pub interval_seconds: u32,
    pub next_execution_at: i64,
    pub remaining_payments: u32,
    pub executed_payments: u32,
    pub policy_len: u16,
    pub policy_bytes: [u8; MAX_RECURRING_POLICY_BYTES],
    pub status: u8,
    pub bump: u8,
}

impl RecurringSchedule {
    pub fn read(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < RECURRING_SCHEDULE_LEN || data[0] != RECURRING_SCHEDULE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut offset = 1usize;
        let take32 = |offset: &mut usize| {
            let mut value = [0u8; 32];
            value.copy_from_slice(&data[*offset..*offset + 32]);
            *offset += 32;
            value
        };
        let wallet = Address::new_from_array(take32(&mut offset));
        let intent = Address::new_from_array(take32(&mut offset));
        let schedule_id_hash = take32(&mut offset);
        let recipient = Address::new_from_array(take32(&mut offset));
        let policy_commitment = take32(&mut offset);
        let amount_lamports = read_u64(data, &mut offset)?;
        let interval_seconds = read_u32(data, &mut offset)?;
        let next_execution_at = read_i64(data, &mut offset)?;
        let remaining_payments = read_u32(data, &mut offset)?;
        let executed_payments = read_u32(data, &mut offset)?;
        let policy_len = read_u16(data, &mut offset)?;
        if policy_len as usize > MAX_RECURRING_POLICY_BYTES {
            return Err(ProgramError::InvalidAccountData);
        }
        let mut policy_bytes = [0u8; MAX_RECURRING_POLICY_BYTES];
        policy_bytes.copy_from_slice(&data[offset..offset + MAX_RECURRING_POLICY_BYTES]);
        offset += MAX_RECURRING_POLICY_BYTES;
        let status = data[offset];
        let bump = data[offset + 1];
        Ok(Self {
            wallet,
            intent,
            schedule_id_hash,
            recipient,
            policy_commitment,
            amount_lamports,
            interval_seconds,
            next_execution_at,
            remaining_payments,
            executed_payments,
            policy_len,
            policy_bytes,
            status,
            bump,
        })
    }

    pub fn policy(&self) -> &[u8] {
        &self.policy_bytes[..self.policy_len as usize]
    }

    /// # Safety
    /// `ptr` must be writable for `RECURRING_SCHEDULE_LEN` bytes.
    pub unsafe fn write(&self, ptr: *mut u8) {
        unsafe {
            *ptr = RECURRING_SCHEDULE_DISCRIMINATOR;
            let mut offset = 1usize;
            for value in [
                self.wallet.as_ref(),
                self.intent.as_ref(),
                self.schedule_id_hash.as_ref(),
                self.recipient.as_ref(),
                self.policy_commitment.as_ref(),
            ] {
                core::ptr::copy_nonoverlapping(value.as_ptr(), ptr.add(offset), 32);
                offset += 32;
            }
            for value in [
                self.amount_lamports.to_le_bytes().as_slice(),
                self.interval_seconds.to_le_bytes().as_slice(),
                self.next_execution_at.to_le_bytes().as_slice(),
                self.remaining_payments.to_le_bytes().as_slice(),
                self.executed_payments.to_le_bytes().as_slice(),
                self.policy_len.to_le_bytes().as_slice(),
            ] {
                core::ptr::copy_nonoverlapping(value.as_ptr(), ptr.add(offset), value.len());
                offset += value.len();
            }
            core::ptr::copy_nonoverlapping(
                self.policy_bytes.as_ptr(),
                ptr.add(offset),
                MAX_RECURRING_POLICY_BYTES,
            );
            offset += MAX_RECURRING_POLICY_BYTES;
            *ptr.add(offset) = self.status;
            *ptr.add(offset + 1) = self.bump;
        }
    }
}

fn read_u16(data: &[u8], offset: &mut usize) -> Result<u16, ProgramError> {
    let value = u16::from_le_bytes(
        data[*offset..*offset + 2]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    *offset += 2;
    Ok(value)
}

fn read_u32(data: &[u8], offset: &mut usize) -> Result<u32, ProgramError> {
    let value = u32::from_le_bytes(
        data[*offset..*offset + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    *offset += 4;
    Ok(value)
}

fn read_u64(data: &[u8], offset: &mut usize) -> Result<u64, ProgramError> {
    let value = u64::from_le_bytes(
        data[*offset..*offset + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    *offset += 8;
    Ok(value)
}

fn read_i64(data: &[u8], offset: &mut usize) -> Result<i64, ProgramError> {
    let value = i64::from_le_bytes(
        data[*offset..*offset + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    *offset += 8;
    Ok(value)
}
