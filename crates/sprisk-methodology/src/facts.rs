//! The fact catalog (ADR-0045): every fact Rust can send a rule, by pattern. A rule's
//! `reads` names entries here, so it can never depend on a fact that is never sent.

/// Every fact Rust sends a rule. `*` stands for a column or setting name.
pub const FACTS: &[&str] = &[
    "question.target",
    "question.task",
    "question.unit_of_analysis",
    "question.entity_column",
    "question.time_column",
    "question.prediction_horizon",
    // Families of the models seen downstream, joined by ", "; featureless when none declares one.
    "flow.model_families",
    // all, some or none: of the models downstream that are hidden, fill gaps, standardise.
    "flow.models_hidden",
    "flow.models_fill_gaps",
    "flow.models_standardize",
    // The analysis or code steps downstream, which read the step's output.
    "flow.other_readers",
    // A text setting of the step itself, e.g. step.method.
    "step.*",
    // Measured on the step's train rows.
    "rows",
    "column.*.data_type",
    "column.*.missing_share",
    "column.*.distinct",
    "column.*.skewness",
    "column.*.kurtosis",
    "column.*.outlier_share",
    "column.*.iqr",
];

/// Whether `name`, a fact or a pattern from a rule's `reads`, is one Rust sends.
pub fn is_known(name: &str) -> bool {
    FACTS.iter().any(|f| *f == name || covers(f, name))
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
