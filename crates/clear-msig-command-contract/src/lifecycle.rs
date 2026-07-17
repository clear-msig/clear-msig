use crate::validate_values;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypedExecutionContext {
    Backend,
    DryRun {
        actor_pubkey: Option<String>,
    },
    PreSigned {
        signer_pubkey: String,
        signature: String,
        message_flavor: Option<String>,
        signed_message: String,
    },
}

impl TypedExecutionContext {
    pub fn validate_boundary(&self) -> Result<(), String> {
        match self {
            Self::Backend => Ok(()),
            Self::DryRun { actor_pubkey } => validate_values(
                "typed lifecycle context",
                actor_pubkey.iter().map(String::as_str).collect(),
            ),
            Self::PreSigned {
                signer_pubkey,
                signature,
                message_flavor,
                signed_message,
            } => {
                let mut values = vec![
                    signer_pubkey.as_str(),
                    signature.as_str(),
                    signed_message.as_str(),
                ];
                values.extend(message_flavor.iter().map(String::as_str));
                validate_values("typed lifecycle context", values)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypedProposalLifecycle {
    Create {
        wallet: String,
        intent_index: u8,
        action_kind: u8,
        policy_commitment: String,
        payload_hash: String,
        envelope_hash: String,
        action_id: String,
        nonce: String,
        policy_bytes_hex: Option<String>,
        signable_text: Option<String>,
        canonical_intent_hex: Option<String>,
        expiry: Option<String>,
    },
    Approve {
        wallet: String,
        proposal: String,
    },
    Cancel {
        wallet: String,
        proposal: String,
    },
    Execute {
        wallet: String,
        proposal: String,
    },
}

impl TypedProposalLifecycle {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Create { .. } => "proposal typed-create",
            Self::Approve { .. } => "proposal typed-approve",
            Self::Cancel { .. } => "proposal typed-cancel",
            Self::Execute { .. } => "proposal typed-execute",
        }
    }

    pub fn validate_boundary(&self) -> Result<(), String> {
        let values = match self {
            Self::Create {
                wallet,
                policy_commitment,
                payload_hash,
                envelope_hash,
                action_id,
                nonce,
                policy_bytes_hex,
                canonical_intent_hex,
                expiry,
                ..
            } => {
                let mut values = vec![
                    wallet.as_str(),
                    policy_commitment.as_str(),
                    payload_hash.as_str(),
                    envelope_hash.as_str(),
                    action_id.as_str(),
                    nonce.as_str(),
                ];
                values.extend(policy_bytes_hex.iter().map(String::as_str));
                values.extend(canonical_intent_hex.iter().map(String::as_str));
                values.extend(expiry.iter().map(String::as_str));
                values
            }
            Self::Approve { wallet, proposal }
            | Self::Cancel { wallet, proposal }
            | Self::Execute { wallet, proposal } => vec![wallet.as_str(), proposal.as_str()],
        };
        validate_values("typed lifecycle", values)?;
        if let Self::Create {
            signable_text: Some(signable_text),
            ..
        } = self
        {
            if signable_text.len() > crate::MAX_ARG_BYTES {
                return Err("typed lifecycle value exceeds the size limit".into());
            }
            if signable_text.contains('\0') {
                return Err("typed lifecycle values cannot contain NUL bytes".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::TypedProposalLifecycle;

    #[test]
    fn readable_text_allows_lines_but_rejects_nul() {
        let mut lifecycle = TypedProposalLifecycle::Create {
            wallet: "team".into(),
            intent_index: 1,
            action_kind: 1,
            policy_commitment: "00".into(),
            payload_hash: "00".into(),
            envelope_hash: "00".into(),
            action_id: "send".into(),
            nonce: "1".into(),
            policy_bytes_hex: None,
            signable_text: Some("line one\nline two".into()),
            canonical_intent_hex: None,
            expiry: None,
        };
        assert!(lifecycle.validate_boundary().is_ok());
        if let TypedProposalLifecycle::Create { signable_text, .. } = &mut lifecycle {
            *signable_text = Some("bad\0text".into());
        }
        assert!(lifecycle.validate_boundary().is_err());
    }
}
