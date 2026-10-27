//! The operators the engine builds a step of each role from (ADR-0064): read from the
//! registry's role defaults, so core code names no operator.

use sprisk_contracts::{OperatorRole, SplitFolds};
use sprisk_registry::{Registry, RegistryError};

/// One operator reference per role the engine builds.
#[derive(Debug, Clone, PartialEq)]
pub struct Defaults {
    pub source: String,
    pub split: String,
    /// A split that keeps each entity on one side; the engine needs it only when the
    /// question names an entity column.
    pub group_split: Option<String>,
    pub model: String,
    pub score: String,
    pub score_shares: String,
    pub cross_validate: String,
    pub select: String,
}

impl Defaults {
    pub fn of(registry: &Registry) -> Result<Self, RegistryError> {
        let of = |role| registry.default_for(role).map(|o| o.id.to_string());
        let group_split = registry
            .operators()
            .find(|o| o.role == Some(OperatorRole::Split) && o.folds == Some(SplitFolds::Group))
            .map(|o| o.id.to_string());
        Ok(Self {
            source: of(OperatorRole::Source)?,
            split: of(OperatorRole::Split)?,
            group_split,
            model: of(OperatorRole::Model)?,
            score: of(OperatorRole::Score)?,
            score_shares: of(OperatorRole::ScoreShares)?,
            cross_validate: of(OperatorRole::CrossValidate)?,
            select: of(OperatorRole::Select)?,
        })
    }
}
