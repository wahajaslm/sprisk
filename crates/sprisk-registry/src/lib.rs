//! Operator registry: loads and indexes operator manifests.
//!
//! A manifest is any `manifest.yaml` under the root. Each is validated against the
//! `Operator` contract, so the registry holds only well-formed operators.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sprisk_contracts::{ContractError, Operator};
use walkdir::WalkDir;

const MANIFEST: &str = "manifest.yaml";

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
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
    #[error("{path}: not a valid operator: {source}")]
    Invalid {
        path: PathBuf,
        source: ContractError,
    },
    #[error("operator {id} defined twice: {first} and {second}")]
    Duplicate {
        id: String,
        first: PathBuf,
        second: PathBuf,
    },
}

#[derive(Debug, Default)]
pub struct Registry {
    operators: BTreeMap<String, (Operator, PathBuf)>,
}

impl Registry {
    pub fn load_dir(root: &Path) -> Result<Self, RegistryError> {
        let mut registry = Self::default();
        for entry in WalkDir::new(root).sort_by_file_name() {
            let entry = entry.map_err(|source| RegistryError::Walk {
                root: root.to_owned(),
                source,
            })?;
            if entry.file_type().is_file() && entry.file_name() == MANIFEST {
                let path = entry.into_path();
                let operator = read_manifest(&path)?;
                registry.insert(operator, path)?;
            }
        }
        Ok(registry)
    }

    /// Exact lookup by pinned reference, e.g. `sprisk.eval.binary_classification@1.0.0`.
    pub fn get(&self, operator_ref: &str) -> Option<&Operator> {
        self.operators.get(operator_ref).map(|(op, _)| op)
    }

    /// Every operator, ordered by ref.
    pub fn operators(&self) -> impl Iterator<Item = &Operator> {
        self.operators.values().map(|(op, _)| op)
    }

    pub fn len(&self) -> usize {
        self.operators.len()
    }

    pub fn is_empty(&self) -> bool {
        self.operators.is_empty()
    }

    fn insert(&mut self, operator: Operator, path: PathBuf) -> Result<(), RegistryError> {
        let id = operator.id.to_string();
        if let Some((_, first)) = self.operators.get(&id) {
            return Err(RegistryError::Duplicate {
                id,
                first: first.clone(),
                second: path,
            });
        }
        self.operators.insert(id, (operator, path));
        Ok(())
    }
}

/// YAML → JSON value → the contract parser, so manifests get the same checks as wire data.
fn read_manifest(path: &Path) -> Result<Operator, RegistryError> {
    let text = std::fs::read_to_string(path).map_err(|source| RegistryError::Io {
        path: path.to_owned(),
        source,
    })?;
    let value: serde_json::Value =
        yaml_serde::from_str(&text).map_err(|source| RegistryError::Yaml {
            path: path.to_owned(),
            source,
        })?;
    sprisk_contracts::parse(&value.to_string()).map_err(|source| RegistryError::Invalid {
        path: path.to_owned(),
        source,
    })
}
