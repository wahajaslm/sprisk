//! Arch §9 cache keys. Pure: the same step and input bytes always give the same key.

use serde_json::json;
use sha2::{Digest, Sha256};
use sprisk_contracts::Effects;
use sprisk_graph::Step;

/// Only pure steps may reuse earlier outputs. Nondeterministic steps (sources that read
/// files which can change) and side-effecting steps (user code) always run.
pub(crate) fn cacheable(step: &Step) -> bool {
    step.operator.effects == Effects::Pure
}

/// Project, operator version, the digest of its code, its params and its inputs' content
/// hashes (by port). Seeds are params. Scoped to the project so no project ever receives
/// another's artifacts. JSON object keys are sorted, so the bytes are stable.
pub(crate) fn cache_key(project: &str, step: &Step, inputs: &[(String, String)]) -> String {
    let doc = json!({
        "key_version": 1,
        "project": project,
        "operator": step.operator.id,
        "implementation": step.implementation_digest,
        "params": step.params,
        "inputs": inputs,
    });
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(doc.to_string().as_bytes()))
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn step() -> Step {
        let operator = json!({
            "schema_version": "sprisk.operator/v1",
            "id": "acme.ml.fit@1.0.0",
            "capability_class": "estimator",
            "entrypoint": "acme.fit:fit",
            "inputs": [
                { "name": "train", "kind": "table" },
                { "name": "words", "kind": "matrix", "optional": true }
            ],
            "outputs": [{ "name": "model", "kind": "model" }],
            "params_schema": { "type": "object" },
            "effects": "pure",
            "network": "none",
            "resources": { "cpu_cores": 1, "memory_mb": 64, "gpu": "none", "timeout_seconds": 60 }
        });
        Step {
            node_id: "fit".into(),
            operator: sprisk_contracts::parse(&operator.to_string()).unwrap(),
            implementation_digest: "sha256:code".into(),
            params: serde_json::Map::new(),
            inputs: Vec::new(),
            code: None,
        }
    }

    #[test]
    fn a_step_run_with_its_optional_words_never_reuses_one_run_without_them() {
        let train = ("train".to_owned(), "sha256:rows".to_owned());
        let words = ("words".to_owned(), "sha256:rows".to_owned());

        let without = cache_key("prj", &step(), std::slice::from_ref(&train));
        let with = cache_key("prj", &step(), &[train, words]);

        assert_ne!(without, with);
    }
}
