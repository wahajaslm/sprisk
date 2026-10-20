//! Rule catalog: loads every `rule.yaml` under the methodology root (ADR-0042).
//!
//! Each manifest is validated against the `MethodologyRule` contract, and each rule's
//! files are read once at load, so the code shown is the code on disk at start.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::json;
use sprisk_contracts::{
    ContractError, MethodologyRule, MethodologyRuleSelection, MethodologyRuleSource,
    MethodologyRuleStatus,
};

use crate::facts;
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
    #[error("{path}: not a valid methodology rule: {source}")]
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
    #[error("operator {operator} has two active rules: {first} and {second}")]
    SharedOperator {
        operator: String,
        first: String,
        second: String,
    },
    #[error("unknown methodology rule {0}")]
    UnknownRule(String),
    #[error("methodology rule {0} has no rule.py")]
    NoModule(String),
}

#[derive(Debug, Default)]
pub struct RuleCatalog {
    rules: BTreeMap<String, Entry>,
}

#[derive(Debug)]
struct Entry {
    rule: MethodologyRule,
    path: PathBuf,
    source: MethodologyRuleSource,
    /// The rule's `decide()` module, when it has one.
    module: Option<PathBuf>,
}

impl RuleCatalog {
    pub fn load_dir(root: &Path) -> Result<Self, CatalogError> {
        let mut catalog = Self::default();
        for entry in WalkDir::new(root).sort_by_file_name() {
            let entry = entry.map_err(|source| CatalogError::Walk {
                root: root.to_owned(),
                source,
            })?;
            if entry.file_type().is_file() && entry.file_name() == MANIFEST {
                let path = entry.into_path();
                let text = read(&path)?;
                let rule = parse_manifest(&path, &text)?;
                let source = read_source(&path, &rule, text)?;
                let module = Some(path.with_file_name(MODULE)).filter(|m| m.is_file());
                check_status(&rule, module.is_some()).map_err(|problem| {
                    CatalogError::Manifest {
                        path: path.clone(),
                        problem,
                    }
                })?;
                catalog.insert(Entry {
                    rule,
                    path,
                    source,
                    module,
                })?;
            }
        }
        catalog.refuse_shared_decisions()?;
        catalog.refuse_shared_operators()?;
        Ok(catalog)
    }

    /// Every rule, ordered by ref.
    pub fn rules(&self) -> impl Iterator<Item = &MethodologyRule> {
        self.rules.values().map(|e| &e.rule)
    }

    pub fn rule(&self, rule_ref: &str) -> Result<&MethodologyRule, CatalogError> {
        self.entry(rule_ref).map(|e| &e.rule)
    }

    /// The path of the rule's `rule.py`, for the rule runner.
    pub fn module(&self, rule_ref: &str) -> Result<&Path, CatalogError> {
        self.entry(rule_ref)?
            .module
            .as_deref()
            .ok_or_else(|| CatalogError::NoModule(rule_ref.to_owned()))
    }

    /// The active rule that decides steps running `operator` (`<id>@<version>`), if any.
    pub fn rule_for_operator(&self, operator: &str) -> Option<&MethodologyRule> {
        let name = operator.split('@').next()?;
        self.rules()
            .find(|rule| rule.applies_to.iter().any(|a| a.as_str() == name))
    }

    fn entry(&self, rule_ref: &str) -> Result<&Entry, CatalogError> {
        self.rules
            .get(rule_ref)
            .ok_or_else(|| CatalogError::UnknownRule(rule_ref.to_owned()))
    }

    pub fn source(&self, rule_ref: &str) -> Result<&MethodologyRuleSource, CatalogError> {
        self.entry(rule_ref).map(|e| &e.source)
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

    /// One active rule per operator, so a step has one rule (ADR-0045).
    fn refuse_shared_operators(&self) -> Result<(), CatalogError> {
        let mut owners: BTreeMap<String, String> = BTreeMap::new();
        for rule in self.rules() {
            for operator in &rule.applies_to {
                let operator = operator.as_str().to_owned();
                if let Some(first) = owners.insert(operator.clone(), rule.id.to_string()) {
                    return Err(CatalogError::SharedOperator {
                        operator,
                        first,
                        second: rule.id.to_string(),
                    });
                }
            }
        }
        Ok(())
    }

    /// One owner per decision (ADR-0042).
    fn refuse_shared_decisions(&self) -> Result<(), CatalogError> {
        let mut owners: BTreeMap<String, String> = BTreeMap::new();
        for rule in self.rules() {
            let decides = rule.decides.to_string();
            if let Some(first) = owners.insert(decides.clone(), rule.id.to_string()) {
                return Err(CatalogError::DuplicateDecision {
                    decides,
                    first,
                    second: rule.id.to_string(),
                });
            }
        }
        Ok(())
    }
}

/// An active rule has code and only fields the system uses; a draft has no code and is
/// never routed (ADR-0045). Returns what is wrong.
fn check_status(rule: &MethodologyRule, has_module: bool) -> Result<(), String> {
    if rule.status != MethodologyRuleStatus::Active {
        if has_module {
            return Err("a draft rule has no rule.py; mark it active".into());
        }
        if !rule.applies_to.is_empty() {
            return Err("a draft rule is never routed, so it has no applies_to".into());
        }
        return Ok(());
    }
    if !has_module {
        return Err("an active rule needs its rule.py".into());
    }
    if !rule.observes.is_empty() {
        return Err("an active rule declares reads, not observes".into());
    }
    if let Some(a) = rule.alternatives.iter().find(|a| a.condition.is_some()) {
        return Err(format!(
            "alternative {} has a condition: an active rule's decide() is its only logic",
            a.id.as_str()
        ));
    }
    if rule.applies_to.is_empty() {
        return Err("an active rule needs applies_to".into());
    }
    if let Some(unknown) = rule.reads.iter().find(|r| !facts::is_known(r.as_str())) {
        return Err(format!("reads {}, which no one sends", unknown.as_str()));
    }
    if rule.examples.is_empty() {
        return Err("an active rule needs examples".into());
    }
    let shortlist = rule.selection == Some(MethodologyRuleSelection::Shortlist);
    if shortlist && !rule.alternatives.is_empty() {
        return Err("a shortlist rule's alternatives come from the registry; list none".into());
    }
    if !shortlist && rule.alternatives.is_empty() {
        return Err("a recommend rule needs alternatives to pick from".into());
    }
    for example in &rule.examples {
        match (&example.picks, example.shortlist.is_empty(), shortlist) {
            (None, false, true) => {}
            (_, _, true) => {
                return Err("a shortlist rule's example gives a shortlist, not picks".into());
            }
            (Some(picks), true, false) => {
                let picks = picks.as_str();
                if !rule.alternatives.iter().any(|a| a.id.as_str() == picks) {
                    return Err(format!(
                        "an example picks {picks}, which is not on the menu"
                    ));
                }
            }
            (_, _, false) => {
                return Err("a recommend rule's example gives picks, not a shortlist".into());
            }
        }
        if let Some(name) = example
            .given
            .keys()
            .find(|name| !rule.reads.iter().any(|r| facts::covers(r.as_str(), name)))
        {
            return Err(format!(
                "an example gives {name}, which the rule does not read"
            ));
        }
    }
    Ok(())
}

fn read(path: &Path) -> Result<String, CatalogError> {
    std::fs::read_to_string(path).map_err(|source| CatalogError::Io {
        path: path.to_owned(),
        source,
    })
}

fn parse_manifest(path: &Path, text: &str) -> Result<MethodologyRule, CatalogError> {
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

/// The manifest, then the Python module when the rule has one. Only files inside the
/// rule's own folder are read.
fn read_source(
    manifest: &Path,
    rule: &MethodologyRule,
    manifest_text: String,
) -> Result<MethodologyRuleSource, CatalogError> {
    let mut files = vec![json!({ "path": MANIFEST, "language": "yaml", "text": manifest_text })];
    let module = manifest.with_file_name(MODULE);
    if module.is_file() {
        files.push(json!({ "path": MODULE, "language": "python", "text": read(&module)? }));
    }
    let source = json!({ "rule": rule.id.to_string(), "files": files });
    sprisk_contracts::parse(&source.to_string()).map_err(|source| CatalogError::Invalid {
        path: manifest.to_owned(),
        source,
    })
}
