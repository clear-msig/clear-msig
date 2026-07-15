use crate::{
    error::{invalid, IntentSchemaError},
    registered_template, IntentTransactionJson,
};
use serde::{Deserialize, Serialize};

pub const MANAGED_INTENT_REGISTRY_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTemplateStatus {
    Published,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedIntentTemplate {
    pub template_id: String,
    pub template_version: u32,
    pub publisher: String,
    pub status: ManagedTemplateStatus,
    pub canonical_hash: String,
    pub definition: IntentTransactionJson,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedIntentRegistry {
    pub registry_version: u16,
    pub templates: Vec<ManagedIntentTemplate>,
}

impl Default for ManagedIntentRegistry {
    fn default() -> Self {
        Self {
            registry_version: MANAGED_INTENT_REGISTRY_VERSION,
            templates: Vec::new(),
        }
    }
}

impl ManagedIntentRegistry {
    pub fn publish(
        &mut self,
        publisher: &str,
        template_version: u32,
        definition: IntentTransactionJson,
    ) -> Result<&ManagedIntentTemplate, IntentSchemaError> {
        let publisher = publisher.trim();
        if publisher.is_empty() {
            return Err(invalid("managed template publisher must not be empty"));
        }
        if template_version == 0 {
            return Err(invalid("managed template version must be at least 1"));
        }
        definition.validate()?;
        let template_id = definition
            .template_id
            .as_deref()
            .ok_or_else(|| invalid("managed template requires template_id"))?
            .trim();
        if template_id.is_empty() {
            return Err(invalid("managed template_id must not be empty"));
        }
        if registered_template(template_id).is_some() {
            return Err(invalid(
                "managed templates cannot shadow a built-in template_id",
            ));
        }
        let canonical_hash = hex_hash(definition.canonical_hash()?);
        if let Some(index) = self.templates.iter().position(|entry| {
            entry.template_id == template_id && entry.template_version == template_version
        }) {
            let existing = &self.templates[index];
            if existing.publisher == publisher
                && existing.canonical_hash == canonical_hash
                && existing.definition == definition
            {
                return Ok(&self.templates[index]);
            }
            return Err(invalid(format!(
                "managed template '{template_id}' version {template_version} is immutable"
            )));
        }
        self.templates.push(ManagedIntentTemplate {
            template_id: template_id.to_owned(),
            template_version,
            publisher: publisher.to_owned(),
            status: ManagedTemplateStatus::Published,
            canonical_hash,
            definition,
        });
        Ok(self.templates.last().expect("published template exists"))
    }

    pub fn revoke(
        &mut self,
        publisher: &str,
        template_id: &str,
        template_version: u32,
    ) -> Result<(), IntentSchemaError> {
        let entry = self
            .templates
            .iter_mut()
            .find(|entry| {
                entry.template_id == template_id && entry.template_version == template_version
            })
            .ok_or_else(|| invalid("managed template version was not found"))?;
        if entry.publisher != publisher.trim() {
            return Err(invalid(
                "only the template publisher can revoke this version",
            ));
        }
        entry.status = ManagedTemplateStatus::Revoked;
        Ok(())
    }

    pub fn resolve_published(
        &self,
        template_id: &str,
        template_version: u32,
        canonical_hash: &str,
    ) -> Result<&ManagedIntentTemplate, IntentSchemaError> {
        let entry = self
            .templates
            .iter()
            .find(|entry| {
                entry.template_id == template_id && entry.template_version == template_version
            })
            .ok_or_else(|| invalid("managed template version was not found"))?;
        if entry.status != ManagedTemplateStatus::Published {
            return Err(invalid("managed template version is revoked"));
        }
        if !entry
            .canonical_hash
            .eq_ignore_ascii_case(canonical_hash.trim())
        {
            return Err(invalid("managed template canonical hash does not match"));
        }
        Ok(entry)
    }

    pub fn validate(&self) -> Result<(), IntentSchemaError> {
        if self.registry_version != MANAGED_INTENT_REGISTRY_VERSION {
            return Err(invalid("unsupported managed intent registry version"));
        }
        for (index, entry) in self.templates.iter().enumerate() {
            entry.definition.validate()?;
            if entry.template_version == 0
                || entry.publisher.trim().is_empty()
                || entry.definition.template_id.as_deref() != Some(entry.template_id.as_str())
                || entry.canonical_hash != hex_hash(entry.definition.canonical_hash()?)
                || registered_template(&entry.template_id).is_some()
            {
                return Err(invalid("managed template manifest is inconsistent"));
            }
            if self.templates[..index].iter().any(|other| {
                other.template_id == entry.template_id
                    && other.template_version == entry.template_version
            }) {
                return Err(invalid(
                    "managed template registry contains a duplicate version",
                ));
            }
        }
        Ok(())
    }
}

fn hex_hash(hash: [u8; 32]) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ChainKindJson;

    fn custom_definition(template: &str) -> IntentTransactionJson {
        IntentTransactionJson {
            schema_version: 1,
            template_id: Some("org_payroll_sol_v1".into()),
            chain: ChainKindJson::Solana,
            params: Vec::new(),
            accounts: Vec::new(),
            instructions: Vec::new(),
            tx_template: None,
            template: template.into(),
        }
    }

    #[test]
    fn publishes_shares_and_revokes_an_immutable_version() {
        let mut registry = ManagedIntentRegistry::default();
        let published = registry
            .publish("org:clear", 1, custom_definition("pay payroll"))
            .unwrap()
            .clone();

        assert_eq!(
            registry
                .resolve_published(
                    &published.template_id,
                    published.template_version,
                    &published.canonical_hash,
                )
                .unwrap(),
            &published
        );
        assert!(registry
            .publish("org:clear", 1, custom_definition("redirect payroll"))
            .is_err());
        assert!(registry
            .revoke("org:mallory", &published.template_id, 1)
            .is_err());
        registry
            .revoke("org:clear", &published.template_id, 1)
            .unwrap();
        assert!(registry
            .resolve_published(&published.template_id, 1, &published.canonical_hash)
            .is_err());
        registry.validate().unwrap();
    }

    #[test]
    fn rejects_tampered_imports_and_builtin_shadowing() {
        let mut registry = ManagedIntentRegistry::default();
        registry
            .publish("org:clear", 1, custom_definition("pay payroll"))
            .unwrap();
        registry.templates[0].definition.template = "send elsewhere".into();
        assert!(registry.validate().is_err());

        let mut builtin = custom_definition("transfer {1:10^9} SOL to {0}");
        builtin.template_id = Some("solana_transfer_v1".into());
        assert!(ManagedIntentRegistry::default()
            .publish("org:clear", 1, builtin)
            .is_err());
    }
}
