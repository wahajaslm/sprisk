//! Wire types generated from `contracts/schemas`. Do not hand-write wire types here.

use serde::de::DeserializeOwned;
use serde_json::Value;

typify::import_types!(
    schema = "../../contracts/bundle.schema.json",
    derives = [PartialEq],
);

impl PortRef {
    /// The step id and the port name. The schema checks the form `<step>.<port>`, so both
    /// parts are always there.
    pub fn step_and_port(&self) -> (&str, &str) {
        self.as_str().split_once('.').unwrap_or((self.as_str(), ""))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ContractError {
    #[error("null is not allowed; omit the field instead (at {0})")]
    Null(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Parse wire JSON. Use this, not `serde_json` directly: serde reads `null` as an
/// absent optional field, but `null` is never valid sprisk wire data.
pub fn parse<T: DeserializeOwned>(json: &str) -> Result<T, ContractError> {
    let value: Value = serde_json::from_str(json)?;
    if let Some(path) = find_null(&value, "$") {
        return Err(ContractError::Null(path));
    }
    Ok(serde_json::from_value(value)?)
}

fn find_null(value: &Value, path: &str) -> Option<String> {
    match value {
        Value::Null => Some(path.to_owned()),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(i, v)| find_null(v, &format!("{path}[{i}]"))),
        Value::Object(fields) => fields
            .iter()
            .find_map(|(k, v)| find_null(v, &format!("{path}.{k}"))),
        _ => None,
    }
}
