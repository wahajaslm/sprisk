//! Methodology rules (ADR-0042): the rule catalog, what a rule's Python `decide()` reads,
//! and the proposal built from its decision. Graph mutation stays an explicit API Apply.

mod catalog;
mod compare;
mod decision;
pub mod facts;
pub mod review;
pub mod search;
pub use catalog::{CatalogError, RuleCatalog, decides, reopened_stage};
pub use compare::{
    Comparison, FOLDS, INNER_FOLDS, REPEATS, SEED, SELECT_NODE, Scoring, StudySearch, TrialStep,
    comparison, preparation_comparison, study_comparison, trial_steps,
};
pub use decision::{
    Stamp, candidate_facts, candidates, flow_facts, input_facts, join_facts, observation,
    one_table_into, profile_facts, proposal, result_facts, target_facts, train_rows_source,
    unread_sources, with_node_before, without_node,
};

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("node {0} does not exist")]
    UnknownNode(String),
    #[error("operator {0} is not registered")]
    UnknownOperator(String),
    #[error("models {first} and {second} share the candidate id {id}; register one of them")]
    SharedCandidateId {
        id: String,
        first: String,
        second: String,
    },
    #[error("the model selection scored no candidate {0}")]
    NotCompared(String),
    #[error("the train rows cannot be traced to a split: {0}")]
    NotTrainRows(String),
    #[error(
        "step {step} runs its own code, but each fold would refit it with {operator}'s code; revert it to compare"
    )]
    OwnCode { step: String, operator: String },
    #[error("nothing to compare: {0}")]
    NothingToCompare(String),
    #[error("the rule's decision does not fit its selection: {0}")]
    Selection(String),
    #[error("cannot remove the step: output {0} has no input of the same name to take its place")]
    Unremovable(String),
    #[error("these rules wait on each other, so none can go first: {0}")]
    Unordered(String),
    #[error("cannot add the step: {0}")]
    NotInsertable(String),
    #[error("the rule returned alternative {0}, which its manifest does not declare")]
    UndeclaredAlternative(String),
    #[error("could not construct proposal: {0}")]
    Contract(#[from] sprisk_contracts::ContractError),
    #[error(transparent)]
    OverBudget(#[from] search::BudgetError),
    #[error("could not serialize proposal input: {0}")]
    Json(#[from] serde_json::Error),
}
