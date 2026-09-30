use super::transport::{DestinationTransport, HttpResponse};
use crate::error::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProbeState {
    NotFound,
    Submitted,
    Confirmed,
    Failed,
}

pub(super) fn probe(
    transport: &dyn DestinationTransport,
    chain_kind: u8,
    url: &str,
    tx_id: &str,
) -> Result<ProbeState> {
    match chain_kind {
        1 | 4 | 5 => probe_evm(transport, url, tx_id),
        2 => probe_bitcoin(transport, url, tx_id),
        3 => probe_zcash(transport, url, tx_id),
        other => Err(anyhow!(
            "no destination reconciliation probe for chain_kind {other}"
        )),
    }
}

fn probe_evm(transport: &dyn DestinationTransport, url: &str, tx_id: &str) -> Result<ProbeState> {
    let response = transport.post_json(
        url,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":[tx_id]}),
    )?;
    let body = parse_rpc_body(response)?;
    let receipt = rpc_result(&body)?;
    if !receipt.is_null() {
        require_transaction_id(receipt, "transactionHash", tx_id)?;
        let status = receipt.get("status").and_then(serde_json::Value::as_str);
        if !matches!(status, Some("0x0" | "0x1")) {
            return Err(anyhow!("EVM receipt omitted a valid execution status"));
        }
        let block = receipt
            .get("blockNumber")
            .ok_or_else(|| anyhow!("EVM receipt omitted blockNumber"))?;
        if block.is_null() {
            return Ok(ProbeState::Submitted);
        }
        block
            .as_str()
            .and_then(|value| value.strip_prefix("0x"))
            .filter(|value| !value.is_empty() && value.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| anyhow!("EVM receipt has an invalid blockNumber"))?;
        return Ok(if status == Some("0x0") {
            ProbeState::Failed
        } else {
            ProbeState::Confirmed
        });
    }
    let response = transport.post_json(
        url,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":[tx_id]}),
    )?;
    let body = parse_rpc_body(response)?;
    let transaction = rpc_result(&body)?;
    if transaction.is_null() {
        Ok(ProbeState::NotFound)
    } else {
        require_transaction_id(transaction, "hash", tx_id)?;
        Ok(ProbeState::Submitted)
    }
}

pub(super) fn probe_bitcoin(
    transport: &dyn DestinationTransport,
    url: &str,
    tx_id: &str,
) -> Result<ProbeState> {
    if url.to_ascii_lowercase().contains(".g.alchemy.com") {
        let response = transport.post_json(
            url,
            &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"getrawtransaction","params":[tx_id,true]}),
        )?;
        return probe_raw_transaction_response(response, tx_id);
    }
    let endpoint = format!("{}/tx/{tx_id}/status", url.trim_end_matches('/'));
    let response = transport.get(&endpoint)?;
    if response.status == 404 {
        return Ok(ProbeState::NotFound);
    }
    if !response.is_success() {
        return Err(anyhow!(
            "Bitcoin status HTTP {}: {}",
            response.status,
            response.body
        ));
    }
    let body: serde_json::Value =
        serde_json::from_str(&response.body).context("parse Bitcoin transaction status")?;
    match body.get("confirmed").and_then(serde_json::Value::as_bool) {
        Some(true) => Ok(ProbeState::Confirmed),
        Some(false) => Ok(ProbeState::Submitted),
        None => Err(anyhow!("Bitcoin status omitted a boolean confirmed field")),
    }
}

pub(super) fn probe_zcash(
    transport: &dyn DestinationTransport,
    url: &str,
    tx_id: &str,
) -> Result<ProbeState> {
    if url.contains("blockchair") {
        return Err(anyhow!(
            "Blockchair reconciliation is not supported; use a Zcash JSON-RPC endpoint"
        ));
    }
    let response = transport.post_json(
        url,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"getrawtransaction","params":[tx_id,1]}),
    )?;
    probe_raw_transaction_response(response, tx_id)
}

fn probe_raw_transaction_response(response: HttpResponse, tx_id: &str) -> Result<ProbeState> {
    let body = parse_rpc_body_allow_not_found(response)?;
    if let Some(error) = body.get("error").filter(|value| !value.is_null()) {
        let code = error.get("code").and_then(serde_json::Value::as_i64);
        if code == Some(-5) {
            return Ok(ProbeState::NotFound);
        }
        return Err(anyhow!("destination reconciliation RPC error: {error}"));
    }
    let result = rpc_result(&body)?;
    if result.is_null() {
        return Ok(ProbeState::NotFound);
    }
    require_transaction_id(result, "txid", tx_id)?;
    // Mempool responses can omit confirmations. A malformed value cannot be
    // treated as zero, and a different transaction can never confirm ours.
    let confirmations = match result.get("confirmations") {
        None => 0,
        Some(value) => value
            .as_i64()
            .ok_or_else(|| anyhow!("invalid destination confirmation count"))?,
    };
    Ok(if confirmations > 0 {
        ProbeState::Confirmed
    } else if confirmations < 0 {
        ProbeState::Failed
    } else {
        ProbeState::Submitted
    })
}

fn rpc_result(body: &serde_json::Value) -> Result<&serde_json::Value> {
    body.get("result")
        .ok_or_else(|| anyhow!("destination reconciliation response omitted result"))
}

fn require_transaction_id(value: &serde_json::Value, field: &str, tx_id: &str) -> Result<()> {
    let actual = value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow!("destination reconciliation omitted {field}"))?;
    if !actual.eq_ignore_ascii_case(tx_id) {
        return Err(anyhow!(
            "destination reconciliation returned a different transaction"
        ));
    }
    Ok(())
}

fn parse_rpc_body(response: HttpResponse) -> Result<serde_json::Value> {
    let body = parse_rpc_body_allow_not_found(response)?;
    if let Some(error) = body.get("error").filter(|value| !value.is_null()) {
        return Err(anyhow!("destination reconciliation RPC error: {error}"));
    }
    Ok(body)
}

fn parse_rpc_body_allow_not_found(response: HttpResponse) -> Result<serde_json::Value> {
    if !response.is_success() {
        return Err(anyhow!(
            "destination reconciliation HTTP {}: {}",
            response.status,
            response.body
        ));
    }
    serde_json::from_str(&response.body).context("parse destination reconciliation response")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Reply(serde_json::Value);

    impl DestinationTransport for Reply {
        fn get(&self, _url: &str) -> Result<HttpResponse> {
            Ok(HttpResponse {
                status: 200,
                body: self.0.to_string(),
            })
        }
        fn post_json(&self, url: &str, _body: &serde_json::Value) -> Result<HttpResponse> {
            self.get(url)
        }
        fn post_text(&self, _url: &str, _body: &str) -> Result<HttpResponse> {
            Err(anyhow!("unexpected broadcast"))
        }
        fn post_form_hex(&self, _url: &str, _raw_hex: &str) -> Result<HttpResponse> {
            Err(anyhow!("unexpected broadcast"))
        }
    }

    #[test]
    fn malformed_rpc_success_is_neither_not_found_nor_confirmed() {
        for body in [
            serde_json::json!({}),
            serde_json::json!([]),
            serde_json::json!({"result": {}}),
        ] {
            let reply = Reply(body);
            assert!(probe_evm(&reply, "https://rpc.example", "0x1234").is_err());
            assert!(probe_zcash(&reply, "https://rpc.example", "1234").is_err());
        }
        let absent = Reply(serde_json::json!({"result": null}));
        assert_eq!(
            probe_evm(&absent, "https://rpc.example", "0x1234").unwrap(),
            ProbeState::NotFound
        );
    }

    #[test]
    fn mismatched_transaction_and_invalid_confirmation_fields_fail_closed() {
        for result in [
            serde_json::json!({"transactionHash":"0x5678", "status":"0x1", "blockNumber":"0x10"}),
            serde_json::json!({"transactionHash":"0x1234", "blockNumber":"0x10"}),
            serde_json::json!({"transactionHash":"0x1234", "status":"0x1", "blockNumber":false}),
        ] {
            assert!(probe_evm(
                &Reply(serde_json::json!({"result":result})),
                "https://rpc.example",
                "0x1234"
            )
            .is_err());
        }
        for result in [
            serde_json::json!({"txid":"wrong", "confirmations":10}),
            serde_json::json!({"txid":"1234", "confirmations":"10"}),
        ] {
            assert!(probe_zcash(
                &Reply(serde_json::json!({"result":result})),
                "https://rpc.example",
                "1234"
            )
            .is_err());
        }
        assert!(probe_bitcoin(
            &Reply(serde_json::json!({})),
            "https://esplora.example",
            "1234"
        )
        .is_err());
        let invalid_parameter =
            Reply(serde_json::json!({"error":{"code":-8,"message":"invalid parameter"}}));
        assert!(probe_zcash(&invalid_parameter, "https://rpc.example", "1234").is_err());
    }
}
