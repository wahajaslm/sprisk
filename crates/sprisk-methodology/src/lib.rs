//! Methodology rules (ADR-0042): the rule catalog, what a rule's Python `decide()` reads,
//! and the proposal built from its decision. Graph mutation stays an explicit API Apply.

mod catalog;
mod decision;
pub use catalog::{CatalogError, RuleCatalog};
pub use decision::{observation, profile_facts, proposal};

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("node {0} does not exist")]
    UnknownNode(String),
    #[error("node {0} is not a supported split")]
    NotSplit(String),
    #[error("the rule returned alternative {0}, which its manifest does not declare")]
    UndeclaredAlternative(String),
    #[error("could not construct proposal: {0}")]
    Contract(#[from] sprisk_contracts::ContractError),
    #[error("could not serialize proposal input: {0}")]
    Json(#[from] serde_json::Error),
}
