use quasar_lang::{prelude::*, sysvars::Sysvar as _};
use sha2::{Digest, Sha256};

use crate::{
    chains::{
        dispatch_metadata_digest, dispatch_sighash, read_bytes20, read_param, read_u128, read_u64,
        ChainKind,
    },
    error::WalletError,
    instructions::{
        bind_dwallet::{ClearWalletProgram, DWalletProgramInterface},
        typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    },
    state::{
        dwallet_ownership::{DwalletOwnership, DWALLET_OWNERSHIP_SEED},
        ika_config::IkaConfig,
        intent::Intent,
        policy_spend::PolicySpendState,
        proposal::ProposalStatus,
        typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::{
        clearsign::{hash_send_payload, ClearSignActionKind, ClearSignAmount},
        ika_cpi::{DWalletContext, CPI_AUTHORITY_SEED},
        policy::{enforce_typed_remote_send_policy, enforce_wallet_policy_account},
    },
};

#[derive(Accounts)]
pub struct IkaSignTypedChainSend<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub wallet_policy: &'info mut UncheckedAccount,
    #[account(
        init_if_needed,
        payer = payer,
        seeds = PolicySpendState::seeds(wallet, intent),
        bump,
    )]
    pub policy_spend: &'info mut Account<PolicySpendState>,
    #[account(
        mut,
        has_one = wallet,
        constraint = intent.is_approved() @ WalletError::IntentNotApproved,
    )]
    pub intent: Account<Intent<'info>>,
    #[account(
        mut,
        has_one = wallet,
        has_one = intent,
        constraint = proposal.status == ProposalStatus::Approved @ WalletError::ProposalNotApproved
    )]
    pub proposal: Account<TypedProposal<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub ika_config: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(
        seeds = [b"dwallet_owner", dwallet],
        bump,
    )]
    pub dwallet_ownership: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(mut)]
    pub dwallet: &'info mut UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(mut)]
    pub message_approval: &'info mut UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub coordinator: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(
        seeds = [b"__ika_cpi_authority"],
        bump,
    )]
    pub cpi_authority: &'info UncheckedAccount,
    pub caller_program: &'info Program<ClearWalletProgram>,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub dwallet_program: &'info Interface<DWalletProgramInterface>,
    pub system_program: &'info Program<System>,
}

pub struct IkaSignTypedChainSendArgs<'a> {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
    pub message_approval_bump: u8,
    pub cpi_authority_bump: u8,
    pub blake2b_hashes: [u8; 96],
    pub params_data: &'a [u8],
}

impl<'info> IkaSignTypedChainSend<'info> {
    pub fn ika_sign_typed_chain_send(
        &mut self,
        args: IkaSignTypedChainSendArgs<'_>,
        bumps: &IkaSignTypedChainSendBumps,
    ) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        let approved_at = self.proposal.approved_at.get();
        let timelock = self.intent.timelock_seconds.get() as i64;
        require!(
            clock.unix_timestamp.get() >= approved_at + timelock,
            ProgramError::InvalidArgument
        );

        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        let kind = ChainKind::from_u8(args.chain_kind)?;
        require!(kind.is_remote(), ProgramError::InvalidArgument);
        require!(
            self.intent.chain_kind == args.chain_kind,
            ProgramError::InvalidArgument
        );

        verify_ika_binding(
            &self.wallet,
            &self.intent,
            self.ika_config,
            self.dwallet,
            self.dwallet_ownership,
        )?;

        {
            let tx_template = self.intent.tx_template_bytes()?;
            require!(
                sha256_raw(tx_template) == args.tx_template_hash,
                WalletError::InvalidClearSignEnvelope
            );
        }
        verify_native_send_params(
            &self.intent,
            args.params_data,
            kind,
            amount_raw,
            &args.recipient_hash,
            &args.asset_id_hash,
        )?;

        let amount = ClearSignAmount {
            asset: &args.asset_id_hash,
            raw_amount: amount_raw,
        };
        let payload_hash = hash_send_payload(&args.recipient_hash, &amount);
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::Send.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;
        enforce_wallet_policy_account(
            self.wallet.address(),
            self.wallet_policy,
            args.chain_kind,
            args.policy_commitment,
            self.proposal.policy_bytes().as_ref(),
        )?;
        enforce_typed_remote_send_policy(
            self.proposal.policy_bytes().as_ref(),
            args.policy_commitment,
            &args.recipient_hash,
            amount_raw,
            &self.intent,
            &self.proposal,
            &mut self.policy_spend,
            bumps.policy_spend,
        )?;

        approve_ika_message(
            self,
            args.params_data,
            args.message_approval_bump,
            args.cpi_authority_bump,
            &args.blake2b_hashes,
        )?;

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

fn verify_ika_binding(
    wallet: &Account<ClearWallet<'_>>,
    intent: &Account<Intent<'_>>,
    ika_config_account: &UncheckedAccount,
    dwallet: &UncheckedAccount,
    dwallet_ownership: &UncheckedAccount,
) -> Result<(), ProgramError> {
    let chain_byte = [intent.chain_kind];
    let (expected_cfg, _) = Address::find_program_address(
        &[b"ika_config", wallet.address().as_ref(), &chain_byte],
        &crate::ID,
    );
    require_keys_eq!(
        *ika_config_account.address(),
        expected_cfg,
        ProgramError::InvalidSeeds
    );
    require!(
        ika_config_account.to_account_view().owned_by(&crate::ID),
        ProgramError::IncorrectProgramId
    );
    let cfg_data = unsafe { ika_config_account.to_account_view().borrow_unchecked() };
    let ika_config = IkaConfig::read(cfg_data)?;
    require_keys_eq!(
        ika_config.wallet,
        *wallet.address(),
        ProgramError::InvalidArgument
    );
    require!(
        ika_config.chain_kind == intent.chain_kind,
        ProgramError::InvalidArgument
    );
    require_keys_eq!(
        ika_config.dwallet,
        *dwallet.address(),
        ProgramError::InvalidArgument
    );

    let dwallet_addr = *dwallet.address();
    let (expected_ownership, _) =
        Address::find_program_address(&[DWALLET_OWNERSHIP_SEED, dwallet_addr.as_ref()], &crate::ID);
    require_keys_eq!(
        *dwallet_ownership.address(),
        expected_ownership,
        ProgramError::InvalidSeeds
    );
    let ownership_data = unsafe { dwallet_ownership.to_account_view().borrow_unchecked() };
    let ownership = DwalletOwnership::read(ownership_data)?;
    require_keys_eq!(
        ownership.wallet,
        *wallet.address(),
        ProgramError::InvalidArgument
    );
    require_keys_eq!(
        ownership.dwallet,
        dwallet_addr,
        ProgramError::InvalidArgument
    );
    Ok(())
}

fn verify_native_send_params(
    intent: &Intent<'_>,
    params_data: &[u8],
    kind: ChainKind,
    amount_raw: u128,
    recipient_hash: &[u8; 32],
    asset_id_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    match kind {
        ChainKind::Evm1559 | ChainKind::HyperliquidEvm => {
            let amount_u64 =
                u64::try_from(amount_raw).map_err(|_| WalletError::PolicyAmountExceeded)?;
            require!(
                read_u64(intent, params_data, 2)? == amount_u64,
                WalletError::InvalidClearSignEnvelope
            );
            let to = read_bytes20(intent, params_data, 1)?;
            require!(
                evm_address_text_commitment(&to) == *recipient_hash,
                WalletError::InvalidClearSignEnvelope
            );
            let data = read_param(intent, params_data, 3)?;
            require!(
                data.is_empty() || data.first().copied().unwrap_or(0) == 0,
                WalletError::InvalidClearSignEnvelope
            );
            Ok(())
        }
        ChainKind::Evm1559Erc20 => {
            let token_contract = read_bytes20(intent, params_data, 1)?;
            let recipient = read_bytes20(intent, params_data, 2)?;
            verify_erc20_send_commitments(
                amount_raw,
                read_u128(intent, params_data, 3)?,
                recipient_hash,
                &recipient,
                asset_id_hash,
                &token_contract,
            )
        }
        ChainKind::BitcoinP2wpkh => {
            let params_amount = read_u64(intent, params_data, 5)?;
            let recipient_pkh = read_bytes20(intent, params_data, 4)?;
            verify_pkh_send_commitments(
                kind,
                amount_raw,
                params_amount,
                recipient_hash,
                &recipient_pkh,
            )
        }
        ChainKind::ZcashTransparent => {
            let params_amount = read_u64(intent, params_data, 5)?;
            let recipient_pkh = read_bytes20(intent, params_data, 4)?;
            verify_pkh_send_commitments(
                kind,
                amount_raw,
                params_amount,
                recipient_hash,
                &recipient_pkh,
            )
        }
        _ => Err(ProgramError::InvalidArgument),
    }
}

fn verify_erc20_send_commitments(
    amount_raw: u128,
    params_amount: u128,
    recipient_hash: &[u8; 32],
    recipient: &[u8; 20],
    asset_id_hash: &[u8; 32],
    token_contract: &[u8; 20],
) -> Result<(), ProgramError> {
    require!(
        amount_raw == params_amount,
        WalletError::InvalidClearSignEnvelope
    );
    require!(
        evm_address_text_commitment(recipient) == *recipient_hash,
        WalletError::InvalidClearSignEnvelope
    );
    require!(
        evm_address_text_commitment(token_contract) == *asset_id_hash,
        WalletError::InvalidClearSignEnvelope
    );
    Ok(())
}

fn verify_pkh_send_commitments(
    kind: ChainKind,
    amount_raw: u128,
    params_amount: u64,
    recipient_hash: &[u8; 32],
    recipient_pkh: &[u8; 20],
) -> Result<(), ProgramError> {
    let amount_u64 = u64::try_from(amount_raw).map_err(|_| WalletError::PolicyAmountExceeded)?;
    require!(
        params_amount == amount_u64,
        WalletError::InvalidClearSignEnvelope
    );
    let namespace = match kind {
        ChainKind::BitcoinP2wpkh => b"btc-p2wpkh:0x".as_slice(),
        ChainKind::ZcashTransparent => b"zcash-transparent:0x".as_slice(),
        _ => return Err(ProgramError::InvalidArgument),
    };
    require!(
        pkh_text_commitment(namespace, recipient_pkh) == *recipient_hash,
        WalletError::InvalidClearSignEnvelope
    );
    Ok(())
}

fn approve_ika_message(
    accounts: &mut IkaSignTypedChainSend<'_>,
    params_data: &[u8],
    message_approval_bump: u8,
    cpi_authority_bump: u8,
    blake2b_hashes: &[u8; 96],
) -> Result<(), ProgramError> {
    let tx_template = accounts.intent.tx_template_bytes()?;
    let message_hash = dispatch_sighash(
        &accounts.intent,
        params_data,
        tx_template,
        blake2b_hashes,
        None,
    )?;

    let (expected_cpi_auth, _) = Address::find_program_address(&[CPI_AUTHORITY_SEED], &crate::ID);
    require_keys_eq!(
        *accounts.cpi_authority.address(),
        expected_cpi_auth,
        ProgramError::InvalidSeeds
    );

    let ma_view = accounts.message_approval.to_account_view();
    if ma_view.data_len() == 0 {
        let cfg_data = unsafe { accounts.ika_config.to_account_view().borrow_unchecked() };
        let ika_config = IkaConfig::read(cfg_data)?;
        let ctx = DWalletContext {
            dwallet_program: accounts.dwallet_program.to_account_view(),
            cpi_authority: accounts.cpi_authority.to_account_view(),
            caller_program: accounts.caller_program.to_account_view(),
            cpi_authority_bump,
        };
        let user_pubkey: [u8; 32] = ika_config.user_pubkey.to_bytes();
        let message_metadata_digest =
            dispatch_metadata_digest(accounts.intent.chain_kind, tx_template);
        ctx.approve_message(
            accounts.coordinator.to_account_view(),
            accounts.message_approval.to_account_view(),
            accounts.dwallet.to_account_view(),
            accounts.payer.to_account_view(),
            accounts.system_program.to_account_view(),
            message_hash,
            message_metadata_digest,
            user_pubkey,
            ika_config.signature_scheme,
            message_approval_bump,
        )?;
    } else {
        require!(
            ma_view.owned_by(accounts.dwallet_program.address()),
            ProgramError::InvalidArgument
        );
    }

    Ok(())
}

fn evm_address_text_commitment(address: &[u8; 20]) -> [u8; 32] {
    let mut text = [0u8; 42];
    text[0] = b'0';
    text[1] = b'x';
    for (idx, byte) in address.iter().enumerate() {
        text[2 + idx * 2] = hex_nibble(byte >> 4);
        text[3 + idx * 2] = hex_nibble(byte & 0x0f);
    }
    Sha256::digest(text).into()
}

fn pkh_text_commitment(prefix: &[u8], pkh: &[u8; 20]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(prefix);
    for byte in pkh {
        hasher.update([hex_nibble(byte >> 4), hex_nibble(byte & 0x0f)]);
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AMOUNT: u64 = 125_000;
    const RECIPIENT_PKH: [u8; 20] = [0x2a; 20];

    #[test]
    fn btc_commitments_reject_amount_and_recipient_mismatches() {
        assert_commitment_guards(ChainKind::BitcoinP2wpkh, b"btc-p2wpkh:0x");
    }

    #[test]
    fn zcash_commitments_reject_amount_and_recipient_mismatches() {
        assert_commitment_guards(ChainKind::ZcashTransparent, b"zcash-transparent:0x");
    }

    #[test]
    fn erc20_commitments_bind_amount_recipient_and_token_contract() {
        let amount = 25_000_000u128;
        let recipient = [0x11; 20];
        let token = [0x22; 20];
        let recipient_hash = evm_address_text_commitment(&recipient);
        let asset_hash = evm_address_text_commitment(&token);

        assert!(verify_erc20_send_commitments(
            amount,
            amount,
            &recipient_hash,
            &recipient,
            &asset_hash,
            &token,
        )
        .is_ok());
        assert!(verify_erc20_send_commitments(
            amount,
            amount + 1,
            &recipient_hash,
            &recipient,
            &asset_hash,
            &token,
        )
        .is_err());
        assert!(verify_erc20_send_commitments(
            amount,
            amount,
            &recipient_hash,
            &[0x33; 20],
            &asset_hash,
            &token,
        )
        .is_err());
        assert!(verify_erc20_send_commitments(
            amount,
            amount,
            &recipient_hash,
            &recipient,
            &asset_hash,
            &[0x44; 20],
        )
        .is_err());
    }

    fn assert_commitment_guards(kind: ChainKind, namespace: &[u8]) {
        let recipient_hash = pkh_text_commitment(namespace, &RECIPIENT_PKH);
        assert!(verify_pkh_send_commitments(
            kind,
            AMOUNT as u128,
            AMOUNT,
            &recipient_hash,
            &RECIPIENT_PKH,
        )
        .is_ok());
        assert!(verify_pkh_send_commitments(
            kind,
            AMOUNT as u128,
            AMOUNT + 1,
            &recipient_hash,
            &RECIPIENT_PKH,
        )
        .is_err());

        let wrong_recipient = [0x7b; 20];
        assert!(verify_pkh_send_commitments(
            kind,
            AMOUNT as u128,
            AMOUNT,
            &recipient_hash,
            &wrong_recipient,
        )
        .is_err());
    }
}

fn hex_nibble(value: u8) -> u8 {
    match value {
        0..=9 => b'0' + value,
        _ => b'a' + (value - 10),
    }
}

fn sha256_raw(value: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hasher.finalize().into()
}
