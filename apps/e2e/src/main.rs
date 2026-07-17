// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear

//! Clear-msig + Ika E2E Demo (EVM signing).
//!
//! End-to-end flow against Solana devnet and the Ika pre-alpha gRPC service.
//! Drives a 2-of-2 clear-msig wallet through approving an EIP-1559 ETH
//! transfer and getting it signed by an Ika dWallet.
//!
//! ```bash
//! cargo run -p e2e-clear-msig-ika -- <DWALLET_PROGRAM_ID> [CLEAR_WALLET_PROGRAM_ID]
//! ```

mod constants;
mod ika_evm_demo;
mod ika_helpers;
mod messages;
mod output;
mod solana_helpers;

#[tokio::main]
async fn main() {
    ika_evm_demo::run().await;
}
