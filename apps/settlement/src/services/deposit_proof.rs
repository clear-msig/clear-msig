//! Pure validation of independently fetched chain evidence. Caller-declared
//! confirmations and finalized flags are never authorization inputs.
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug)]
pub struct DepositExpectation {
    pub intent_id: Uuid,
    pub chain_id: String,
    pub asset_symbol: String,
    pub source: String,
    pub treasury: String,
    pub amount_minor: u64,
    pub event_index: usize,
    pub tx_hash: String,
    pub funding_deadline: i64,
}

impl DepositExpectation {
    pub fn reference(&self) -> String {
        format!("clearsig-ramp:{}", self.intent_id)
    }
}

fn text<'a>(value: &'a Value, field: &str) -> anyhow::Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("deposit proof omitted {field}"))
}

fn equal_address(actual: &str, expected: &str, evm: bool) -> bool {
    if evm {
        actual.eq_ignore_ascii_case(expected)
    } else {
        actual == expected
    }
}

pub fn hex_quantity(value: &str) -> anyhow::Result<u128> {
    let digits = value
        .strip_prefix("0x")
        .filter(|digits| !digits.is_empty())
        .ok_or_else(|| anyhow::anyhow!("invalid RPC hex quantity"))?;
    u128::from_str_radix(digits, 16).map_err(Into::into)
}

pub fn verify_evm(
    expected: &DepositExpectation,
    chain_id: &Value,
    transaction: &Value,
    receipt: &Value,
    finalized: &Value,
    canonical_block: &Value,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        matches!(expected.asset_symbol.as_str(), "ETH" | "HYPE"),
        "unsupported EVM deposit asset"
    );
    let expected_chain: u128 = expected.chain_id.parse()?;
    let actual_chain = hex_quantity(
        chain_id
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing chain ID"))?,
    )?;
    anyhow::ensure!(actual_chain == expected_chain, "deposit network mismatch");
    anyhow::ensure!(
        expected.event_index == 0,
        "native EVM deposits require event index zero"
    );
    anyhow::ensure!(
        text(transaction, "hash")?.eq_ignore_ascii_case(&expected.tx_hash),
        "deposit transaction mismatch"
    );
    anyhow::ensure!(
        text(receipt, "transactionHash")?.eq_ignore_ascii_case(&expected.tx_hash),
        "deposit receipt mismatch"
    );
    anyhow::ensure!(
        equal_address(text(transaction, "from")?, &expected.source, true),
        "deposit sender mismatch"
    );
    anyhow::ensure!(
        equal_address(text(transaction, "to")?, &expected.treasury, true),
        "deposit treasury mismatch"
    );
    anyhow::ensure!(
        hex_quantity(text(transaction, "value")?)? == u128::from(expected.amount_minor),
        "deposit amount mismatch"
    );
    anyhow::ensure!(
        text(transaction, "input")? == format!("0x{}", hex::encode(expected.reference())),
        "deposit intent reference mismatch"
    );
    anyhow::ensure!(
        hex_quantity(text(receipt, "status")?)? == 1,
        "deposit transaction failed"
    );
    let height = hex_quantity(text(receipt, "blockNumber")?)?;
    anyhow::ensure!(
        height <= hex_quantity(text(finalized, "number")?)?,
        "deposit is not finalized"
    );
    anyhow::ensure!(
        height == hex_quantity(text(canonical_block, "number")?)?,
        "deposit block height mismatch"
    );
    anyhow::ensure!(
        text(receipt, "blockHash")?.eq_ignore_ascii_case(text(canonical_block, "hash")?),
        "deposit block is not canonical"
    );
    anyhow::ensure!(
        text(transaction, "blockHash")?.eq_ignore_ascii_case(text(receipt, "blockHash")?),
        "deposit transaction block mismatch"
    );
    let funded_at = hex_quantity(text(canonical_block, "timestamp")?)?;
    anyhow::ensure!(
        funded_at <= u128::try_from(expected.funding_deadline)?,
        "deposit funded after quote expiry"
    );
    Ok(())
}

pub fn verify_solana(expected: &DepositExpectation, transaction: &Value) -> anyhow::Result<()> {
    anyhow::ensure!(
        expected.asset_symbol == "SOL",
        "unsupported Solana deposit asset"
    );
    anyhow::ensure!(
        transaction.get("meta").and_then(|meta| meta.get("err")) == Some(&Value::Null),
        "Solana deposit failed or has no execution result"
    );
    let tx = transaction
        .get("transaction")
        .ok_or_else(|| anyhow::anyhow!("missing transaction"))?;
    anyhow::ensure!(
        tx.get("signatures")
            .and_then(Value::as_array)
            .is_some_and(|signatures| signatures.first().and_then(Value::as_str)
                == Some(expected.tx_hash.as_str())),
        "deposit signature mismatch"
    );
    let instructions = tx
        .get("message")
        .and_then(|message| message.get("instructions"))
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("missing parsed instructions"))?;
    let instruction = instructions
        .get(expected.event_index)
        .ok_or_else(|| anyhow::anyhow!("deposit instruction index not found"))?;
    anyhow::ensure!(
        text(instruction, "programId")? == "11111111111111111111111111111111",
        "deposit must be a native system transfer"
    );
    let parsed = instruction
        .get("parsed")
        .ok_or_else(|| anyhow::anyhow!("deposit instruction is not parsed"))?;
    anyhow::ensure!(
        text(parsed, "type")? == "transfer",
        "unsupported deposit instruction"
    );
    let info = parsed
        .get("info")
        .ok_or_else(|| anyhow::anyhow!("missing transfer info"))?;
    anyhow::ensure!(
        text(info, "source")? == expected.source,
        "deposit sender mismatch"
    );
    anyhow::ensure!(
        text(info, "destination")? == expected.treasury,
        "deposit treasury mismatch"
    );
    anyhow::ensure!(
        info.get("lamports").and_then(Value::as_u64) == Some(expected.amount_minor),
        "deposit amount mismatch"
    );
    anyhow::ensure!(
        instructions.iter().any(|instruction| {
            instruction.get("programId").and_then(Value::as_str)
                == Some("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
                && instruction.get("parsed").and_then(Value::as_str)
                    == Some(expected.reference().as_str())
        }),
        "deposit intent reference mismatch"
    );
    let funded_at = transaction
        .get("blockTime")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("Solana funding timestamp unavailable"))?;
    anyhow::ensure!(
        funded_at > 0 && funded_at <= expected.funding_deadline,
        "deposit funded after quote expiry"
    );
    Ok(())
}

/// Parse a JSON decimal amount without using binary floating-point arithmetic.
pub fn decimal_minor(value: &str, decimals: u32) -> anyhow::Result<u64> {
    anyhow::ensure!(
        value.len() <= 128 && decimals <= 18,
        "decimal amount too large"
    );
    let (mantissa, exponent) = value.split_once(['e', 'E']).unwrap_or((value, "0"));
    let exponent: i32 = exponent.parse()?;
    anyhow::ensure!(
        (-38..=38).contains(&exponent),
        "decimal exponent out of range"
    );
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    anyhow::ensure!(
        !whole.is_empty()
            && whole.bytes().all(|b| b.is_ascii_digit())
            && fraction.bytes().all(|b| b.is_ascii_digit()),
        "invalid chain decimal amount"
    );
    let digits: u128 = format!("{whole}{fraction}").parse()?;
    let power = decimals as i32 + exponent - fraction.len() as i32;
    let exact = if power >= 0 {
        digits
            .checked_mul(
                10u128
                    .checked_pow(power as u32)
                    .ok_or_else(|| anyhow::anyhow!("decimal scale overflow"))?,
            )
            .ok_or_else(|| anyhow::anyhow!("chain amount overflow"))?
    } else {
        let scale = 10u128
            .checked_pow(power.unsigned_abs())
            .ok_or_else(|| anyhow::anyhow!("decimal scale overflow"))?;
        anyhow::ensure!(
            digits.is_multiple_of(scale),
            "chain amount has fractional atomic units"
        );
        digits / scale
    };
    u64::try_from(exact).map_err(Into::into)
}

pub fn reference_script(reference: &str) -> String {
    let bytes = reference.as_bytes();
    // Current references are 50 ASCII bytes, represented by one minimal push.
    format!("6a{:02x}{}", bytes.len(), hex::encode(bytes))
}

pub fn verify_bitcoin(
    expected: &DepositExpectation,
    tx: &Value,
    tip_height: u64,
    canonical_block: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        expected.asset_symbol == "BTC",
        "unsupported Bitcoin deposit asset"
    );
    anyhow::ensure!(
        text(tx, "txid")? == expected.tx_hash,
        "deposit transaction mismatch"
    );
    let status = tx
        .get("status")
        .ok_or_else(|| anyhow::anyhow!("missing Bitcoin status"))?;
    anyhow::ensure!(
        status.get("confirmed").and_then(Value::as_bool) == Some(true),
        "Bitcoin deposit unconfirmed"
    );
    let height = status
        .get("block_height")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow::anyhow!("missing Bitcoin block height"))?;
    anyhow::ensure!(
        tip_height
            .checked_sub(height)
            .is_some_and(|depth| depth >= 5),
        "Bitcoin deposit needs six confirmations"
    );
    anyhow::ensure!(
        text(status, "block_hash")? == canonical_block,
        "Bitcoin deposit block is not canonical"
    );
    let inputs = tx
        .get("vin")
        .and_then(Value::as_array)
        .filter(|inputs| !inputs.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing Bitcoin inputs"))?;
    anyhow::ensure!(
        inputs.iter().all(|input| input
            .get("prevout")
            .and_then(|out| out.get("scriptpubkey_address"))
            .and_then(Value::as_str)
            == Some(expected.source.as_str())),
        "Bitcoin deposit sender mismatch"
    );
    let outputs = tx
        .get("vout")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("missing Bitcoin outputs"))?;
    let output = outputs
        .get(expected.event_index)
        .ok_or_else(|| anyhow::anyhow!("deposit output index not found"))?;
    anyhow::ensure!(
        text(output, "scriptpubkey_address")? == expected.treasury,
        "deposit treasury mismatch"
    );
    anyhow::ensure!(
        output.get("value").and_then(Value::as_u64) == Some(expected.amount_minor),
        "deposit amount mismatch"
    );
    anyhow::ensure!(
        outputs
            .iter()
            .any(|out| out.get("scriptpubkey").and_then(Value::as_str)
                == Some(reference_script(&expected.reference()).as_str())),
        "deposit intent reference mismatch"
    );
    let funded_at = status
        .get("block_time")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("Bitcoin funding timestamp unavailable"))?;
    anyhow::ensure!(
        funded_at > 0 && funded_at <= expected.funding_deadline,
        "deposit funded after quote expiry"
    );
    Ok(())
}

pub fn verify_zcash(
    expected: &DepositExpectation,
    transaction: &Value,
    previous_transactions: &[Value],
    chain_info: &Value,
    canonical_block: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        expected.asset_symbol == "ZEC",
        "unsupported Zcash deposit asset"
    );
    let chain = match expected.chain_id.as_str() {
        "mainnet" => "main",
        "testnet" => "test",
        _ => anyhow::bail!("unsupported Zcash network"),
    };
    anyhow::ensure!(
        text(chain_info, "chain")? == chain,
        "deposit network mismatch"
    );
    anyhow::ensure!(
        text(transaction, "txid")? == expected.tx_hash,
        "deposit transaction mismatch"
    );
    anyhow::ensure!(
        transaction
            .get("confirmations")
            .and_then(Value::as_u64)
            .is_some_and(|count| count >= 10),
        "Zcash deposit needs ten confirmations"
    );
    anyhow::ensure!(
        text(transaction, "blockhash")? == canonical_block,
        "Zcash deposit block is not canonical"
    );
    let inputs = transaction
        .get("vin")
        .and_then(Value::as_array)
        .filter(|inputs| !inputs.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing Zcash inputs"))?;
    anyhow::ensure!(
        inputs.len() == previous_transactions.len(),
        "missing Zcash input evidence"
    );
    for (input, previous) in inputs.iter().zip(previous_transactions) {
        anyhow::ensure!(
            text(input, "txid")? == text(previous, "txid")?,
            "Zcash previous transaction mismatch"
        );
        let index = input
            .get("vout")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow::anyhow!("missing previous output index"))?
            as usize;
        let out = previous
            .get("vout")
            .and_then(Value::as_array)
            .and_then(|outputs| outputs.get(index))
            .ok_or_else(|| anyhow::anyhow!("missing previous output"))?;
        anyhow::ensure!(
            zcash_output_address(out)? == expected.source,
            "Zcash deposit sender mismatch"
        );
    }
    let outputs = transaction
        .get("vout")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("missing Zcash outputs"))?;
    let output = outputs
        .get(expected.event_index)
        .ok_or_else(|| anyhow::anyhow!("deposit output index not found"))?;
    anyhow::ensure!(
        zcash_output_address(output)? == expected.treasury,
        "deposit treasury mismatch"
    );
    let amount = output
        .get("value")
        .ok_or_else(|| anyhow::anyhow!("missing Zcash amount"))?
        .to_string();
    anyhow::ensure!(
        decimal_minor(&amount, 8)? == expected.amount_minor,
        "deposit amount mismatch"
    );
    anyhow::ensure!(
        outputs.iter().any(|out| out
            .get("scriptPubKey")
            .and_then(|script| script.get("hex"))
            .and_then(Value::as_str)
            == Some(reference_script(&expected.reference()).as_str())),
        "deposit intent reference mismatch"
    );
    // Shielded spends do not provide independently attributable transparent
    // source evidence. Their valuation/proof path is deliberately unsupported.
    for field in ["vjoinsplit", "vShieldedSpend", "vShieldedOutput"] {
        if let Some(value) = transaction.get(field) {
            anyhow::ensure!(
                value.as_array().is_some_and(|items| items.is_empty()),
                "shielded Zcash deposits are unsupported"
            );
        }
    }
    if let Some(orchard) = transaction.get("orchard") {
        anyhow::ensure!(
            orchard
                .get("actions")
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.is_empty()),
            "Orchard deposits are unsupported"
        );
    }
    let funded_at = transaction
        .get("blocktime")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("Zcash funding timestamp unavailable"))?;
    anyhow::ensure!(
        funded_at > 0 && funded_at <= expected.funding_deadline,
        "deposit funded after quote expiry"
    );
    Ok(())
}

fn zcash_output_address(output: &Value) -> anyhow::Result<&str> {
    let addresses = output
        .get("scriptPubKey")
        .and_then(|script| script.get("addresses"))
        .and_then(Value::as_array)
        .filter(|addresses| addresses.len() == 1)
        .ok_or_else(|| anyhow::anyhow!("unsupported Zcash output script"))?;
    addresses[0]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("invalid Zcash address"))
}

#[cfg(test)]
mod tests;
