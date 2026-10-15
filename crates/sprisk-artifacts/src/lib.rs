//! Local content-addressed artifact store: workers write to staging, the control plane verifies and commits.
//!
//! Layout under the root: `staging/<attempt>/<port>` and `objects/<hex[..2]>/<hex>`.
//! Commit is a rename within one filesystem, so an object is either fully present or absent.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("unsafe path segment {0:?}: use letters, digits and underscores only")]
    UnsafeName(String),
    #[error("invalid content hash {0:?}: expected sha256:<64 lowercase hex>")]
    InvalidHash(String),
    #[error("{0} is not inside the staging directory")]
    OutsideStaging(PathBuf),
    #[error("hash mismatch for {path}: expected {expected}, got {actual}")]
    HashMismatch {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("no artifact with hash {0}")]
    NotFound(String),
    #[error("{action} {path}: {source}")]
    Io {
        action: &'static str,
        path: PathBuf,
        source: io::Error,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Committed {
    pub content_hash: String,
    pub size_bytes: u64,
    pub uri: String,
}

pub struct FsStore {
    staging: PathBuf,
    objects: PathBuf,
}

impl FsStore {
    pub fn new(root: &Path) -> Result<Self, StoreError> {
        let staging = root.join("staging");
        let objects = root.join("objects");
        for dir in [&staging, &objects] {
            fs::create_dir_all(dir).map_err(io_err("create", dir))?;
        }
        Ok(Self {
            staging: canonical(&staging)?,
            objects: canonical(&objects)?,
        })
    }

    /// Where a worker writes one output. The caller creates the parent directory.
    pub fn staging_path(&self, attempt_id: &str, port: &str) -> Result<PathBuf, StoreError> {
        Ok(self.staging.join(safe(attempt_id)?).join(safe(port)?))
    }

    /// Verify the staged file's hash, then move it into the store.
    /// Committing content that is already stored succeeds and discards the staged copy.
    pub fn commit(&self, staged: &Path, expected_hash: &str) -> Result<Committed, StoreError> {
        let hex = parse_hash(expected_hash)?;
        let staged = canonical(staged)?;
        if !staged.starts_with(&self.staging) {
            return Err(StoreError::OutsideStaging(staged));
        }
        let (actual, size_bytes) = hash_file(&staged)?;
        if actual != hex {
            return Err(StoreError::HashMismatch {
                path: staged,
                expected: expected_hash.to_owned(),
                actual: format!("sha256:{actual}"),
            });
        }
        let target = self.object_path(hex);
        if target.exists() {
            fs::remove_file(&staged).map_err(io_err("remove", &staged))?;
        } else {
            let parent = self.objects.join(&hex[..2]);
            fs::create_dir_all(&parent).map_err(io_err("create", &parent))?;
            fs::rename(&staged, &target).map_err(io_err("move", &staged))?;
        }
        Ok(Committed {
            content_hash: expected_hash.to_owned(),
            size_bytes,
            uri: format!("file://{}", target.display()),
        })
    }

    pub fn open(&self, content_hash: &str) -> Result<File, StoreError> {
        let path = self.object_path(parse_hash(content_hash)?);
        File::open(&path).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => StoreError::NotFound(content_hash.to_owned()),
            _ => io_err("open", &path)(e),
        })
    }

    fn object_path(&self, hex: &str) -> PathBuf {
        self.objects.join(&hex[..2]).join(hex)
    }
}

fn safe(name: &str) -> Result<&str, StoreError> {
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(name)
    } else {
        Err(StoreError::UnsafeName(name.to_owned()))
    }
}

/// Returns the hex part of `sha256:<hex>`.
fn parse_hash(hash: &str) -> Result<&str, StoreError> {
    match hash.strip_prefix("sha256:") {
        Some(hex)
            if hex.len() == 64 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) =>
        {
            Ok(hex)
        }
        _ => Err(StoreError::InvalidHash(hash.to_owned())),
    }
}

fn hash_file(path: &Path) -> Result<(String, u64), StoreError> {
    let mut file = File::open(path).map_err(io_err("open", path))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(io_err("read", path))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), size))
}

fn canonical(path: &Path) -> Result<PathBuf, StoreError> {
    path.canonicalize().map_err(io_err("resolve", path))
}

fn io_err(action: &'static str, path: &Path) -> impl FnOnce(io::Error) -> StoreError {
    let path = path.to_owned();
    move |source| StoreError::Io {
        action,
        path,
        source,
    }
}
