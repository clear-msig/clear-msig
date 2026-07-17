use serde::{Deserialize, Serialize};

use crate::ApiError;

pub(super) const FULL_PROFILE_ID: &str = "clearsig-full-v1";
pub(super) const LEDGER_COMPACT_PROFILE_ID: &str = "clearsig-ledger-solana-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RenderMode {
    Full,
    Compact,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct DeviceProfile {
    pub(super) id: &'static str,
    pub(super) version: u8,
    pub(super) mode: RenderMode,
    pub(super) max_document_bytes: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceProfileRequest {
    pub(super) id: String,
    #[serde(default)]
    pub(super) capability: Option<DeviceCapabilityRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceCapabilityRequest {
    pub(super) vendor: String,
    pub(super) app: String,
    pub(super) app_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceProfileResponse {
    pub(super) id: &'static str,
    pub(super) version: u8,
    pub(super) mode: &'static str,
    pub(super) max_document_bytes: usize,
}

const FULL_PROFILE: DeviceProfile = DeviceProfile {
    id: FULL_PROFILE_ID,
    version: 1,
    mode: RenderMode::Full,
    max_document_bytes: 2_048,
};

// This profile is deliberately conservative. Ledger's current Solana signer
// documentation identifies app 1.14+ as the capability boundary for the newer
// off-chain signing protocol. ClearSig still signs its existing raw V0 envelope,
// but does not activate compact rendering for an older or unknown app version.
const LEDGER_SOLANA_PROFILE: DeviceProfile = DeviceProfile {
    id: LEDGER_COMPACT_PROFILE_ID,
    version: 1,
    mode: RenderMode::Compact,
    max_document_bytes: 1_024,
};

impl DeviceProfile {
    pub(super) fn response(self) -> DeviceProfileResponse {
        DeviceProfileResponse {
            id: self.id,
            version: self.version,
            mode: match self.mode {
                RenderMode::Full => "full",
                RenderMode::Compact => "compact",
            },
            max_document_bytes: self.max_document_bytes,
        }
    }

    pub(super) fn display_label(self) -> String {
        format!("{}@{}", self.id, self.version)
    }
}

pub(super) fn resolve_device_profile(
    request: Option<&DeviceProfileRequest>,
) -> Result<DeviceProfile, ApiError> {
    let Some(request) = request else {
        return Ok(FULL_PROFILE);
    };
    match request.id.trim() {
        FULL_PROFILE_ID => Ok(FULL_PROFILE),
        LEDGER_COMPACT_PROFILE_ID => {
            let capability = request.capability.as_ref().ok_or_else(|| {
                ApiError::BadRequest(
                    "Ledger compact profile requires a device capability record".into(),
                )
            })?;
            if !capability.vendor.trim().eq_ignore_ascii_case("ledger")
                || !capability.app.trim().eq_ignore_ascii_case("solana")
                || !version_at_least(&capability.app_version, (1, 14, 0))
            {
                return Err(ApiError::BadRequest(
                    "Ledger compact profile requires the Ledger Solana app version 1.14.0 or newer"
                        .into(),
                ));
            }
            Ok(LEDGER_SOLANA_PROFILE)
        }
        other => Err(ApiError::BadRequest(format!(
            "unknown ClearSign device profile '{other}'"
        ))),
    }
}

fn version_at_least(value: &str, minimum: (u32, u32, u32)) -> bool {
    let mut parts = value.trim().split('.');
    let Some(major) = parts.next().and_then(|part| part.parse::<u32>().ok()) else {
        return false;
    };
    let Some(minor) = parts.next().and_then(|part| part.parse::<u32>().ok()) else {
        return false;
    };
    let Some(patch) = parts.next().and_then(|part| part.parse::<u32>().ok()) else {
        return false;
    };
    parts.next().is_none() && (major, minor, patch) >= minimum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_unknown_devices_to_the_full_profile() {
        assert_eq!(resolve_device_profile(None).unwrap(), FULL_PROFILE);
    }

    #[test]
    fn compact_profile_requires_an_allowlisted_capability() {
        let missing = DeviceProfileRequest {
            id: LEDGER_COMPACT_PROFILE_ID.into(),
            capability: None,
        };
        assert!(resolve_device_profile(Some(&missing)).is_err());

        let old = DeviceProfileRequest {
            id: LEDGER_COMPACT_PROFILE_ID.into(),
            capability: Some(DeviceCapabilityRequest {
                vendor: "Ledger".into(),
                app: "Solana".into(),
                app_version: "1.13.9".into(),
            }),
        };
        assert!(resolve_device_profile(Some(&old)).is_err());

        let supported = DeviceProfileRequest {
            id: LEDGER_COMPACT_PROFILE_ID.into(),
            capability: Some(DeviceCapabilityRequest {
                vendor: "Ledger".into(),
                app: "Solana".into(),
                app_version: "1.14.0".into(),
            }),
        };
        assert_eq!(
            resolve_device_profile(Some(&supported)).unwrap(),
            LEDGER_SOLANA_PROFILE
        );
    }

    #[test]
    fn rejects_unregistered_profile_ids_and_malformed_versions() {
        let unknown = DeviceProfileRequest {
            id: "browser-selected-500-bytes".into(),
            capability: None,
        };
        assert!(resolve_device_profile(Some(&unknown)).is_err());
        assert!(!version_at_least("1.14", (1, 14, 0)));
        assert!(!version_at_least("latest", (1, 14, 0)));
    }
}
