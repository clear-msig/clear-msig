use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ActionKind {
    Send = 1,
    BatchSend = 2,
    AddMember = 3,
    RemoveMember = 4,
    ChangeThreshold = 5,
    SetProtection = 6,
    ReleaseMilestone = 7,
    ReturnEscrowFunds = 8,
    AgentTradeApproval = 9,
    RecoveryAction = 10,
    SwapIntent = 11,
    AgentSessionGrant = 12,
    AgentRiskPolicy = 13,
    AgentTradeSettlement = 14,
    RecurringSchedule = 15,
}

impl ActionKind {
    pub fn from_code(value: u8) -> Result<Self, Error> {
        match value {
            1 => Ok(Self::Send),
            2 => Ok(Self::BatchSend),
            3 => Ok(Self::AddMember),
            4 => Ok(Self::RemoveMember),
            5 => Ok(Self::ChangeThreshold),
            6 => Ok(Self::SetProtection),
            7 => Ok(Self::ReleaseMilestone),
            8 => Ok(Self::ReturnEscrowFunds),
            9 => Ok(Self::AgentTradeApproval),
            10 => Ok(Self::RecoveryAction),
            11 => Ok(Self::SwapIntent),
            12 => Ok(Self::AgentSessionGrant),
            13 => Ok(Self::AgentRiskPolicy),
            14 => Ok(Self::AgentTradeSettlement),
            15 => Ok(Self::RecurringSchedule),
            _ => Err(Error::UnsupportedAction),
        }
    }

    pub const fn code(self) -> u8 {
        self as u8
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum DeviceProfile {
    Full = 1,
    LedgerSolana = 2,
}

impl DeviceProfile {
    pub(crate) fn from_code(value: u8) -> Result<Self, Error> {
        match value {
            1 => Ok(Self::Full),
            2 => Ok(Self::LedgerSolana),
            _ => Err(Error::UnknownDeviceProfile),
        }
    }

    pub const fn max_document_bytes(self) -> usize {
        match self {
            Self::Full => MAX_DOCUMENT_BYTES,
            Self::LedgerSolana => MAX_COMPACT_DOCUMENT_BYTES,
        }
    }

    pub const fn display_label(self) -> &'static [u8] {
        match self {
            Self::Full => b"clearsig-full-v2@1",
            Self::LedgerSolana => b"clearsig-ledger-solana-v2@1",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Network {
    SolanaDevnet = 1,
    EthereumSepolia = 2,
    BitcoinTestnet = 3,
    BitcoinSignet = 4,
    BitcoinTestnet4 = 5,
    ZcashTestnet = 6,
    HyperliquidTestnet = 7,
    EthereumSepoliaErc20 = 8,
}

impl Network {
    pub(crate) fn from_code(value: u8) -> Result<Self, Error> {
        match value {
            1 => Ok(Self::SolanaDevnet),
            2 => Ok(Self::EthereumSepolia),
            3 => Ok(Self::BitcoinTestnet),
            4 => Ok(Self::BitcoinSignet),
            5 => Ok(Self::BitcoinTestnet4),
            6 => Ok(Self::ZcashTestnet),
            7 => Ok(Self::HyperliquidTestnet),
            8 => Ok(Self::EthereumSepoliaErc20),
            _ => Err(Error::UnknownNetwork),
        }
    }

    pub const fn chain_kind(self) -> u8 {
        match self {
            Self::SolanaDevnet => 0,
            Self::EthereumSepolia => 1,
            Self::EthereumSepoliaErc20 => 4,
            Self::BitcoinTestnet | Self::BitcoinSignet | Self::BitcoinTestnet4 => 2,
            Self::ZcashTestnet => 3,
            Self::HyperliquidTestnet => 5,
        }
    }

    pub const fn display_name(self) -> &'static [u8] {
        match self {
            Self::SolanaDevnet => b"Solana Devnet",
            Self::EthereumSepolia | Self::EthereumSepoliaErc20 => b"Ethereum Sepolia",
            Self::BitcoinTestnet => b"Bitcoin Testnet",
            Self::BitcoinSignet => b"Bitcoin Signet",
            Self::BitcoinTestnet4 => b"Bitcoin Testnet4",
            Self::ZcashTestnet => b"Zcash Testnet",
            Self::HyperliquidTestnet => b"Hyperliquid Testnet",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum IdentityEncoding {
    Text = 1,
    SolanaPubkey = 2,
    Sha256Text = 3,
}

impl IdentityEncoding {
    pub(crate) fn from_code(value: u8) -> Result<Self, Error> {
        match value {
            1 => Ok(Self::Text),
            2 => Ok(Self::SolanaPubkey),
            3 => Ok(Self::Sha256Text),
            _ => Err(Error::InvalidEncoding),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    BufferTooSmall,
    InvalidMagic,
    UnsupportedVersion,
    UnsupportedAction,
    UnknownDeviceProfile,
    UnknownNetwork,
    InvalidEncoding,
    InvalidLength,
    InvalidText,
    InvalidAmount,
    InvalidContext,
    TrailingBytes,
    MessageTooLong,
}

#[derive(Clone, Copy)]
pub struct CommonFields {
    pub profile: DeviceProfile,
    pub network: Network,
    pub proposal_index: u64,
    pub wallet_id: [u8; 32],
    pub actor: [u8; 32],
    pub action_id: [u8; 32],
    pub nonce: [u8; 32],
    pub expires_at: i64,
    pub policy_commitment: [u8; 32],
    pub approval_required: u8,
}

#[derive(Clone, Copy)]
pub struct TransferInput<'a> {
    pub common: CommonFields,
    pub recipient_encoding: IdentityEncoding,
    pub recipient: &'a [u8],
    pub asset_encoding: IdentityEncoding,
    pub asset: &'a [u8],
    pub raw_amount: u128,
    pub decimals: u8,
    pub display_asset: &'a [u8],
    /// Hash of the immutable executable transaction template selected by the
    /// onchain intent. Local program-defined transfers use all zeroes.
    pub execution_commitment: [u8; 32],
    pub fiat_estimate: Option<FiatEstimateInput<'a>>,
    pub reason: &'a [u8],
}

#[derive(Clone, Copy)]
pub struct FiatEstimateInput<'a> {
    pub amount: &'a [u8],
    pub currency: &'a [u8],
    pub source: &'a [u8],
    pub observed_at: i64,
}

#[derive(Clone, Copy)]
pub struct TransferRowInput<'a> {
    pub recipient_encoding: IdentityEncoding,
    pub recipient: &'a [u8],
    pub asset_encoding: IdentityEncoding,
    pub asset: &'a [u8],
    pub raw_amount: u128,
    pub decimals: u8,
    pub display_asset: &'a [u8],
}

pub struct BatchTransferInput<'a> {
    pub common: CommonFields,
    pub rows: &'a [TransferRowInput<'a>],
    pub reason: &'a [u8],
}

pub struct EscrowReleaseInput<'a> {
    pub common: CommonFields,
    pub escrow_id: &'a [u8],
    pub escrow_title: &'a [u8],
    pub milestone_id: &'a [u8],
    pub milestone_title: &'a [u8],
    pub payment: TransferRowInput<'a>,
    pub execution_commitment: [u8; 32],
    pub reason: &'a [u8],
}

pub struct EscrowReturnInput<'a> {
    pub common: CommonFields,
    pub escrow_id: &'a [u8],
    pub escrow_title: &'a [u8],
    pub rows: &'a [TransferRowInput<'a>],
    pub execution_commitment: [u8; 32],
    pub reason: &'a [u8],
}

pub struct GovernanceInput<'a> {
    pub common: CommonFields,
    pub kind: ActionKind,
    pub target_intent_index: u8,
    pub approval_threshold: u8,
    pub cancellation_threshold: u8,
    pub timelock_seconds: u32,
    pub proposers: &'a [[u8; 32]],
    pub approvers: &'a [[u8; 32]],
    pub reason: &'a [u8],
}

#[derive(Clone, Copy)]
pub struct PolicyUpdateInput<'a> {
    pub common: CommonFields,
    pub chain_kind: u8,
    pub new_policy_commitment: [u8; 32],
    pub reason: &'a [u8],
}

pub struct AgentTradeApprovalInput<'a> {
    pub common: CommonFields,
    pub agent_id: &'a [u8],
    pub venue: &'a [u8],
    pub market: &'a [u8],
    pub side: &'a [u8],
    pub asset_id: &'a [u8],
    pub max_notional_raw: u128,
    pub max_leverage_x100: u32,
    pub session_id: &'a [u8],
    pub route: &'a [u8],
    pub risk_check_hash: [u8; 32],
    pub reason: &'a [u8],
}

pub struct AgentSessionInput<'a> {
    pub common: CommonFields,
    pub session_id: &'a [u8],
    pub agent_id: &'a [u8],
    pub venue: &'a [u8],
    pub market: &'a [u8],
    pub max_notional_raw: u128,
    pub max_leverage_x100: u32,
    pub session_expires_at: i64,
    pub status: u8,
    pub reason: &'a [u8],
}

pub struct AgentRiskPolicyInput<'a> {
    pub common: CommonFields,
    pub session_id: &'a [u8],
    pub oracle_policy_hash: [u8; 32],
    pub max_loss_raw: u128,
    pub status: u8,
    pub reason: &'a [u8],
}

pub struct AgentSettlementInput<'a> {
    pub common: CommonFields,
    pub session_id: &'a [u8],
    pub execution_id: &'a [u8],
    pub settlement_artifact_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub closed_notional_raw: u128,
    pub outcome: u8,
    pub pnl_abs_raw: u128,
    pub settlement_sequence: u64,
    pub reason: &'a [u8],
}

pub struct RecurringScheduleInput<'a> {
    pub common: CommonFields,
    pub schedule_id: &'a [u8],
    pub payment: TransferRowInput<'a>,
    /// Binds non-native execution accounts (for example SPL source and
    /// destination token accounts). Native SOL schedules must use zero.
    pub execution_commitment: [u8; 32],
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    /// 1 = active, 2 = revoked.
    pub status: u8,
    pub reason: &'a [u8],
}

#[derive(Clone, Copy)]
pub struct EnvelopeFields<'a> {
    pub kind: ActionKind,
    pub network: Network,
    pub proposal_index: u64,
    pub wallet_name: &'a [u8],
    pub wallet_id: &'a [u8; 32],
    pub actor: &'a [u8; 32],
    pub action_id: &'a [u8; 32],
    pub nonce: &'a [u8; 32],
    pub expires_at: i64,
    pub approval_required: u8,
    pub policy_commitment: &'a [u8; 32],
    pub payload_hash: &'a [u8; 32],
    pub clear_text_hash: &'a [u8; 32],
}

#[derive(Clone, Copy)]
pub struct CanonicalIntent<'a> {
    pub common: CommonFields,
    pub action: Action<'a>,
    pub reason: &'a [u8],
    pub(crate) encoded: &'a [u8],
}

#[derive(Clone, Copy)]
pub enum Action<'a> {
    Transfer(Transfer<'a>),
    BatchTransfer(BatchTransfer<'a>),
    Governance(Governance<'a>),
    PolicyUpdate(PolicyUpdate),
    EscrowRelease(EscrowRelease<'a>),
    EscrowReturn(EscrowReturn<'a>),
    AgentTradeApproval(AgentTradeApproval<'a>),
    AgentSession(AgentSession<'a>),
    AgentRiskPolicy(AgentRiskPolicy<'a>),
    AgentSettlement(AgentSettlement<'a>),
    RecurringSchedule(RecurringSchedule<'a>),
}

#[derive(Clone, Copy)]
pub struct Transfer<'a> {
    pub recipient_encoding: IdentityEncoding,
    pub recipient: &'a [u8],
    pub asset_encoding: IdentityEncoding,
    pub asset: &'a [u8],
    pub raw_amount: u128,
    pub decimals: u8,
    pub display_asset: &'a [u8],
    pub execution_commitment: [u8; 32],
    pub(crate) encoded_fiat_estimate: &'a [u8],
}

#[derive(Clone, Copy)]
pub struct FiatEstimate<'a> {
    pub amount: &'a [u8],
    pub currency: &'a [u8],
    pub source: &'a [u8],
    pub observed_at: i64,
}

#[derive(Clone, Copy)]
pub struct BatchTransfer<'a> {
    pub(crate) encoded_rows: &'a [u8],
    pub row_count: u8,
}

#[derive(Clone, Copy)]
pub struct Governance<'a> {
    pub kind: ActionKind,
    pub target_intent_index: u8,
    pub approval_threshold: u8,
    pub cancellation_threshold: u8,
    pub timelock_seconds: u32,
    pub proposers: &'a [u8],
    pub proposer_count: u8,
    pub approvers: &'a [u8],
    pub approver_count: u8,
}

#[derive(Clone, Copy)]
pub struct PolicyUpdate {
    pub chain_kind: u8,
    pub new_policy_commitment: [u8; 32],
}

#[derive(Clone, Copy)]
pub struct EscrowRelease<'a> {
    pub escrow_id: &'a [u8],
    pub escrow_title: &'a [u8],
    pub milestone_id: &'a [u8],
    pub milestone_title: &'a [u8],
    pub payment: Transfer<'a>,
    pub execution_commitment: [u8; 32],
}

#[derive(Clone, Copy)]
pub struct EscrowReturn<'a> {
    pub escrow_id: &'a [u8],
    pub escrow_title: &'a [u8],
    pub(crate) encoded_rows: &'a [u8],
    pub row_count: u8,
    pub execution_commitment: [u8; 32],
}

#[derive(Clone, Copy)]
pub struct AgentTradeApproval<'a> {
    pub agent_id: &'a [u8],
    pub venue: &'a [u8],
    pub market: &'a [u8],
    pub side: &'a [u8],
    pub asset_id: &'a [u8],
    pub max_notional_raw: u128,
    pub max_leverage_x100: u32,
    pub session_id: &'a [u8],
    pub route: &'a [u8],
    pub risk_check_hash: [u8; 32],
}

#[derive(Clone, Copy)]
pub struct AgentSession<'a> {
    pub session_id: &'a [u8],
    pub agent_id: &'a [u8],
    pub venue: &'a [u8],
    pub market: &'a [u8],
    pub max_notional_raw: u128,
    pub max_leverage_x100: u32,
    pub session_expires_at: i64,
    pub status: u8,
}

#[derive(Clone, Copy)]
pub struct AgentRiskPolicy<'a> {
    pub session_id: &'a [u8],
    pub oracle_policy_hash: [u8; 32],
    pub max_loss_raw: u128,
    pub status: u8,
}

#[derive(Clone, Copy)]
pub struct AgentSettlement<'a> {
    pub session_id: &'a [u8],
    pub execution_id: &'a [u8],
    pub settlement_artifact_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub closed_notional_raw: u128,
    pub outcome: u8,
    pub pnl_abs_raw: u128,
    pub settlement_sequence: u64,
}

#[derive(Clone, Copy)]
pub struct RecurringSchedule<'a> {
    pub schedule_id: &'a [u8],
    pub payment: Transfer<'a>,
    pub execution_commitment: [u8; 32],
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    pub status: u8,
}
