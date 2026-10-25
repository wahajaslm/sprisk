//! The fixed, explainable mapping from a question ledger and stored profile to Explore views.

use serde_json::json;
use sprisk_contracts::{
    ArtifactId, ColumnRole, DatasetProfile, ProfilePlan, QuestionVersion, TaskType, parse,
};

/// Select input-scope views only from immutable question fields and stored profile facts.
///
/// This is deliberately a small, pure selector: it does not infer semantic bindings, execute a
/// methodology rule, or inspect data rows. The browser receives this result verbatim.
pub fn input_plan(
    artifact_id: &ArtifactId,
    profile: &DatasetProfile,
    question: Option<&QuestionVersion>,
) -> Result<ProfilePlan, serde_json::Error> {
    let mut sections = vec![
        section(
            "overview",
            "Overview",
            "Establish the size and bounds of the descriptive profile.",
            "Every table starts with a bounded descriptive overview.",
        ),
        section(
            "data_quality",
            "Data quality",
            "Show gaps, blank text, duplicate rows and profile findings.",
            "Every table is checked for structural quality before methodology is applied.",
        ),
        section(
            "columns",
            "Columns",
            "Describe each profiled column's observed type, role and distribution.",
            "Every table needs a column inventory before its fields can be bound to the question.",
        ),
        section(
            "relationships",
            "Relationships",
            "Show bounded numeric associations between observed columns.",
            "The stored profile contains a bounded correlation view for this table.",
        ),
    ];

    let mut limitations = vec![
        "Input-scope views are descriptive and must not be used to fit preparation or choose a model.".to_owned(),
        format!(
            "This profile covers {} of {} rows and {} of {} columns.",
            profile.profiled_rows,
            profile.total_rows,
            profile.columns.len(),
            profile.total_columns
        ),
    ];

    if let Some(question) = question {
        let has_target = question.target.is_some();
        if let Some(target) = &question.target {
            sections.push(section(
                "target",
                "Target",
                "Show the observed values of the target declared in the question ledger.",
                &format!(
                    "The question ledger declares '{}' as the target column.",
                    target.value.as_str()
                ),
            ));
        }
        match question.task.value {
            TaskType::Classification if has_target => sections.push(section(
                "classification",
                "Class balance",
                "Show the observed distribution of the declared target.",
                "The question ledger declares a classification task with a target.",
            )),
            TaskType::Regression if has_target => sections.push(section(
                "regression",
                "Target distribution",
                "Show the observed distribution of the declared numeric target.",
                "The question ledger declares a regression task with a target.",
            )),
            TaskType::Classification | TaskType::Regression => limitations.push(
                "The question declares a supervised task but no target is recorded, so target-specific views are unavailable.".to_owned(),
            ),
            TaskType::Exploration | TaskType::Undetermined => {}
        }
        if question.entity_column.is_some() {
            sections.push(section(
                "entity_integrity",
                "Entity integrity",
                "Inspect the declared entity field for repeated entities and split risk.",
                "The question ledger declares an entity column, so entity-aware evidence is required before splitting.",
            ));
        }
        if question.time_column.is_some() {
            sections.push(section(
                "temporal_integrity",
                "Temporal integrity",
                "Inspect the declared time field for ordering, coverage and temporal split risk.",
                "The question ledger declares a time column, so temporal evidence is required before splitting.",
            ));
        }
    }

    if profile
        .columns
        .iter()
        .any(|column| column.role == Some(ColumnRole::Text))
    {
        sections.push(section(
            "text",
            "Text exploration",
            "Show text length, blankness and markup indicators for observed text fields.",
            "At least one stored column profile has the observed role 'text'.",
        ));
    }
    if profile
        .columns
        .iter()
        .any(|column| column.role == Some(ColumnRole::Category))
    {
        sections.push(section(
            "categories",
            "Category exploration",
            "Show frequency and rarity patterns for observed categorical fields.",
            "At least one stored column profile has the observed role 'category'.",
        ));
    }

    let mut value = json!({
        "schema_version": "sprisk.profile_plan/v1",
        "artifact_id": artifact_id,
        "scope": "input",
        "sections": sections,
        "limitations": limitations,
    });
    if let Some(question) = question {
        value["question_version_id"] = json!(question.id);
    }
    parse(&value.to_string())
        .map_err(|error| serde_json::Error::io(std::io::Error::other(error.to_string())))
}

fn section(id: &str, title: &str, purpose: &str, reason: &str) -> serde_json::Value {
    json!({
        "id": id,
        "title": title,
        "purpose": purpose,
        "evidence_scope": "input",
        "reason": reason,
    })
}
