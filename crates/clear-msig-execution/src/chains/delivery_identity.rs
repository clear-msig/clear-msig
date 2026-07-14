use crate::error::*;
use sha2::{Digest, Sha256};
use tiny_keccak::{Hasher, Keccak};

pub(super) fn normalize_raw_hex(raw: &str) -> Result<String> {
    let raw = raw.trim().strip_prefix("0x").unwrap_or(raw.trim());
    if raw.is_empty()
        || !raw.len().is_multiple_of(2)
        || !raw.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err(anyhow!(
            "destination raw transaction must be non-empty even-length hex"
        ));
    }
    Ok(raw.to_ascii_lowercase())
}

pub(super) fn expected_tx_id(chain_kind: u8, raw_tx_hex: &str) -> Result<String> {
    let raw = hex::decode(raw_tx_hex).context("decode destination raw transaction")?;
    let digest = match chain_kind {
        1 | 4 | 5 => {
            let mut digest = [0u8; 32];
            let mut hasher = Keccak::v256();
            hasher.update(&raw);
            hasher.finalize(&mut digest);
            return Ok(format!("0x{}", hex::encode(digest)));
        }
        2 => double_sha256(&strip_bitcoin_witness(&raw)?),
        3 => double_sha256(&raw),
        other => {
            return Err(anyhow!(
                "no deterministic destination tx id for chain_kind {other}"
            ))
        }
    };
    Ok(hex::encode(digest.into_iter().rev().collect::<Vec<_>>()))
}

pub(super) fn execution_id(chain_kind: u8, tx_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"clearsig-destination-execution-v1");
    hasher.update([chain_kind]);
    hasher.update(tx_id.to_ascii_lowercase().as_bytes());
    format!("dst_{}", hex::encode(hasher.finalize()))
}

fn double_sha256(bytes: &[u8]) -> [u8; 32] {
    let first = Sha256::digest(bytes);
    Sha256::digest(first).into()
}

fn strip_bitcoin_witness(raw: &[u8]) -> Result<Vec<u8>> {
    if raw.len() < 10 || raw.get(4..6) != Some(&[0, 1]) {
        return Err(anyhow!("expected a serialized segwit Bitcoin transaction"));
    }
    let mut stripped = raw[..4].to_vec();
    let mut cursor = 6;
    let input_start = cursor;
    let input_count = read_varint(raw, &mut cursor)?;
    for _ in 0..input_count {
        take(raw, &mut cursor, 36)?;
        let script_len = read_varint(raw, &mut cursor)?;
        take(
            raw,
            &mut cursor,
            usize::try_from(script_len).context("Bitcoin script length overflow")?,
        )?;
        take(raw, &mut cursor, 4)?;
    }
    stripped.extend_from_slice(&raw[input_start..cursor]);
    let output_start = cursor;
    let output_count = read_varint(raw, &mut cursor)?;
    for _ in 0..output_count {
        take(raw, &mut cursor, 8)?;
        let script_len = read_varint(raw, &mut cursor)?;
        take(
            raw,
            &mut cursor,
            usize::try_from(script_len).context("Bitcoin script length overflow")?,
        )?;
    }
    stripped.extend_from_slice(&raw[output_start..cursor]);
    for _ in 0..input_count {
        let item_count = read_varint(raw, &mut cursor)?;
        for _ in 0..item_count {
            let item_len = read_varint(raw, &mut cursor)?;
            take(
                raw,
                &mut cursor,
                usize::try_from(item_len).context("Bitcoin witness length overflow")?,
            )?;
        }
    }
    let lock_time = take(raw, &mut cursor, 4)?.to_owned();
    if cursor != raw.len() {
        return Err(anyhow!("Bitcoin transaction has trailing bytes"));
    }
    stripped.extend_from_slice(&lock_time);
    Ok(stripped)
}

fn read_varint(raw: &[u8], cursor: &mut usize) -> Result<u64> {
    let prefix = *take(raw, cursor, 1)?
        .first()
        .ok_or_else(|| anyhow!("missing Bitcoin varint"))?;
    let length = match prefix {
        0xfd => 2,
        0xfe => 4,
        0xff => 8,
        value => return Ok(u64::from(value)),
    };
    let bytes = take(raw, cursor, length)?;
    let mut padded = [0u8; 8];
    padded[..length].copy_from_slice(bytes);
    Ok(u64::from_le_bytes(padded))
}

fn take<'a>(raw: &'a [u8], cursor: &mut usize, length: usize) -> Result<&'a [u8]> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| anyhow!("destination transaction offset overflow"))?;
    let bytes = raw
        .get(*cursor..end)
        .ok_or_else(|| anyhow!("truncated destination transaction"))?;
    *cursor = end;
    Ok(bytes)
}
