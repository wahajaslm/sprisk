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
    ClassificationReport,
    CodeDisplay,
    CodeInterface,
    CodeSplit,
    CodeSplitRequest,
    ConceptSet,
    CopilotChatReply,
    CopilotChatRequest,
    CopilotLedgerDraft,
    CopilotLedgerRequest,
    CreateDatasetVersion,
    CreateRun,
    CreateStudy,
    CreateWalk,
    DatasetProfile,
    DatasetVersion,
    DecisionProposal,
    EvidenceSet,
    ExecutionPlan,
    FigureSet,
    FlowDecisions,
    KeyMatches,
    LoadedTable,
    Method,
    MethodAnswer,
    MethodFiles,
    MethodologyCheck,
    MethodologyDecision,
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
    ProfilePlan,
    QuestionVersion,
    Report,
    Run,
    SelectionDecision,
    SourceProfileRequest,
    Study,
    StudyDetail,
    TablePage,
    TableShift,
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
    (MethodRequest, "method_request"),
    (MethodFiles, "method_files"),
    (MethodAnswer, "method_answer"),
    (VerificationRequest, "verification_request"),
    (FigureSet, "figure_set"),
    (FlowDecisions, "flow_decisions"),
    (LoadedTable, "loaded_table"),
    (DatasetProfile, "dataset_profile"),
    (DatasetVersion, "dataset_version"),
    (CreateDatasetVersion, "create_dataset_version"),
    (SourceProfileRequest, "source_profile_request"),
    (ExecutionPlan, "execution_plan"),
    (ProfilePlan, "profile_plan"),
    (KeyMatches, "key_matches"),
    (TableShift, "table_shift"),
    (ClassificationReport, "classification_report"),
    (CodeInterface, "code_interface"),
    (CodeSplitRequest, "code_split_request"),
    (CodeSplit, "code_split"),
    (CopilotChatRequest, "copilot_chat_request"),
    (CopilotChatReply, "copilot_chat_reply"),
    (CopilotLedgerRequest, "copilot_ledger_request"),
    (CopilotLedgerDraft, "copilot_ledger_draft"),
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
