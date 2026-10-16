//! Operator registry: loads and indexes operator manifests.
//!
//! A manifest is any `manifest.yaml` under the root. Each is validated against the
//! `Operator` contract, so the registry holds only well-formed operators.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use sprisk_contracts::{ContractError, Operator, OperatorSource, OperatorSourceLanguage};
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
    #[error("unknown operator {0}")]
    UnknownOperator(String),
    #[error("operator {operator} has no readable source in its pack")]
    NoSource { operator: String },
    #[error("operator {operator}: digest is not a content hash: {reason}")]
    BadDigest { operator: String, reason: String },
    #[error("operator {id} defined twice: {first} and {second}")]
    Duplicate {
        id: String,
        first: PathBuf,
        second: PathBuf,
    },
}

#[derive(Debug, Default)]
pub struct Registry {
    operators: BTreeMap<String, Entry>,
}

#[derive(Debug, Clone)]
struct Entry {
    operator: Operator,
    path: PathBuf,
    /// Arch §9 `implementation_digest`: the manifest plus the pack's source code.
    digest: String,
    /// The entrypoint module, read once with the digest so the code shown is the code that runs.
    source: Option<OperatorSource>,
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
                let digest = implementation_digest(&path)?;
                let source = read_source(&path, &operator, &digest)?;
                registry.insert(Entry {
                    operator,
                    path,
                    digest,
                    source,
                })?;
            }
        }
        Ok(registry)
    }

    /// Exact lookup by pinned reference, e.g. `sprisk.eval.binary_classification@1.0.0`.
    pub fn get(&self, operator_ref: &str) -> Option<&Operator> {
        self.operators.get(operator_ref).map(|e| &e.operator)
    }

    /// Every operator, ordered by ref.
    pub fn operators(&self) -> impl Iterator<Item = &Operator> {
        self.operators.values().map(|e| &e.operator)
    }

    pub fn len(&self) -> usize {
        self.operators.len()
    }

    pub fn is_empty(&self) -> bool {
        self.operators.is_empty()
    }

    fn insert(&mut self, entry: Entry) -> Result<(), RegistryError> {
        let id = entry.operator.id.to_string();
        if let Some(first) = self.operators.get(&id) {
            return Err(RegistryError::Duplicate {
                id,
                first: first.path.clone(),
                second: entry.path,
            });
        }
        self.operators.insert(id, entry);
        Ok(())
    }

    /// The operator and its implementation digest, together, so callers cannot get one
    /// without the other.
    pub fn resolve(&self, operator_ref: &str) -> Option<(&Operator, &str)> {
        self.operators
            .get(operator_ref)
            .map(|e| (&e.operator, e.digest.as_str()))
    }

    /// Digest of the operator's manifest and its pack's source. Changes whenever the code
    /// that would run changes, even without a version bump, so caches never serve stale code.
    pub fn digest(&self, operator_ref: &str) -> Option<&str> {
        self.operators.get(operator_ref).map(|e| e.digest.as_str())
    }
}

impl Registry {
    /// The Python module behind an operator's entrypoint, as read when the registry loaded.
    pub fn source(&self, operator_ref: &str) -> Result<&OperatorSource, RegistryError> {
        let entry = self
            .operators
            .get(operator_ref)
            .ok_or_else(|| RegistryError::UnknownOperator(operator_ref.to_owned()))?;
        entry
            .source
            .as_ref()
            .ok_or_else(|| RegistryError::NoSource {
                operator: operator_ref.to_owned(),
            })
    }
}

/// Largest module the registry keeps for reading; plugin modules are a few KB.
const MAX_SOURCE_BYTES: u64 = 512 * 1024;

/// The entrypoint module from the pack's `src/`. Only a regular, UTF-8 file under the cap that
/// resolves inside that `src/` is kept: no links out, no other paths. Anything else is `None`.
fn read_source(
    manifest: &Path,
    operator: &Operator,
    digest: &str,
) -> Result<Option<OperatorSource>, RegistryError> {
    let entrypoint = operator.entrypoint.to_string();
    let module = entrypoint.split(':').next().unwrap_or_default();
    let rel = format!("{}.py", module.replace('.', "/"));
    let Some(src) = pack_src(manifest).and_then(|s| s.canonicalize().ok()) else {
        return Ok(None);
    };
    let Ok(file) = src.join(&rel).canonicalize() else {
        return Ok(None);
    };
    let small_file =
        std::fs::metadata(&file).is_ok_and(|m| m.is_file() && m.len() <= MAX_SOURCE_BYTES);
    if !file.starts_with(&src) || !small_file {
        return Ok(None);
    }
    let Ok(text) = std::fs::read_to_string(&file) else {
        return Ok(None);
    };
    let digest = digest.parse().map_err(|e| RegistryError::BadDigest {
        operator: operator.id.to_string(),
        reason: format!("{e}"),
    })?;
    Ok(Some(OperatorSource {
        operator: operator.id.clone(),
        path: rel,
        language: OperatorSourceLanguage::Python,
        text,
        digest,
    }))
}

/// The pack's `src/`: the pack is the nearest ancestor of the manifest holding a `pyproject.toml`.
fn pack_src(manifest: &Path) -> Option<PathBuf> {
    manifest
        .ancestors()
        .skip(1)
        .find(|dir| dir.join("pyproject.toml").is_file())
        .map(|p| p.join("src"))
        .filter(|s| s.is_dir())
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

/// sha256 over the manifest and every file under the pack's `src/`, by relative path.
/// The pack is the nearest ancestor of the manifest holding a `pyproject.toml`.
fn implementation_digest(manifest: &Path) -> Result<String, RegistryError> {
    let read = |path: &Path| {
        std::fs::read(path).map_err(|source| RegistryError::Io {
            path: path.to_owned(),
            source,
        })
    };
    let mut hasher = Sha256::new();
    hasher.update(read(manifest)?);
    if let Some(src) = pack_src(manifest) {
        let files = WalkDir::new(&src)
            .sort_by_file_name()
            .into_iter()
            .filter_entry(|e| e.file_name() != "__pycache__");
        for entry in files {
            let entry = entry.map_err(|source| RegistryError::Walk {
                root: src.clone(),
                source,
            })?;
            if entry.file_type().is_file() {
                let rel = entry.path().strip_prefix(&src).unwrap_or(entry.path());
                let bytes = read(entry.path())?;
                // Length-prefixed, so file boundaries cannot shift between packs.
                hasher.update(rel.to_string_lossy().as_bytes());
                hasher.update([0]);
                hasher.update((bytes.len() as u64).to_le_bytes());
                hasher.update(bytes);
            }
        }
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}
