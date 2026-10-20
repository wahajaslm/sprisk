//! Rule catalog: loads every `rule.yaml` under the methodology root (ADR-0042).
//!
//! Each manifest is validated against the `MethodologyRule` contract, and each rule's
//! files are read once at load, so the code shown is the code on disk at start.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::json;
use sprisk_contracts::{ContractError, MethodologyRule, MethodologyRuleSource};
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
    #[error("unknown methodology rule {0}")]
    UnknownRule(String),
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
                catalog.insert(Entry { rule, path, source })?;
            }
        }
        catalog.refuse_shared_decisions()?;
        Ok(catalog)
    }

    /// Every rule, ordered by ref.
    pub fn rules(&self) -> impl Iterator<Item = &MethodologyRule> {
        self.rules.values().map(|e| &e.rule)
    }

    pub fn source(&self, rule_ref: &str) -> Result<&MethodologyRuleSource, CatalogError> {
        self.rules
            .get(rule_ref)
            .map(|e| &e.source)
            .ok_or_else(|| CatalogError::UnknownRule(rule_ref.to_owned()))
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
