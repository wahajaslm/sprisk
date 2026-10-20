//! The fact catalog (ADR-0045): every fact Rust can send a rule, by pattern. A rule's
//! `reads` names entries here, so it can never depend on a fact that is never sent.

/// A fact a rule may read. `*` in a name stands for a column or setting name.
pub struct FactSpec {
    pub name: &'static str,
    pub description: &'static str,
}

const fn fact(name: &'static str, description: &'static str) -> FactSpec {
    FactSpec { name, description }
}

pub const FACTS: &[FactSpec] = &[
    fact("question.target", "Target column."),
    fact(
        "question.task",
        "classification, regression, exploration or undetermined.",
    ),
    fact("question.unit_of_analysis", "What one row stands for."),
    fact(
        "question.entity_column",
        "Column naming the entity a row belongs to.",
    ),
    fact(
        "question.time_column",
        "Column giving when a row was observed.",
    ),
    fact(
        "question.prediction_horizon",
        "How far ahead the target lies.",
    ),
    fact(
        "flow.model_families",
        "Families of the models seen downstream, from their manifests, joined by ', '; featureless when none declares one.",
    ),
    fact(
        "flow.models_hidden",
        "Whether all, some or none of the models downstream sit behind a step or model that may change the columns.",
    ),
    fact(
        "flow.models_fill_gaps",
        "Whether all, some or none of the models downstream fill gaps themselves on the train rows.",
    ),
    fact(
        "flow.models_standardize",
        "Whether all, some or none of the models downstream standardise their own inputs on the train rows.",
    ),
    fact(
        "flow.other_readers",
        "The analysis or code steps downstream, which read this step's output, joined by ', '.",
    ),
    fact(
        "step.*",
        "A text setting of the step itself, e.g. step.method.",
    ),
    fact("rows", "Train rows profiled."),
    fact(
        "column.*.data_type",
        "A step column's data type in the train rows.",
    ),
    fact(
        "column.*.missing_share",
        "Share of a step column's train values that are missing.",
    ),
    fact(
        "column.*.distinct",
        "Distinct values in a step column's train rows.",
    ),
    fact(
        "column.*.skewness",
        "Skewness of a numeric step column with variation.",
    ),
    fact(
        "column.*.kurtosis",
        "Excess kurtosis of a numeric step column with variation.",
    ),
    fact(
        "column.*.outlier_share",
        "Share of a numeric step column's train values outside the 1.5 x IQR fences.",
    ),
    fact(
        "column.*.iqr",
        "Interquartile range of a numeric step column's train values.",
    ),
];

/// Whether `name`, a fact or a pattern from a rule's `reads`, is one Rust sends.
pub fn is_known(name: &str) -> bool {
    FACTS.iter().any(|f| f.name == name || covers(f.name, name))
}

/// Whether the fact `name` is one `pattern` from `reads` covers.
pub fn covers(pattern: &str, name: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == name,
        Some((prefix, suffix)) => {
            name.len() > prefix.len() + suffix.len()
                && name.starts_with(prefix)
                && name.ends_with(suffix)
        }
    }
}

/// Whether a rule reading `reads` needs the train rows measured.
pub fn needs_train_rows<'a>(mut reads: impl Iterator<Item = &'a str>) -> bool {
    reads.any(|r| r == "rows" || r.starts_with("column."))
}
