pub const IX_TRANSFER_OWNERSHIP: u8 = 24;

pub const DISC_COORDINATOR: u8 = 1;
pub const DISC_NEK: u8 = 3;
pub const DISC_MESSAGE_APPROVAL: u8 = 14;

pub const COORDINATOR_LEN: usize = 116;
pub const NEK_LEN: usize = 164;

pub const MA_STATUS: usize = 139;
pub const MA_STATUS_SIGNED: u8 = 1;
pub const MA_SIGNATURE_LEN: usize = 140;
pub const MA_SIGNATURE: usize = 142;

pub const SEED_DWALLET_COORDINATOR: &[u8] = b"dwallet_coordinator";
pub const SEED_DWALLET: &[u8] = b"dwallet";
pub const SEED_MESSAGE_APPROVAL: &[u8] = b"message_approval";
pub const SEED_CPI_AUTHORITY: &[u8] = b"__ika_cpi_authority";
pub const SEED_DWALLET_OWNERSHIP: &[u8] = b"dwallet_owner";

// Pre-alpha mock signer only handles Curve25519 + EdDSA. We still drive the
// EVM RLP code path, but the resulting signature is Ed25519, not real ECDSA.
pub const CURVE_CURVE25519: u8 = 2;

pub const INTENT_TYPE_CUSTOM: u8 = 3;
pub const CHAIN_KIND_EVM: u8 = 1;
pub const DEFAULT_EXPIRY: i64 = 1_900_000_000;
