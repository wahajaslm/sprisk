//! Methodology rules (ADR-0042): the rule catalog, what a rule's Python `decide()` reads,
//! and the proposal built from its decision. Graph mutation stays an explicit API Apply.

mod catalog;
mod decision;
pub mod facts;
pub use catalog::{CatalogError, RuleCatalog};
pub use decision::{
    Stamp, candidate_facts, candidates, flow_facts, observation, profile_facts, proposal,
    without_node,
};

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("node {0} does not exist")]
    UnknownNode(String),
    #[error("operator {0} is not registered")]
    UnknownOperator(String),
    #[error("the rule's decision does not fit its selection: {0}")]
    Selection(String),
    #[error("cannot remove the step: output {0} has no input of the same name to take its place")]
    Unremovable(String),
    #[error("the rule returned alternative {0}, which its manifest does not declare")]
    UndeclaredAlternative(String),
    #[error("could not construct proposal: {0}")]
    Contract(#[from] sprisk_contracts::ContractError),
    #[error("could not serialize proposal input: {0}")]
    Json(#[from] serde_json::Error),
}
