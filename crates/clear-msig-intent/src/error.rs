use std::fmt;

#[derive(Debug)]
pub enum IntentSchemaError {
    Invalid(String),
    Json(serde_json::Error),
}

impl fmt::Display for IntentSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::Json(error) => write!(f, "intent JSON error: {error}"),
        }
    }
}

impl std::error::Error for IntentSchemaError {}

impl From<serde_json::Error> for IntentSchemaError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

pub(crate) fn invalid(message: impl Into<String>) -> IntentSchemaError {
    IntentSchemaError::Invalid(message.into())
}
