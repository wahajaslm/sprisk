//! Asset steps' folder and file name, from the question's asset bindings (ADR-0063 amendment,
//! 27 Oct). A step marks its folder setting `x-sprisk-asset-root` and its file setting
//! `x-sprisk-asset-file`, each naming a kind of file; the question binds each kind once.

use serde_json::{Map, Value, json};
use sprisk_contracts::{AssetBinding, Operator, QuestionVersion};

const ROOT: &str = "x-sprisk-asset-root";
const FILE: &str = "x-sprisk-asset-file";

/// The asset settings of `operator` that the question's bindings fill. A kind of file the
/// question does not bind fills nothing; compiling then refuses a required setting.
pub fn asset_params(operator: &Operator, question: &QuestionVersion) -> Map<String, Value> {
    let Some(properties) = operator
        .params_schema
        .get("properties")
        .and_then(Value::as_object)
    else {
        return Map::new();
    };
    let mut params = Map::new();
    for (name, schema) in properties {
        if let Some(binding) = marked(schema, ROOT).and_then(|kind| bound(question, kind)) {
            params.insert(name.clone(), json!(binding.asset_root.as_str()));
        }
        if let Some(binding) = marked(schema, FILE).and_then(|kind| bound(question, kind)) {
            params.insert(name.clone(), json!(file_pattern(binding)));
        }
    }
    params
}

/// Whether the question binds every kind of file in `kinds`.
pub fn binds_all(question: &QuestionVersion, kinds: impl IntoIterator<Item = String>) -> bool {
    kinds
        .into_iter()
        .all(|kind| bound(question, &kind).is_some())
}

fn marked<'s>(schema: &'s Value, marker: &str) -> Option<&'s str> {
    schema.get(marker).and_then(Value::as_str)
}

fn bound<'q>(question: &'q QuestionVersion, kind: &str) -> Option<&'q AssetBinding> {
    question
        .asset_bindings
        .iter()
        .find(|b| b.modality.to_string() == kind)
}

/// Without a pattern, the link column holds each row's file name.
fn file_pattern(binding: &AssetBinding) -> String {
    binding.file_pattern.as_ref().map_or_else(
        || format!("{{{}}}", binding.link_column.as_str()),
        |p| p.as_str().to_owned(),
    )
}
