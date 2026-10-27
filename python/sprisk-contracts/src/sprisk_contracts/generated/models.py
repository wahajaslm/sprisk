# Generated from contracts/schemas. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import ConfigDict, Field, RootModel, StringConstraints
from sprisk_contracts.base import StrictModel
from enum import StrEnum
from typing_extensions import TypeAliasType


class Bundle(RootModel[Any]):
    root: Annotated[Any, Field(title="Bundle")]


class TableColumn(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Arrow data type name, for display only.")]


class MissingItem(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class TableRow(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    values: list[str]
    missing: Annotated[
        list[MissingItem],
        Field(description="Indexes of columns whose value is missing in this row."),
    ]


class KeyMatch(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column: Annotated[
        str,
        Field(
            description="Dataset text: a column name both tables have.",
            max_length=256,
            min_length=1,
        ),
    ]
    matched_rows: Annotated[
        int,
        Field(
            description="Rows of the step's table whose value finds a row of the other table. Missing values never match.",
            ge=0,
        ),
    ]
    most_rows_per_key: Annotated[
        int,
        Field(
            description="The most rows of the other table that share one value: above 1, a join would copy rows.",
            ge=0,
        ),
    ]


class ProfileScope(StrEnum):
    input = "input"
    train = "train"
    test = "test"
    transformed = "transformed"
    comparison = "comparison"


class ProfileSectionId(StrEnum):
    overview = "overview"
    data_quality = "data_quality"
    columns = "columns"
    relationships = "relationships"
    target = "target"
    classification = "classification"
    regression = "regression"
    text = "text"
    categories = "categories"
    entity_integrity = "entity_integrity"
    temporal_integrity = "temporal_integrity"
    split_check = "split_check"
    change_report = "change_report"


class Count(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class OtherCount(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class ColumnShift(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column: str
    ks: Annotated[
        float,
        Field(
            description="Two-sample Kolmogorov-Smirnov statistic: the largest gap between the two tables' cumulative shares.",
            ge=0.0,
            le=1.0,
        ),
    ]
    lower: Annotated[float, Field(description="Lower edge of the shared bins.")]
    upper: Annotated[float, Field(description="Upper edge of the shared bins.")]
    counts: Annotated[
        list[Count],
        Field(description="This table's values in 20 equal-width bins over both tables' range."),
    ]
    other_counts: Annotated[
        list[OtherCount], Field(description="The other table's values in the same bins.")
    ]


class CutOff(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    positive: str
    at: Annotated[float, Field(ge=0.0, le=1.0)]


class MatrixItem(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class ConfusionMatrix(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    labels: list[str]
    matrix: Annotated[
        list[list[MatrixItem]],
        Field(description="Rows are the true class, columns the predicted class, in labels order."),
    ]


class ClassScore(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: str
    precision: Annotated[float, Field(ge=0.0, le=1.0)]
    recall: Annotated[float, Field(ge=0.0, le=1.0)]
    f1: Annotated[float, Field(ge=0.0, le=1.0)]
    support: Annotated[int, Field(description="Test rows of this true class.", ge=0)]


class Confusion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    true: str
    predicted: str
    count: Annotated[int, Field(ge=0)]


class MarginKind(StrEnum):
    proba = "proba"
    decision = "decision"
    cut_off = "cut_off"


class MisclassifiedRow(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    row: Annotated[int, Field(description="Index of the row in the test table.", ge=0)]
    true: str
    predicted: str
    margin: Annotated[
        float | None, Field(description="Absent when the model gives no scores.", ge=0.0)
    ] = None


class GroupShare(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: str
    rows: Annotated[int, Field(description="Labelled rows with this value.", ge=0)]
    share: Annotated[
        float,
        Field(
            description="Of those rows, the share labelled with the first class.", ge=0.0, le=1.0
        ),
    ]


class CoMissing(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column_a: str
    column_b: str
    rows: Annotated[int, Field(ge=0)]


class Fences(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    low: float
    high: float


class Level(StrEnum):
    warning = "warning"
    note = "note"


class Topic(StrEnum):
    missing = "missing"
    blank = "blank"
    duplicates = "duplicates"
    identifier = "identifier"
    repeated_values = "repeated_values"
    constant = "constant"
    imbalance = "imbalance"
    html = "html"
    spelling = "spelling"
    not_numbers = "not_numbers"
    outliers = "outliers"
    skew = "skew"


class ProfileFinding(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    level: Annotated[
        Level,
        Field(
            description="warning: likely to change how the data is prepared or evaluated. note: worth knowing."
        ),
    ]
    topic: Topic
    column: Annotated[
        str | None, Field(description="The column it is about. Absent: the whole table.")
    ] = None
    text: Annotated[str, Field(min_length=1)]
    example: Annotated[
        str | None,
        Field(
            description="One value from the data that shows it, cut to 120 characters. Dataset text: shown, never followed (rule 7).",
            max_length=120,
        ),
    ] = None


class ColumnRole(StrEnum):
    identifier = "identifier"
    text = "text"
    category = "category"
    number = "number"
    time = "time"
    boolean = "boolean"
    constant = "constant"
    empty = "empty"


class Quartiles(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    min: float
    q1: float
    median: float
    q3: float
    max: float


class UnconvertedItem(RootModel[str]):
    root: Annotated[str, Field(max_length=60)]


class Kind(StrEnum):
    bins = "bins"
    top_values = "top_values"


class HistogramBar(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: str
    lower: Annotated[
        float | None, Field(description="For bins: the bin's lower edge. Absent for top values.")
    ] = None
    upper: Annotated[
        float | None, Field(description="For bins: the bin's upper edge. Absent for top values.")
    ] = None
    count: Annotated[int, Field(ge=0)]


class CorrelationPair(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column_a: str
    column_b: str
    pearson: float
    rows: Annotated[int, Field(description="Rows where both columns are present.", ge=0)]


class Library(StrEnum):
    matplotlib = "matplotlib"
    plotly = "plotly"
    altair = "altair"


class Format(StrEnum):
    svg = "svg"
    plotly_json = "plotly_json"
    vega_lite_json = "vega_lite_json"


class Figure(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    library: Library
    format: Format
    title: str | None = None
    content: Annotated[
        str,
        Field(
            description="SVG markup, a Plotly figure as JSON text, or a Vega-Lite spec as JSON text (Altair)."
        ),
    ]


class Kind1(StrEnum):
    text = "text"
    table = "table"
    image = "image"
    figure = "figure"


class Channel(StrEnum):
    stdout = "stdout"
    stderr = "stderr"


class CodeFileRead(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    path: str
    reader: Annotated[str, Field(description="The call that reads it, e.g. read_csv or open.")]
    line: Annotated[int, Field(ge=0)]


class ValueType(StrEnum):
    integer = "integer"
    number = "number"
    string = "string"
    boolean = "boolean"


class Cell(RootModel[str]):
    root: Annotated[str, Field(max_length=100000)]


class CellRange(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    first: Annotated[int, Field(ge=0)]
    last: Annotated[int, Field(ge=0)]


class Cell1(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class SplitParameter(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    value: int | float | str | bool


class SplitNote(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cell: Annotated[int, Field(description="Index (from 0) of the cell the note is about.", ge=0)]
    message: str


class CodeField(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Polars data type name, for display only.")]
    null_count: Annotated[int, Field(ge=0)]


class NotebookSettings1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reads_as: Literal["settings"]
    settings: Annotated[
        dict[str, Any], Field(description="The step's params, as the edited cell states them.")
    ]


class NotebookSettings2(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reads_as: Literal["code"]


class NotebookSettings(RootModel[NotebookSettings1 | NotebookSettings2]):
    root: Annotated[
        NotebookSettings1 | NotebookSettings2,
        Field(
            description="What an edited ready-made cell is (ADR-0055): the step with new settings, when only values changed, so it keeps its checks; otherwise code, and the step becomes a code step.",
            title="NotebookSettings",
        ),
    ]


class NotebookCode(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(max_length=100000)]


class ArtifactId(RootModel[str]):
    root: Annotated[str, Field(pattern="^art_[0-9A-HJKMNP-TV-Z]{26}$")]


class ProjectId(RootModel[str]):
    root: Annotated[str, Field(pattern="^prj_[0-9A-HJKMNP-TV-Z]{26}$")]


class AttemptId(RootModel[str]):
    root: Annotated[str, Field(pattern="^att_[0-9A-HJKMNP-TV-Z]{26}$")]


class SchemaId(RootModel[str]):
    root: Annotated[str, Field(pattern="^sch_[0-9A-HJKMNP-TV-Z]{26}$")]


class ContentHash(RootModel[str]):
    root: Annotated[str, Field(pattern="^sha256:[0-9a-f]{64}$")]


class Timestamp(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.",
            pattern="^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
        ),
    ]


class InvestigationId(RootModel[str]):
    root: Annotated[str, Field(pattern="^inv_[0-9A-HJKMNP-TV-Z]{26}$")]


class QuestionVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^qv_[0-9A-HJKMNP-TV-Z]{26}$")]


class MethodologyProposalId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mpr_[0-9A-HJKMNP-TV-Z]{26}$")]


class MethodologyDecisionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mdc_[0-9A-HJKMNP-TV-Z]{26}$")]


class PipelineVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^plv_[0-9A-HJKMNP-TV-Z]{26}$")]


class NotebookId(RootModel[str]):
    root: Annotated[str, Field(pattern="^nb_[0-9A-HJKMNP-TV-Z]{26}$")]


class NotebookVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^nbv_[0-9A-HJKMNP-TV-Z]{26}$")]


class RunId(RootModel[str]):
    root: Annotated[str, Field(pattern="^run_[0-9A-HJKMNP-TV-Z]{26}$")]


class WorkerId(RootModel[str]):
    root: Annotated[str, Field(pattern="^wrk_[0-9A-HJKMNP-TV-Z]{26}$")]


class NodeId(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Node name, unique within a pipeline version.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]


class PortName(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]


class OperatorRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Pinned operator: dotted name @ semver, e.g. sprisk.eval.binary_classification@1.0.0.",
            pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        ),
    ]


class Params(StrictModel):
    model_config = ConfigDict(
        extra="allow",
    )


class Error(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*$")]
    message: Annotated[str, Field(min_length=1)]


class MethodRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="methodology.<pack>.<method>@<semver>",
            pattern="^methodology\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        ),
    ]


class DecisionKey(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="<area>.<decision>, the key other methods read a decision by.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ]


class ConceptId(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="<pack>.<concept>, a meaning defined in a pack's concepts.yaml.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ]


class EvidenceKind(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="<area>.<evidence>, a measured fact one operator produces.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ]


class QuestionStatement(StrEnum):
    costs = "costs"
    interpretability = "interpretability"
    success_bar = "success_bar"


FromEvidenceAdditionalProperty = TypeAliasType(
    "FromEvidenceAdditionalProperty",
    Annotated[str, Field(pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")],
)


class MethodBind(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    concept: ConceptId
    evidence: EvidenceKind
    column: Annotated[
        str,
        Field(description="A column the producer writes, never a dataset column.", min_length=1),
    ]


class MethodVerification(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    needs: EvidenceKind
    promise: Annotated[
        str, Field(description="What holds when it passes, for people.", min_length=1)
    ]
    settings: Annotated[
        Params | None, Field(description="Values verify_<name>() reads. Absent: none.")
    ] = None


class Language(StrEnum):
    yaml = "yaml"
    python = "python"


class File(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    path: Annotated[
        str,
        Field(
            description="Relative to the method folder, e.g. method.yaml. Never an absolute path.",
            pattern="^[A-Za-z0-9_][A-Za-z0-9_./-]*$",
        ),
    ]
    language: Language
    text: str


class MethodFiles(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    method: MethodRef
    files: list[File]


class MethodOptionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]


class VerificationName(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="A verification a method declares, the name of its verify_<name>() function.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]


class MethodAssurance(StrEnum):
    confirmed = "confirmed"
    rule = "rule"


class Outcome(StrEnum):
    choose = "choose"
    ask = "ask"


class MethodDecided(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    answer: Literal["decided"]
    method: MethodRef
    outcome: Annotated[
        Outcome,
        Field(
            description="choose: the method applies the option. ask: a person confirms the option, or picks another, before anything relies on it."
        ),
    ]
    option: MethodOptionId
    reason: Annotated[
        str, Field(description="Why, for a person. For ask, the question itself.", min_length=1)
    ]


class MethodRefused(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    answer: Literal["refused"]
    error: Annotated[
        str,
        Field(
            description="The method's own error (an undeclared read, an unknown option). It may name local paths, so it goes to the log, not to a client.",
            min_length=1,
        ),
    ]


class VerificationOutcome(StrEnum):
    pass_ = "pass"
    fail = "fail"
    inconclusive = "inconclusive"


class DecisionAnswer(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decides: DecisionKey
    option: MethodOptionId


class ConceptKind(StrEnum):
    label = "label"
    text = "text"
    entity_identifier = "entity_identifier"
    time = "time"


class BindingSourceKind(StrEnum):
    column = "column"
    derived = "derived"


class BindingSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column: Annotated[str, Field(min_length=1)]
    step: Annotated[
        NodeId | None,
        Field(description="The step that adds the column. Absent: a column of the loaded data."),
    ] = None


class OperatorRole(StrEnum):
    source = "source"
    split = "split"
    model = "model"
    score = "score"
    score_shares = "score_shares"
    cross_validate = "cross_validate"
    select = "select"
    row_filter = "row_filter"


class SplitFolds(StrEnum):
    plain = "plain"
    group = "group"
    time = "time"


class Side(StrEnum):
    input = "input"
    output = "output"


class OperatorAttach(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: OperatorRole
    side: Side


class OperatorScope(StrEnum):
    all = "all"
    train = "train"


class EvidenceValue(RootModel[int | float | bool | str | list[str]]):
    root: Annotated[
        int | float | bool | str | list[str],
        Field(
            description="A field's value: a number, a yes or no, a short text, or a list of short texts (string_list)."
        ),
    ]


class EvidenceFieldType(StrEnum):
    integer = "integer"
    number = "number"
    boolean = "boolean"
    string = "string"
    string_list = "string_list"


class MethodReplace(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: OperatorRole
    operator: OperatorRef
    settings: Annotated[
        Params | None, Field(description="Params that do not depend on the project. Absent: none.")
    ] = None
    concepts: Annotated[
        dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], ConceptId]
        | None,
        Field(
            description="Params a project's binding fills: param name to concept. A param the operator already maps to a concept is not listed here. Absent: none."
        ),
    ] = None


class BindingStated(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    assurance: Literal["stated"]


class BindingByMethod(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    assurance: MethodAssurance
    method: MethodRef


class ProfileItem(RootModel[str]):
    root: Annotated[str, Field(max_length=60)]


class Profile(RootModel[list[ProfileItem]]):
    root: Annotated[list[ProfileItem], Field(max_length=10)]


class ShortlistItem(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]


class Applicability(StrEnum):
    applicable = "applicable"
    needs_fact = "needs_fact"
    not_applicable = "not_applicable"


class Alternative(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    applicability: Applicability
    reason: Annotated[str, Field(min_length=1)]
    params: Annotated[
        Params | None,
        Field(
            description="Concrete params for the manifest action's operator; present when applicable."
        ),
    ] = None


class RuleRefused(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    answer: Literal["refused"]
    error: Annotated[
        str,
        Field(
            description="The rule's own error (a broken observation, a module with no decide). It may name local paths, so it goes to the log, not to a client.",
            min_length=1,
        ),
    ]


class MethodologyRuleRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="methodology.<pack>.<rule>@<semver>",
            pattern="^methodology\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*@\\d+\\.\\d+\\.\\d+$",
        ),
    ]


class MethodologyStage(StrEnum):
    question = "question"
    data = "data"
    split = "split"
    cleaning = "cleaning"
    features = "features"
    models = "models"
    evaluation = "evaluation"
    reporting = "reporting"


class Selection(StrEnum):
    recommend = "recommend"
    shortlist = "shortlist"


class Status(StrEnum):
    draft = "draft"
    active = "active"


class AppliesToItem(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$")]


class Read(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class CornerCase(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class Provenance(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    standard: Annotated[str, Field(min_length=1)]
    citation: Annotated[str, Field(min_length=1)]
    pitfall: Annotated[str, Field(min_length=1)]
    corner_cases: list[CornerCase]


class Observes(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    profile: Annotated[str, Field(min_length=1)]
    description: str
    required: bool


class Observes1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    fact: Annotated[str, Field(min_length=1)]
    description: str
    required: bool


class Verification(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    check_id: Annotated[str, Field(min_length=1)]
    invariant: Annotated[str, Field(min_length=1)]


class File1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    path: Annotated[
        str,
        Field(
            description="Relative to the rule folder, e.g. rule.yaml. Never an absolute path.",
            pattern="^[A-Za-z0-9_][A-Za-z0-9_./-]*$",
        ),
    ]
    language: Language
    text: str


class MethodologyRuleSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rule: MethodologyRuleRef
    files: Annotated[list[File1], Field(min_length=1)]


class Kind2(StrEnum):
    question_fact = "question_fact"
    profile_fact = "profile_fact"
    flow_fact = "flow_fact"
    policy = "policy"
    user_reason = "user_reason"


class GivenItem(RootModel[str]):
    root: Annotated[str, Field(max_length=60)]


class Given(RootModel[list[GivenItem]]):
    root: Annotated[list[GivenItem], Field(max_length=10)]


class RuleActionType(StrEnum):
    replace_node = "replace_node"
    remove_node = "remove_node"
    insert_step = "insert_step"
    pass_through = "pass_through"
    update_estimator_params = "update_estimator_params"
    configure_clustering_cardinality = "configure_clustering_cardinality"
    configure_clustering_distance = "configure_clustering_distance"
    configure_dbscan_params = "configure_dbscan_params"
    configure_evaluation_params = "configure_evaluation_params"
    emit_methodology_limitation = "emit_methodology_limitation"
    enforce_compiler_invariant = "enforce_compiler_invariant"
    reopen = "reopen"


class GraphEffect1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["replace_node"]
    node_id: NodeId
    operator: OperatorRef
    params: Params


class GraphEffect2(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["remove_node"]
    node_id: NodeId


class NextItem(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class MethodologyReviewStatus(StrEnum):
    settled = "settled"
    proposal = "proposal"
    needs_fact = "needs_fact"
    needs_run = "needs_run"
    waiting = "waiting"
    no_subject = "no_subject"
    not_applicable = "not_applicable"
    reopen = "reopen"


class ApplyMethodologyDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    alternative_id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    reason: Annotated[str | None, Field(min_length=1)] = None
    idempotency_key: Annotated[str, Field(max_length=128, min_length=8)]


class MethodologyCheckId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mck_[0-9A-HJKMNP-TV-Z]{26}$")]


class CheckRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Pinned rule: <pack>.<rule>@<semver>.",
            pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        ),
    ]


class Verdict(StrEnum):
    pass_ = "pass"
    fail = "fail"
    warning = "warning"
    not_assessed = "not_assessed"


class MethodologyPhase(StrEnum):
    plan = "plan"
    code = "code"
    runtime = "runtime"
    result = "result"
    release = "release"


class MethodologyCoverage(StrEnum):
    complete = "complete"
    partial = "partial"
    not_assessed = "not_assessed"


class Kind3(StrEnum):
    code = "code"
    markdown = "markdown"


class NotebookCellId(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Stable within a notebook across versions, as in Jupyter's nbformat 4.5.",
            pattern="^[A-Za-z0-9_-]{1,64}$",
        ),
    ]


class NotebookExecute(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cell_id: NotebookCellId
    code: Annotated[str, Field(max_length=100000)]


class Status1(StrEnum):
    ok = "ok"
    error = "error"
    interrupted = "interrupted"
    timed_out = "timed_out"


class NotebookError(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    message: str
    traceback: Annotated[list[str], Field(description="Plain text lines, colour codes removed.")]


class NotebookVariable(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    defined: bool
    type: Annotated[
        str | None,
        Field(description="Module and class, e.g. pandas.DataFrame. Absent when not defined."),
    ] = None
    table: Annotated[
        bool,
        Field(
            description="A pandas or polars DataFrame: the one kind of value that crosses a node boundary today."
        ),
    ]


class KernelExecute(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["execute"]
    code: Annotated[str, Field(max_length=100000)]


class KernelInterrupt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["interrupt"]


class KernelVariables(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["variables"]
    names: list[PortName]


class KernelShutdown(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["shutdown"]


class SearchSetting(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    values: list[Any]


class Entrypoint(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z_][a-z0-9_]*(\\.[a-z_][a-z0-9_]*)*:[a-z_][a-z0-9_]*$")]


class ModelFamily(StrEnum):
    tree_ensemble = "tree_ensemble"
    linear = "linear"
    distance_based = "distance_based"
    density_based = "density_based"


class CapabilityClass(StrEnum):
    source = "source"
    transform = "transform"
    analyzer = "analyzer"
    estimator = "estimator"
    evaluator = "evaluator"
    optimizer = "optimizer"
    decision_evaluator = "decision_evaluator"
    sink = "sink"
    custom_code = "custom_code"


class PortKind(StrEnum):
    table = "table"
    matrix = "matrix"
    model = "model"
    metrics = "metrics"
    diagnostics = "diagnostics"
    report = "report"
    figure = "figure"


class Effects(StrEnum):
    pure = "pure"
    nondeterministic = "nondeterministic"
    side_effecting = "side_effecting"


class NetworkAccess(StrEnum):
    none = "none"
    egress_allowlisted = "egress_allowlisted"


class Gpu(StrEnum):
    none = "none"
    optional = "optional"
    required = "required"


class Resources(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cpu_cores: Annotated[int, Field(ge=1)]
    memory_mb: Annotated[int, Field(ge=1)]
    gpu: Gpu
    timeout_seconds: Annotated[int, Field(ge=1)]


class Stage(StrEnum):
    load = "load"
    split = "split"
    explore = "explore"
    clean = "clean"
    model = "model"
    evaluate = "evaluate"


class BeforeItem(RootModel[str]):
    root: Annotated[str, Field(max_length=100000)]


class AfterItem(RootModel[str]):
    root: Annotated[str, Field(max_length=100000)]


class NodeNotes(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    before: Annotated[
        list[BeforeItem] | None,
        Field(description="Markdown cells above the step's cell, in order."),
    ] = None
    after: Annotated[
        list[AfterItem] | None,
        Field(description="Markdown cells below it; only the last step of a stage has them."),
    ] = None


class VariableName(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="A Python name a cell sets or reads.",
            pattern="^[A-Za-z_][A-Za-z0-9_]{0,62}$",
        ),
    ]


class NodeSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notebook_version_id: NotebookVersionId
    notebook_id: Annotated[
        NotebookId | None,
        Field(
            description="The notebook these cells belong to, so saving it again rebuilds its steps (ADR-0037). Absent on nodes made before."
        ),
    ] = None
    cells: list[NotebookCellId]


class NodeCode(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: Annotated[str, Field(description="Python module source.", max_length=200000)]
    function: Annotated[
        str,
        Field(
            description="The function in source that is the step.",
            pattern="^[A-Za-z_][A-Za-z0-9_]*$",
        ),
    ]


class PortRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="`<node_id>.<port_name>`.",
            pattern="^[a-z][a-z0-9_]{0,62}\\.[a-z][a-z0-9_]{0,62}$",
        ),
    ]


class Modality(StrEnum):
    image = "image"
    audio = "audio"
    video = "video"


class Origin1(StrEnum):
    explicit = "explicit"
    confirmed = "confirmed"


class AssetBinding(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    modality: Modality
    asset_root: Annotated[str, Field(min_length=1)]
    link_column: Annotated[str, Field(min_length=1)]
    origin: Origin1


class Interpretability(StrEnum):
    high = "high"
    medium = "medium"
    low = "low"


class Origin(StrEnum):
    explicit = "explicit"
    inferred = "inferred"
    measured = "measured"
    confirmed = "confirmed"


class Fact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[str, Field(min_length=1)]
    origin: Origin


class Origin4(StrEnum):
    explicit = "explicit"
    confirmed = "confirmed"


class Costs(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    positive: Annotated[
        str, Field(description="The class whose miss costs, as text.", min_length=1)
    ]
    false_negative: Annotated[
        float,
        Field(
            description="Cost of predicting another class for a `positive` row. Positive; the API refuses others."
        ),
    ]
    false_positive: Annotated[
        float,
        Field(
            description="Cost of predicting `positive` for another row. Positive; the API refuses others. A correct prediction costs nothing."
        ),
    ]


class TaskType(StrEnum):
    exploration = "exploration"
    classification = "classification"
    regression = "regression"
    undetermined = "undetermined"


class Blocks(StrEnum):
    planning = "planning"
    execution = "execution"
    release = "release"


class Unknown(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    question: Annotated[str, Field(min_length=1)]
    blocks: Annotated[
        Blocks, Field(description="Earliest stage this unknown must be resolved before.")
    ]


class ReportId(RootModel[str]):
    root: Annotated[str, Field(pattern="^rpt_[0-9A-HJKMNP-TV-Z]{26}$")]


class Limitation(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class ReportEvidence1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decision: MethodologyDecisionId


class ReportEvidence2(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run: RunId


class ReportEvidence3(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pipeline_version: PipelineVersionId


class RunStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class AttemptState(StrEnum):
    created = "created"
    validated = "validated"
    queued = "queued"
    leased = "leased"
    running = "running"
    uploading = "uploading"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"
    timed_out = "timed_out"
    skipped = "skipped"
    cache_hit = "cache_hit"


class SelectionMetric(StrEnum):
    balanced_accuracy = "balanced_accuracy"
    expected_cost = "expected_cost"
    rmse = "rmse"
    weighted_f1 = "weighted_f1"


class BaselineRole(StrEnum):
    floor = "floor"
    reference = "reference"


class NotCompared(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[
        str, Field(description="The proposal's alternative.", pattern="^[a-z][a-z0-9_]{0,62}$")
    ]
    reason: Annotated[str, Field(description="Why it was not scored on the folds.", min_length=1)]


class SearchedTrial(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    settings: Params
    inner_mean: Annotated[
        float,
        Field(
            description="Mean inner score over the outer folds: what the search saw. Not a performance estimate."
        ),
    ]
    chosen_in: Annotated[int, Field(description="How many outer folds chose this trial.", ge=0)]


class GuardrailResult(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: Annotated[str, Field(min_length=1)]
    at_least: float
    mean: Annotated[float, Field(description="Mean over the outer folds of the recall of `label`.")]
    corrected_se: Annotated[
        float,
        Field(
            description="Its standard error, corrected for folds that share train rows as for the scores."
        ),
    ]
    passed: Annotated[bool, Field(description="Whether `mean` is at least `at_least`.")]


class BaselineComparison(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mean_difference: Annotated[
        float,
        Field(
            description="Mean fold-by-fold improvement over the baseline on the same folds; positive is better for either metric."
        ),
    ]
    corrected_se: Annotated[
        float,
        Field(
            description="Standard error of that mean, corrected for folds that share train rows: the correction of Nadeau & Bengio (2003), applied to k-fold as in Bouckaert & Frank (2004)."
        ),
    ]
    p_value: Annotated[
        float | None,
        Field(
            description="One-sided p of the corrected repeated k-fold t-test that the alternative is no better than the baseline (Bouckaert & Frank 2004). Absent: decided by the one-SE screen, before ADR-0050's test."
        ),
    ] = None
    beats_baseline: Annotated[
        bool,
        Field(
            description="With p_value: whether the test rejects at α = 0.05 after a Holm adjustment over the other alternatives. Without: whether mean_difference is larger than one corrected_se, a screening rule."
        ),
    ]


class StudyId(RootModel[str]):
    root: Annotated[str, Field(pattern="^std_[0-9A-HJKMNP-TV-Z]{26}$")]


class StudyStrategy(StrEnum):
    grid = "grid"
    random = "random"


class StudyStatus(StrEnum):
    running = "running"
    completed = "completed"
    budget_reached = "budget_reached"
    failed = "failed"


class Guardrail(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    metric: Literal["recall"]
    label: Annotated[str, Field(description="The target value, as text.", min_length=1)]
    at_least: Annotated[float, Field(description="Between 0 and 1.")]


class CreateStudy(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    idempotency_key: Annotated[str, Field(max_length=128, min_length=8)]
    strategy: StudyStrategy
    seed: Annotated[int, Field(ge=0)]
    max_trials: Annotated[int, Field(ge=0)]
    max_wall_seconds: Annotated[int, Field(ge=0)]
    guardrails: list[Guardrail]


class TrialState(StrEnum):
    not_started = "not_started"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class WalkId(RootModel[str]):
    root: Annotated[str, Field(pattern="^wlk_[0-9A-HJKMNP-TV-Z]{26}$")]


class WalkSource(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class WalkSources(RootModel[list[WalkSource]]):
    root: Annotated[
        list[WalkSource],
        Field(
            description="Local CSV or Parquet files, inside an allowed data folder, read as file_source steps. The first holds the rows to predict on; any other is joined to it by a rule."
        ),
    ]


class WalkStatus(StrEnum):
    walking = "walking"
    stopped = "stopped"


class WalkAskOption(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: MethodOptionId
    label: Annotated[str, Field(min_length=1)]


class WalkStopReason(StrEnum):
    complete = "complete"
    needs_person = "needs_person"
    limitation = "limitation"
    uncovered = "uncovered"
    source_changed = "source_changed"
    run_failed = "run_failed"
    stale = "stale"
    unverified = "unverified"
    budget_exhausted = "budget_exhausted"
    error = "error"


class WalkAction(StrEnum):
    build = "build"
    run = "run"
    apply = "apply"
    compare = "compare"
    measure = "measure"
    decide = "decide"
    score = "score"
    verify = "verify"
    stop = "stop"


class PromiseResult(StrEnum):
    pass_ = "pass"
    fail = "fail"
    inconclusive = "inconclusive"
    not_evaluated = "not_evaluated"


class UsedEvidence(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: EvidenceKind
    step: Annotated[NodeId, Field(description="The producer step that measured it.")]
    fields: Annotated[dict[str, Any], Field(description="The fields as the method saw them.")]


class PromiseStanding(StrEnum):
    pass_ = "pass"
    fail = "fail"
    inconclusive = "inconclusive"
    not_evaluated = "not_evaluated"
    stale = "stale"


class Handshake(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["handshake"]
    protocol_version: Literal["sprisk.worker/v1"]
    worker_id: WorkerId
    operators: list[OperatorRef]


class Heartbeat(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["heartbeat"]
    attempt_id: AttemptId


class Progress(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["progress"]
    attempt_id: AttemptId
    completed: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]


class ArtifactManifest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["artifact_manifest"]
    attempt_id: AttemptId
    port: PortName
    staging_uri: Annotated[str, Field(pattern="^[a-z][a-z0-9+.-]*://.+$")]
    content_hash: ContentHash
    media_type: Annotated[str, Field(pattern="^[a-z]+/[a-z0-9.+-]+$")]
    schema_ref: SchemaId | None = None
    size_bytes: Annotated[int, Field(ge=0)]


class Complete(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["complete"]
    attempt_id: AttemptId


class FailureKind(StrEnum):
    transient = "transient"
    permanent = "permanent"


class Fail(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["fail"]
    attempt_id: AttemptId
    error: Error
    failure_kind: FailureKind


class Cancel(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["cancel"]
    attempt_id: AttemptId


class Acknowledge(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["acknowledge"]
    attempt_id: AttemptId


class InputBinding(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port: PortName
    artifact_id: ArtifactId
    uri: Annotated[str, Field(pattern="^[a-z][a-z0-9+.-]*://.+$")]
    content_hash: ContentHash


class CreateRun(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pipeline_version_id: PipelineVersionId
    reuse_run_id: Annotated[
        RunId | None,
        Field(
            description="Reuse this run's results for every step whose definition is unchanged; run the rest (ADR-0026). Omitted: run from the start."
        ),
    ] = None
    run_from_node_id: Annotated[
        NodeId | None,
        Field(
            description="Run this step and every step after it again, even where unchanged; reuse or take from the cache only the steps before it (ADR-0026 amendment). It must be a step of the version. Omitted: only changed steps run."
        ),
    ] = None


class Problem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    errors: list[Error]


class TablePage(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    offset: Annotated[int, Field(description="Index of the first row in this page.", ge=0)]
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[
        int,
        Field(
            description="Columns in the table; more than `columns` holds when the table is too wide to page whole.",
            ge=0,
        ),
    ]
    columns: list[TableColumn]
    rows: list[TableRow]


class OperatorSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    operator: OperatorRef
    path: Annotated[
        str,
        Field(
            description="Relative to the pack's src/, e.g. sprisk_clean/impute.py. Never an absolute path."
        ),
    ]
    language: Literal["python"]
    text: str
    digest: Annotated[
        ContentHash,
        Field(
            description="The operator's implementation digest: the code that runs, and the code shown, are the same."
        ),
    ]


class LoadedTableUse(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pipeline_version_id: PipelineVersionId
    run_id: Annotated[
        RunId,
        Field(description="The latest run of that version, whose source step loaded the table."),
    ]
    node_id: NodeId


class KeyMatches(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.key_matches/v1"]
    rows: Annotated[int, Field(description="Rows of the table the step reads.", ge=0)]
    other_rows: Annotated[int, Field(description="Rows of the other table.", ge=0)]
    keys: Annotated[
        list[KeyMatch],
        Field(
            description="Each column both tables share, in the step's column order; at most 200."
        ),
    ]


class ProfilePlanSection(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: ProfileSectionId
    title: str
    purpose: str
    evidence_scope: ProfileScope
    reason: Annotated[
        str,
        Field(
            description="A fixed, deterministic template naming the profile fact or question-ledger field that made this view applicable."
        ),
    ]


class TableShift(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.table_shift/v1"]
    rows: Annotated[int, Field(ge=0)]
    other_rows: Annotated[int, Field(ge=0)]
    columns: Annotated[
        list[ColumnShift],
        Field(
            description="Each numeric column both tables share, at most 30, largest shift first."
        ),
    ]


class ErrorMargins(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: MarginKind
    edges: Annotated[list[float], Field(description="11 bin edges (numpy.histogram, 10 bins).")]
    counts: Annotated[list[Count], Field(description="Misclassified test rows per bin.")]


class MisclassifiedSample(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rows: Annotated[
        list[MisclassifiedRow],
        Field(description="At most 20, picked with a fixed seed, in test-table order."),
    ]
    n_total: Annotated[int, Field(description="All misclassified test rows.", ge=0)]


class ClassBins(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: str
    counts: Annotated[
        list[Count],
        Field(description="Rows of this class in each of the column's bins, in bin order."),
    ]
    quartiles: Quartiles | None = None


class LabelGroup(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column: str
    values: list[GroupShare]


class Histogram(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Annotated[
        Kind,
        Field(
            description="bins: equal-width bins of a numeric column. top_values: the 30 most common values of any other column, most common first."
        ),
    ]
    bars: list[HistogramBar]
    other: Annotated[
        int | None,
        Field(
            description="For top_values: present values not in any bar (the long tail). Absent for bins.",
            ge=0,
        ),
    ] = None


class Correlation(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    columns: list[str]
    pairs: list[CorrelationPair]


class FigureSet(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[Figure]


class DisplayItem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Kind1
    text: Annotated[str | None, Field(description="Present for kind text.")] = None
    table: Annotated[
        TablePage | None, Field(description="Present for kind table: the first rows only.")
    ] = None
    figure: Annotated[
        Figure | None,
        Field(
            description="Present for kind figure: a plot the code drew, as SVG, Plotly or Vega-Lite (ADR-0024)."
        ),
    ] = None
    png_base64: Annotated[
        str | None,
        Field(
            description="Present for kind image: a PNG, base64-encoded. Written by older code steps; new ones write figures."
        ),
    ] = None
    label: Annotated[
        str | None,
        Field(
            description="The code that was shown, as written: a name such as summary, or an expression such as df.head(). Absent for printed text, figures shown at the end, and older code steps."
        ),
    ] = None
    line: Annotated[
        int | None,
        Field(
            description="The line of the step's code that showed it: a show() or display() call, or the last line. Absent when it was shown at the end of the run, or by older code steps.",
            ge=0,
        ),
    ] = None
    channel: Annotated[
        Channel | None,
        Field(
            description="For printed text: which stream it came from. Absent for displayed values. Warnings arrive on stderr."
        ),
    ] = None


class CodeInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    origin: Origin
    bound: Annotated[
        bool,
        Field(
            description="True when the name is provided by the step (its input table or a library); false means the code reads a name nothing defines."
        ),
    ]


class CodeParameter(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    line: Annotated[int, Field(ge=0)]
    value_type: ValueType
    default_text: Annotated[str, Field(description="The literal as written in the source.")]
    effective_text: Annotated[str, Field(description="The literal the run used, as Python source.")]
    origin: Annotated[Origin, Field(description="inferred until the user exposes it (confirmed).")]


class CodeOutputCandidate(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    type: Annotated[
        str, Field(description="Python type of the final value, e.g. polars.DataFrame.")
    ]
    rows: Annotated[int | None, Field(ge=0)] = None
    columns: Annotated[int | None, Field(ge=0)] = None
    origin: Origin
    chosen: Annotated[bool, Field(description="This value became the step's data output.")]
    fields: Annotated[
        list[CodeField] | None,
        Field(
            description="For tables: their columns with type and missing count, for the Data tab's variable explorer (ADR-0030). Capped."
        ),
    ] = None
    sample: Annotated[
        TablePage | None,
        Field(
            description="For tables: the first rows (ADR-0030). Omitted once the report's size budget is used up."
        ),
    ] = None
    text: Annotated[
        str | None,
        Field(description="For other values: their repr, cut to a bounded length (ADR-0030)."),
    ] = None


class CodeSplitRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cells: list[Cell]
    together: Annotated[
        CellRange | None,
        Field(
            description="Cells first..last (from 0) start as one step: the cells a person picked for Create node (ADR-0036). Absent: every cell starts alone."
        ),
    ] = None


class SplitStep(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: Annotated[
        str,
        Field(
            description="The step's code: its cells, with the imports and literals it uses from earlier cells copied in."
        ),
    ]
    parameters: Annotated[
        list[SplitParameter],
        Field(
            description="Top-level literals in the step's code, its own or copied in, that can be exposed as settings."
        ),
    ]
    cells: Annotated[
        list[Cell1], Field(description="Indexes (from 0) of the cells this step holds.")
    ]
    inputs: list[PortName]
    outputs: list[PortName]


class SplitLink(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_step: Annotated[int, Field(ge=0)]
    to_step: Annotated[int, Field(ge=0)]
    name: PortName


class NotebookCodeRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    settings: Annotated[
        dict[str, Any], Field(description="The step's params as the flow has them.")
    ]
    inputs: Annotated[
        dict[str, VariableName], Field(description="The variable each input port reads, by port.")
    ]
    outputs: Annotated[
        dict[str, VariableName], Field(description="The variable each output port sets, by port.")
    ]


class NotebookSettingsRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    settings: Annotated[
        dict[str, Any], Field(description="The step's params as the flow has them.")
    ]
    inputs: Annotated[
        dict[str, VariableName], Field(description="The variable each input port reads, by port.")
    ]
    outputs: Annotated[
        dict[str, VariableName], Field(description="The variable each output port sets, by port.")
    ]
    code: Annotated[str, Field(description="The cell as edited.", max_length=100000)]


class Artifact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.artifact/v1"]
    id: ArtifactId
    project_id: ProjectId
    producer_attempt_id: AttemptId
    content_hash: ContentHash
    media_type: Annotated[
        str,
        Field(description="IANA media type of the stored bytes.", pattern="^[a-z]+/[a-z0-9.+-]+$"),
    ]
    schema_ref: Annotated[
        SchemaId | None,
        Field(
            description="Declared data schema. Absent for artifacts without a tabular schema, such as model bundles."
        ),
    ] = None
    size_bytes: Annotated[int, Field(ge=0)]
    uri: Annotated[
        str,
        Field(
            description="Storage location. Opaque to domain logic; resolved by the artifact store.",
            pattern="^[a-z][a-z0-9+.-]*://.+$",
        ),
    ]
    created_at: Timestamp


class MethodAppliesWhen(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    task: list[TaskType]


class MethodNeeds(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    concepts: list[ConceptId]
    evidence: list[EvidenceKind]
    decisions: list[DecisionKey]
    statements: Annotated[
        list[QuestionStatement] | None,
        Field(
            description="The question statements decide() may read (ADR-0063 slice 6). Absent: none."
        ),
    ] = None


class MethodSet(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: OperatorRole
    settings: Annotated[
        Params | None,
        Field(description="Settings that do not depend on the project. Absent: none."),
    ] = None
    from_statements: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], QuestionStatement
        ]
        | None,
        Field(
            description="Settings read from a statement the method needs: setting name to statement. A statement the question does not make leaves its setting out. Absent: none."
        ),
    ] = None


class MethodInsert(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    before: OperatorRole
    operator: OperatorRef
    node_id: Annotated[
        str,
        Field(
            description="The inserted step's id; a free one with a suffix when the flow already has it.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]
    settings: Annotated[
        Params | None, Field(description="Params that do not depend on the project. Absent: none.")
    ] = None
    from_evidence: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")],
            FromEvidenceAdditionalProperty,
        ]
        | None,
        Field(
            description="Params read from a field of evidence the method needs: param name to <area>.<evidence>.<field>. Absent: none."
        ),
    ] = None
    concepts: Annotated[
        dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], ConceptId]
        | None,
        Field(description="Params a project's binding fills: param name to concept. Absent: none."),
    ] = None


class RuledOutOption(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    option: MethodOptionId
    verification: VerificationName
    detail: Annotated[str, Field(min_length=1)]


class MethodVerified(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    answer: Literal["verified"]
    method: MethodRef
    verification: VerificationName
    result: VerificationOutcome
    detail: Annotated[
        str, Field(description="What the evidence showed, for a person.", min_length=1)
    ]


class Concept(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: ConceptKind
    description: Annotated[str, Field(min_length=1)]
    binds_to: list[BindingSourceKind]


class EvidenceProduced(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    default: Annotated[
        bool | None,
        Field(
            description="The producer the engine adds when several operators produce this kind. Absent: false."
        ),
    ] = None
    fields: dict[
        Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], EvidenceFieldType
    ]


class EvidenceFields(
    RootModel[
        dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], EvidenceValue]
    ]
):
    root: dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], EvidenceValue]


class BindingSetBy(RootModel[BindingStated | BindingByMethod]):
    root: Annotated[
        BindingStated | BindingByMethod,
        Field(
            description="Who set the binding, tagged by assurance: a person stated it, or a method's option made it, confirmed by a person or set unasked by the method (rule)."
        ),
    ]


class RuleObservation(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.rule_observation/v1"]
    rule: MethodologyRuleRef
    facts: Annotated[
        dict[str, Fact],
        Field(
            description="Facts by name: question facts (question.time_column), facts read from the flow (flow.model_families), and the step's own text settings (step.method). A fact that lists several values joins them, sorted, with ', '."
        ),
    ]
    profile: Annotated[
        dict[str, float | str | bool | Profile],
        Field(
            description="Measured profile values by name. A list holds dataset text, such as the values of a column that do not read as numbers."
        ),
    ]
    settings: Annotated[
        dict[str, Any],
        Field(description="The rule's settings: policy thresholds with any overrides."),
    ]


class RuleRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.rule_request/v1"]
    module: Annotated[
        str,
        Field(
            description="Path of the rule's rule.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the rule process on the same machine, never stored.",
            min_length=1,
        ),
    ]
    observation: RuleObservation


class Action(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: RuleActionType
    operator: Annotated[
        str | None,
        Field(
            description="Operator the action builds; may name one not yet registered.", min_length=1
        ),
    ] = None
    placement: Annotated[str | None, Field(min_length=1)] = None
    node_id: Annotated[
        NodeId | None,
        Field(
            description="insert_step: the id of the step it adds, saying what the step is about (ADR-0057)."
        ),
    ] = None
    fit_on: Annotated[str | None, Field(min_length=1)] = None
    apply_to: Annotated[str | None, Field(min_length=1)] = None
    params: Annotated[
        dict[str, Any] | None,
        Field(
            description="Operator params; '{settings.x}' strings are filled from the alternative's settings."
        ),
    ] = None


class Alternative1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    label: Annotated[str, Field(min_length=1)]
    description: Annotated[str, Field(min_length=1)]
    condition: Annotated[
        str | None,
        Field(
            description="A draft rule's design note on when this applies. An active rule has none: its decide() is the logic, shown by its examples (ADR-0045)."
        ),
    ] = None
    when: Annotated[
        str | None,
        Field(
            description="In a few words, when the rule takes this route, e.g. the column is skewed. Shown beside the example that picks it; nothing that decides reads it. Required on an active rule's alternatives (ADR-0045 amendment).",
            min_length=1,
        ),
    ] = None
    rationale: Annotated[str, Field(min_length=1)]
    settings_schema: Annotated[
        dict[str, Any] | None, Field(description="JSON Schema for this alternative's settings.")
    ] = None
    action: Action


class MethodologyEvidence(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Kind2
    label: Annotated[str, Field(min_length=1)]
    value: Annotated[str, Field(min_length=1)]
    origin: Origin
    artifact_id: ArtifactId | None = None


class Given1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[str, Field(min_length=1)]
    origin: Origin


class RuleExample(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    given: Annotated[
        dict[str, str | float | Given | Given1],
        Field(
            description="Facts by name. A question fact is confirmed and a flow fact measured unless given as { value, origin }. A measured fact may also be a list of dataset text."
        ),
    ]
    picks: Annotated[
        str | None,
        Field(description="What a recommend rule picks.", pattern="^[a-z][a-z0-9_]{0,62}$"),
    ] = None
    shortlist: Annotated[
        list[ShortlistItem] | None, Field(description="What a shortlist rule puts forward.")
    ] = None


class GraphEffect3(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["insert_node"]
    node_id: NodeId
    operator: OperatorRef
    params: Params
    before: NodeId
    other: Annotated[
        PortRef | None,
        Field(
            description="A step that joins: the output feeding its `other` input, a source table no step read before (ADR-0059). Absent for a step with one input."
        ),
    ] = None


class GraphEffect4(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["add_node"]
    node_id: NodeId
    operator: OperatorRef
    params: Params
    inputs: dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], PortRef]


class GraphEffect5(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["set_input"]
    node_id: NodeId
    port: PortName
    from_: Annotated[PortRef, Field(alias="from")]


class GraphEffect(
    RootModel[GraphEffect1 | GraphEffect2 | GraphEffect3 | GraphEffect4 | GraphEffect5]
):
    root: Annotated[
        GraphEffect1 | GraphEffect2 | GraphEffect3 | GraphEffect4 | GraphEffect5,
        Field(
            description="Typed mutation previewed and compiled before it can create a pipeline version."
        ),
    ]


class MethodologyAlternative(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    label: Annotated[str, Field(min_length=1)]
    description: Annotated[str, Field(min_length=1)]
    applicability: Applicability
    reason: Annotated[str, Field(min_length=1)]
    effect: GraphEffect | None = None


class DecisionProposal(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.decision_proposal/v1"]
    id: MethodologyProposalId
    rule: CheckRef
    question_version_id: QuestionVersionId
    pipeline_version_id: PipelineVersionId
    subject_node_id: NodeId
    evidence: list[MethodologyEvidence]
    alternatives: Annotated[list[MethodologyAlternative], Field(min_length=1)]
    recommended_alternative_id: Annotated[str | None, Field(pattern="^[a-z][a-z0-9_]{0,62}$")] = (
        None
    )
    shortlist: Annotated[
        list[ShortlistItem] | None,
        Field(description="The alternatives a shortlist rule puts forward to compare (ADR-0044)."),
    ] = None
    fingerprint: ContentHash
    created_at: Timestamp


class MethodologyReviewItem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rule: CheckRef
    decides: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")]
    stage: MethodologyStage
    subject_node_id: NodeId | None = None
    status: MethodologyReviewStatus
    reason: Annotated[str, Field(min_length=1)]
    recommended_alternative_id: Annotated[str | None, Field(pattern="^[a-z][a-z0-9_]{0,62}$")] = (
        None
    )
    reopens: Annotated[
        MethodologyStage | None,
        Field(
            description="With status reopen: the stage the results send the flow back to. Absent otherwise."
        ),
    ] = None


class MethodologyDecisionByRule(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_decision/v1"]
    id: MethodologyDecisionId
    proposal_id: MethodologyProposalId
    rule: CheckRef
    question_version_id: QuestionVersionId
    base_pipeline_version_id: PipelineVersionId
    pipeline_version_id: PipelineVersionId
    subject_node_id: NodeId
    alternative_id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    reason: Annotated[str | None, Field(min_length=1)] = None
    selection_id: Annotated[
        ArtifactId | None,
        Field(
            description="The SelectionDecision this choice followed or overrode (ADR-0050). Absent when no comparison had decided."
        ),
    ] = None
    missed_guardrails: Annotated[
        list[GuardrailResult] | None,
        Field(
            description="The guardrails the chosen alternative failed in the SelectionDecision this choice overrode, with its values (ADR-0052). Absent when it failed none."
        ),
    ] = None
    test_rows_seen_by: Annotated[
        list[PipelineVersionId] | None,
        Field(
            description="Earlier versions applied from the same proposal whose runs had already scored the test rows (arch doc §11). Absent when none had."
        ),
    ] = None
    created_at: Timestamp


class MethodologyCheck(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_check/v1"]
    id: MethodologyCheckId
    pipeline_version_id: PipelineVersionId
    question_version_id: QuestionVersionId | None = None
    methodology_decision_id: MethodologyDecisionId | None = None
    check: CheckRef
    phase: MethodologyPhase | None = None
    coverage: MethodologyCoverage | None = None
    verdict: Verdict
    rationale: Annotated[str, Field(min_length=1)]
    cited_nodes: Annotated[
        list[NodeId],
        Field(
            description="Nodes the verdict is about. Empty when the rule found nothing to inspect."
        ),
    ]
    limitations: Annotated[
        str | None,
        Field(
            description="What the rule could not assess. Omitted when there is nothing to say.",
            min_length=1,
        ),
    ] = None
    created_at: Timestamp


class NotebookCell(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: NotebookCellId
    kind: Kind3
    source: Annotated[str, Field(max_length=100000)]


class NotebookExecution(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: Status1
    execution_count: Annotated[
        int | None,
        Field(
            description="The kernel's count for this execution. Absent when the cell never got one (timed out before it started).",
            ge=0,
        ),
    ] = None
    outputs: list[DisplayItem]
    error: Annotated[
        NotebookError | None, Field(description="Present when status is error or interrupted.")
    ] = None
    kernel_restarted: Annotated[
        bool | None,
        Field(
            description="Present and true when the kernel restarted before or during this cell (memory cap, crash, stuck interrupt): every variable is gone. Absent otherwise."
        ),
    ] = None


class ExecutionRunning(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["running"]
    execution_count: Annotated[
        int | None,
        Field(description="The kernel's count for this execution, once it has one.", ge=0),
    ] = None
    outputs: Annotated[
        list[DisplayItem],
        Field(description="Every output so far, not only the new ones, capped as in the result."),
    ]


class ExecutionDone(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["done"]
    execution: NotebookExecution


class ExecutionFailed(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["failed"]
    problem: Problem


class NotebookVariables(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variables: list[NotebookVariable]


class NotebookKernelRequest(
    RootModel[KernelExecute | KernelInterrupt | KernelVariables | KernelShutdown]
):
    root: Annotated[
        KernelExecute | KernelInterrupt | KernelVariables | KernelShutdown,
        Field(
            description="Rust to the session host, one JSON line each (ADR-0036). Tagged by `op`. The host answers execute with NotebookExecutionEvent lines ending in `done` (ADR-0041) and variables with NotebookVariables; interrupt and shutdown get no answer.",
            title="NotebookKernelRequest",
        ),
    ]


class OperatorModel(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    family: Annotated[
        ModelFamily | None,
        Field(
            description="Left out for a model that ignores its features, such as a dummy baseline."
        ),
    ] = None
    tasks: Annotated[
        list[TaskType] | None,
        Field(
            description="The supervised tasks the model fits, so a shortlist rule can offer it (ADR-0044)."
        ),
    ] = None
    complexity: Annotated[
        int | None,
        Field(
            description="How flexible the model is, for the one-SE rule (ADR-0050): of the models within one standard error of the best, the one with the lowest complexity is recommended. 0 ignores its features; linear models are 1; tree ensembles 2. Set on every supervised model.",
            ge=0,
        ),
    ] = None
    estimator: Annotated[
        Entrypoint | None,
        Field(
            description="Python `module:function` returning the model unfitted, given its params except target, features and costs, so cross-validation can refit it per fold (ADR-0044, ADR-0046). Set on every supervised model."
        ),
    ] = None
    search: Annotated[
        list[SearchSetting] | None,
        Field(
            description="The settings a study may tune, in this order, each with the values it tries (ADR-0052). Left out for a model with nothing to tune."
        ),
    ] = None


class Port(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    kind: PortKind
    description: str | None = None


class InputPort(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    kind: PortKind
    description: str | None = None
    optional: Annotated[
        bool | None,
        Field(
            description="An input the step may run without (ADR-0058): left unconnected, the step gets nothing for it. Only a matrix input may be optional today; the registry refuses any other."
        ),
    ] = None


class Node(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: NodeId
    operator: OperatorRef
    params: Params
    methodology_decision_id: Annotated[
        MethodologyDecisionId | None,
        Field(
            description="Decision that produced this node state. Absent for a hand-authored node."
        ),
    ] = None
    code: Annotated[
        NodeCode | None,
        Field(
            description="This step's own code in this version, replacing its operator's implementation (ADR-0028). Omitted: the operator's code runs."
        ),
    ] = None
    from_notebook: Annotated[
        NodeSource | None,
        Field(
            description="The notebook cells this node was created from (ADR-0036). Omitted: not made from a notebook."
        ),
    ] = None
    title: Annotated[
        str | None,
        Field(
            description="The kind of step, as people read it: Box plot, Train/test split (ADR-0055). The step's id says what it is about. Omitted: its operator's name.",
            max_length=80,
            min_length=1,
        ),
    ] = None
    stage: Annotated[
        Stage | None,
        Field(
            description="The stage notebook this step's cell is in (ADR-0055). Omitted: the stage its operator implies."
        ),
    ] = None
    notes: Annotated[
        NodeNotes | None,
        Field(description="Markdown cells shown with this step's cell (ADR-0055). Omitted: none."),
    ] = None
    names: Annotated[
        dict[str, VariableName] | None,
        Field(
            description="The variable each output port goes by in the notebook, by port (ADR-0055). Omitted: the port names."
        ),
    ] = None


class Edge(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_: Annotated[PortRef, Field(alias="from")]
    to: PortRef


class SuccessBar(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    metric: SelectionMetric
    score: Annotated[
        float,
        Field(
            description="At least this for balanced_accuracy, at most this for expected_cost and rmse. The API refuses a balanced accuracy outside 0 to 1 and a negative cost or error."
        ),
    ]


class InterpretabilityFact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Interpretability
    origin: Annotated[Origin1, Field(description="A constraint is never inferred or measured.")]


class CostsFact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Costs
    origin: Annotated[Origin4, Field(description="Costs are never inferred or measured.")]


class TaskFact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: TaskType
    origin: Origin


class WalkStepRef(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    walk_id: WalkId
    round: Annotated[int, Field(ge=0)]


class Run(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.run/v1"]
    id: RunId
    project_id: ProjectId
    pipeline_version_id: PipelineVersionId
    status: RunStatus
    reuse_run_id: Annotated[
        RunId | None,
        Field(
            description="The run whose unchanged results this run reused (ADR-0026). Omitted when it ran from the start."
        ),
    ] = None
    run_from_node_id: Annotated[
        NodeId | None,
        Field(
            description="The step this run ran again from, with every step after it (ADR-0026 amendment). Omitted when only changed steps ran."
        ),
    ] = None
    created_at: Timestamp
    finished_at: Annotated[
        Timestamp | None, Field(description="Set once the run reaches a terminal status.")
    ] = None


class Attempt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.attempt/v1"]
    id: AttemptId
    run_id: RunId
    node_id: NodeId
    number: Annotated[int, Field(description="1 for the first try of this step.", ge=1)]
    state: AttemptState
    worker_id: Annotated[WorkerId | None, Field(description="Set once leased.")] = None
    lease_expires_at: Annotated[Timestamp | None, Field(description="Set while leased.")] = None
    error: Annotated[Error | None, Field(description="Set when state is failed or timed_out.")] = (
        None
    )
    created_at: Timestamp


class CandidateSearch(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    trials: list[SearchedTrial]
    settings: Params


class Study(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.study/v1"]
    id: StudyId
    project_id: ProjectId
    pipeline_version_id: Annotated[
        PipelineVersionId, Field(description="The flow version whose model step is studied.")
    ]
    node_id: Annotated[NodeId, Field(description="The model step.")]
    proposal_id: Annotated[
        MethodologyProposalId,
        Field(description="The study's own shortlist proposal; its comparison is the study's."),
    ]
    comparison_id: Annotated[
        PipelineVersionId,
        Field(description="The comparison version holding the trials and the select step."),
    ]
    run_id: Annotated[RunId, Field(description="The comparison's run.")]
    strategy: StudyStrategy
    seed: Annotated[int, Field(description="Shuffles the grid for random search.", ge=0)]
    max_trials: Annotated[
        int, Field(description="Most trials the study may hold; checked when it is built.", ge=0)
    ]
    max_wall_seconds: Annotated[
        int, Field(description="Longest the study's run may take, counted from its start.", ge=0)
    ]
    guardrails: Annotated[
        list[Guardrail],
        Field(
            description="Declared when the study is created, before this study's scores exist (EXP-02). Earlier comparisons of the same step may have been seen; the decision lists them (ADR-0052)."
        ),
    ]
    status: StudyStatus
    deadline: Annotated[
        Timestamp | None,
        Field(
            description="When the budget runs out: the scheduler leases no step after it. Absent until the run starts."
        ),
    ] = None
    created_at: Timestamp
    finished_at: Annotated[
        Timestamp | None, Field(description="Set once the study reaches a terminal status.")
    ] = None


class Trial(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.trial/v1"]
    study_id: StudyId
    node_id: Annotated[NodeId, Field(description="The cross-validate step in the comparison.")]
    candidate: Annotated[
        str,
        Field(
            description="The shortlist alternative this trial scores.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]
    operator: Annotated[OperatorRef, Field(description="The model operator.")]
    settings: Annotated[
        Params,
        Field(
            description="The searched settings this trial uses; empty for a model with nothing to search."
        ),
    ]
    state: TrialState
    attempts: Annotated[list[AttemptId], Field(description="Its attempts, oldest first.")]
    scores: Annotated[
        ArtifactId | None, Field(description="Its per-fold scores table. Absent until it succeeds.")
    ] = None


class StudyDetail(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    study: Study
    trials: list[Trial]
    run: Run


class CreateWalk(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    idempotency_key: Annotated[str, Field(max_length=128, min_length=8)]
    project_id: ProjectId
    question_version_id: QuestionVersionId
    sources: WalkSources
    max_actions: Annotated[
        int, Field(description="Most actions (applies, runs, comparisons) the walk may take.", ge=0)
    ]
    max_wall_seconds: Annotated[
        int, Field(description="Longest the walk may take, counted from its creation.", ge=0)
    ]


class WalkAsk(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decides: Annotated[
        DecisionKey,
        Field(
            description="The decision it holds back: a method's or a rule's key, such as data.repeated_items, or the question fact to state, such as question.success_bar."
        ),
    ]
    question: Annotated[str, Field(description="The question, for a person.", min_length=1)]
    method: Annotated[
        MethodRef | None,
        Field(description="The method that asks. Absent: a rule or the engine asks."),
    ] = None
    option: Annotated[
        MethodOptionId | None,
        Field(description="The option the method would take, once a person confirms it."),
    ] = None
    options: Annotated[
        list[WalkAskOption] | None,
        Field(
            description="Every option of the method, for the person to pick from. Present exactly when method is."
        ),
    ] = None


class PromiseCheck(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decides: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")]
    method: MethodRef
    verification: VerificationName
    promise: Annotated[
        str, Field(description="What holds when it passes, from method.yaml.", min_length=1)
    ]
    step: Annotated[
        NodeId | None,
        Field(description="The step that measured the evidence. Absent when not_evaluated."),
    ] = None
    result: PromiseResult
    detail: Annotated[
        str,
        Field(description="What the evidence showed, or why nothing measured it.", min_length=1),
    ]


class PromiseStatus(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    verification: VerificationName
    promise: Annotated[str, Field(min_length=1)]
    status: PromiseStanding
    detail: Annotated[str, Field(min_length=1)]
    step: Annotated[
        NodeId | None,
        Field(description="The step that measured its evidence. Absent when nothing did."),
    ] = None
    last_result: Annotated[
        PromiseResult | None, Field(description="For stale: what the check found when it ran.")
    ] = None


class LeaseAttempt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["lease_attempt"]
    attempt_id: AttemptId
    run_id: RunId
    node_id: NodeId
    operator: OperatorRef
    params: Params
    inputs: list[InputBinding]
    code: Annotated[
        NodeCode | None,
        Field(
            description="The step's own code (ADR-0028): run this function instead of the operator's."
        ),
    ] = None
    staging_uri: Annotated[
        str,
        Field(
            description="Only location the worker may write outputs to. Scoped to this attempt.",
            pattern="^[a-z][a-z0-9+.-]*://.+$",
        ),
    ]
    lease_expires_at: Timestamp


class AttemptOutput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port: PortName
    artifact: Artifact


class LoadedTable(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[
        str,
        Field(
            description="The file name the source step reads, or the step's id when it reads no file."
        ),
    ]
    operator: OperatorRef
    artifact: Artifact
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[int, Field(ge=0)]
    used_by: list[LoadedTableUse]


class ProfilePlan(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.profile_plan/v1"]
    artifact_id: ArtifactId
    question_version_id: Annotated[
        QuestionVersionId | None,
        Field(
            description="The formal question whose declared task, target and bindings selected the sections. Absent for neutral data exploration."
        ),
    ] = None
    scope: ProfileScope
    sections: Annotated[
        list[ProfilePlanSection],
        Field(
            description="Applicable sections in the fixed display order. The UI renders only these sections and their supplied reason."
        ),
    ]
    limitations: Annotated[
        list[str],
        Field(
            description="Fixed statements about the evidence bounds or scope. They are explanations, not findings."
        ),
    ]


class ClassificationReport(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.classification_report/v1"]
    n_rows: Annotated[int, Field(ge=0)]
    estimator: Annotated[
        str,
        Field(description="The estimator's class name, inside a cost cut-off when there is one."),
    ]
    sklearn_version: str
    cut_off: Annotated[
        CutOff | None, Field(description="Only for a model that decides by costs (ADR-0053).")
    ] = None
    expected_cost: Annotated[
        float | None, Field(description="Mean cost per test row; only with cut_off.", ge=0.0)
    ] = None
    accuracy: Annotated[float, Field(ge=0.0, le=1.0)]
    balanced_accuracy: Annotated[float, Field(ge=0.0, le=1.0)]
    f1_macro: Annotated[float, Field(ge=0.0, le=1.0)]
    weighted_f1: Annotated[float, Field(ge=0.0, le=1.0)]
    confusion: ConfusionMatrix
    per_class: Annotated[
        list[ClassScore], Field(description="One per class, in the confusion matrix's label order.")
    ]
    top_confusions: Annotated[
        list[Confusion],
        Field(
            description="The off-diagonal confusion cells with any rows, largest first, at most 10."
        ),
    ]
    error_margins: Annotated[
        ErrorMargins | None,
        Field(description="Absent when the model gives no scores or got no row wrong."),
    ] = None
    misclassified_sample: MisclassifiedSample


class LabelNumber(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column: str
    r: Annotated[
        float,
        Field(
            description="For two classes, the point-biserial r with the first class (-1 to 1). For more, the correlation ratio eta (0 to 1). Rows missing either are left out."
        ),
    ]
    by_class: Annotated[
        list[ClassBins] | None,
        Field(
            description="For at most 6 classes: each class's counts in the column's histogram bins. Absent for more."
        ),
    ] = None


class ColumnProfile(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Polars data type name, for display only.")]
    missing: Annotated[int, Field(description="Empty cells, NaN and infinity.", ge=0)]
    distinct: Annotated[int, Field(description="Distinct values, not counting missing.", ge=0)]
    skewness: Annotated[
        float | None,
        Field(description="Sample skewness of a numeric column with variation; absent otherwise."),
    ] = None
    kurtosis: Annotated[
        float | None,
        Field(
            description="Excess (Fisher) kurtosis of a numeric column with variation; absent otherwise."
        ),
    ] = None
    outlier_share: Annotated[
        float | None,
        Field(
            description="Share of present values outside the 1.5 x IQR fences, for a numeric column with variation.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    iqr: Annotated[
        float | None,
        Field(
            description="Interquartile range of a numeric column with variation. Zero when most values are equal: IQR fences and robust scaling then have no spread to use.",
            ge=0.0,
        ),
    ] = None
    case_variants: Annotated[
        int | None,
        Field(
            description="Of a text column's distinct values, how many merge with another once spaces and case are ignored ('Paris', 'paris '). Absent for other columns.",
            ge=0,
        ),
    ] = None
    accent_variants: Annotated[
        int | None,
        Field(
            description="How many more of a text column's distinct values merge once accents are also ignored ('café', 'cafe'). Absent for other columns.",
            ge=0,
        ),
    ] = None
    rarest_share: Annotated[
        float | None,
        Field(
            description="For a column with at most 20 distinct values, the share of present values held by its least common value, such as the rarest class of a target. Absent for other columns.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    numeric_share: Annotated[
        float | None,
        Field(
            description="Of a text column's present values, the share that read as numbers. Absent for other columns.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    word_share: Annotated[
        float | None,
        Field(
            description="Of a text column's present values, the share holding more than one word: free text, not a code such as an identifier (ADR-0059). Absent for other columns.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    html_share: Annotated[
        float | None,
        Field(
            description="Of a text column's present values, the share holding an HTML tag (<br />) or entity (&eacute;): markup, not words (ADR-0059). Absent for other columns.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    leading_zero_values: Annotated[
        int | None,
        Field(
            description="Of a text column's present values, how many read as numbers but start with a zero before a digit, like the code 01234. Absent for other columns.",
            ge=0,
        ),
    ] = None
    unconverted: Annotated[
        list[UnconvertedItem] | None,
        Field(
            description="A text column's most common present values that do not read as numbers, most common first, when some do. Dataset text (untrusted, rule 7), cut to 60 characters.",
            max_length=10,
        ),
    ] = None
    role: ColumnRole | None = None
    blank: Annotated[
        int | None,
        Field(
            description="Present text values that are empty or only spaces. Counted apart from missing, which holds empty cells, NaN and infinity: a blank is text that a step must turn into a gap before an imputer sees it. Absent for columns that are not text.",
            ge=0,
        ),
    ] = None
    word_counts: Annotated[
        Histogram | None,
        Field(
            description="Words per present value of a text column, as equal-width bins. Absent for other columns."
        ),
    ] = None
    quartiles: Quartiles | None = None
    mean: Annotated[
        float | None, Field(description="Mean of a numeric column's present values.")
    ] = None
    std: Annotated[
        float | None,
        Field(description="Sample standard deviation of a numeric column with variation.", ge=0.0),
    ] = None
    fences: Fences | None = None
    outliers: Annotated[
        int | None,
        Field(
            description="Present values outside the fences, for a numeric column with variation.",
            ge=0,
        ),
    ] = None
    missing_by_band: Annotated[
        list[float],
        Field(
            description="Share of gaps (0 to 1) in each row band, in row order: missing cells, and blank text in a text column."
        ),
    ]
    histogram: Annotated[
        Histogram | None, Field(description="Absent when every value is missing.")
    ] = None


class CodeDisplay(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[DisplayItem]


class CodeInterface(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    inputs: list[CodeInput]
    parameters: list[CodeParameter]
    outputs: list[CodeOutputCandidate]
    files: Annotated[
        list[CodeFileRead] | None,
        Field(
            description="Files the code reads (ADR-0025): inputs, never parameters. Omitted in reports written before ADR-0025."
        ),
    ] = None


class CodeSplit(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    steps: list[SplitStep]
    links: list[SplitLink]
    notes: list[SplitNote]


class MethodStatements(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    costs: Costs | None = None
    interpretability: Interpretability | None = None
    success_bar: SuccessBar | None = None


class MethodAction(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    bind: MethodBind | None = None
    replace: MethodReplace | None = None
    insert: MethodInsert | None = None
    set: MethodSet | None = None


class VerificationRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.verification_request/v1"]
    module: Annotated[
        str,
        Field(
            description="Path of the method's method.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the method process on the same machine, never stored.",
            min_length=1,
        ),
    ]
    method: MethodRef
    verification: VerificationName
    evidence: Annotated[
        EvidenceFields, Field(description="The fields of the evidence kind the verification needs.")
    ]
    settings: Annotated[
        Params,
        Field(description="The verification's settings from method.yaml; empty when it has none."),
    ]


class MethodAnswer(RootModel[MethodDecided | MethodRefused | MethodVerified]):
    root: Annotated[
        MethodDecided | MethodRefused | MethodVerified,
        Field(
            description="The method session's one JSON line per request, tagged by `answer`: what decide() returned, what verify_<name>() found, or why the method refused its request. Any other failure ends the session.",
            title="MethodAnswer",
        ),
    ]


class ConceptSet(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.concept_set/v1"]
    concepts: dict[
        Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")], Concept
    ]


class Binding(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.binding/v1"]
    concept: ConceptId
    source: BindingSource
    set_by: BindingSetBy


class EvidenceSet(
    RootModel[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")],
            EvidenceFields,
        ]
    ]
):
    root: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")],
            EvidenceFields,
        ],
        Field(
            description="What one evidence producer measured, written to its output port named evidence (ADR-0063): each kind it produces, with each field's value. The operator's produces says which kinds and fields, of which types; the control plane checks the file against it when the step's outputs are saved.",
            title="EvidenceSet",
        ),
    ]


class RuleDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.rule_decision/v1"]
    rule: MethodologyRuleRef
    recommended_alternative_id: Annotated[
        str | None,
        Field(
            description="The one alternative a recommend rule picks; absent for a shortlist rule.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ] = None
    shortlist: Annotated[
        list[ShortlistItem] | None,
        Field(
            description="The alternatives a shortlist rule puts forward to compare; absent for a recommend rule (ADR-0044)."
        ),
    ] = None
    alternatives: Annotated[list[Alternative], Field(min_length=1)]
    evidence: list[MethodologyEvidence]


class RuleDecided(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    answer: Literal["decided"]
    decision: RuleDecision


class MethodologyRule(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_rule/v1"]
    id: MethodologyRuleRef
    name: Annotated[str, Field(min_length=1)]
    stage: MethodologyStage
    selection: Annotated[
        Selection | None,
        Field(
            description="recommend (the default): decide() picks one alternative. shortlist: it puts forward the registry's models worth comparing (ADR-0044)."
        ),
    ] = None
    status: Annotated[
        Status,
        Field(
            description="draft: a design with no rule.py, never run; its condition and observes are notes. active: has rule.py, applies_to, reads and examples, and no notes (ADR-0045)."
        ),
    ]
    applies_to: Annotated[
        list[AppliesToItem] | None,
        Field(
            description="Operators, without version, whose steps this active rule decides. Rust routes from it (ADR-0045)."
        ),
    ] = None
    reads: Annotated[
        list[Read] | None,
        Field(
            description="Facts this active rule may read, by name from the fact catalog, e.g. question.target or column.*.kurtosis; * stands for a column or setting name. Rust sends only these (ADR-0045)."
        ),
    ] = None
    examples: Annotated[
        list[RuleExample] | None,
        Field(
            description="Inputs and the alternative decide() picks for them. Run as tests and shown in place of conditions (ADR-0045)."
        ),
    ] = None
    question: Annotated[
        str | None,
        Field(
            description="The decision as a person asks it, e.g. How should missing values be filled? Shown on the Methodology page; nothing that decides reads it. Required on an active rule (ADR-0045 amendment).",
            min_length=1,
        ),
    ] = None
    decides: Annotated[
        str,
        Field(
            description="The one decision this rule owns; unique across loaded packs.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ]
    provenance: Provenance
    observes: Annotated[
        list[Observes | Observes1] | None,
        Field(
            description="Design notes on a draft rule's inputs; an active rule declares reads instead."
        ),
    ] = None
    policy_thresholds: Annotated[
        dict[str, Any], Field(description="Default thresholds the rule decides with.")
    ]
    alternatives: Annotated[
        list[Alternative1],
        Field(
            description="A recommend rule's menu. A shortlist rule has none: its candidates come from the registry (ADR-0044)."
        ),
    ]
    verification: Verification


class MethodologyReview(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_review/v1"]
    pipeline_version_id: PipelineVersionId
    items: list[MethodologyReviewItem]
    next: Annotated[
        list[NextItem],
        Field(description="Indexes into items of the open items with nothing open before them."),
    ]


class MethodologyDecisionByMethod(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_decision/v1"]
    id: MethodologyDecisionId
    method: MethodRef
    decides: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")]
    option: MethodOptionId
    assurance: MethodAssurance
    reason: Annotated[str, Field(min_length=1)]
    question_version_id: QuestionVersionId
    base_pipeline_version_id: PipelineVersionId
    pipeline_version_id: Annotated[
        PipelineVersionId | None,
        Field(description="The version the option made. Absent when it changed no step."),
    ] = None
    effects: Annotated[
        list[GraphEffect] | None,
        Field(description="The patch the option applied, in order. Absent: it changed no step."),
    ] = None
    bindings: Annotated[
        list[Binding] | None, Field(description="The bindings the option made. Absent: none.")
    ] = None
    promises: Annotated[
        list[VerificationName] | None,
        Field(description="The verifications the option promises, by name. Absent: none."),
    ] = None
    evidence: Annotated[
        list[UsedEvidence] | None,
        Field(
            description="What the method read, whether it chose or a person answered. Absent: it read none."
        ),
    ] = None
    created_at: Timestamp


class NotebookVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.notebook_version/v1"]
    id: NotebookVersionId
    notebook_id: NotebookId
    project_id: ProjectId
    parent_id: Annotated[
        NotebookVersionId | None,
        Field(
            description="Version this one was saved over. Absent for a notebook's first version."
        ),
    ] = None
    pipeline_version_id: Annotated[
        PipelineVersionId | None,
        Field(
            description="The flow version this notebook was made in or last synced into (ADR-0037). The notebook belongs to that flow and its later versions. Absent: not in a flow yet."
        ),
    ] = None
    title: Annotated[str, Field(max_length=200)]
    cells: list[NotebookCell]
    created_at: Timestamp
    removed: Annotated[
        bool | None,
        Field(
            description="Present and true: the notebook was deleted in this version (ADR-0041). It is no longer listed; its history stays readable. Absent otherwise."
        ),
    ] = None


class NotebookExecutionEvent(RootModel[ExecutionRunning | ExecutionDone | ExecutionFailed]):
    root: Annotated[
        ExecutionRunning | ExecutionDone | ExecutionFailed,
        Field(
            description="One line of a cell's execution as it happens (ADR-0041), from the session host to Rust and, when asked with Accept: application/x-ndjson, from POST /notebooks/{id}/execute to the browser. Tagged by `kind`: `running` lines carry every output so far; the last line is `done`, or `failed` when the kernel stopped answering after the stream began (earlier failures are an HTTP error).",
            title="NotebookExecutionEvent",
        ),
    ]


class Operator(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.operator/v1"]
    id: OperatorRef
    capability_class: CapabilityClass
    model: OperatorModel | None = None
    title: Annotated[
        str | None,
        Field(
            description="The step's name for people: the standard term for what it does (Group split, Imputation). Shown by the UI, CLI and notebooks; the description explains it in plain words. Absent: the operator's name stands in.",
            min_length=1,
        ),
    ] = None
    description: str | None = None
    entrypoint: Annotated[
        Entrypoint, Field(description="Python `module:function` the worker calls.")
    ]
    notebook_code: Annotated[
        Entrypoint | None,
        Field(
            description="Python `module:function` that writes this step as plain Python for a notebook cell, with its settings and names filled in (ADR-0055). A test runs that code against the step on fixtures. Absent: the step has no plain code yet."
        ),
    ] = None
    fits_on_train: Annotated[
        bool | None,
        Field(
            description="True for a step that reads train and test on ports of those names, fits on train only and writes each from its own rows. Such a step keeps train rows apart, and is refit on each fold when models are compared (ADR-0050). Absent: it may mix rows."
        ),
    ] = None
    role: Annotated[
        OperatorRole | None,
        Field(
            description="The job the step does, for methods that replace a step by role (ADR-0063). Absent: no method places it by role."
        ),
    ] = None
    role_default: Annotated[
        bool | None,
        Field(
            description="True for the operator the engine uses when it builds a step of this role (ADR-0064). At most one per role. Absent: not a default."
        ),
    ] = None
    folds: Annotated[
        SplitFolds | None,
        Field(
            description="Set on a split: how its folds are made when models are compared. Absent: a flow with this split cannot be compared."
        ),
    ] = None
    attach: Annotated[
        OperatorAttach | None,
        Field(description="Set on an evidence producer: where the engine adds it (ADR-0063)."),
    ] = None
    scope: Annotated[
        OperatorScope | None,
        Field(description="Which rows the step reads. Absent: whatever its inputs carry."),
    ] = None
    concepts: Annotated[
        dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], ConceptId]
        | None,
        Field(
            description="Params a project's binding fills: param name to concept (ADR-0063). Absent: none."
        ),
    ] = None
    produces: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")],
            EvidenceProduced,
        ]
        | None,
        Field(
            description="The evidence the step measures, by kind, with its fields (ADR-0063). The step writes it as one EvidenceSet to its output named evidence, and needs an attach. Absent: none."
        ),
    ] = None
    inputs: list[InputPort]
    outputs: list[Port]
    params_schema: Annotated[
        dict[str, Any],
        Field(
            description="JSON Schema for this operator's params. The compiler validates node params against it."
        ),
    ]
    effects: Effects
    network: NetworkAccess
    resources: Resources


class PipelineVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.pipeline_version/v1"]
    id: PipelineVersionId
    project_id: ProjectId
    question_version_id: Annotated[
        QuestionVersionId | None,
        Field(
            description="Exact immutable question-ledger revision this flow answers. Absent only for legacy or not-yet-scoped flows."
        ),
    ] = None
    parent_id: Annotated[
        PipelineVersionId | None,
        Field(description="Version this one was derived from. Absent for the first version."),
    ] = None
    compares: Annotated[
        MethodologyProposalId | None,
        Field(
            description="The shortlist proposal whose models this version cross-validates (ADR-0046). A comparison is a side version, not an edit: it has no parent_id, so the proposal stays applicable. Absent on every other version."
        ),
    ] = None
    nodes: list[Node]
    edges: list[Edge]
    created_at: Timestamp


class SuccessBarFact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: SuccessBar
    origin: Annotated[
        Origin1,
        Field(
            description="A bar is never inferred or measured: one set from the scores always looks met."
        ),
    ]


class ReportEvidence4(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    walk_step: WalkStepRef


class ReportEvidence(
    RootModel[ReportEvidence1 | ReportEvidence2 | ReportEvidence3 | ReportEvidence4]
):
    root: Annotated[
        ReportEvidence1 | ReportEvidence2 | ReportEvidence3 | ReportEvidence4,
        Field(description="One record a claim rests on, by id."),
    ]


class CandidateResult(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[
        str, Field(description="The compared alternative.", pattern="^[a-z][a-z0-9_]{0,62}$")
    ]
    fold_scores: Annotated[
        list[float],
        Field(
            description="The metric on each fold's validation rows, in fold order, repeat after repeat."
        ),
    ]
    mean: float
    spread: Annotated[float, Field(description="Standard deviation of the fold scores.")]
    versus_baseline: Annotated[
        BaselineComparison | None, Field(description="Absent for the baseline itself.")
    ] = None
    search: Annotated[
        CandidateSearch | None,
        Field(
            description="How its settings were tuned (ADR-0052). Absent: it ran at the flow's settings."
        ),
    ] = None
    guardrails: Annotated[
        list[GuardrailResult] | None,
        Field(
            description="Each declared guardrail, in declared order, as this candidate met it. Absent: none were declared."
        ),
    ] = None


class WalkStop(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reason: WalkStopReason
    detail: Annotated[
        str, Field(description="What is open, for a person to read. Never parsed.", min_length=1)
    ]
    asks: Annotated[
        list[WalkAsk] | None,
        Field(
            description="Every question the walk's look found open, as one list (ADR-0063 amendment). Absent: the walk stopped for another reason."
        ),
    ] = None


class WalkStep(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.walk_step/v1"]
    walk_id: WalkId
    round: Annotated[int, Field(description="Its place in the trail, from 0.", ge=0)]
    action: WalkAction
    pipeline_version_id: Annotated[
        PipelineVersionId | None, Field(description="The version it reviewed. Absent for build.")
    ] = None
    rule: Annotated[
        CheckRef | None, Field(description="The rule it acted for. Absent for build and run.")
    ] = None
    decides: Annotated[
        str | None,
        Field(
            description="What the rule decides. Absent for build, run and stop.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ] = None
    subject_node_id: Annotated[
        NodeId | None,
        Field(description="The step the rule decided. Absent for build, run and stop."),
    ] = None
    alternative_id: Annotated[
        str | None,
        Field(description="The alternative it applied.", pattern="^[a-z][a-z0-9_]{0,62}$"),
    ] = None
    methodology_decision_id: Annotated[
        MethodologyDecisionId | None, Field(description="The decision an apply recorded.")
    ] = None
    made_pipeline_version_id: Annotated[
        PipelineVersionId | None,
        Field(
            description="The version a build, apply, measure or decide made. Absent for a decide whose option changes no step."
        ),
    ] = None
    effects: Annotated[
        list[GraphEffect] | None,
        Field(
            description="The patch a measure or decide step applied, in order (ADR-0063). Absent for every other action."
        ),
    ] = None
    method: Annotated[
        MethodRef | None, Field(description="The method a decide step decided for.")
    ] = None
    option: Annotated[
        MethodOptionId | None,
        Field(
            description="The option a decide step took. A decide step always has method, decides, option and assurance."
        ),
    ] = None
    assurance: Annotated[
        MethodAssurance | None, Field(description="How a decide step's option was taken.")
    ] = None
    bindings: Annotated[
        list[Binding] | None,
        Field(description="The bindings a decide step's option made. Absent: none."),
    ] = None
    promises: Annotated[
        list[VerificationName] | None,
        Field(
            description="The verifications a decide step's option promises, by name. Absent: none."
        ),
    ] = None
    evidence: Annotated[
        list[UsedEvidence] | None,
        Field(
            description="What a decide step's method read, whether it chose or a person answered. Absent: it read no evidence."
        ),
    ] = None
    verifications: Annotated[
        list[PromiseCheck] | None,
        Field(
            description="What a verify step found, one item per promise the walk's decisions made. Absent for every other action."
        ),
    ] = None
    run_id: Annotated[
        RunId | None,
        Field(
            description="The run a run step started, or the run whose evidence a verify step read."
        ),
    ] = None
    reason: Annotated[
        str, Field(description="Why, from the review item it acted on.", min_length=1)
    ]
    created_at: Timestamp


class FlowDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decides: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")]
    method: MethodRef
    name: Annotated[
        str, Field(description="The method's name, for the decision's title.", min_length=1)
    ]
    activity: Annotated[
        str,
        Field(
            description="The method's activity: one stage card, one notebook section.", min_length=1
        ),
    ]
    question: Annotated[str, Field(description="The question the method answers.", min_length=1)]
    option: MethodOptionId
    label: Annotated[str, Field(description="The option, for people.", min_length=1)]
    reason: Annotated[
        str, Field(description="Why it was taken, from the decide step.", min_length=1)
    ]
    assurance: MethodAssurance
    steps: Annotated[
        list[NodeId],
        Field(
            description="The steps it shaped or rested on: those its patch changed, those its bindings read, those that measured its promises, and those that measured the evidence it read."
        ),
    ]
    bindings: Annotated[
        list[Binding] | None, Field(description="The bindings it made. Absent: none.")
    ] = None
    evidence: Annotated[
        list[UsedEvidence] | None,
        Field(description="What the method read, with the step that measured it. Absent: none."),
    ] = None
    promises: list[PromiseStatus]


class WorkerMessage(
    RootModel[
        Handshake
        | LeaseAttempt
        | Heartbeat
        | Progress
        | ArtifactManifest
        | Complete
        | Fail
        | Cancel
        | Acknowledge
    ]
):
    root: Annotated[
        Handshake
        | LeaseAttempt
        | Heartbeat
        | Progress
        | ArtifactManifest
        | Complete
        | Fail
        | Cancel
        | Acknowledge,
        Field(
            description="Local worker protocol message (arch doc §11). Tagged by `type`.",
            title="WorkerMessage",
        ),
    ]


class LabelProfile(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target: str
    classes: Annotated[
        list[HistogramBar],
        Field(
            description="The 30 most common labels and their rows, most common first. Rows with no label are left out."
        ),
    ]
    other: Annotated[
        int,
        Field(
            description="Labelled rows whose label is not among the classes. Above zero, the label has too many values to relate columns to: numbers and groups are then empty.",
            ge=0,
        ),
    ]
    numbers: Annotated[
        list[LabelNumber],
        Field(description="Each measured number and how it moves with the label."),
    ]
    groups: Annotated[
        list[LabelGroup],
        Field(
            description="Categories with 2 to 20 values, at most 6, and the first class's share in each value."
        ),
    ]


class MethodOption(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: MethodOptionId
    label: Annotated[str, Field(min_length=1)]
    action: MethodAction | None = None
    verify: Annotated[
        list[VerificationName],
        Field(description="The verifications this option promises, by name."),
    ]


class MethodRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.method_request/v1"]
    module: Annotated[
        str,
        Field(
            description="Path of the method's method.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the method process on the same machine, never stored.",
            min_length=1,
        ),
    ]
    method: MethodRef
    needs: MethodNeeds
    options: Annotated[
        list[MethodOptionId],
        Field(
            description="The ids of the method's options: decide() chooses or asks for one of them."
        ),
    ]
    task: TaskType
    evidence: Annotated[
        EvidenceSet,
        Field(
            description="Each needed kind that was measured. A needed kind left out cannot be measured, because its producer reads a concept no binding names."
        ),
    ]
    decisions: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")],
            MethodOptionId,
        ],
        Field(description="Each needed decision, by its key: the option chosen."),
    ]
    bound: Annotated[
        list[ConceptId],
        Field(
            description="The needed concepts a stated, confirmed or method-made binding names. Never a column name."
        ),
    ]
    ruled_out: Annotated[
        list[RuledOutOption] | None,
        Field(
            description="Options this walk took whose promise then failed, so the decision is made again: they are left out of `options`. Absent: none."
        ),
    ] = None
    statements: Annotated[
        MethodStatements | None,
        Field(
            description="The needed statements the question makes. Absent: the method needs none."
        ),
    ] = None


class RuleAnswer(RootModel[RuleDecided | RuleRefused]):
    root: Annotated[
        RuleDecided | RuleRefused,
        Field(
            description="The rule session's one JSON line per RuleRequest, tagged by `answer`: the rule's decision, or why the rule refused its observation. Any other failure ends the session.",
            title="RuleAnswer",
        ),
    ]


class MethodologyDecision(RootModel[MethodologyDecisionByRule | MethodologyDecisionByMethod]):
    root: Annotated[
        MethodologyDecisionByRule | MethodologyDecisionByMethod,
        Field(
            description="Immutable record of one decision made through Apply: a rule's alternative, or a method's option (ADR-0064).",
            title="MethodologyDecision",
        ),
    ]


class AppliedMethodologyDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decision: MethodologyDecision
    pipeline: PipelineVersion


class ModelSelection(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    proposal: DecisionProposal
    comparison: PipelineVersion
    run: Run


class QuestionVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.question_version/v1"]
    id: QuestionVersionId
    investigation_id: InvestigationId
    parent_id: Annotated[
        QuestionVersionId | None,
        Field(description="Version this one revises. Absent for the first version."),
    ] = None
    objective: Fact
    task: TaskFact
    target: Annotated[
        Fact | None,
        Field(description="Target column. Absent when there is no legitimate supervised target."),
    ] = None
    unit_of_analysis: Fact | None = None
    entity_column: Annotated[
        Fact | None,
        Field(
            description="Column whose values identify the unit or group that must not cross an entity-aware split."
        ),
    ] = None
    time_column: Fact | None = None
    prediction_horizon: Annotated[
        Fact | None,
        Field(
            description="How far after prediction time the outcome is observed, preferably an ISO-8601 duration such as P30D."
        ),
    ] = None
    assumptions: list[Fact]
    unknowns: list[Unknown]
    acceptance_criteria: list[Fact]
    costs: Annotated[
        CostsFact | None,
        Field(
            description="What each wrong prediction costs, for a two-class classification question (ADR-0053). Only a person can state it. Absent: unknown, so both mistakes are treated as costing the same."
        ),
    ] = None
    interpretability: Annotated[
        InterpretabilityFact | None,
        Field(
            description="How far a person must follow each prediction, a hard constraint (ref-v3 0.4). high: only models a person can read, such as linear ones. Only a person can state it. Absent: not stated."
        ),
    ] = None
    success_bar: Annotated[
        SuccessBarFact | None,
        Field(
            description="The cross-validated score that counts as good enough, in a metric models are compared by (ADR-0059). Only a person can state it. Absent: not stated; the text acceptance criteria hold everything else."
        ),
    ] = None
    bindings: Annotated[
        list[Binding] | None,
        Field(
            description="Which column means each concept the packs ask for, in this project (ADR-0063). One binding per concept. Absent: none stated."
        ),
    ] = None
    asset_bindings: Annotated[
        list[AssetBinding] | None,
        Field(
            description="Explicitly declared external assets linked to rows. Asset roots are never inferred or scanned implicitly."
        ),
    ] = None
    answers: Annotated[
        list[DecisionAnswer] | None,
        Field(
            description="A person's answers to the methods' asks, one per decision key (ADR-0063 amendment). Absent: none given."
        ),
    ] = None
    created_at: Timestamp


class ReportClaim(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    statement: Annotated[str, Field(min_length=1)]
    evidence: Annotated[
        list[ReportEvidence],
        Field(
            description="The records the statement rests on. The engine builds every claim on at least one."
        ),
    ]


class SelectionDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.selection_decision/v1"]
    metric: SelectionMetric
    folds: Annotated[
        int,
        Field(description="Number of cross-validation folds every candidate was scored on.", ge=0),
    ]
    repeats: Annotated[
        int | None,
        Field(
            description="How many times the rows were shuffled into folds (ADR-0050). Absent: once, as before repeated folds.",
            ge=0,
        ),
    ] = None
    seed: Annotated[int, Field(description="Seed that shuffled the rows into folds.", ge=0)]
    baseline: Annotated[
        str,
        Field(
            description="The candidate every other must beat. As a floor, a model that ignores its features; as a reference, the rule's recommended preparation.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]
    baseline_role: Annotated[
        BaselineRole | None,
        Field(description="Absent: floor, as decided before ADR-0050 compared preparation."),
    ] = None
    candidates: list[CandidateResult]
    winner: Annotated[
        str | None,
        Field(
            description="The chosen candidate. Absent: no model beats a floor baseline. A reference baseline is the winner when no alternative beats it.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ] = None
    reason: Annotated[str, Field(min_length=1)]
    not_compared: Annotated[
        list[NotCompared] | None,
        Field(
            description="Alternatives the comparison did not score, each with why (ADR-0050). Absent: decided before ADR-0050 recorded them."
        ),
    ] = None
    limitations: Annotated[
        list[Limitation], Field(description="What the comparison did not cover.")
    ]
    guardrails: Annotated[
        list[Guardrail] | None,
        Field(
            description="Constraints a candidate had to meet to win, declared with the study (EXP-02, ADR-0052). Absent: none were declared."
        ),
    ] = None
    positive_share: Annotated[
        float | None,
        Field(
            description="With costs: the share of the costed class in the train rows. Expected cost and each tuned cut-off hold at this share only (ADR-0053)."
        ),
    ] = None
    earlier_looks: Annotated[
        list[PipelineVersionId] | None,
        Field(
            description="Earlier comparisons of the same version and step, started on the same folds before this one, whether or not they finished (ADR-0052). Absent: none."
        ),
    ] = None


class Walk(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.walk/v1"]
    id: WalkId
    project_id: ProjectId
    question_version_id: QuestionVersionId
    sources: WalkSources
    source_hashes: Annotated[
        list[ContentHash] | None,
        Field(
            description="Each source's SHA-256 when the walk began, in the order of `sources`. Every round checks them: a source that changed stops the walk. Absent on walks made before they were recorded, and on one that stopped before building anything."
        ),
    ] = None
    max_actions: Annotated[int, Field(ge=0)]
    max_wall_seconds: Annotated[int, Field(ge=0)]
    status: WalkStatus
    head_pipeline_version_id: Annotated[
        PipelineVersionId | None,
        Field(
            description="The latest version the walk made. Absent when it stopped before building one."
        ),
    ] = None
    stop: Annotated[WalkStop | None, Field(description="Why it stopped. Present once stopped.")] = (
        None
    )
    created_at: Timestamp
    finished_at: Annotated[Timestamp | None, Field(description="Set once stopped.")] = None


class FlowDecisions(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.flow_decisions/v2"]
    pipeline_version_id: PipelineVersionId
    walk_id: Annotated[
        WalkId | None,
        Field(
            description="The walk that made the version or its nearest ancestor. Absent: no walk did, so nothing decided it."
        ),
    ] = None
    decisions: list[FlowDecision]


class WalkDetail(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    walk: Walk
    steps: list[WalkStep]


class DatasetProfile(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[int, Field(ge=0)]
    profiled_rows: Annotated[
        int,
        Field(
            description="Rows the profile covers: all of them, or the first 1,000,000 of a larger table.",
            ge=0,
        ),
    ]
    band_rows: Annotated[
        int,
        Field(
            description="Rows in each band of the missing-value map; the last band may hold fewer.",
            ge=0,
        ),
    ]
    duplicate_rows: Annotated[
        int | None,
        Field(description="Profiled rows equal in every column to an earlier one.", ge=0),
    ] = None
    rows_with_gap: Annotated[
        int | None,
        Field(
            description="Profiled rows with at least one gap: a missing cell, or blank text in a text column.",
            ge=0,
        ),
    ] = None
    co_missing: Annotated[
        list[CoMissing] | None,
        Field(
            description="The column pairs most often empty in the same rows (a missing cell or blank text), most rows first, at most 5. Pairs never empty together are left out."
        ),
    ] = None
    columns: list[ColumnProfile]
    correlation: Correlation
    label: Annotated[
        LabelProfile | None,
        Field(
            description="How the columns relate to a label column, when one was asked for (GET /artifacts/{id}/profile?target=). Of every row, held-out rows included: for looking, never for choosing (rule 8). Absent when none was asked for or the table has no such column."
        ),
    ] = None
    findings: Annotated[
        list[ProfileFinding] | None,
        Field(
            description="What stands out in the profiled rows, most important first, as plain sentences built from the counts above (ADR-0065). Descriptive: a finding is never evidence for a decision.",
            max_length=60,
        ),
    ] = None


class Method(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.method/v2"]
    id: MethodRef
    decides: DecisionKey
    name: Annotated[
        str,
        Field(
            description="The decision's professional name, for titles (\"Duplicate analysis\"); `question` explains it. A rule's `name` means the same.",
            min_length=1,
        ),
    ]
    activity: Annotated[
        str,
        Field(
            description="The group this decision is shown in: one stage card on the canvas, one notebook section.",
            min_length=1,
        ),
    ]
    question: Annotated[
        str, Field(description="The decision as a question for people.", min_length=1)
    ]
    applies_when: MethodAppliesWhen | None = None
    needs: MethodNeeds
    options: list[MethodOption]
    verifications: Annotated[
        dict[
            Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,62}$")], MethodVerification
        ],
        Field(
            description="Promises an option can make, by name. An option lists the ones it makes in verify."
        ),
    ]
    source: Annotated[
        str, Field(description="The published standard the method follows.", min_length=1)
    ]


class Report(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.report/v1"]
    id: ReportId
    walk_id: WalkId
    question_version_id: QuestionVersionId
    question: Annotated[
        str, Field(description="The question's objective, as a person stated it.", min_length=1)
    ]
    answer: ReportClaim
    claims: Annotated[
        list[ReportClaim],
        Field(
            description="One per decision the walk made and per promise it checked, in trail order."
        ),
    ]
    limitations: Annotated[list[Limitation], Field(description="What the answer does not show.")]
    created_at: Timestamp
