"""Every valid fixture must round-trip unchanged; every invalid one must be rejected."""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from sprisk_contracts import (
    AppliedMethodologyDecision,
    ApplyMethodologyDecision,
    Artifact,
    Attempt,
    AttemptOutput,
    Binding,
    CodeDisplay,
    CodeInterface,
    CodeSplit,
    CodeSplitRequest,
    ConceptSet,
    CreateRun,
    CreateStudy,
    CreateWalk,
    DatasetProfile,
    DecisionProposal,
    EvidenceSet,
    FigureSet,
    FlowDecisions,
    KeyMatches,
    LoadedTable,
    Method,
    MethodAnswer,
    MethodFiles,
    MethodologyCheck,
    MethodologyDecision,
    MethodologyReview,
    MethodologyRule,
    MethodologyRuleSource,
    MethodRequest,
    ModelSelection,
    NotebookCode,
    NotebookCodeRequest,
    NotebookExecute,
    NotebookExecution,
    NotebookExecutionEvent,
    NotebookKernelRequest,
    NotebookSettings,
    NotebookSettingsRequest,
    NotebookVariables,
    NotebookVersion,
    Operator,
    OperatorSource,
    PipelineVersion,
    Problem,
    QuestionVersion,
    Report,
    RuleAnswer,
    RuleDecision,
    RuleObservation,
    RuleRequest,
    Run,
    SelectionDecision,
    Study,
    StudyDetail,
    TablePage,
    Trial,
    VerificationRequest,
    Walk,
    WalkDetail,
    WalkStep,
    WorkerMessage,
)

FIXTURES = Path(__file__).parents[3] / "tests" / "contract"

ENTITIES: list[tuple[type[BaseModel], str]] = [
    (Artifact, "artifact"),
    (Operator, "operator"),
    (PipelineVersion, "pipeline_version"),
    (Run, "run"),
    (Attempt, "attempt"),
    (WorkerMessage, "worker_message"),
    (QuestionVersion, "question_version"),
    (MethodologyCheck, "methodology_check"),
    (DecisionProposal, "decision_proposal"),
    (MethodologyReview, "methodology_review"),
    (MethodologyDecision, "methodology_decision"),
    (ApplyMethodologyDecision, "apply_methodology_decision"),
    (AppliedMethodologyDecision, "applied_methodology_decision"),
    (CreateRun, "create_run"),
    (AttemptOutput, "attempt_output"),
    (Problem, "problem"),
    (TablePage, "table_page"),
    (CodeDisplay, "code_display"),
    (OperatorSource, "operator_source"),
    (MethodologyRule, "methodology_rule"),
    (MethodologyRuleSource, "methodology_rule_source"),
    (RuleObservation, "rule_observation"),
    (RuleRequest, "rule_request"),
    (RuleAnswer, "rule_answer"),
    (MethodRequest, "method_request"),
    (MethodFiles, "method_files"),
    (MethodAnswer, "method_answer"),
    (VerificationRequest, "verification_request"),
    (RuleDecision, "rule_decision"),
    (FigureSet, "figure_set"),
    (FlowDecisions, "flow_decisions"),
    (LoadedTable, "loaded_table"),
    (DatasetProfile, "dataset_profile"),
    (KeyMatches, "key_matches"),
    (CodeInterface, "code_interface"),
    (CodeSplitRequest, "code_split_request"),
    (CodeSplit, "code_split"),
    (NotebookCode, "notebook_code"),
    (NotebookCodeRequest, "notebook_code_request"),
    (NotebookSettings, "notebook_settings"),
    (NotebookSettingsRequest, "notebook_settings_request"),
    (SelectionDecision, "selection_decision"),
    (ModelSelection, "model_selection"),
    (CreateStudy, "create_study"),
    (Study, "study"),
    (StudyDetail, "study_detail"),
    (CreateWalk, "create_walk"),
    (Walk, "walk"),
    (WalkDetail, "walk_detail"),
    (Report, "report"),
    (WalkStep, "walk_step"),
    (Trial, "trial"),
    (NotebookVersion, "notebook_version"),
    (NotebookExecute, "notebook_execute"),
    (NotebookExecution, "notebook_execution"),
    (NotebookExecutionEvent, "notebook_execution_event"),
    (NotebookVariables, "notebook_variables"),
    (NotebookKernelRequest, "notebook_kernel_request"),
    (Method, "method"),
    (ConceptSet, "concept_set"),
    (EvidenceSet, "evidence_set"),
    (Binding, "binding"),
]


def cases(kind: str) -> list[Any]:
    found = []
    for model, entity in ENTITIES:
        paths = sorted((FIXTURES / entity / kind).glob("*.json"))
        assert paths, f"no fixtures in {FIXTURES / entity / kind}"
        found += [pytest.param(model, p, id=f"{entity}/{p.name}") for p in paths]
    return found


def test_every_fixture_dir_has_an_entity() -> None:
    dirs = {p.name for p in FIXTURES.iterdir() if p.is_dir()}
    assert dirs == {entity for _, entity in ENTITIES}


@pytest.mark.parametrize(("model", "path"), cases("valid"))
def test_valid_fixture_round_trips(model: type[BaseModel], path: Path) -> None:
    text = path.read_text()
    parsed = model.model_validate_json(text)
    assert parsed.model_dump(mode="json") == json.loads(text)


@pytest.mark.parametrize(("model", "path"), cases("invalid"))
def test_invalid_fixture_is_rejected(model: type[BaseModel], path: Path) -> None:
    with pytest.raises(ValidationError):
        model.model_validate_json(path.read_text())
