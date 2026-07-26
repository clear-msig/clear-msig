use std::env;
use std::thread;
use std::time::{Duration, Instant};

use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer as SolanaSigner;
use solana_sdk::transaction::Transaction;

pub fn load_payer() -> Keypair {
    let path = env::var("PAYER_KEYPAIR").unwrap_or_else(|_| {
        format!(
            "{}/.config/solana/devnet-admin.json",
            env::var("HOME").unwrap_or_default()
        )
    });
    let data =
        std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("Cannot read keypair at {path}"));
    let bytes: Vec<u8> = {
        let s = data.trim();
        s[1..s.len() - 1]
            .split(',')
            .map(|v| v.trim().parse::<u8>().unwrap())
            .collect()
    };
    Keypair::try_from(bytes.as_slice()).expect("valid keypair")
}

pub fn send_tx(
    client: &RpcClient,
    payer: &Keypair,
    ixs: Vec<Instruction>,
    extra: &[&Keypair],
) -> solana_sdk::signature::Signature {
    let blockhash = client.get_latest_blockhash().expect("blockhash");
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(&ixs, Some(&payer.pubkey()), &signers, blockhash);
    client
        .send_and_confirm_transaction(&tx)
        .expect("send_and_confirm")
}

pub fn poll_until(
    client: &RpcClient,
    account: &Pubkey,
    check: impl Fn(&[u8]) -> bool,
    timeout: Duration,
) -> Vec<u8> {
    let start = Instant::now();
    loop {
        if start.elapsed() > timeout {
            panic!("timeout waiting for account {account}");
        }
        if let Ok(acct) = client.get_account(account) {
            if check(&acct.data) {
                return acct.data;
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
}

pub fn read_u16_le(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap())
}

pub fn pk_to_addr(p: Pubkey) -> solana_address::Address {
    solana_address::Address::new_from_array(p.to_bytes())
}

pub fn addr_to_pk(a: solana_address::Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}

pub fn sdk_ix_from_ext(ix: solana_instruction::Instruction) -> Instruction {
    Instruction {
        program_id: addr_to_pk(ix.program_id),
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: addr_to_pk(m.pubkey),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}
