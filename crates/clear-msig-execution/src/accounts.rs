use crate::error::*;
use bech32::{primitives::decode::CheckedHrpstring, Bech32, Hrp};
use clear_wallet::utils::definition::*;
use ripemd::Ripemd160;
use serde::Serialize;
use sha2::{Digest as Sha2Digest, Sha256};

/// Deserialized ClearWallet account.
#[derive(Debug, Serialize)]
pub struct WalletAccount {
    pub bump: u8,
    pub proposal_index: u64,
    pub intent_index: u8,
    /// Pubkey (base58) of the address that paid for + signed the
    /// create_wallet instruction. Stored on chain post creator-scoped
    /// PDA upgrade so reads can identify the wallet's owner.
    pub creator: String,
    pub name: String,
}

/// Deserialized Intent account.
#[allow(dead_code)]
pub struct IntentAccount {
    pub wallet: String,
    pub bump: u8,
    pub intent_index: u8,
    pub intent_type: u8,
    /// 0 = Solana (local CPI), 1+ = remote chain via Ika dWallet.
    pub chain_kind: u8,
    pub approved: bool,
    pub approval_threshold: u8,
    pub cancellation_threshold: u8,
    pub timelock_seconds: u32,
    pub template_offset: u16,
    pub template_len: u16,
    pub tx_template_offset: u16,
    pub tx_template_len: u16,
    pub active_proposal_count: u16,
    pub proposers: Vec<String>,
    pub approvers: Vec<String>,
    pub params: Vec<ParamEntry>,
    pub accounts: Vec<AccountEntry>,
    pub instructions: Vec<InstructionEntry>,
    pub data_segments: Vec<DataSegmentEntry>,
    pub seeds: Vec<SeedEntry>,
    pub policy_ciphertexts: Vec<u8>,
    pub byte_pool: Vec<u8>,
}

/// Deserialized Proposal account.
#[derive(Debug, Serialize)]
pub struct ProposalAccount {
    pub wallet: String,
    pub intent: String,
    pub proposal_index: u64,
    pub proposer: String,
    pub status: String,
    pub proposed_at: i64,
    pub approved_at: i64,
    pub bump: u8,
    pub approval_bitmap: u16,
    pub cancellation_bitmap: u16,
    pub rent_refund: String,
    pub params_data: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct TypedProposalAccount {
    pub wallet: String,
    pub intent: String,
    pub proposal_index: u64,
    pub proposer: String,
    pub status: String,
    pub action_kind: u8,
    pub proposed_at: i64,
    pub approved_at: i64,
    pub expires_at: i64,
    pub bump: u8,
    pub approval_bitmap: u16,
    pub cancellation_bitmap: u16,
    pub rent_refund: String,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub action_id: Vec<u8>,
    pub nonce: Vec<u8>,
    pub policy_bytes: Vec<u8>,
    pub clear_text: Vec<u8>,
}

fn read_u8(data: &[u8], offset: &mut usize) -> Result<u8> {
    let val = *data
        .get(*offset)
        .ok_or(anyhow!("unexpected end of data at {}", *offset))?;
    *offset += 1;
    Ok(val)
}

fn read_u16_le(data: &[u8], offset: &mut usize) -> Result<u16> {
    let bytes: [u8; 2] = data
        .get(*offset..*offset + 2)
        .ok_or(anyhow!("unexpected end of data"))?
        .try_into()?;
    *offset += 2;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32_le(data: &[u8], offset: &mut usize) -> Result<u32> {
    let bytes: [u8; 4] = data
        .get(*offset..*offset + 4)
        .ok_or(anyhow!("unexpected end of data"))?
        .try_into()?;
    *offset += 4;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64_le(data: &[u8], offset: &mut usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(*offset..*offset + 8)
        .ok_or(anyhow!("unexpected end of data"))?
        .try_into()?;
    *offset += 8;
    Ok(u64::from_le_bytes(bytes))
}

fn read_i64_le(data: &[u8], offset: &mut usize) -> Result<i64> {
    let bytes: [u8; 8] = data
        .get(*offset..*offset + 8)
        .ok_or(anyhow!("unexpected end of data"))?
        .try_into()?;
    *offset += 8;
    Ok(i64::from_le_bytes(bytes))
}

fn read_address(data: &[u8], offset: &mut usize) -> Result<String> {
    let bytes = data
        .get(*offset..*offset + 32)
        .ok_or(anyhow!("unexpected end of data"))?;
    *offset += 32;
    Ok(bs58::encode(bytes).into_string())
}

fn read_fixed_32(data: &[u8], offset: &mut usize) -> Result<[u8; 32]> {
    let bytes: [u8; 32] = data
        .get(*offset..*offset + 32)
        .ok_or(anyhow!("unexpected end of data reading 32-byte field"))?
        .try_into()?;
    *offset += 32;
    Ok(bytes)
}

fn read_vec_addresses(data: &[u8], offset: &mut usize) -> Result<Vec<String>> {
    let count = read_u32_le(data, offset)? as usize;
    let mut addresses = Vec::with_capacity(count);
    for _ in 0..count {
        addresses.push(read_address(data, offset)?);
    }
    Ok(addresses)
}

fn read_vec_raw<T: Copy>(data: &[u8], offset: &mut usize) -> Result<Vec<T>> {
    let count = read_u32_le(data, offset)? as usize;
    let elem_size = core::mem::size_of::<T>();
    let total = count * elem_size;
    let bytes = data.get(*offset..*offset + total).ok_or(anyhow!(
        "unexpected end of data reading vec of {} elements",
        count
    ))?;
    let items: Vec<T> = (0..count)
        .map(|i| unsafe { core::ptr::read(bytes[i * elem_size..].as_ptr() as *const T) })
        .collect();
    *offset += total;
    Ok(items)
}

fn read_vec_u8(data: &[u8], offset: &mut usize) -> Result<Vec<u8>> {
    let count = read_u32_le(data, offset)? as usize;
    let bytes = data
        .get(*offset..*offset + count)
        .ok_or(anyhow!("unexpected end of data reading {} bytes", count))?;
    let result = bytes.to_vec();
    *offset += count;
    Ok(result)
}

fn read_optional_vec_u8(data: &[u8], offset: &mut usize) -> Result<Vec<u8>> {
    if *offset == data.len() {
        return Ok(Vec::new());
    }
    read_vec_u8(data, offset)
}

pub fn parse_wallet(data: &[u8]) -> Result<WalletAccount> {
    if data.is_empty() || data[0] != 1 {
        return Err(anyhow!(
            "not a ClearWallet account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let mut offset = 1;
    let bump = read_u8(data, &mut offset)?;
    let proposal_index = read_u64_le(data, &mut offset)?;
    let intent_index = read_u8(data, &mut offset)?;
    // Creator pubkey, 32 raw bytes — added 2026-05-03 with the
    // creator-scoped PDA upgrade. Layout drift here is the most
    // likely source of "name decodes as junk" if you forget to
    // mirror this in the frontend's parseWallet too.
    let creator_bytes = data
        .get(offset..offset + 32)
        .ok_or(anyhow!("unexpected end of data reading creator"))?;
    let creator =
        solana_pubkey::Pubkey::new_from_array(creator_bytes.try_into().expect("32 bytes"))
            .to_string();
    offset += 32;
    // name is a dynamic String with u32 LE prefix
    let name_len = read_u32_le(data, &mut offset)? as usize;
    let name_bytes = data
        .get(offset..offset + name_len)
        .ok_or(anyhow!("unexpected end of data reading name"))?;
    let name = String::from_utf8_lossy(name_bytes).to_string();

    Ok(WalletAccount {
        bump,
        proposal_index,
        intent_index,
        creator,
        name,
    })
}

pub fn parse_intent(data: &[u8]) -> Result<IntentAccount> {
    if data.is_empty() || data[0] != 2 {
        return Err(anyhow!(
            "not an Intent account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    // Layout (must match programs/clear-wallet/src/state/intent.rs):
    //   disc(1) + wallet(32) + bump(1) + intent_index(1) + intent_type(1)
    //   + chain_kind(1) + approved(1)
    //   + approval_threshold(1) + cancellation_threshold(1) + timelock_seconds(4)
    //   + template_offset(2) + template_len(2)
    //   + tx_template_offset(2) + tx_template_len(2)
    //   + active_proposal_count(2)
    //   + Vec<proposers> + Vec<approvers> + Vec<params> + ...
    //   + policy_ciphertexts + byte_pool
    let mut offset = 1;
    let wallet = read_address(data, &mut offset)?;
    let bump = read_u8(data, &mut offset)?;
    let intent_index = read_u8(data, &mut offset)?;
    let intent_type = read_u8(data, &mut offset)?;
    let chain_kind = read_u8(data, &mut offset)?;
    let approved = read_u8(data, &mut offset)? != 0;
    let approval_threshold = read_u8(data, &mut offset)?;
    let cancellation_threshold = read_u8(data, &mut offset)?;
    let timelock_seconds = read_u32_le(data, &mut offset)?;
    let template_offset = read_u16_le(data, &mut offset)?;
    let template_len = read_u16_le(data, &mut offset)?;
    let tx_template_offset = read_u16_le(data, &mut offset)?;
    let tx_template_len = read_u16_le(data, &mut offset)?;
    let active_proposal_count = read_u16_le(data, &mut offset)?;

    let proposers = read_vec_addresses(data, &mut offset)?;
    let approvers = read_vec_addresses(data, &mut offset)?;
    let params = read_vec_raw::<ParamEntry>(data, &mut offset)?;
    let accounts = read_vec_raw::<AccountEntry>(data, &mut offset)?;
    let instructions = read_vec_raw::<InstructionEntry>(data, &mut offset)?;
    let data_segments = read_vec_raw::<DataSegmentEntry>(data, &mut offset)?;
    let seeds = read_vec_raw::<SeedEntry>(data, &mut offset)?;
    let tail_offset = offset;
    let (policy_ciphertexts, byte_pool) = match (|| -> Result<(Vec<u8>, Vec<u8>)> {
        let policy_ciphertexts = read_vec_u8(data, &mut offset)?;
        let byte_pool = read_vec_u8(data, &mut offset)?;
        Ok((policy_ciphertexts, byte_pool))
    })() {
        Ok(tail) => tail,
        Err(_) => {
            // Older deployed program builds wrote intent accounts before the
            // policy_ciphertexts tail field existed. Accept that layout so
            // wallet signing can still verify legacy on-chain intents.
            let mut legacy_offset = tail_offset;
            let byte_pool = read_optional_vec_u8(data, &mut legacy_offset)?;
            (Vec::new(), byte_pool)
        }
    };

    Ok(IntentAccount {
        wallet,
        bump,
        intent_index,
        intent_type,
        chain_kind,
        approved,
        approval_threshold,
        cancellation_threshold,
        timelock_seconds,
        template_offset,
        template_len,
        tx_template_offset,
        tx_template_len,
        active_proposal_count,
        proposers,
        approvers,
        params,
        accounts,
        instructions,
        data_segments,
        seeds,
        policy_ciphertexts,
        byte_pool,
    })
}

/// Deserialized IkaConfig account (the per-(wallet, chain_kind) dWallet binding).
#[derive(Debug, Serialize)]
pub struct IkaConfigAccount {
    pub wallet: String,
    pub dwallet: String,
    pub user_pubkey: String,
    pub chain_kind: u8,
    pub signature_scheme: u16,
    pub bump: u8,
}

/// Subset of the dWallet account needed by the CLI (curve + actual pubkey).
///
/// On-chain layout (after the 1-byte discriminator + 1-byte version header):
/// - `[2..34]`   authority
/// - `[34..36]`  curve (u16 LE)
/// - `[36]`      state
/// - `[37]`      public_key_len
/// - `[38..103]` public_key (zero-padded to 65 bytes)
#[derive(Debug, Serialize)]
pub struct DWalletAccount {
    pub curve: u16,
    pub state: u8,
    pub public_key: Vec<u8>,
    pub created_epoch: u64,
    pub noa_public_key: String,
}

/// Read just the dWallet's current authority pubkey (32 bytes at offset 2)
/// without parsing the rest of the account. Used by `wallet add-chain` to
/// detect whether the dWallet has already been transferred to clear-wallet's
/// CPI authority PDA on a prior bind, in which case we skip the
/// `transfer_ownership` step instead of failing on a duplicate transfer.
pub fn parse_dwallet_authority(data: &[u8]) -> Result<solana_sdk::pubkey::Pubkey> {
    if data.len() < 34 || data[0] != 2 {
        return Err(anyhow!(
            "not a DWallet account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let mut authority = [0u8; 32];
    authority.copy_from_slice(&data[2..34]);
    Ok(solana_sdk::pubkey::Pubkey::new_from_array(authority))
}

pub fn parse_dwallet(data: &[u8]) -> Result<DWalletAccount> {
    if data.len() < 145 || data[0] != 2 {
        return Err(anyhow!(
            "not a DWallet account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let curve = u16::from_le_bytes([data[34], data[35]]);
    let state = data[36];
    let public_key_len = data[37] as usize;
    if public_key_len == 0 || public_key_len > 65 {
        return Err(anyhow!("invalid dWallet public_key_len: {public_key_len}"));
    }
    let public_key = data[38..38 + public_key_len].to_vec();
    let created_epoch = u64::from_le_bytes(data[103..111].try_into().unwrap());
    let noa_public_key =
        solana_pubkey::Pubkey::new_from_array(data[111..143].try_into().expect("32 bytes"))
            .to_string();
    Ok(DWalletAccount {
        curve,
        state,
        public_key,
        created_epoch,
        noa_public_key,
    })
}

/// Compute the EVM address (20 bytes) from a 33-byte SEC1 compressed
/// secp256k1 public key. Returns the lowercase `0x`-prefixed hex string.
pub fn evm_address_from_secp256k1(compressed: &[u8]) -> Result<String> {
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    use k256::PublicKey;
    use tiny_keccak::{Hasher, Keccak};

    if compressed.len() != 33 {
        return Err(anyhow!(
            "expected 33-byte compressed secp256k1 pubkey, got {}",
            compressed.len()
        ));
    }
    let pk = PublicKey::from_sec1_bytes(compressed)
        .map_err(|e| anyhow!("invalid secp256k1 pubkey: {e}"))?;
    let uncompressed = pk.to_encoded_point(false);
    let xy = &uncompressed.as_bytes()[1..]; // strip 0x04 prefix → 64 bytes
    let mut hash = [0u8; 32];
    let mut hasher = Keccak::v256();
    hasher.update(xy);
    hasher.finalize(&mut hash);
    Ok(format!("0x{}", hex_encode(&hash[12..])))
}

/// `hash160(x)` = `RIPEMD160(SHA256(x))` — the standard Bitcoin key
/// fingerprint hash used for P2WPKH addresses.
fn hash160(bytes: &[u8]) -> [u8; 20] {
    let sha = Sha256::digest(bytes);
    let ripemd = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&ripemd);
    out
}

/// Bitcoin P2WPKH address (bech32, witness version 0) for the given network.
///
/// `hrp` is the human-readable part: `"bc"` for mainnet, `"tb"` for testnet,
/// `"bcrt"` for regtest. Returns e.g. `bc1q...` / `tb1q...`.
pub fn bitcoin_p2wpkh_address(compressed: &[u8], hrp: &str) -> Result<String> {
    if compressed.len() != 33 {
        return Err(anyhow!(
            "expected 33-byte compressed secp256k1 pubkey, got {}",
            compressed.len()
        ));
    }
    let h160 = hash160(compressed);
    let hrp = Hrp::parse(hrp).map_err(|e| anyhow!("invalid bech32 HRP: {e}"))?;
    // Witness version 0, then the 20-byte program. The bech32 crate exposes
    // this via `encode::<Bech32>` after we manually prepend the version.
    // For witness v0 P2WPKH the encoded payload is just the 20-byte hash and
    // the version byte is encoded outside the data. The simplest correct
    // path is to use `bech32::segwit::encode_v0`.
    bech32::segwit::encode_v0(hrp, &h160).map_err(|e| anyhow!("bech32 encode: {e}"))
}

/// Zcash transparent P2PKH address (base58check) from a 33-byte compressed
/// secp256k1 pubkey. `mainnet` = true → `t1...`, false → `tm...`.
pub fn zcash_transparent_address(compressed: &[u8], mainnet: bool) -> Result<String> {
    if compressed.len() != 33 {
        return Err(anyhow!(
            "expected 33-byte compressed secp256k1 pubkey, got {}",
            compressed.len()
        ));
    }
    let h160 = hash160(compressed);
    // Zcash t-addr version bytes: mainnet 0x1CB8, testnet 0x1D25
    let version = if mainnet { [0x1C, 0xB8] } else { [0x1D, 0x25] };
    let mut payload = Vec::with_capacity(2 + 20 + 4);
    payload.extend_from_slice(&version);
    payload.extend_from_slice(&h160);
    // Double-SHA256 checksum
    let hash1 = Sha256::digest(&payload);
    let hash2 = Sha256::digest(hash1);
    payload.extend_from_slice(&hash2[..4]);
    Ok(bs58::encode(&payload).into_string())
}

#[allow(dead_code)]
fn _bech32_unused() {
    // Silence unused-import warnings if `Bech32` / `CheckedHrpstring` are not
    // referenced after a future refactor.
    let _ = std::any::type_name::<Bech32>();
    let _ = std::any::type_name::<CheckedHrpstring<'_>>();
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    /// dWallet pubkey from a real devnet DKG run on
    /// `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` — used as a known
    /// fixed input so we can pin every chain-native derivation against
    /// independently-computed reference values.
    const TEST_PK_HEX: &str = "03445655313b638875c9f559b34aacb355e59cc9ce248b49696a584d0416cd9b79";

    fn pk() -> Vec<u8> {
        let mut out = Vec::with_capacity(33);
        let bytes = TEST_PK_HEX.as_bytes();
        for i in (0..bytes.len()).step_by(2) {
            let hi = (bytes[i] as char).to_digit(16).unwrap() as u8;
            let lo = (bytes[i + 1] as char).to_digit(16).unwrap() as u8;
            out.push((hi << 4) | lo);
        }
        out
    }

    #[test]
    fn evm_address_matches_reference() {
        assert_eq!(
            evm_address_from_secp256k1(&pk()).unwrap(),
            "0x400d36c43a8e5871483e7caa957f0cace0d71a1d"
        );
    }

    #[test]
    fn p2wpkh_addresses_round_trip() {
        // Both networks should encode without error and decode back to the same
        // 20-byte hash160. We don't pin the literal bech32 string here because
        // the reference value is implicitly verified by the round-trip + the
        // hash160 equality check.
        let pk = pk();
        let main = bitcoin_p2wpkh_address(&pk, "bc").unwrap();
        let test = bitcoin_p2wpkh_address(&pk, "tb").unwrap();
        assert!(main.starts_with("bc1q"));
        assert!(test.starts_with("tb1q"));

        let h160 = hash160(&pk);
        for addr in [main, test] {
            let (_hrp, _witness_version, program) = bech32::segwit::decode(&addr).unwrap();
            assert_eq!(&program, &h160);
        }
    }

    fn push_u8(buf: &mut Vec<u8>, value: u8) {
        buf.push(value);
    }

    fn push_u16(buf: &mut Vec<u8>, value: u16) {
        buf.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(buf: &mut Vec<u8>, value: u32) {
        buf.extend_from_slice(&value.to_le_bytes());
    }

    fn push_address(buf: &mut Vec<u8>, value: [u8; 32]) {
        buf.extend_from_slice(&value);
    }

    fn push_zero_vec_headers(buf: &mut Vec<u8>, count: usize) {
        for _ in 0..count {
            push_u32(buf, 0);
        }
    }

    fn intent_prefix() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(2);
        push_address(&mut buf, [7; 32]);
        push_u8(&mut buf, 1);
        push_u8(&mut buf, 2);
        push_u8(&mut buf, 3);
        push_u8(&mut buf, 4);
        push_u8(&mut buf, 1);
        push_u8(&mut buf, 2);
        push_u8(&mut buf, 1);
        push_u32(&mut buf, 3600);
        push_u16(&mut buf, 0);
        push_u16(&mut buf, 4);
        push_u16(&mut buf, 0);
        push_u16(&mut buf, 0);
        push_u16(&mut buf, 0);
        push_zero_vec_headers(&mut buf, 7);
        buf
    }

    #[test]
    fn parse_intent_accepts_current_tail_layout() {
        let mut data = intent_prefix();
        let policy_ciphertexts =
            encode_policy_ciphertexts(&["ct_deadbeef".to_string(), "ct_cafebabe".to_string()])
                .unwrap();
        push_u32(&mut data, policy_ciphertexts.len() as u32);
        data.extend_from_slice(&policy_ciphertexts);
        push_u32(&mut data, 4);
        data.extend_from_slice(b"tmpl");

        let parsed = parse_intent(&data).unwrap();
        assert_eq!(parsed.template(), "tmpl");
        assert_eq!(
            parsed.policy_ciphertext_ids(),
            vec!["ct_deadbeef".to_string(), "ct_cafebabe".to_string()]
        );
        assert_eq!(parsed.byte_pool, b"tmpl");
    }

    #[test]
    fn parse_intent_accepts_legacy_tail_layout_without_policy_ciphertexts() {
        let mut data = intent_prefix();
        push_u32(&mut data, 4);
        data.extend_from_slice(b"tmpl");

        let parsed = parse_intent(&data).unwrap();
        assert_eq!(parsed.template(), "tmpl");
        assert!(parsed.policy_ciphertexts.is_empty());
        assert_eq!(parsed.byte_pool, b"tmpl");
    }
}

pub fn parse_ika_config(data: &[u8]) -> Result<IkaConfigAccount> {
    if data.len() < 101 || data[0] != 4 {
        return Err(anyhow!(
            "not an IkaConfig account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let mut offset = 1;
    let wallet = read_address(data, &mut offset)?;
    let dwallet = read_address(data, &mut offset)?;
    let user_pubkey_bytes = data
        .get(offset..offset + 32)
        .ok_or(anyhow!("unexpected end of data reading user_pubkey"))?;
    let user_pubkey = hex_encode(user_pubkey_bytes);
    offset += 32;
    let chain_kind = read_u8(data, &mut offset)?;
    let signature_scheme = u16::from_le_bytes(
        data.get(offset..offset + 2)
            .ok_or(anyhow!("unexpected end of data reading signature_scheme"))?
            .try_into()
            .unwrap(),
    );
    offset += 2;
    let bump = read_u8(data, &mut offset)?;
    Ok(IkaConfigAccount {
        wallet,
        dwallet,
        user_pubkey,
        chain_kind,
        signature_scheme,
        bump,
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn parse_proposal(data: &[u8]) -> Result<ProposalAccount> {
    if data.is_empty() || data[0] != 3 {
        return Err(anyhow!(
            "not a Proposal account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let mut offset = 1;
    let wallet = read_address(data, &mut offset)?;
    let intent = read_address(data, &mut offset)?;
    let proposal_index = read_u64_le(data, &mut offset)?;
    let proposer = read_address(data, &mut offset)?;
    let status_byte = read_u8(data, &mut offset)?;
    let status = match status_byte {
        0 => "Active",
        1 => "Approved",
        2 => "Executed",
        3 => "Cancelled",
        _ => "Unknown",
    }
    .to_string();
    let proposed_at = read_i64_le(data, &mut offset)?;
    let approved_at = read_i64_le(data, &mut offset)?;
    let bump = read_u8(data, &mut offset)?;
    let approval_bitmap = read_u16_le(data, &mut offset)?;
    let cancellation_bitmap = read_u16_le(data, &mut offset)?;
    let rent_refund = read_address(data, &mut offset)?;
    let params_data = read_vec_u8(data, &mut offset)?;

    Ok(ProposalAccount {
        wallet,
        intent,
        proposal_index,
        proposer,
        status,
        proposed_at,
        approved_at,
        bump,
        approval_bitmap,
        cancellation_bitmap,
        rent_refund,
        params_data,
    })
}

pub fn parse_typed_proposal(data: &[u8]) -> Result<TypedProposalAccount> {
    if data.is_empty() || data[0] != 6 {
        return Err(anyhow!(
            "not a TypedProposal account (discriminator={})",
            data.first().unwrap_or(&0)
        ));
    }
    let mut offset = 1;
    let wallet = read_address(data, &mut offset)?;
    let intent = read_address(data, &mut offset)?;
    let proposal_index = read_u64_le(data, &mut offset)?;
    let proposer = read_address(data, &mut offset)?;
    let status_byte = read_u8(data, &mut offset)?;
    let status = match status_byte {
        0 => "Active",
        1 => "Approved",
        2 => "Executed",
        3 => "Cancelled",
        _ => "Unknown",
    }
    .to_string();
    let action_kind = read_u8(data, &mut offset)?;
    let proposed_at = read_i64_le(data, &mut offset)?;
    let approved_at = read_i64_le(data, &mut offset)?;
    let expires_at = read_i64_le(data, &mut offset)?;
    let bump = read_u8(data, &mut offset)?;
    let approval_bitmap = read_u16_le(data, &mut offset)?;
    let cancellation_bitmap = read_u16_le(data, &mut offset)?;
    let rent_refund = read_address(data, &mut offset)?;
    let policy_commitment = read_fixed_32(data, &mut offset)?;
    let payload_hash = read_fixed_32(data, &mut offset)?;
    let envelope_hash = read_fixed_32(data, &mut offset)?;
    let action_id = read_vec_u8(data, &mut offset)?;
    let nonce = read_vec_u8(data, &mut offset)?;
    let before_policy = offset;
    let maybe_policy = read_vec_u8(data, &mut offset);
    let (policy_bytes, clear_text) = match maybe_policy {
        Ok(policy) => match read_vec_u8(data, &mut offset) {
            Ok(clear) => (policy, clear),
            Err(_) => {
                offset = before_policy;
                (Vec::new(), read_vec_u8(data, &mut offset)?)
            }
        },
        Err(_) => {
            offset = before_policy;
            (Vec::new(), read_vec_u8(data, &mut offset)?)
        }
    };

    Ok(TypedProposalAccount {
        wallet,
        intent,
        proposal_index,
        proposer,
        status,
        action_kind,
        proposed_at,
        approved_at,
        expires_at,
        bump,
        approval_bitmap,
        cancellation_bitmap,
        rent_refund,
        policy_commitment,
        payload_hash,
        envelope_hash,
        action_id,
        nonce,
        policy_bytes,
        clear_text,
    })
}

impl IntentAccount {
    pub fn intent_type_name(&self) -> &str {
        match self.intent_type {
            0 => "AddIntent",
            1 => "RemoveIntent",
            2 => "UpdateIntent",
            3 => "Custom",
            _ => "Unknown",
        }
    }

    pub fn template(&self) -> &str {
        if self.template_len == 0 {
            return "";
        }
        let start = self.template_offset as usize;
        let end = start + self.template_len as usize;
        if end <= self.byte_pool.len() {
            std::str::from_utf8(&self.byte_pool[start..end]).unwrap_or("")
        } else {
            ""
        }
    }

    pub fn tx_template_hash(&self) -> [u8; 32] {
        let start = self.tx_template_offset as usize;
        let end = start.saturating_add(self.tx_template_len as usize);
        if end > self.byte_pool.len() {
            return [0u8; 32];
        }
        Sha256::digest(&self.byte_pool[start..end]).into()
    }

    pub fn policy_ciphertext_ids(&self) -> Vec<String> {
        decode_policy_ciphertexts(&self.policy_ciphertexts).unwrap_or_default()
    }
}

pub fn encode_policy_ciphertexts(ids: &[String]) -> Result<Vec<u8>> {
    let trimmed: Vec<&str> = ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect();
    if trimmed.len() > u16::MAX as usize {
        return Err(anyhow!("too many policy ciphertext identifiers"));
    }
    let mut out = Vec::new();
    out.extend_from_slice(&(trimmed.len() as u16).to_le_bytes());
    for trimmed in trimmed {
        let bytes = trimmed.as_bytes();
        if bytes.len() > u16::MAX as usize {
            return Err(anyhow!("policy ciphertext identifier too long"));
        }
        out.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(bytes);
    }
    if out.len() > 2048 {
        return Err(anyhow!(
            "policy ciphertext identifiers exceed on-chain limit: {} > 2048 bytes",
            out.len()
        ));
    }
    Ok(out)
}

pub fn decode_policy_ciphertexts(data: &[u8]) -> Result<Vec<String>> {
    if data.is_empty() {
        return Ok(Vec::new());
    }
    let mut offset = 0usize;
    let count = read_u16_le(data, &mut offset)? as usize;
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        let len = read_u16_le(data, &mut offset)? as usize;
        let bytes = data
            .get(offset..offset + len)
            .ok_or_else(|| anyhow!("truncated policy ciphertext identifier"))?;
        offset += len;
        ids.push(String::from_utf8_lossy(bytes).to_string());
    }
    Ok(ids)
}
