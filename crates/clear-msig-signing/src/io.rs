use super::*;

pub(crate) struct Reader<'a> {
    remaining: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { remaining: bytes }
    }

    pub(crate) fn remaining(&self) -> &'a [u8] {
        self.remaining
    }

    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8], Error> {
        if self.remaining.len() < len {
            return Err(Error::InvalidLength);
        }
        let (value, remaining) = self.remaining.split_at(len);
        self.remaining = remaining;
        Ok(value)
    }

    pub(crate) fn u8(&mut self) -> Result<u8, Error> {
        Ok(self.take(1)?[0])
    }

    pub(crate) fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| Error::InvalidLength)?,
        ))
    }

    pub(crate) fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error::InvalidLength)?,
        ))
    }

    pub(crate) fn u128(&mut self) -> Result<u128, Error> {
        Ok(u128::from_le_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| Error::InvalidLength)?,
        ))
    }

    pub(crate) fn i64(&mut self) -> Result<i64, Error> {
        Ok(i64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| Error::InvalidLength)?,
        ))
    }

    pub(crate) fn array32(&mut self) -> Result<[u8; 32], Error> {
        self.take(32)?.try_into().map_err(|_| Error::InvalidLength)
    }

    pub(crate) fn bytes(&mut self, max: usize) -> Result<&'a [u8], Error> {
        let len = u16::from_le_bytes(self.take(2)?.try_into().map_err(|_| Error::InvalidLength)?)
            as usize;
        if len > max {
            return Err(Error::InvalidLength);
        }
        self.take(len)
    }
}

pub(crate) struct Writer<'a> {
    out: &'a mut [u8],
    pub(crate) len: usize,
}

impl<'a> Writer<'a> {
    pub(crate) fn new(out: &'a mut [u8]) -> Self {
        Self { out, len: 0 }
    }

    pub(crate) fn push(&mut self, value: &[u8]) -> Result<(), Error> {
        let end = self
            .len
            .checked_add(value.len())
            .ok_or(Error::BufferTooSmall)?;
        if end > self.out.len() {
            return Err(Error::BufferTooSmall);
        }
        self.out[self.len..end].copy_from_slice(value);
        self.len = end;
        Ok(())
    }

    pub(crate) fn u8(&mut self, value: u8) -> Result<(), Error> {
        self.push(&[value])
    }

    pub(crate) fn u64(&mut self, value: u64) -> Result<(), Error> {
        self.push(&value.to_le_bytes())
    }

    pub(crate) fn u32(&mut self, value: u32) -> Result<(), Error> {
        self.push(&value.to_le_bytes())
    }

    pub(crate) fn u128(&mut self, value: u128) -> Result<(), Error> {
        self.push(&value.to_le_bytes())
    }

    pub(crate) fn i64(&mut self, value: i64) -> Result<(), Error> {
        self.push(&value.to_le_bytes())
    }

    pub(crate) fn bytes(&mut self, value: &[u8]) -> Result<(), Error> {
        let len = u16::try_from(value.len()).map_err(|_| Error::InvalidLength)?;
        self.push(&len.to_le_bytes())?;
        self.push(value)
    }

    pub(crate) fn decimal_u128(&mut self, value: u128) -> Result<(), Error> {
        let mut digits = [0u8; 39];
        let mut remaining = value;
        let mut cursor = digits.len();
        loop {
            cursor -= 1;
            digits[cursor] = b'0' + (remaining % 10) as u8;
            remaining /= 10;
            if remaining == 0 {
                break;
            }
        }
        self.push(&digits[cursor..])
    }

    pub(crate) fn signed_decimal_i64(&mut self, value: i64) -> Result<(), Error> {
        if value < 0 {
            self.push(b"-")?;
        }
        self.decimal_u128(value.unsigned_abs() as u128)
    }

    pub(crate) fn amount(&mut self, raw: u128, decimals: u8) -> Result<(), Error> {
        if decimals == 0 {
            return self.decimal_u128(raw);
        }
        let scale = 10u128
            .checked_pow(decimals as u32)
            .ok_or(Error::InvalidAmount)?;
        let whole = raw / scale;
        let fraction = raw % scale;
        self.decimal_u128(whole)?;
        if fraction == 0 {
            return Ok(());
        }
        self.push(b".")?;
        let mut digits = [b'0'; 36];
        let width = decimals as usize;
        let mut remaining = fraction;
        for index in (0..width).rev() {
            digits[index] = b'0' + (remaining % 10) as u8;
            remaining /= 10;
        }
        let mut end = width;
        while end > 0 && digits[end - 1] == b'0' {
            end -= 1;
        }
        self.push(&digits[..end])
    }

    pub(crate) fn hex(&mut self, value: &[u8]) -> Result<(), Error> {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in value {
            self.push(&[HEX[(byte >> 4) as usize], HEX[(byte & 0x0f) as usize]])?;
        }
        Ok(())
    }

    pub(crate) fn identity(
        &mut self,
        encoding: IdentityEncoding,
        value: &[u8],
    ) -> Result<(), Error> {
        if encoding == IdentityEncoding::SolanaPubkey {
            let mut out = [0u8; 44];
            let len = encode_base58(value, &mut out).ok_or(Error::InvalidLength)?;
            self.push(&out[..len])
        } else {
            self.push(value)
        }
    }

    pub(crate) fn pubkeys(&mut self, bytes: &[u8], count: u8) -> Result<(), Error> {
        if bytes.len() != count as usize * 32 {
            return Err(Error::InvalidLength);
        }
        for (index, pubkey) in bytes.chunks_exact(32).enumerate() {
            if index > 0 {
                self.push(b", ")?;
            }
            let mut out = [0u8; 44];
            let len = encode_base58(pubkey, &mut out).ok_or(Error::InvalidLength)?;
            self.push(&out[..len])?;
        }
        Ok(())
    }
}

fn encode_base58(input: &[u8], out: &mut [u8]) -> Option<usize> {
    const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if input.is_empty() {
        return Some(0);
    }
    let zeros = input.iter().take_while(|byte| **byte == 0).count();
    let mut digits = [0u8; 64];
    let mut digit_len = 1usize;
    for byte in input {
        let mut carry = *byte as u32;
        for digit in digits[..digit_len].iter_mut() {
            carry += (*digit as u32) << 8;
            *digit = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            if digit_len >= digits.len() {
                return None;
            }
            digits[digit_len] = (carry % 58) as u8;
            digit_len += 1;
            carry /= 58;
        }
    }
    while digit_len > 1 && digits[digit_len - 1] == 0 {
        digit_len -= 1;
    }
    let encoded_len = zeros + digit_len;
    if encoded_len > out.len() {
        return None;
    }
    for byte in &mut out[..zeros] {
        *byte = b'1';
    }
    for (index, digit) in digits[..digit_len].iter().rev().enumerate() {
        out[zeros + index] = ALPHABET[*digit as usize];
    }
    Some(encoded_len)
}
