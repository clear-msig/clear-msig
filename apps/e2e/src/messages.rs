use ed25519_dalek::Signer as DalekSigner;

const OFFCHAIN_DOMAIN: &[u8] = b"\xffsolana offchain";

pub fn sign_dalek(key: &ed25519_dalek::SigningKey, body: &[u8]) -> [u8; 64] {
    key.sign(&wrap_offchain(body)).to_bytes()
}

pub fn hex_lower(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn add_intent_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    body: &[u8],
) -> Vec<u8> {
    format!(
        "expires {}: {action} add intent definition_hash: {} | wallet: {wallet_name} proposal: {proposal_index}",
        format_timestamp(expiry),
        hex_lower(&sha256_hash(body)),
    ).into_bytes()
}

pub fn custom_evm_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    nonce: u64,
    to: &[u8; 20],
    value: u64,
) -> Vec<u8> {
    format!(
        "expires {}: {action} send {value} wei to 0x{} (nonce {nonce}) | wallet: {wallet_name} proposal: {proposal_index}",
        format_timestamp(expiry),
        hex_lower(to),
    ).into_bytes()
}

fn wrap_offchain(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(20 + body.len());
    out.extend_from_slice(OFFCHAIN_DOMAIN);
    out.push(0);
    out.push(0);
    out.extend_from_slice(&(body.len() as u16).to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn sha256_hash(data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}

fn format_timestamp(ts: i64) -> String {
    // Yyyy-mm-dd HH:MM:SS. Matches on-chain `format_timestamp`.
    let secs_per_day: i64 = 86400;
    let mut days = ts / secs_per_day;
    let day_secs = ((ts % secs_per_day) + secs_per_day) % secs_per_day;
    if ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let (hour, min, sec) = (day_secs / 3600, (day_secs % 3600) / 60, day_secs % 60);
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}")
}
