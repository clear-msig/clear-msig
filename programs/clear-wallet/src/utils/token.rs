use quasar_lang::{cpi::Seed, prelude::*};

pub const SPL_TOKEN_ID: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_MINT_OFFSET: usize = 0;
pub const TOKEN_OWNER_OFFSET: usize = 32;
pub const TOKEN_ACCOUNT_STATE_INITIALIZED: u8 = 1;

const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_STATE_OFFSET: usize = 108;
const TOKEN_ACCOUNT_STATE_FROZEN: u8 = 2;

pub fn transfer_tokens(
    token_program: &UncheckedAccount,
    source: &UncheckedAccount,
    destination: &UncheckedAccount,
    authority: &UncheckedAccount,
    authority_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    transfer_tokens_view(
        token_program,
        source.to_account_view(),
        destination.to_account_view(),
        authority.to_account_view(),
        authority_seeds,
        amount,
    )
}

pub fn transfer_tokens_view(
    token_program: &UncheckedAccount,
    source: &AccountView,
    destination: &AccountView,
    authority: &AccountView,
    authority_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    let mut cpi = DynCpiCall::<3, 9>::new(token_program.address());
    cpi.push_account(source, false, true)?;
    cpi.push_account(destination, false, true)?;
    cpi.push_account(authority, true, false)?;
    let data = cpi.data_mut() as *mut u8;
    unsafe {
        *data = 3;
        core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), data.add(1), 8);
    }
    cpi.set_data_len(9)?;
    cpi.invoke_signed(authority_seeds)
}

pub fn token_account_address(
    account: &AccountView,
    offset: usize,
) -> Result<Address, ProgramError> {
    require!(
        account.data_len() >= TOKEN_ACCOUNT_LEN,
        ProgramError::AccountDataTooSmall
    );
    let data = unsafe { account.borrow_unchecked() };
    Ok(Address::new_from_array(
        data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    ))
}

pub fn token_account_state(account: &AccountView) -> Result<u8, ProgramError> {
    require!(
        account.data_len() >= TOKEN_ACCOUNT_LEN,
        ProgramError::AccountDataTooSmall
    );
    let data = unsafe { account.borrow_unchecked() };
    let state = data[TOKEN_STATE_OFFSET];
    require!(
        state != TOKEN_ACCOUNT_STATE_FROZEN,
        ProgramError::InvalidAccountData
    );
    Ok(state)
}
