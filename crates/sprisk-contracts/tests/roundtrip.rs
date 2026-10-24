//! Every valid fixture must round-trip unchanged; every invalid one must be rejected.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{
    AppliedMethodologyDecision, ApplyMethodologyDecision, Artifact, Attempt, AttemptOutput,
    Binding, CodeDisplay, CodeInterface, CodeSplit, CodeSplitRequest, ConceptSet, CreateRun,
    CreateStudy, CreateWalk, DatasetProfile, DecisionProposal, EvidenceSet, FigureSet, KeyMatches,
    LoadedTable, Method, MethodAnswer, MethodRequest, MethodologyCheck, MethodologyDecision,
    MethodologyReview, MethodologyRule, MethodologyRuleSource, ModelSelection, NotebookCode,
    NotebookCodeRequest, NotebookExecute, NotebookExecution, NotebookExecutionEvent,
    NotebookKernelRequest, NotebookSettings, NotebookSettingsRequest, NotebookVariables,
    NotebookVersion, Operator, OperatorSource, PipelineVersion, Problem, QuestionVersion,
    RuleAnswer, RuleDecision, RuleObservation, RuleRequest, Run, SelectionDecision, Study,
    StudyDetail, TablePage, Trial, VerificationRequest, Walk, WalkDetail, WalkStep, WorkerMessage,
    parse,
};

fn fixtures(entity: &str, kind: &str) -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract")
        .join(entity)
        .join(kind);
    let mut paths: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no fixtures in {}", dir.display());
    paths
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn check<T: Serialize + DeserializeOwned>(entity: &str) {
    for path in fixtures(entity, "valid") {
        let text = read(&path);
        let original: serde_json::Value = serde_json::from_str(&text).unwrap();
        let parsed: T =
            parse(&text).unwrap_or_else(|e| panic!("{} should parse: {e}", path.display()));
        let reserialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(
            reserialized,
            original,
            "{} changed on round-trip",
            path.display()
        );
    }
    for path in fixtures(entity, "invalid") {
        let result = parse::<T>(&read(&path));
        assert!(result.is_err(), "{} should be rejected", path.display());
    }
}

const ENTITIES: &[&str] = &[
    "applied_methodology_decision",
    "apply_methodology_decision",
    "artifact",
    "attempt",
    "attempt_output",
    "binding",
    "code_display",
    "code_interface",
    "code_split",
    "code_split_request",
    "concept_set",
    "create_run",
    "create_study",
    "create_walk",
    "dataset_profile",
    "decision_proposal",
    "evidence_set",
    "figure_set",
    "key_matches",
    "loaded_table",
    "method",
    "method_answer",
    "method_request",
    "methodology_check",
    "methodology_decision",
    "methodology_review",
    "methodology_rule",
    "methodology_rule_source",
    "model_selection",
    "notebook_code",
    "notebook_code_request",
    "notebook_execute",
    "notebook_execution",
    "notebook_execution_event",
    "notebook_kernel_request",
    "notebook_settings",
    "notebook_settings_request",
    "notebook_variables",
    "notebook_version",
    "operator",
    "operator_source",
    "pipeline_version",
    "problem",
    "question_version",
    "rule_answer",
    "rule_decision",
    "rule_observation",
    "rule_request",
    "run",
    "selection_decision",
    "study",
    "study_detail",
    "table_page",
    "trial",
    "verification_request",
    "walk",
    "walk_detail",
    "walk_step",
    "worker_message",
];

#[test]
fn every_fixture_dir_has_an_entity() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/contract");
    let mut dirs: Vec<String> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.is_dir())
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    dirs.sort();
    assert_eq!(
        dirs, ENTITIES,
        "add a #[test] and an ENTITIES entry per fixture dir"
    );
}

#[test]
fn artifact() {
    check::<Artifact>("artifact");
}

#[test]
fn operator() {
    check::<Operator>("operator");
}

#[test]
fn pipeline_version() {
    check::<PipelineVersion>("pipeline_version");
}

#[test]
fn run() {
    check::<Run>("run");
}

#[test]
fn attempt() {
    check::<Attempt>("attempt");
}

#[test]
fn worker_message() {
    check::<WorkerMessage>("worker_message");
}

#[test]
fn question_version() {
    check::<QuestionVersion>("question_version");
}

#[test]
fn methodology_check() {
    check::<MethodologyCheck>("methodology_check");
}

#[test]
fn decision_proposal() {
    check::<DecisionProposal>("decision_proposal");
}

#[test]
fn methodology_review() {
    check::<MethodologyReview>("methodology_review");
}

#[test]
fn apply_methodology_decision() {
    check::<ApplyMethodologyDecision>("apply_methodology_decision");
}

#[test]
fn methodology_decision() {
    check::<MethodologyDecision>("methodology_decision");
}

#[test]
fn applied_methodology_decision() {
    check::<AppliedMethodologyDecision>("applied_methodology_decision");
}

#[test]
fn attempt_output() {
    check::<AttemptOutput>("attempt_output");
}

#[test]
fn create_run() {
    check::<CreateRun>("create_run");
}

#[test]
fn problem() {
    check::<Problem>("problem");
}

#[test]
fn table_page() {
    check::<TablePage>("table_page");
}

#[test]
fn code_display() {
    check::<CodeDisplay>("code_display");
}

#[test]
fn loaded_table() {
    check::<LoadedTable>("loaded_table");
}

#[test]
fn key_matches() {
    check::<KeyMatches>("key_matches");
}

#[test]
fn dataset_profile() {
    check::<DatasetProfile>("dataset_profile");
}

#[test]
fn notebook_execution_event() {
    check::<NotebookExecutionEvent>("notebook_execution_event");
}

#[test]
fn figure_set() {
    check::<FigureSet>("figure_set");
}

#[test]
fn operator_source() {
    check::<OperatorSource>("operator_source");
}

#[test]
fn methodology_rule() {
    check::<MethodologyRule>("methodology_rule");
}

#[test]
fn methodology_rule_source() {
    check::<MethodologyRuleSource>("methodology_rule_source");
}

#[test]
fn rule_observation() {
    check::<RuleObservation>("rule_observation");
}

#[test]
fn rule_decision() {
    check::<RuleDecision>("rule_decision");
}

#[test]
fn rule_request() {
    check::<RuleRequest>("rule_request");
}

#[test]
fn rule_answer() {
    check::<RuleAnswer>("rule_answer");
}

#[test]
fn method_request() {
    check::<MethodRequest>("method_request");
}

#[test]
fn method_answer() {
    check::<MethodAnswer>("method_answer");
}

#[test]
fn verification_request() {
    check::<VerificationRequest>("verification_request");
}

#[test]
fn code_interface() {
    check::<CodeInterface>("code_interface");
}

#[test]
fn notebook_code() {
    check::<NotebookCode>("notebook_code");
}

#[test]
fn notebook_code_request() {
    check::<NotebookCodeRequest>("notebook_code_request");
}

#[test]
fn notebook_settings_request() {
    check::<NotebookSettingsRequest>("notebook_settings_request");
}

#[test]
fn notebook_settings() {
    check::<NotebookSettings>("notebook_settings");
}

#[test]
fn code_split() {
    check::<CodeSplit>("code_split");
}

#[test]
fn code_split_request() {
    check::<CodeSplitRequest>("code_split_request");
}

#[test]
fn notebook_version() {
    check::<NotebookVersion>("notebook_version");
}

#[test]
fn notebook_execute() {
    check::<NotebookExecute>("notebook_execute");
}

#[test]
fn notebook_execution() {
    check::<NotebookExecution>("notebook_execution");
}

#[test]
fn notebook_variables() {
    check::<NotebookVariables>("notebook_variables");
}

#[test]
fn notebook_kernel_request() {
    check::<NotebookKernelRequest>("notebook_kernel_request");
}

#[test]
fn selection_decision() {
    check::<SelectionDecision>("selection_decision");
}

#[test]
fn model_selection() {
    check::<ModelSelection>("model_selection");
}

#[test]
fn study() {
    check::<Study>("study");
}

#[test]
fn create_study() {
    check::<CreateStudy>("create_study");
}

#[test]
fn trial() {
    check::<Trial>("trial");
}

#[test]
fn study_detail() {
    check::<StudyDetail>("study_detail");
}

#[test]
fn walk() {
    check::<Walk>("walk");
}

#[test]
fn create_walk() {
    check::<CreateWalk>("create_walk");
}

#[test]
fn walk_detail() {
    check::<WalkDetail>("walk_detail");
}

#[test]
fn walk_step() {
    check::<WalkStep>("walk_step");
}

#[test]
fn method() {
    check::<Method>("method");
}

#[test]
fn concept_set() {
    check::<ConceptSet>("concept_set");
}

#[test]
fn evidence_set() {
    check::<EvidenceSet>("evidence_set");
}

#[test]
fn binding() {
    check::<Binding>("binding");
}
