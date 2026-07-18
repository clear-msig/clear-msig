use clear_wallet_client::generated::execute_recurring_payment::ExecuteRecurringPaymentInstruction;
use clear_wallet_client::generated::execute_recurring_token_payment::ExecuteRecurringTokenPaymentInstruction;
use clear_wallet_client::generated::execute_typed_recurring_schedule::ExecuteTypedRecurringScheduleInstruction;
use clear_wallet_client::generated::execute_typed_recurring_token_schedule::ExecuteTypedRecurringTokenScheduleInstruction;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

use super::{pk_to_addr, sdk_ix_from_ext};

#[allow(clippy::too_many_arguments)]
pub fn execute_typed_recurring_schedule(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    schedule: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    schedule_id_hash: [u8; 32],
    recipient: [u8; 32],
    amount_lamports: u64,
    interval_seconds: u32,
    first_execution_at: i64,
    payment_count: u32,
    status: u8,
) -> Instruction {
    sdk_ix_from_ext(
        ExecuteTypedRecurringScheduleInstruction {
            payer: pk_to_addr(payer),
            wallet: pk_to_addr(wallet),
            wallet_policy: pk_to_addr(wallet_policy),
            intent: pk_to_addr(intent),
            proposal: pk_to_addr(proposal),
            schedule: pk_to_addr(schedule),
            system_program: solana_sdk_ids::system_program::ID,
            policy_commitment,
            envelope_hash,
            schedule_id_hash,
            recipient,
            amount_lamports,
            interval_seconds,
            first_execution_at,
            payment_count,
            status,
        }
        .into(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn execute_recurring_payment(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    policy_spend: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    schedule: Pubkey,
    recipient: Pubkey,
    schedule_id_hash: [u8; 32],
) -> Instruction {
    sdk_ix_from_ext(
        ExecuteRecurringPaymentInstruction {
            payer: pk_to_addr(payer),
            wallet: pk_to_addr(wallet),
            wallet_policy: pk_to_addr(wallet_policy),
            policy_spend: pk_to_addr(policy_spend),
            vault: pk_to_addr(vault),
            intent: pk_to_addr(intent),
            schedule: pk_to_addr(schedule),
            recipient: pk_to_addr(recipient),
            system_program: solana_sdk_ids::system_program::ID,
            schedule_id_hash,
        }
        .into(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn execute_typed_recurring_token_schedule(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    schedule_id_hash: [u8; 32],
    amount_tokens: u64,
    interval_seconds: u32,
    first_execution_at: i64,
    payment_count: u32,
    status: u8,
) -> Instruction {
    sdk_ix_from_ext(
        ExecuteTypedRecurringTokenScheduleInstruction {
            payer: pk_to_addr(payer),
            wallet: pk_to_addr(wallet),
            wallet_policy: pk_to_addr(wallet_policy),
            vault: pk_to_addr(vault),
            intent: pk_to_addr(intent),
            proposal: pk_to_addr(proposal),
            schedule: pk_to_addr(schedule),
            mint: pk_to_addr(mint),
            source_token: pk_to_addr(source_token),
            destination_token: pk_to_addr(destination_token),
            recipient_owner: pk_to_addr(recipient_owner),
            token_program: pk_to_addr(spl_token_program()),
            system_program: solana_sdk_ids::system_program::ID,
            policy_commitment,
            envelope_hash,
            schedule_id_hash,
            amount_tokens,
            interval_seconds,
            first_execution_at,
            payment_count,
            status,
        }
        .into(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn execute_recurring_token_payment(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    schedule_id_hash: [u8; 32],
) -> Instruction {
    sdk_ix_from_ext(
        ExecuteRecurringTokenPaymentInstruction {
            payer: pk_to_addr(payer),
            wallet: pk_to_addr(wallet),
            wallet_policy: pk_to_addr(wallet_policy),
            vault: pk_to_addr(vault),
            intent: pk_to_addr(intent),
            schedule: pk_to_addr(schedule),
            mint: pk_to_addr(mint),
            source_token: pk_to_addr(source_token),
            destination_token: pk_to_addr(destination_token),
            recipient_owner: pk_to_addr(recipient_owner),
            token_program: pk_to_addr(spl_token_program()),
            schedule_id_hash,
        }
        .into(),
    )
}

fn spl_token_program() -> Pubkey {
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        .parse()
        .expect("static SPL token program")
}

#[allow(clippy::too_many_arguments)]
pub fn execute_typed_recurring_asset_schedule(
    payer: Pubkey,
    wallet: Pubkey,
    asset_policy: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    schedule_id_hash: [u8; 32],
    amount_tokens: u64,
    interval_seconds: u32,
    first_execution_at: i64,
    payment_count: u32,
    status: u8,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(asset_policy, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(schedule, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new_readonly(source_token, false),
        AccountMeta::new_readonly(destination_token, false),
        AccountMeta::new_readonly(recipient_owner, false),
        AccountMeta::new_readonly(spl_token_program(), false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![37u8];
    for value in [&policy_commitment, &envelope_hash, &schedule_id_hash] {
        wincode::serialize_into(&mut data, value).unwrap();
    }
    wincode::serialize_into(&mut data, &amount_tokens).unwrap();
    wincode::serialize_into(&mut data, &interval_seconds).unwrap();
    wincode::serialize_into(&mut data, &first_execution_at).unwrap();
    wincode::serialize_into(&mut data, &payment_count).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: super::program_id(),
        accounts,
        data,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn execute_recurring_asset_payment(
    payer: Pubkey,
    wallet: Pubkey,
    asset_policy: Pubkey,
    asset_policy_spend: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    schedule_id_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(asset_policy, false),
        AccountMeta::new(asset_policy_spend, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new_readonly(intent, false),
        AccountMeta::new(schedule, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(source_token, false),
        AccountMeta::new(destination_token, false),
        AccountMeta::new_readonly(recipient_owner, false),
        AccountMeta::new_readonly(spl_token_program(), false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![38u8];
    wincode::serialize_into(&mut data, &schedule_id_hash).unwrap();
    Instruction {
        program_id: super::program_id(),
        accounts,
        data,
    }
}
