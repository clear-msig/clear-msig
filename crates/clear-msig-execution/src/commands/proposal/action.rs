use clap::Subcommand;

#[derive(Subcommand)]
pub enum ProposalAction {
    /// Create a new proposal for a custom intent
    Create {
        #[arg(long)]
        wallet: String,
        /// Intent index to propose against
        #[arg(long)]
        intent_index: u8,
        /// Parameters as key=value pairs
        #[arg(long = "param")]
        params: Vec<String>,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Create a ClearSign typed proposal
    TypedCreate {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        intent_index: u8,
        #[arg(long)]
        action_kind: u8,
        #[arg(long)]
        policy_commitment: String,
        #[arg(long)]
        payload_hash: String,
        #[arg(long)]
        envelope_hash: String,
        #[arg(long)]
        action_id: String,
        #[arg(long)]
        nonce: String,
        #[arg(long)]
        policy_bytes_hex: Option<String>,
        /// Human-readable ClearSign document derived from the canonical v4 intent.
        ///
        /// Required for dry-run and local signing. Browser pre-signed submits
        /// pass the exact signed readable vote bytes via global --signed-message.
        #[arg(long)]
        signable_text: Option<String>,
        /// Canonical ClearSign v4 intent bytes. When present, payload hash,
        /// readable text, and envelope are derived and legacy inputs are only
        /// accepted as matching assertions.
        #[arg(long)]
        canonical_intent_hex: Option<String>,
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Approve a ClearSign typed proposal
    TypedApprove {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Cancel a ClearSign typed proposal
    TypedCancel {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Mark an approved ClearSign typed proposal executed
    TypedExecute {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Execute an approved typed wallet policy update.
    TypedWalletPolicyUpdate {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// New typed policy bytes as hex. Must match the approved SetProtection payload.
        #[arg(long)]
        policy_bytes_hex: String,
        /// Chain kind whose active policy should be replaced (0 SOL, 1 EVM, 2 BTC, 3 ZEC, 4 ERC-20, 5 HyperEVM).
        #[arg(long, default_value_t = 0)]
        chain_kind: u8,
    },
    /// Execute an approved typed membership / threshold / timelock update.
    TypedIntentGovernance {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// ClearSign action kind: 3=add_member, 4=remove_member, 5=change_threshold.
        #[arg(long)]
        action_kind: Option<u8>,
        /// Intent index being rewritten (Custom spend intent, not the meta UpdateIntent).
        #[arg(long)]
        target_index: Option<u8>,
        /// New intent body as hex (no discriminator). Preferred when the browser
        /// already built the body via prepare.updateIntent.
        #[arg(long)]
        new_intent_body_hex: Option<String>,
        /// Template file used when building the body server-side.
        #[arg(long)]
        file: Option<String>,
        #[arg(long, value_delimiter = ',')]
        proposers: Option<Vec<String>>,
        #[arg(long, value_delimiter = ',')]
        approvers: Option<Vec<String>>,
        #[arg(long)]
        threshold: Option<u8>,
        #[arg(long, default_value_t = 1)]
        cancellation_threshold: u8,
        #[arg(long, default_value_t = 0)]
        timelock: u32,
    },
    /// Execute an approved typed escrow milestone release.
    TypedEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        recipient: String,
        #[arg(long)]
        amount_lamports: u64,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
    },
    /// Execute an approved typed SPL-token escrow milestone release.
    TypedSplEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        mint: String,
        #[arg(long)]
        source_token: String,
        #[arg(long)]
        destination_token: String,
        #[arg(long)]
        recipient_owner: String,
        #[arg(long)]
        amount_tokens: u64,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
    },
    /// Execute an approved typed SPL-token escrow unwind / return.
    ///
    /// Pass one `--return destination_token:funder_owner:tokens` per funder.
    TypedSplEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        mint: String,
        #[arg(long)]
        source_token: String,
        #[arg(long)]
        escrow_id: String,
        #[arg(long = "return")]
        returns: Vec<String>,
    },
    /// Finalize an approved typed cross-chain escrow milestone release.
    TypedCrossChainEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed cross-chain escrow unwind / return.
    TypedCrossChainEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        refund_recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed encrypted/private escrow milestone release.
    TypedPrivateEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        private_evaluation_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed encrypted/private escrow unwind / return.
    TypedPrivateEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        refund_recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        private_evaluation_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed agent trade decision.
    TypedAgentTradeApproval {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        agent_id_hash: String,
        #[arg(long)]
        venue_hash: String,
        #[arg(long)]
        market_hash: String,
        #[arg(long)]
        side_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        max_leverage_x100: u32,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        risk_check_hash: String,
    },
    /// Grant or revoke a bounded on-chain agent session.
    TypedAgentSessionGrant {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        agent_id_hash: String,
        #[arg(long)]
        venue_hash: String,
        #[arg(long)]
        market_hash: String,
        #[arg(long)]
        max_notional_raw: u128,
        #[arg(long)]
        max_leverage_x100: u32,
        #[arg(long)]
        expires_at: i64,
        #[arg(long)]
        status: u8,
    },
    /// Configure or pause the on-chain loss/oracle policy for an agent session.
    TypedAgentRiskPolicy {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        oracle_policy_hash: String,
        #[arg(long)]
        max_loss_raw: u128,
        #[arg(long)]
        status: u8,
    },
    /// Apply an owner-approved, artifact-bound settlement to agent accounting.
    TypedAgentTradeSettlement {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        execution_id_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
        #[arg(long)]
        oracle_policy_hash: String,
        #[arg(long)]
        closed_notional_raw: u128,
        #[arg(long)]
        outcome: u8,
        #[arg(long)]
        pnl_abs_raw: u128,
        #[arg(long)]
        settlement_sequence: u64,
    },
    /// Execute an approved typed escrow unwind / return.
    ///
    /// Pass one `--return recipient:lamports` per funder.
    TypedEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        escrow_id: String,
        #[arg(long = "return")]
        returns: Vec<String>,
    },
    /// Execute an approved typed SOL send.
    TypedSolSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        recipient: String,
        #[arg(long)]
        amount_lamports: u64,
    },
    /// Verify and finalize an approved typed BTC/EVM/Zcash/HYPE send.
    TypedChainSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
    },
    /// Sign and optionally broadcast an approved typed remote send via Ika.
    TypedChainSendIka {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        /// Destination-chain params_data bytes as hex. Must match the signed ClearSign action.
        #[arg(long)]
        params_data_hex: String,
        /// Ika dWallet program ID on the current cluster.
        #[arg(long)]
        dwallet_program: String,
        /// Ika gRPC endpoint.
        #[arg(long, default_value = crate::ika::DEFAULT_GRPC_URL)]
        grpc_url: String,
        /// Destination-chain RPC URL for broadcast.
        #[arg(long)]
        rpc_url: Option<String>,
        /// Broadcast the signed transaction after Ika signing.
        #[arg(long, default_value = "false")]
        broadcast: bool,
    },
    /// Execute an approved typed SOL batch send.
    ///
    /// Pass one `--payment recipient:lamports` per recipient.
    TypedSolBatchSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long = "payment")]
        payments: Vec<String>,
    },
    /// Approve an existing proposal
    Approve {
        #[arg(long)]
        wallet: String,
        /// Proposal account address
        #[arg(long)]
        proposal: String,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Cancel / reject a proposal
    Cancel {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Execute an approved proposal.
    ///
    /// Chain-aware: for `chain = solana` intents, runs the local CPI executor
    /// (vault PDA signs). For any remote chain (EVM, BTC, ZEC, ERC-20),
    /// drives the on-chain `ika_sign` instruction and then completes the
    /// gRPC presign+sign roundtrip with the bound dWallet.
    Execute {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// Required for remote-chain execution: the dWallet program ID on
        /// the current cluster. Ignored for local Solana intents.
        #[arg(long)]
        dwallet_program: Option<String>,
        /// Ika gRPC endpoint (default: pre-alpha-dev-1).
        #[arg(long, default_value = crate::ika::DEFAULT_GRPC_URL)]
        grpc_url: String,
        /// Destination-chain RPC URL. If set together with `--broadcast`,
        /// the CLI assembles the chain-native signed transaction (recovers
        /// `v`, splices the signature into the EIP-1559 RLP envelope for
        /// EVM, builds the witness for Bitcoin, etc.) and broadcasts it
        /// via this endpoint after the dwallet network returns the
        /// signature. Chain-native protocol is selected automatically from
        /// the intent's `chain_kind` — JSON-RPC `eth_sendRawTransaction`
        /// for EVM, Bitcoin Core RPC `sendrawtransaction` / Esplora REST
        /// `POST /tx` for BTC, etc.
        ///
        /// Examples:
        ///   - Sepolia (public):           `https://ethereum-sepolia-rpc.publicnode.com`
        ///   - Ethereum mainnet (Alchemy): `https://eth-mainnet.g.alchemy.com/v2/<key>`
        ///   - Base mainnet:               `https://mainnet.base.org`
        ///   - Bitcoin testnet (Esplora):  `https://blockstream.info/testnet/api`
        #[arg(long)]
        rpc_url: Option<String>,
        /// Broadcast the signed transaction to the chain after signing.
        /// Requires `--rpc-url <URL>`. Without this flag the CLI just
        /// returns the raw signed bytes in the JSON output and the caller
        /// is responsible for broadcasting them.
        #[arg(long, default_value = "false")]
        broadcast: bool,
    },
    /// List proposals for a wallet
    List {
        #[arg(long)]
        wallet: String,
    },
    /// Show details of a specific proposal
    Show {
        /// Proposal account address
        #[arg(long)]
        proposal: String,
    },
    /// Close an executed/cancelled proposal and reclaim rent
    Cleanup {
        #[arg(long)]
        proposal: String,
    },
}

#[derive(Clone, Copy)]
pub(super) enum HandlerGroup {
    Creation,
    Votes,
    Governance,
    Escrow,
    Agent,
    Send,
    Legacy,
}

impl ProposalAction {
    pub(super) fn handler_group(&self) -> HandlerGroup {
        match self {
            Self::Create { .. } | Self::TypedCreate { .. } => HandlerGroup::Creation,
            Self::TypedApprove { .. }
            | Self::TypedCancel { .. }
            | Self::Approve { .. }
            | Self::Cancel { .. } => HandlerGroup::Votes,
            Self::TypedExecute { .. }
            | Self::TypedWalletPolicyUpdate { .. }
            | Self::TypedIntentGovernance { .. } => HandlerGroup::Governance,
            Self::TypedEscrowRelease { .. }
            | Self::TypedSplEscrowRelease { .. }
            | Self::TypedSplEscrowReturn { .. }
            | Self::TypedCrossChainEscrowRelease { .. }
            | Self::TypedCrossChainEscrowReturn { .. }
            | Self::TypedPrivateEscrowRelease { .. }
            | Self::TypedPrivateEscrowReturn { .. }
            | Self::TypedEscrowReturn { .. } => HandlerGroup::Escrow,
            Self::TypedAgentTradeApproval { .. }
            | Self::TypedAgentSessionGrant { .. }
            | Self::TypedAgentRiskPolicy { .. }
            | Self::TypedAgentTradeSettlement { .. } => HandlerGroup::Agent,
            Self::TypedSolSend { .. }
            | Self::TypedChainSend { .. }
            | Self::TypedChainSendIka { .. }
            | Self::TypedSolBatchSend { .. } => HandlerGroup::Send,
            Self::Execute { .. } | Self::List { .. } | Self::Show { .. } | Self::Cleanup { .. } => {
                HandlerGroup::Legacy
            }
        }
    }
}
