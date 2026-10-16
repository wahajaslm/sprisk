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
