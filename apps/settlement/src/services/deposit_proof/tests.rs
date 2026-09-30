use super::*;
fn expected() -> DepositExpectation {
    DepositExpectation {
        intent_id: Uuid::nil(),
        chain_id: "11155111".into(),
        asset_symbol: "ETH".into(),
        source: "0x1111".into(),
        treasury: "0x2222".into(),
        amount_minor: 100,
        event_index: 0,
        tx_hash: "0x3333".into(),
        funding_deadline: 1000,
    }
}
#[test]
fn evm_proof_rejects_forged_amount_sender_recipient_network_and_finality() {
    let expected = expected();
    let tx = serde_json::json!({"hash":"0x3333","from":"0x1111","to":"0x2222","value":"0x64","input":format!("0x{}",hex::encode(expected.reference())),"blockHash":"0x4444"});
    let receipt = serde_json::json!({"transactionHash":"0x3333","status":"0x1","blockNumber":"0x10","blockHash":"0x4444"});
    let final_block = serde_json::json!({"number":"0x10"});
    let block = serde_json::json!({"number":"0x10","hash":"0x4444","timestamp":"0x100"});
    let chain = serde_json::json!("0xaa36a7");
    assert!(verify_evm(&expected, &chain, &tx, &receipt, &final_block, &block).is_ok());
    for (field, value) in [
        ("from", "0xattacker"),
        ("to", "0xattacker"),
        ("value", "0x65"),
        ("input", "0x"),
        ("hash", "0xother"),
        ("blockHash", "0xother"),
    ] {
        let mut changed = tx.clone();
        changed[field] = serde_json::json!(value);
        assert!(
            verify_evm(&expected, &chain, &changed, &receipt, &final_block, &block).is_err(),
            "{field}"
        );
    }
    assert!(verify_evm(
        &expected,
        &serde_json::json!("0x1"),
        &tx,
        &receipt,
        &final_block,
        &block
    )
    .is_err());
    assert!(verify_evm(
        &expected,
        &chain,
        &tx,
        &receipt,
        &serde_json::json!({"number":"0xf"}),
        &block
    )
    .is_err());
    let mut failed = receipt.clone();
    failed["status"] = serde_json::json!("0x0");
    assert!(verify_evm(&expected, &chain, &tx, &failed, &final_block, &block).is_err());
}
#[test]
fn decimal_amounts_are_exact_and_bounded() {
    assert_eq!(decimal_minor("1.00000001", 8).unwrap(), 100_000_001);
    assert_eq!(decimal_minor("1e-6", 8).unwrap(), 100);
    for amount in ["-1", "NaN", "0.000000001", "18446744073709551616"] {
        assert!(decimal_minor(amount, 8).is_err());
    }
}

#[test]
fn solana_requires_success_exact_transfer_and_bound_memo() {
    let mut expected = expected();
    expected.asset_symbol = "SOL".into();
    expected.chain_id = "devnet".into();
    expected.source = "source".into();
    expected.treasury = "treasury".into();
    expected.tx_hash = "signature".into();
    let transfer = serde_json::json!({"programId":"11111111111111111111111111111111","parsed":{"type":"transfer","info":{"source":"source","destination":"treasury","lamports":100}}});
    let memo = serde_json::json!({"programId":"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr","parsed":expected.reference()});
    let valid = serde_json::json!({"blockTime":100,"meta":{"err":null},"transaction":{"signatures":["signature"],"message":{"instructions":[transfer,memo]}}});
    verify_solana(&expected, &valid).unwrap();
    for (field, value) in [
        ("source", serde_json::json!("attacker")),
        ("destination", serde_json::json!("attacker")),
        ("lamports", serde_json::json!(99)),
    ] {
        let mut changed = valid.clone();
        changed["transaction"]["message"]["instructions"][0]["parsed"]["info"][field] = value;
        assert!(verify_solana(&expected, &changed).is_err(), "{field}");
    }
    let mut failed = valid.clone();
    failed["meta"]["err"] = serde_json::json!({"InstructionError":[0,"failed"]});
    assert!(verify_solana(&expected, &failed).is_err());
    let mut memo = valid.clone();
    memo["transaction"]["message"]["instructions"][1]["parsed"] =
        serde_json::json!("clearsig-ramp:other");
    assert!(verify_solana(&expected, &memo).is_err());
    let mut index = expected;
    index.event_index = 1;
    assert!(verify_solana(&index, &valid).is_err());
}

#[test]
fn bitcoin_requires_correct_output_source_reference_and_six_canonical_confirmations() {
    let mut expected = expected();
    expected.asset_symbol = "BTC".into();
    expected.chain_id = "testnet".into();
    expected.source = "source".into();
    expected.treasury = "treasury".into();
    expected.tx_hash = "txid".into();
    let valid = serde_json::json!({"txid":"txid","status":{"confirmed":true,"block_height":100,"block_hash":"block","block_time":100},"vin":[{"prevout":{"scriptpubkey_address":"source"}}],"vout":[{"scriptpubkey_address":"treasury","value":100},{"scriptpubkey":reference_script(&expected.reference()),"value":0}]});
    verify_bitcoin(&expected, &valid, 105, "block").unwrap();
    assert!(verify_bitcoin(&expected, &valid, 104, "block").is_err());
    assert!(verify_bitcoin(&expected, &valid, 105, "reorged-block").is_err());
    let mut amount = valid.clone();
    amount["vout"][0]["value"] = serde_json::json!(101);
    assert!(verify_bitcoin(&expected, &amount, 105, "block").is_err());
    let mut source = valid.clone();
    source["vin"][0]["prevout"]["scriptpubkey_address"] = serde_json::json!("attacker");
    assert!(verify_bitcoin(&expected, &source, 105, "block").is_err());
    let mut reference = valid.clone();
    reference["vout"][1]["scriptpubkey"] =
        serde_json::json!(reference_script("clearsig-ramp:other"));
    assert!(verify_bitcoin(&expected, &reference, 105, "block").is_err());
}

#[test]
fn zcash_requires_transparent_prevouts_exact_zatoshis_reference_network_and_finality() {
    let mut expected = expected();
    expected.asset_symbol = "ZEC".into();
    expected.chain_id = "testnet".into();
    expected.source = "source".into();
    expected.treasury = "treasury".into();
    expected.tx_hash = "txid".into();
    let previous =
        serde_json::json!({"txid":"prev","vout":[{"scriptPubKey":{"addresses":["source"]}}]});
    let valid = serde_json::json!({"txid":"txid","blockhash":"block","blocktime":100,"confirmations":10,"vin":[{"txid":"prev","vout":0}],"vout":[{"scriptPubKey":{"addresses":["treasury"]},"value":0.000001},{"scriptPubKey":{"hex":reference_script(&expected.reference())},"value":0}],"vShieldedSpend":[],"vShieldedOutput":[]});
    let info = serde_json::json!({"chain":"test"});
    verify_zcash(
        &expected,
        &valid,
        std::slice::from_ref(&previous),
        &info,
        "block",
    )
    .unwrap();
    assert!(verify_zcash(
        &expected,
        &valid,
        std::slice::from_ref(&previous),
        &serde_json::json!({"chain":"main"}),
        "block"
    )
    .is_err());
    assert!(verify_zcash(
        &expected,
        &valid,
        std::slice::from_ref(&previous),
        &info,
        "reorged"
    )
    .is_err());
    let mut unconfirmed = valid.clone();
    unconfirmed["confirmations"] = serde_json::json!(9);
    assert!(verify_zcash(
        &expected,
        &unconfirmed,
        std::slice::from_ref(&previous),
        &info,
        "block"
    )
    .is_err());
    let mut source = previous.clone();
    source["vout"][0]["scriptPubKey"]["addresses"] = serde_json::json!(["attacker"]);
    assert!(verify_zcash(&expected, &valid, &[source], &info, "block").is_err());
    let mut shielded = valid.clone();
    shielded["vShieldedSpend"] = serde_json::json!([{}]);
    assert!(verify_zcash(&expected, &shielded, &[previous], &info, "block").is_err());
}
