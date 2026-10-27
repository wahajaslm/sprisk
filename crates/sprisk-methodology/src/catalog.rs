//! Rule catalog: loads every `rule.yaml` under the methodology root (ADR-0042), and beside
//! them every `method.yaml` and pack `concepts.yaml` (ADR-0063).
//!
//! Each manifest is validated against the `MethodologyRule` contract, and each rule's
//! files are read once at load, so the code shown is the code on disk at start.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde_json::json;
use sprisk_contracts::{
    Concept, ContractError, Method, MethodFiles, MethodStop, MethodologyRule,
    MethodologyRuleSource, MethodologyRuleStatus, MethodologyStage, Operator, RuleActionType,
};

use crate::methods::{self, ConceptEntry, MethodEntry, Provided};
use walkdir::WalkDir;

const MANIFEST: &str = "rule.yaml";
const MODULE: &str = "rule.py";

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("walk {root}: {source}")]
    Walk {
        root: PathBuf,
        source: walkdir::Error,
    },
    #[error("{path}: invalid YAML: {source}")]
    Yaml {
        path: PathBuf,
        source: yaml_serde::Error,
    },
    #[error("{path}: not a valid manifest: {source}")]
    Invalid {
        path: PathBuf,
        source: ContractError,
    },
    #[error("rule {id} defined twice: {first} and {second}")]
    DuplicateId {
        id: String,
        first: PathBuf,
        second: PathBuf,
    },
    #[error("decision {decides} has two owners: {first} and {second}")]
    DuplicateDecision {
        decides: String,
        first: String,
        second: String,
    },
    #[error("{path}: {problem} (ADR-0045)")]
    Manifest { path: PathBuf, problem: String },
    #[error("{path}: {problem} (ADR-0063)")]
    Method { path: PathBuf, problem: String },
    #[error("operator {operator}: {problem} (ADR-0063)")]
    Operator { operator: String, problem: String },
    #[error("evidence {0} (ADR-0063)")]
    Evidence(String),
    #[error("decisions read each other in a cycle, through {0} (ADR-0063)")]
    DecisionCycle(String),
    #[error("concept {id} defined twice: {first} and {second}")]
    DuplicateConcept {
        id: String,
        first: PathBuf,
        second: PathBuf,
    },
    #[error("unknown methodology rule {0}")]
    UnknownRule(String),
    #[error("method {0} is in no loaded pack")]
    UnknownMethod(String),
    #[error("methodology rule {0} has no rule.py")]
    NoModule(String),
    #[error("decision {0} names no stage before its dot")]
    UnknownStage(String),
}

#[derive(Debug, Default)]
pub struct RuleCatalog {
    rules: BTreeMap<String, Entry>,
    /// In decision order: a method comes after the methods whose decisions it reads.
    methods: Vec<MethodEntry>,
    /// Methods shown as rules on the map. Display only: Apply and source go to the method.
    method_rules: Vec<MethodologyRule>,
    concepts: BTreeMap<String, ConceptEntry>,
}

#[derive(Debug)]
struct Entry {
    rule: MethodologyRule,
    path: PathBuf,
    source: MethodologyRuleSource,
}

impl RuleCatalog {
    /// Loads every pack under `root`. Methods are checked against `operators`, the registered
    /// operators: each option names one of them, and each evidence kind has one producer.
    pub fn load_dir<'a>(
        root: &Path,
        operators: impl IntoIterator<Item = &'a Operator>,
    ) -> Result<Self, CatalogError> {
        let mut catalog = Self::default();
        let mut methods = Vec::new();
        for entry in WalkDir::new(root).sort_by_file_name() {
            let entry = entry.map_err(|source| CatalogError::Walk {
                root: root.to_owned(),
                source,
            })?;
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.file_name() == methods::METHOD {
                methods.push(methods::read_method(entry.path())?);
            } else if entry.file_name() == methods::CONCEPTS {
                methods::read_concepts(entry.path(), &mut catalog.concepts)?;
            } else if entry.file_name() == MANIFEST {
                let path = entry.into_path();
                let text = read(&path)?;
                let rule = parse_manifest(&path, &text)?;
                check_draft(&rule, path.with_file_name(MODULE).is_file()).map_err(|problem| {
                    CatalogError::Manifest {
                        path: path.clone(),
                        problem,
                    }
                })?;
                let source = read_source(&path, &rule, text)?;
                catalog.insert(Entry { rule, path, source })?;
            }
        }
        refuse_duplicate_methods(&methods)?;
        catalog.refuse_shared_decisions(&methods)?;
        let provided = Provided {
            concepts: &catalog.concepts,
            operators: operators
                .into_iter()
                .map(|op| (op.id.to_string(), op))
                .collect(),
        };
        catalog.methods = methods::check(methods, &provided)?;
        catalog.method_rules = catalog
            .methods
            .iter()
            .map(|e| method_as_rule(&e.method, &e.path))
            .collect::<Result<_, _>>()?;
        Ok(catalog)
    }

    /// Every method, in decision order.
    pub fn methods(&self) -> impl Iterator<Item = &Method> {
        self.methods.iter().map(|e| &e.method)
    }

    /// The path of the method's `method.py`, for the method runner.
    pub fn method_module(&self, method_ref: &str) -> Result<PathBuf, CatalogError> {
        self.methods
            .iter()
            .find(|e| e.method.id.as_str() == method_ref)
            .map(|e| e.path.with_file_name(methods::METHOD_MODULE))
            .ok_or_else(|| CatalogError::NoModule(method_ref.to_owned()))
    }

    /// Every concept the packs define, by id.
    pub fn concepts(&self) -> impl Iterator<Item = (&str, &Concept)> {
        self.concepts
            .iter()
            .map(|(id, e)| (id.as_str(), &e.concept))
    }

    /// Every rule, ordered by ref.
    pub fn rules(&self) -> impl Iterator<Item = &MethodologyRule> {
        self.rules.values().map(|e| &e.rule)
    }

    pub fn rule(&self, rule_ref: &str) -> Result<&MethodologyRule, CatalogError> {
        self.entry(rule_ref).map(|e| &e.rule)
    }

    fn entry(&self, rule_ref: &str) -> Result<&Entry, CatalogError> {
        self.rules
            .get(rule_ref)
            .ok_or_else(|| CatalogError::UnknownRule(rule_ref.to_owned()))
    }

    pub fn source(&self, rule_ref: &str) -> Result<&MethodologyRuleSource, CatalogError> {
        self.entry(rule_ref).map(|e| &e.source)
    }

    /// A method's method.yaml and method.py, as the packs loaded them.
    pub fn method_files(&self, method_ref: &str) -> Result<&MethodFiles, CatalogError> {
        self.methods
            .iter()
            .find(|e| e.method.id.as_str() == method_ref)
            .map(|e| &e.files)
            .ok_or_else(|| CatalogError::UnknownMethod(method_ref.to_owned()))
    }

    fn insert(&mut self, entry: Entry) -> Result<(), CatalogError> {
        let id = entry.rule.id.to_string();
        if let Some(first) = self.rules.get(&id) {
            return Err(CatalogError::DuplicateId {
                id,
                first: first.path.clone(),
                second: entry.path,
            });
        }
        self.rules.insert(id, entry);
        Ok(())
    }

    /// One owner per decision, rule or method (ADR-0042, ADR-0063).
    fn refuse_shared_decisions(&self, methods: &[MethodEntry]) -> Result<(), CatalogError> {
        let rules = self
            .rules()
            .map(|r| (r.decides.to_string(), r.id.to_string()));
        let methods = methods
            .iter()
            .map(|m| (m.method.decides.to_string(), m.method.id.to_string()));
        let mut owners: BTreeMap<String, String> = BTreeMap::new();
        for (decides, owner) in rules.chain(methods) {
            if let Some(first) = owners.insert(decides.clone(), owner.clone()) {
                return Err(CatalogError::DuplicateDecision {
                    decides,
                    first,
                    second: owner,
                });
            }
        }
        Ok(())
    }

    /// Every rule and every method shown as one, in stage order.
    pub fn all_rules(&self) -> Vec<MethodologyRule> {
        let mut rules: Vec<MethodologyRule> = self.rules().cloned().collect();
        rules.extend(self.method_rules.iter().cloned());
        rules.sort_by_key(|r| (r.stage, r.id.to_string()));
        rules
    }
}

/// A rule is a draft: words for the map, with no code, never routed. An active decision is a
/// method (ADR-0063 slice 6). Returns what is wrong.
fn check_draft(rule: &MethodologyRule, has_module: bool) -> Result<(), String> {
    if rule.status != MethodologyRuleStatus::Draft {
        return Err("a rule is a draft; an active decision is a method (method.yaml)".into());
    }
    if has_module {
        return Err("a draft rule has no rule.py".into());
    }
    if !rule.applies_to.is_empty() {
        return Err("a draft rule is never routed, so it has no applies_to".into());
    }
    Ok(())
}

pub(crate) fn read(path: &Path) -> Result<String, CatalogError> {
    std::fs::read_to_string(path).map_err(|source| CatalogError::Io {
        path: path.to_owned(),
        source,
    })
}

fn refuse_duplicate_methods(methods: &[MethodEntry]) -> Result<(), CatalogError> {
    let mut paths: BTreeMap<String, &Path> = BTreeMap::new();
    for entry in methods {
        let id = entry.method.id.to_string();
        if let Some(first) = paths.insert(id.clone(), &entry.path) {
            return Err(CatalogError::DuplicateId {
                id,
                first: first.to_owned(),
                second: entry.path.clone(),
            });
        }
    }
    Ok(())
}

/// Reads a YAML manifest and parses it through its contract.
pub(crate) fn parse_yaml<T: DeserializeOwned>(path: &Path) -> Result<T, CatalogError> {
    parse_manifest(path, &read(path)?)
}

fn parse_manifest<T: DeserializeOwned>(path: &Path, text: &str) -> Result<T, CatalogError> {
    let value: serde_json::Value =
        yaml_serde::from_str(text).map_err(|source| CatalogError::Yaml {
            path: path.to_owned(),
            source,
        })?;
    sprisk_contracts::parse(&value.to_string()).map_err(|source| CatalogError::Invalid {
        path: path.to_owned(),
        source,
    })
}

/// The rule's manifest, the one file a draft has.
fn read_source(
    manifest: &Path,
    rule: &MethodologyRule,
    manifest_text: String,
) -> Result<MethodologyRuleSource, CatalogError> {
    let files = vec![json!({ "path": MANIFEST, "language": "yaml", "text": manifest_text })];
    let source = json!({ "rule": rule.id.to_string(), "files": files });
    sprisk_contracts::parse(&source.to_string()).map_err(|source| CatalogError::Invalid {
        path: manifest.to_owned(),
        source,
    })
}

/// The stage a decision belongs to: the area in `<area>.<decision>`.
fn stage_of(decides: &str) -> Result<MethodologyStage, CatalogError> {
    let area = decides.split_once('.').map_or(decides, |(area, _)| area);
    area.parse()
        .map_err(|_| CatalogError::UnknownStage(decides.to_owned()))
}

/// A method shown as a rule, for the map, in the method's own words.
fn method_as_rule(m: &Method, path: &Path) -> Result<MethodologyRule, CatalogError> {
    let alternatives: Vec<serde_json::Value> = m
        .options
        .iter()
        .map(|option| {
            json!({
                "id": option.id,
                "label": option.label,
                "description": option.description,
                "rationale": option.rationale,
                "when": option.when,
                "action": method_action(option.action.as_ref()),
            })
        })
        .collect();
    let reads: Vec<&str> = m
        .needs
        .evidence
        .iter()
        .map(|e| e.as_str())
        .chain(m.needs.concepts.iter().map(|c| c.as_str()))
        .chain(m.needs.decisions.iter().map(|d| d.as_str()))
        .collect();
    // By name, so the words do not depend on map order.
    let verifications: BTreeMap<&str, &str> = m
        .verifications
        .iter()
        .map(|(name, v)| (name.as_str(), v.promise.as_str()))
        .collect();
    let (checks, promises): (Vec<&str>, Vec<&str>) = verifications.into_iter().unzip();
    let rule = json!({
        "schema_version": "sprisk.methodology_rule/v1",
        "id": m.id,
        "name": m.name,
        "stage": stage_of(m.decides.as_str())?,
        "decides": m.decides,
        "status": "active",
        "question": m.question,
        "provenance": {
            "standard": m.activity,
            "citation": m.source,
            "pitfall": m.pitfall,
            "corner_cases": [],
        },
        "policy_thresholds": {},
        "alternatives": alternatives,
        "verification": if checks.is_empty() {
            json!({ "check_id": "none", "invariant": "The method makes no checked promise." })
        } else {
            json!({ "check_id": checks.join(", "), "invariant": promises.join(" ") })
        },
        "reads": reads,
    });
    sprisk_contracts::parse(&rule.to_string()).map_err(|source| CatalogError::Invalid {
        path: path.to_owned(),
        source,
    })
}

/// The rule action nearest to what a method option does. Display only.
fn method_action(action: Option<&sprisk_contracts::MethodAction>) -> serde_json::Value {
    match action {
        Some(a) if a.replace.is_some() => {
            json!({ "type": RuleActionType::ReplaceNode, "operator": a.replace.as_ref().map(|r| &r.operator) })
        }
        Some(a) if a.insert.is_some() => {
            json!({ "type": RuleActionType::InsertStep, "operator": a.insert.as_ref().map(|i| &i.operator) })
        }
        Some(a) if a.stop == Some(MethodStop::Limitation) => {
            json!({ "type": RuleActionType::EmitMethodologyLimitation })
        }
        Some(a) if a.stop == Some(MethodStop::Uncovered) => {
            json!({ "type": RuleActionType::Reopen })
        }
        _ => json!({ "type": RuleActionType::PassThrough }),
    }
}
