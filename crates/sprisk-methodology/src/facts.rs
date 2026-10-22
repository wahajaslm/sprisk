//! The fact catalog (ADR-0045): every fact Rust can send a rule, by pattern. A rule's
//! `reads` names entries here, so it can never depend on a fact that is never sent.

/// Every fact Rust sends a rule. `*` stands for a column or setting name.
pub const FACTS: &[&str] = &[
    "question.objective",
    // The success bar: the question's acceptance criteria joined by "; ", with the weakest
    // origin among them, so one inferred criterion makes the whole bar ask.
    "question.acceptance_criteria",
    "question.target",
    "question.task",
    "question.unit_of_analysis",
    "question.entity_column",
    "question.time_column",
    "question.prediction_horizon",
    // Misclassification costs (ADR-0053), each part as text: numbers as decimals.
    "question.costs.positive",
    "question.costs.false_negative",
    "question.costs.false_positive",
    // Families of the models seen downstream, joined by ", "; featureless when none declares one.
    "flow.model_families",
    // all, some or none: of the models downstream, those hidden behind another step.
    "flow.models_hidden",
    // The analysis or code steps downstream, which read the step's output.
    "flow.other_readers",
    // A text setting of the step itself, e.g. step.method.
    "step.*",
    // A model a shortlist rule may put forward: its family, featureless when it has none.
    "candidate.*.family",
    // Measured on the step's train rows.
    "rows",
    "column.*.data_type",
    "column.*.missing_share",
    "column.*.distinct",
    "column.*.skewness",
    "column.*.kurtosis",
    "column.*.outlier_share",
    "column.*.iqr",
    // The target column of the step's train rows: its type, distinct values, and the share
    // of its rarest value when it has few.
    "target.data_type",
    "target.distinct",
    "target.rarest_share",
    // Structure of the rows the step reads, measured before the split on all of them
    // (ADR-0059): types, duplicates, values that do not read as numbers. Never statistics.
    "input.rows",
    "input.duplicate_rows",
    "input.column.*.data_type",
    // Distinct values, which say whether a column identifies rows (structure, not statistics).
    "input.column.*.distinct",
    "input.column.*.numeric_share",
    // How many text values reading as numbers start with a zero, like the code 01234.
    "input.column.*.leading_zero_values",
    // The most common values of a text column that do not read as numbers (dataset text).
    "input.column.*.unconverted",
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

/// Whether a rule reading `reads` needs the structure of the rows its step reads measured.
pub fn needs_input_rows<'a>(mut reads: impl Iterator<Item = &'a str>) -> bool {
    reads.any(|r| r.starts_with("input."))
}

/// Whether a rule reading `reads` needs the train rows measured.
pub fn needs_train_rows<'a>(mut reads: impl Iterator<Item = &'a str>) -> bool {
    reads.any(|r| r == "rows" || r.starts_with("column.") || r.starts_with("target."))
}
