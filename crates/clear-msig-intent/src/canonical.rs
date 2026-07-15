use crate::error::IntentSchemaError;
use serde::Serialize;
use serde_json::Value;

pub(crate) fn canonical_json<T: Serialize>(value: &T) -> Result<String, IntentSchemaError> {
    let mut value = serde_json::to_value(value)?;
    sort_json(&mut value);
    Ok(serde_json::to_string(&value)?)
}

fn sort_json(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(sort_json),
        Value::Object(values) => {
            for value in values.values_mut() {
                sort_json(value);
            }
        }
        _ => {}
    }
}
