//! What an evidence producer measured (ADR-0063): one object per kind it declares in
//! `produces`, with exactly the declared fields, each of its declared type.

use serde_json::Value;
use sprisk_contracts::{EvidenceFieldType, EvidenceSet, Operator, parse};

/// The output where an evidence producer writes what it measured, by kind.
pub const EVIDENCE_PORT: &str = "evidence";

#[derive(Debug, thiserror::Error)]
#[error("{operator}: {problem}")]
pub struct EvidenceError {
    pub operator: String,
    pub problem: String,
}

/// Refuses evidence from `operator` that does not match its manifest.
pub fn check(operator: &Operator, measured: &Value) -> Result<(), EvidenceError> {
    let refuse = |problem: String| EvidenceError {
        operator: operator.id.to_string(),
        problem,
    };
    parse::<EvidenceSet>(&measured.to_string())
        .map_err(|e| refuse(format!("its evidence is not an EvidenceSet: {e}")))?;
    let Some(kinds) = measured.as_object() else {
        return Err(refuse("its evidence is not an object".into()));
    };
    if let Some(extra) = kinds
        .keys()
        .find(|k| !operator.produces.keys().any(|p| p.as_str() == k.as_str()))
    {
        return Err(refuse(format!(
            "measured {extra}, which it does not declare"
        )));
    }
    for (kind, produced) in &operator.produces {
        let kind = kind.as_str();
        let fields = kinds
            .get(kind)
            .and_then(Value::as_object)
            .ok_or_else(|| refuse(format!("did not measure {kind}")))?;
        if let Some(extra) = fields
            .keys()
            .find(|f| !produced.fields.keys().any(|d| d.as_str() == f.as_str()))
        {
            return Err(refuse(format!("{kind}.{extra} is not declared")));
        }
        for (name, declared) in &produced.fields {
            let name = name.as_str();
            let value = fields
                .get(name)
                .ok_or_else(|| refuse(format!("{kind} has no {name}")))?;
            if !is_of(value, *declared) {
                return Err(refuse(format!("{kind}.{name} is {value}, not {declared}")));
            }
        }
    }
    Ok(())
}

fn is_of(value: &Value, declared: EvidenceFieldType) -> bool {
    match declared {
        EvidenceFieldType::Integer => value.is_i64() || value.is_u64(),
        EvidenceFieldType::Number => value.is_number(),
        EvidenceFieldType::Boolean => value.is_boolean(),
        EvidenceFieldType::String => value.is_string(),
        EvidenceFieldType::StringList => value
            .as_array()
            .is_some_and(|items| items.iter().all(Value::is_string)),
    }
}
