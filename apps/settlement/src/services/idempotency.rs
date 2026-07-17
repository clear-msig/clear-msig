use sha2::{Digest, Sha256};

pub fn hash_request_payload<T: serde::Serialize>(payload: &T) -> anyhow::Result<String> {
    let bytes = serde_json::to_vec(payload)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn ensure_non_empty_idempotency(value: Option<&str>) -> anyhow::Result<String> {
    let normalized = value.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        anyhow::bail!("Idempotency-Key header is required");
    }
    Ok(normalized)
}
