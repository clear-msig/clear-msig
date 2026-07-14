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
    if let Some(receipt) = body.get("result").filter(|value| !value.is_null()) {
        if receipt.get("status").and_then(|value| value.as_str()) == Some("0x0") {
            return Ok(ProbeState::Failed);
        }
        return Ok(
            if receipt
                .get("blockNumber")
                .is_some_and(|value| !value.is_null())
            {
                ProbeState::Confirmed
            } else {
                ProbeState::Submitted
            },
        );
    }
    let response = transport.post_json(
        url,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":[tx_id]}),
    )?;
    let body = parse_rpc_body(response)?;
    Ok(
        if body.get("result").is_some_and(|value| !value.is_null()) {
            ProbeState::Submitted
        } else {
            ProbeState::NotFound
        },
    )
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
        return probe_raw_transaction_response(response);
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
    Ok(
        if body.get("confirmed").and_then(serde_json::Value::as_bool) == Some(true) {
            ProbeState::Confirmed
        } else {
            ProbeState::Submitted
        },
    )
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
    probe_raw_transaction_response(response)
}

fn probe_raw_transaction_response(response: HttpResponse) -> Result<ProbeState> {
    let body = parse_rpc_body_allow_not_found(response)?;
    if let Some(error) = body.get("error").filter(|value| !value.is_null()) {
        let code = error.get("code").and_then(serde_json::Value::as_i64);
        if matches!(code, Some(-5 | -8)) {
            return Ok(ProbeState::NotFound);
        }
        return Err(anyhow!("destination reconciliation RPC error: {error}"));
    }
    let result = body.get("result").filter(|value| !value.is_null());
    let Some(result) = result else {
        return Ok(ProbeState::NotFound);
    };
    let confirmations = result
        .get("confirmations")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    Ok(if confirmations > 0 {
        ProbeState::Confirmed
    } else if confirmations < 0 {
        ProbeState::Failed
    } else {
        ProbeState::Submitted
    })
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
