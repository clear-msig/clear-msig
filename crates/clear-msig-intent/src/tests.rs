use super::*;
use std::{collections::HashSet, fs, path::PathBuf};

#[test]
fn every_registered_example_is_versioned_and_valid() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/intents");
    let mut ids = HashSet::new();
    for registered in BUILTIN_INTENT_TEMPLATES {
        assert!(
            ids.insert(registered.id),
            "duplicate template id {}",
            registered.id
        );
        let json = fs::read_to_string(root.join(registered.file)).unwrap();
        let value: IntentTransactionJson = serde_json::from_str(&json).unwrap();
        assert_eq!(validate_registered_template(&value).unwrap(), registered);
        assert_ne!(value.canonical_hash().unwrap(), [0; 32]);
    }

    let committed_registry = fs::read_to_string(root.join("registry-v1.json")).unwrap();
    assert_eq!(committed_registry, registry_json_pretty().unwrap());

    for chain in [
        ChainKindJson::Solana,
        ChainKindJson::Evm1559,
        ChainKindJson::BitcoinP2wpkh,
        ChainKindJson::ZcashTransparent,
        ChainKindJson::Evm1559Erc20,
        ChainKindJson::HyperliquidEvm,
    ] {
        assert_eq!(
            BUILTIN_INTENT_TEMPLATES
                .iter()
                .filter(|entry| entry.chain == chain && entry.default_for_chain)
                .count(),
            1,
            "chain {chain:?} must have exactly one default template"
        );
    }
}

#[test]
fn canonicalization_ignores_json_field_order() {
    let left: IntentTransactionJson = serde_json::from_str(
            r#"{"schema_version":1,"template_id":"example_v1","params":[{"name":"amount","type":"u64"}],"template":"send {0}"}"#,
        )
        .unwrap();
    let right: IntentTransactionJson = serde_json::from_str(
            r#"{"template":"send {0}","params":[{"type":"u64","name":"amount"}],"template_id":"example_v1","schema_version":1}"#,
        )
        .unwrap();
    assert_eq!(
        left.canonical_json().unwrap(),
        right.canonical_json().unwrap()
    );
    assert_eq!(
        left.canonical_hash().unwrap(),
        right.canonical_hash().unwrap()
    );
}

#[test]
fn validation_rejects_unknown_versions_and_template_injection() {
    let unknown: IntentTransactionJson = serde_json::from_str(
        r#"{"schema_version":2,"template_id":"future_v2","params":[],"template":"ok"}"#,
    )
    .unwrap();
    assert!(unknown.validate().is_err());

    let injected: IntentTransactionJson = serde_json::from_str(
        r#"{"schema_version":1,"params":[{"name":"amount","type":"u64"}],"template":"send {1}"}"#,
    )
    .unwrap();
    assert!(injected.validate().is_err());

    assert!(render_template("send {0:10^2}", &[ParamTypeJson::U8], &[1]).is_err());
    assert!(render_template("send £{0}", &[ParamTypeJson::U64], &[0; 8]).is_err());
}

#[test]
fn committed_render_vectors_match_the_shared_renderer() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/intents");
    let committed = fs::read_to_string(root.join("render-vectors-v1.json")).unwrap();
    assert_eq!(committed, render_vectors_json_pretty().unwrap());
    for vector in render_vectors_artifact().vectors {
        let params_data = decode_hex(&vector.params_data_hex);
        assert_eq!(
            render_template(&vector.template, &vector.param_types, &params_data).unwrap(),
            vector.expected,
            "{}",
            vector.id
        );
    }
}

fn decode_hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).unwrap();
            u8::from_str_radix(pair, 16).unwrap()
        })
        .collect()
}
