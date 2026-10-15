//! Content-addressed artifact store on `object_store` (local disk now, S3 later).
//!
//! Workers write outputs to a local staging directory. `commit` streams a staged file once,
//! hashing and uploading together, and keeps it only if the hash matches the worker's claim.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use bytes::Bytes;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, WriteMultipart};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

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
        source: std::io::Error,
    },
    #[error("object store: {0}")]
    Object(#[from] object_store::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Committed {
    pub content_hash: String,
    pub size_bytes: u64,
    pub uri: String,
}

pub struct ArtifactStore {
    staging: PathBuf,
    objects: Arc<dyn ObjectStore>,
    uri_prefix: String,
}

const CHUNK: usize = 8 * 1024 * 1024;

impl ArtifactStore {
    /// Staging and objects both under `root` on local disk.
    pub fn local(root: &Path) -> Result<Self, StoreError> {
        let staging = root.join("staging");
        let objects = root.join("objects");
        for dir in [&staging, &objects] {
            std::fs::create_dir_all(dir).map_err(io_err("create", dir))?;
        }
        let objects = canonical(&objects)?;
        Ok(Self {
            staging: canonical(&staging)?,
            objects: Arc::new(LocalFileSystem::new_with_prefix(&objects)?),
            uri_prefix: format!("file://{}", objects.display()),
        })
    }

    /// Where a worker writes one output. The caller creates the parent directory.
    pub fn staging_path(&self, attempt_id: &str, port: &str) -> Result<PathBuf, StoreError> {
        Ok(self.staging.join(safe(attempt_id)?).join(safe(port)?))
    }

    /// Verify the staged file's hash while uploading it, then remove the staged copy.
    /// Committing content that is already stored succeeds without uploading again.
    pub async fn commit(
        &self,
        staged: &Path,
        expected_hash: &str,
    ) -> Result<Committed, StoreError> {
        let hex = parse_hash(expected_hash)?;
        let staged = canonical(staged)?;
        if !staged.starts_with(&self.staging) {
            return Err(StoreError::OutsideStaging(staged));
        }
        let key = object_key(hex);
        let size_bytes = match self.objects.head(&key).await {
            Ok(meta) => meta.size,
            Err(object_store::Error::NotFound { .. }) => {
                self.upload_verified(&staged, &key, hex, expected_hash)
                    .await?
            }
            Err(e) => return Err(e.into()),
        };
        tokio::fs::remove_file(&staged)
            .await
            .map_err(io_err("remove", &staged))?;
        Ok(Committed {
            content_hash: expected_hash.to_owned(),
            size_bytes,
            uri: format!("{}/{key}", self.uri_prefix),
        })
    }

    pub async fn get(&self, content_hash: &str) -> Result<Bytes, StoreError> {
        let key = object_key(parse_hash(content_hash)?);
        match self.objects.get(&key).await {
            Ok(result) => Ok(result.bytes().await?),
            Err(object_store::Error::NotFound { .. }) => {
                Err(StoreError::NotFound(content_hash.to_owned()))
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Streams `staged` to `key`, hashing as it goes. Aborts the upload on mismatch,
    /// so a wrong or tampered file never becomes visible.
    async fn upload_verified(
        &self,
        staged: &Path,
        key: &ObjectPath,
        expected_hex: &str,
        expected_hash: &str,
    ) -> Result<u64, StoreError> {
        let mut file = tokio::fs::File::open(staged)
            .await
            .map_err(io_err("open", staged))?;
        let mut upload = WriteMultipart::new(self.objects.put_multipart(key).await?);
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = file.read(&mut buf).await.map_err(io_err("read", staged))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            upload.write(&buf[..n]);
            size += n as u64;
        }
        let actual = hex::encode(hasher.finalize());
        if actual != expected_hex {
            upload.abort().await?;
            return Err(StoreError::HashMismatch {
                path: staged.to_owned(),
                expected: expected_hash.to_owned(),
                actual: format!("sha256:{actual}"),
            });
        }
        upload.finish().await?;
        Ok(size)
    }
}

fn object_key(hex: &str) -> ObjectPath {
    ObjectPath::from(format!("{}/{hex}", &hex[..2]))
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

fn canonical(path: &Path) -> Result<PathBuf, StoreError> {
    path.canonicalize().map_err(io_err("resolve", path))
}

fn io_err(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> StoreError {
    let path = path.to_owned();
    move |source| StoreError::Io {
        action,
        path,
        source,
    }
}
