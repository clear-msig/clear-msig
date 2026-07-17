//! Ika dWallet integration helpers used by `wallet add-chain` and the
//! chain-aware `proposal execute`.
//!
//! This module hides the gRPC roundtrip, the dWallet program PDA derivations,
//! and the BCS request shaping. gRPC uses the caller's Tokio runtime and
//! execution-cancellation signal; standalone CLI calls create a localized
//! runtime only as a fallback.

use crate::config::RuntimeConfig;
use crate::error::*;
use crate::rpc;
use ika_dwallet_types::*;
use ika_grpc::d_wallet_service_client::DWalletServiceClient;
use ika_grpc::UserSignedRequest;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer as _;
use std::time::{Duration, Instant};

pub struct IkaSubmitRequest {
    pub user_signature: Vec<u8>,
    pub signed_request_data: Vec<u8>,
}

pub trait IkaGrpcPort: Send + Sync {
    fn submit(
        &self,
        grpc_url: &str,
        request: IkaSubmitRequest,
        control: crate::ExecutionControl,
    ) -> Result<Vec<u8>>;
}

#[derive(Default)]
pub struct LiveIkaGrpcPort;

impl LiveIkaGrpcPort {
    fn run<T>(
        &self,
        control: crate::ExecutionControl,
        operation: impl std::future::Future<Output = Result<T>>,
    ) -> Result<T> {
        let controlled = async move {
            tokio::select! {
                result = operation => result,
                _ = control.cancelled() => Err(anyhow!("Ika gRPC request cancelled")),
            }
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.block_on(controlled)
        } else {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .with_context(|| "tokio runtime build failed")?
                .block_on(controlled)
        }
    }
}

impl IkaGrpcPort for LiveIkaGrpcPort {
    fn submit(
        &self,
        grpc_url: &str,
        request: IkaSubmitRequest,
        control: crate::ExecutionControl,
    ) -> Result<Vec<u8>> {
        let request = UserSignedRequest {
            user_signature: request.user_signature,
            signed_request_data: request.signed_request_data,
        };
        if std::env::var("CLEAR_MSIG_DEBUG_GRPC").is_ok() {
            use prost::Message;
            let mut buf = Vec::new();
            request.encode(&mut buf).unwrap();
            let mut framed = Vec::with_capacity(5 + buf.len());
            framed.push(0u8);
            framed.extend_from_slice(&(buf.len() as u32).to_be_bytes());
            framed.extend_from_slice(&buf);
            let path = "/tmp/clear-msig-grpc-request.bin";
            std::fs::write(path, &framed).ok();
            crate::progress!(
                "[DEBUG] dumped {} bytes of gRPC body to {path}",
                framed.len()
            );
        }
        let grpc_url = grpc_url.to_string();
        let operation = async move {
            let mut client = if grpc_url.starts_with("https") {
                let tls = tonic::transport::ClientTlsConfig::new().with_native_roots();
                let channel = tonic::transport::Channel::from_shared(grpc_url.to_string())
                    .with_context(|| "invalid gRPC URL")?
                    .tls_config(tls)
                    .with_context(|| "TLS config failed")?
                    .connect()
                    .await
                    .with_context(|| format!("failed to connect to gRPC at {grpc_url}"))?;
                DWalletServiceClient::new(channel)
            } else {
                DWalletServiceClient::connect(grpc_url.to_string())
                    .await
                    .with_context(|| format!("failed to connect to gRPC at {grpc_url}"))?
            };
            let response = client
                .submit_transaction(request)
                .await
                .with_context(|| "gRPC submit_transaction failed")?;
            Ok(response.into_inner().response_data)
        };
        self.run(control, operation)
    }
}

/// Default Ika pre-alpha gRPC endpoint.
pub const DEFAULT_GRPC_URL: &str = "https://pre-alpha-dev-1.ika.ika-network.net:443";

// ── dWallet program constants (mirror upstream e2e examples) ──

pub const SEED_DWALLET_COORDINATOR: &[u8] = b"dwallet_coordinator";
pub const SEED_DWALLET: &[u8] = b"dwallet";
pub const SEED_MESSAGE_APPROVAL: &[u8] = b"message_approval";
pub const SEED_CPI_AUTHORITY: &[u8] = b"__ika_cpi_authority";

pub const DISC_COORDINATOR: u8 = 1;
pub const DISC_MESSAGE_APPROVAL: u8 = 14;

pub const COORDINATOR_LEN: usize = 116;

// MessageApproval layout offsets (updated for new pre-alpha).
pub const MA_STATUS: usize = 172;
pub const MA_STATUS_SIGNED: u8 = 1;
pub const MA_SIGNATURE_LEN: usize = 173;
pub const MA_SIGNATURE: usize = 175;

// Curve discriminants — match `DWalletCurve` repr in `ika-dwallet-types`.
pub const CURVE_SECP256K1: u16 = 0;
pub const CURVE_SECP256R1: u16 = 1;
pub const CURVE_CURVE25519: u16 = 2;

/// Map a `DWalletCurve` to its on-chain u16 discriminant (used in dWallet
/// PDA derivation `["dwallet", chunks(curve_u16_le || pubkey)]`).
pub fn curve_u16(curve: DWalletCurve) -> u16 {
    match curve {
        DWalletCurve::Secp256k1 => CURVE_SECP256K1,
        DWalletCurve::Secp256r1 => CURVE_SECP256R1,
        DWalletCurve::Curve25519 => CURVE_CURVE25519,
        DWalletCurve::Ristretto => 3,
    }
}

// ── PDA helpers ──

/// Program-wide CPI authority PDA — `[SEED_CPI_AUTHORITY]`.
pub fn cpi_authority_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_CPI_AUTHORITY], program_id)
}

/// Per-dWallet ownership lock PDA — `["dwallet_owner", dwallet]`.
pub fn dwallet_ownership_pda(program_id: &Pubkey, dwallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"dwallet_owner", dwallet.as_ref()], program_id)
}

/// Derive a dWallet PDA from `(curve, public_key)`.
///
/// Mirrors the upstream `DWalletPdaSeeds::new`: concatenates `curve_u16_le ||
/// public_key` into a single buffer and splits it into 32-byte chunks
/// (Solana's `MAX_SEED_LEN`), passing each chunk as its own PDA seed.
pub fn dwallet_pda(dwallet_program: &Pubkey, curve: u16, public_key: &[u8]) -> (Pubkey, u8) {
    let payload = pack_dwallet_seed_payload(curve, public_key);
    let mut seeds: Vec<&[u8]> = Vec::with_capacity(4);
    seeds.push(SEED_DWALLET);
    for chunk in payload.chunks(32) {
        seeds.push(chunk);
    }
    Pubkey::find_program_address(&seeds, dwallet_program)
}

/// Pack `curve_u16_le || public_key` for PDA seed chunking.
fn pack_dwallet_seed_payload(curve: u16, public_key: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(2 + public_key.len());
    buf.extend_from_slice(&curve.to_le_bytes());
    buf.extend_from_slice(public_key);
    buf
}

/// MessageApproval PDA — hierarchical seeds under the dWallet:
/// `["dwallet", chunks(curve_u16_le || pk), "message_approval", &scheme_u16_le, &message_digest, [&metadata_digest]]`
pub fn message_approval_pda(
    dwallet_program: &Pubkey,
    curve: u16,
    public_key: &[u8],
    signature_scheme: u16,
    message_digest: &[u8; 32],
    message_metadata_digest: &[u8; 32],
) -> (Pubkey, u8) {
    let payload = pack_dwallet_seed_payload(curve, public_key);
    let scheme_bytes = signature_scheme.to_le_bytes();
    let mut seeds: Vec<&[u8]> = Vec::with_capacity(7);
    seeds.push(b"dwallet");
    for chunk in payload.chunks(32) {
        seeds.push(chunk);
    }
    seeds.push(SEED_MESSAGE_APPROVAL);
    seeds.push(&scheme_bytes);
    seeds.push(message_digest);
    if *message_metadata_digest != [0u8; 32] {
        seeds.push(message_metadata_digest);
    }
    Pubkey::find_program_address(&seeds, dwallet_program)
}

/// DWalletCoordinator PDA.
pub fn coordinator_pda(dwallet_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_DWALLET_COORDINATOR], dwallet_program)
}

/// `["ika_config", wallet, &[chain_kind]]` under clear-wallet's program.
pub fn ika_config_pda(
    clear_wallet_program: &Pubkey,
    wallet: &Pubkey,
    chain_kind: u8,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"ika_config", wallet.as_ref(), &[chain_kind]],
        clear_wallet_program,
    )
}

// ── Attestation persistence ──

/// Directory for storing DKG attestations.
///
/// On Fly the container fs is ephemeral — without an explicit
/// override every redeploy wipes the attestations and any wallet
/// whose chain bindings rely on them is bricked off-chain. Set
/// `CLEAR_MSIG_ATTESTATION_DIR` (e.g. to `/data/attestations` over
/// a mounted volume) to persist across deploys. Local dev keeps
/// the original `~/.config/clear-msig/attestations` default.
fn attestation_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("CLEAR_MSIG_ATTESTATION_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return std::path::PathBuf::from(trimmed);
        }
    }
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".config/clear-msig/attestations")
}

/// Save a DKG attestation to disk keyed by `(wallet, chain_kind)`.
///
/// Each `wallet add-chain` runs DKG and produces a fresh dWallet with
/// its own pubkey. Storing all per-chain attestations under one
/// `<wallet>.json` file (the previous behavior) caused later
/// addChains to silently OVERWRITE earlier ones — so on a wallet
/// with both BTC and ETH bound, whichever was added LAST is what
/// `load_attestation` would return for both chains' sends. The
/// non-current chain's `proposal execute` would then hand Ika's
/// gRPC the wrong dWallet pubkey, and Ika would fail to find the
/// MessageApproval PDA (it derives the seed from the pubkey in
/// the attestation, which doesn't match what the on-chain
/// `ika_sign` instruction wrote against the correct chain's
/// dWallet pubkey).
///
/// We now save to `<wallet>__c<chain_kind>.json`. Old wallets that
/// still have a single `<wallet>.json` file work via the legacy
/// fallback in `load_attestation` below — but the moment any chain
/// is re-bound under the new code, that chain gets a chain-specific
/// file and is no longer affected by the overwrite bug.
///
/// We also continue writing the legacy `<wallet>.json` path so a
/// brief downgrade to the old CLI binary doesn't lose access; the
/// content there will be the most recently bound chain's
/// attestation, same as the old behavior.
pub fn save_attestation(
    wallet_name: &str,
    chain_kind: u8,
    attestation: &NetworkSignedAttestation,
) -> Result<()> {
    let dir = attestation_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::json!({
        "attestation_data": hex_encode_bytes(&attestation.attestation_data),
        "network_signature": hex_encode_bytes(&attestation.network_signature),
        "network_pubkey": hex_encode_bytes(&attestation.network_pubkey),
        "epoch": attestation.epoch,
    });
    let payload = serde_json::to_string_pretty(&json)?;

    let chain_path = dir.join(format!("{wallet_name}__c{chain_kind}.json"));
    std::fs::write(&chain_path, &payload)?;

    let legacy_path = dir.join(format!("{wallet_name}.json"));
    std::fs::write(&legacy_path, &payload)?;
    Ok(())
}

/// Load a previously saved DKG attestation for `(wallet, chain_kind)`.
/// Tries the chain-specific path first; falls back to the legacy
/// `<wallet>.json` for wallets bound before the per-chain split.
///
/// The fallback is "best effort" — if the legacy file holds a
/// different chain's attestation (the historical overwrite bug),
/// the gRPC sign will still fail with "MessageApproval PDA not
/// found". In that case the user has to re-bind the chain (which
/// writes a fresh chain-specific file under the new code) or
/// create a new wallet.
pub fn load_attestation(wallet_name: &str, chain_kind: u8) -> Result<NetworkSignedAttestation> {
    let dir = attestation_dir();
    let chain_path = dir.join(format!("{wallet_name}__c{chain_kind}.json"));
    let legacy_path = dir.join(format!("{wallet_name}.json"));

    let (path, used_legacy) = if chain_path.exists() {
        (chain_path, false)
    } else if legacy_path.exists() {
        (legacy_path, true)
    } else {
        return Err(anyhow!(
            "no saved attestation for wallet '{wallet_name}' chain_kind={chain_kind} \
             at {} (also checked legacy {}); re-run `wallet add-chain` to generate one",
            dir.join(format!("{wallet_name}__c{chain_kind}.json"))
                .display(),
            dir.join(format!("{wallet_name}.json")).display(),
        ));
    };

    if used_legacy {
        crate::progress!(
            "⚠ [attestation] using legacy {wallet_name}.json (no per-chain file \
             yet for chain_kind={chain_kind}). If this fails, the legacy file \
             holds another chain's attestation — re-bind chain_kind={chain_kind} \
             to write a chain-specific file."
        );
    }

    let data = std::fs::read_to_string(&path)
        .with_context(|| format!("reading attestation at {}", path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&data)?;
    Ok(NetworkSignedAttestation {
        attestation_data: hex_decode_field(&json, "attestation_data")?,
        network_signature: hex_decode_field(&json, "network_signature")?,
        network_pubkey: hex_decode_field(&json, "network_pubkey")?,
        epoch: json["epoch"].as_u64().unwrap_or(1),
    })
}

/// Load an attestation from chain state when no local file exists.
///
/// This recovers old Fly-era wallets after infrastructure migrations without manual file copy:
/// the DKG attestation lives in the `DWalletAttestation` PDA, while the
/// `network_pubkey` and `epoch` come from the dWallet account.
pub fn load_attestation_from_chain(
    client: &crate::rpc::Client,
    dwallet_program: &Pubkey,
    dwallet: &Pubkey,
) -> Result<NetworkSignedAttestation> {
    let dwallet_data = rpc::fetch_account(client, dwallet)
        .with_context(|| format!("fetching dWallet account {dwallet}"))?;
    let dwallet_account = crate::accounts::parse_dwallet(&dwallet_data)?;
    let curve = dwallet_account.curve;
    let public_key = dwallet_account.public_key.clone();

    // Re-derive with the chunked seed layout used by the upstream PDA.
    let mut seeds: Vec<&[u8]> = Vec::new();
    let payload = pack_dwallet_seed_payload(curve, &public_key);
    seeds.push(SEED_DWALLET);
    for chunk in payload.chunks(32) {
        seeds.push(chunk);
    }
    seeds.push(b"attestation");
    let (attestation_pk, _) = Pubkey::find_program_address(&seeds, dwallet_program);

    let attestation_data = rpc::fetch_account(client, &attestation_pk)
        .with_context(|| format!("fetching attestation account {attestation_pk}"))?;
    if attestation_data.len() < 67 || attestation_data[0] != 15 {
        return Err(anyhow!(
            "not a DWalletAttestation account (discriminator={})",
            attestation_data.first().unwrap_or(&0)
        ));
    }
    let network_signature = attestation_data[2..66].to_vec();
    let attestation_data = attestation_data[67..].to_vec();

    Ok(NetworkSignedAttestation {
        attestation_data,
        network_signature,
        network_pubkey: dwallet_account
            .noa_public_key
            .parse::<Pubkey>()
            .with_context(|| "parsing dWallet noa public key")?
            .to_bytes()
            .to_vec(),
        epoch: dwallet_account.created_epoch,
    })
}

fn hex_encode_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_decode_field(json: &serde_json::Value, field: &str) -> Result<Vec<u8>> {
    let s = json[field].as_str().unwrap_or("");
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| anyhow!("{e}")))
        .collect()
}

// ── Setup probes ──

/// Wait for the dWallet program's coordinator PDA to be initialized.
pub fn wait_for_coordinator(
    client: &crate::rpc::Client,
    dwallet_program: &Pubkey,
    timeout: Duration,
) -> Result<()> {
    let (coord, _) = coordinator_pda(dwallet_program);
    poll_until(
        client,
        &coord,
        |d| d.len() >= COORDINATOR_LEN && d[0] == DISC_COORDINATOR,
        timeout,
    )?;
    Ok(())
}

// ── gRPC dance ──

/// DKG result — carries both the dWallet address and the attestation needed
/// for later Sign requests.
pub struct DkgResult {
    pub dwallet_addr: [u8; 32],
    pub public_key: Vec<u8>,
    pub attestation: NetworkSignedAttestation,
}

/// Run a DKG via Ika gRPC. Returns the full DKG result including the
/// attestation needed by subsequent Sign calls.
///
/// `session_preimage` is the 32-byte value Ika uses to derive the new
/// dWallet's session identifier — caller must make it unique per
/// binding (e.g. `sha256(payer || wallet || chain_kind || curve)`),
/// because every DKG call with the same preimage produces the same
/// session_identifier and the Ika mock signer overwrites the previous
/// mapping under that identifier. Passing a per-binding hash here is
/// what keeps cross-binding sign requests from returning signatures
/// over the wrong dWallet's key.
pub fn dkg(
    config: &RuntimeConfig,
    grpc_url: &str,
    curve: DWalletCurve,
    session_preimage: [u8; 32],
) -> Result<DkgResult> {
    let payer_pubkey = config.payer.pubkey();
    let request = SignedRequestData {
        session_identifier_preimage: session_preimage,
        epoch: 1,
        chain_id: ChainId::Solana,
        intended_chain_sender: payer_pubkey.to_bytes().to_vec(),
        request: DWalletRequest::DKG {
            dwallet_network_encryption_public_key: vec![0u8; 32],
            curve,
            centralized_public_key_share_and_proof: vec![0u8; 32],
            user_secret_key_share: UserSecretKeyShare::Encrypted {
                encrypted_centralized_secret_share_and_proof: vec![0u8; 32],
                encryption_key: vec![0u8; 32],
                signer_public_key: payer_pubkey.to_bytes().to_vec(),
            },
            user_public_output: vec![0u8; 32],
            sign_during_dkg_request: None,
        },
    };

    let response = grpc_call(
        config,
        grpc_url,
        build_signed_request(&payer_pubkey, request),
    )?;
    match response {
        TransactionResponseData::Attestation(attestation) => {
            let versioned: VersionedDWalletDataAttestation =
                bcs::from_bytes(&attestation.attestation_data)
                    .with_context(|| "failed to decode DKG attestation")?;
            let VersionedDWalletDataAttestation::V1(data) = versioned;
            Ok(DkgResult {
                dwallet_addr: data.session_identifier,
                public_key: data.public_key,
                attestation,
            })
        }
        TransactionResponseData::Error { message } => Err(anyhow!("gRPC DKG failed: {message}")),
        other => Err(anyhow!("unexpected DKG response: {other:?}")),
    }
}

/// Allocate a presign for the given dWallet via Ika gRPC.
/// Returns `(presign_session_identifier, presign_data)`.
pub fn presign(
    config: &RuntimeConfig,
    grpc_url: &str,
    dwallet_addr: [u8; 32],
    curve: DWalletCurve,
    algo: DWalletSignatureAlgorithm,
) -> Result<Vec<u8>> {
    let payer_pubkey = config.payer.pubkey();
    let request = SignedRequestData {
        session_identifier_preimage: dwallet_addr,
        epoch: 1,
        chain_id: ChainId::Solana,
        intended_chain_sender: payer_pubkey.to_bytes().to_vec(),
        request: DWalletRequest::Presign {
            dwallet_network_encryption_public_key: vec![0u8; 32],
            curve,
            signature_algorithm: algo,
        },
    };

    let response = grpc_call(
        config,
        grpc_url,
        build_signed_request(&payer_pubkey, request),
    )?;
    match response {
        TransactionResponseData::Attestation(att) => {
            let versioned: VersionedPresignDataAttestation = bcs::from_bytes(&att.attestation_data)
                .with_context(|| "failed to decode presign attestation")?;
            let VersionedPresignDataAttestation::V1(data) = versioned;
            Ok(data.presign_session_identifier)
        }
        TransactionResponseData::Error { message } => {
            Err(anyhow!("gRPC presign failed: {message}"))
        }
        other => Err(anyhow!("unexpected presign response: {other:?}")),
    }
}

/// Send a Sign request to Ika gRPC. Returns the produced signature bytes.
#[allow(clippy::too_many_arguments)]
pub fn sign(
    config: &RuntimeConfig,
    grpc_url: &str,
    dwallet_addr: [u8; 32],
    dwallet_attestation: NetworkSignedAttestation,
    presign_session_identifier: Vec<u8>,
    message: Vec<u8>,
    message_metadata: Vec<u8>,
    quorum_tx_signature: Vec<u8>,
) -> Result<Vec<u8>> {
    let payer_pubkey = config.payer.pubkey();
    let request = SignedRequestData {
        session_identifier_preimage: dwallet_addr,
        epoch: 1,
        chain_id: ChainId::Solana,
        intended_chain_sender: payer_pubkey.to_bytes().to_vec(),
        request: DWalletRequest::Sign {
            message,
            message_metadata,
            presign_session_identifier,
            message_centralized_signature: vec![0u8; 64],
            dwallet_attestation,
            approval_proof: ApprovalProof::Solana {
                transaction_signature: quorum_tx_signature,
                slot: 0,
            },
        },
    };

    let response = grpc_call(
        config,
        grpc_url,
        build_signed_request(&payer_pubkey, request),
    )?;
    match response {
        TransactionResponseData::Signature { signature } => Ok(signature),
        TransactionResponseData::Error { message } => Err(anyhow!("gRPC sign failed: {message}")),
        other => Err(anyhow!("unexpected sign response: {other:?}")),
    }
}

// ── Plumbing ──

fn build_signed_request(payer: &Pubkey, request: SignedRequestData) -> IkaSubmitRequest {
    let signed_data = bcs::to_bytes(&request).expect("BCS serialize");
    let user_sig = UserSignature::Ed25519 {
        signature: vec![0u8; 64],
        public_key: payer.to_bytes().to_vec(),
    };
    IkaSubmitRequest {
        user_signature: bcs::to_bytes(&user_sig).expect("BCS serialize sig"),
        signed_request_data: signed_data,
    }
}

/// Run a cancellable gRPC submit_transaction call against the Ika service.
fn grpc_call(
    config: &RuntimeConfig,
    grpc_url: &str,
    request: IkaSubmitRequest,
) -> Result<TransactionResponseData> {
    let response_data = config
        .ika_grpc_port
        .submit(grpc_url, request, config.control.clone())?;
    decode_grpc_response(&response_data)
}

fn decode_grpc_response(response_data: &[u8]) -> Result<TransactionResponseData> {
    bcs::from_bytes(response_data).with_context(|| "BCS deserialize response")
}

#[cfg(test)]
mod grpc_port_tests {
    use super::{decode_grpc_response, LiveIkaGrpcPort};

    #[test]
    fn cancellation_drops_pending_ika_io() {
        let control = crate::ExecutionControl::default();
        control.cancel();
        let result = LiveIkaGrpcPort.run(control, std::future::pending::<anyhow::Result<()>>());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }

    #[test]
    fn malformed_ika_response_is_rejected_at_the_port_boundary() {
        assert!(decode_grpc_response(&[0xff, 0x00]).is_err());
    }
}

// ── On-chain polling ──

/// Block until `account` exists and `check(data)` returns true, or `timeout`.
pub fn poll_until(
    client: &crate::rpc::Client,
    account: &Pubkey,
    check: impl Fn(&[u8]) -> bool,
    timeout: Duration,
) -> Result<Vec<u8>> {
    let start = Instant::now();
    loop {
        if start.elapsed() > timeout {
            return Err(anyhow!("timeout waiting for account {account}"));
        }
        if let Some(data) = rpc::fetch_account_optional(client, account)? {
            if check(&data) {
                return Ok(data);
            }
        }
        client.wait(Duration::from_millis(500))?;
    }
}

mod preimage;
pub use preimage::*;
