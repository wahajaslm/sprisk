//! Data registered by reference (ADR-0067): where it lives, and a fingerprint of its files'
//! metadata. Files are listed through `object_store`; their bytes are never read or copied.
//! Credentials for an object store come from the environment only.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::TryStreamExt;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectMeta, ObjectStore, ObjectStoreExt, ObjectStoreScheme};
use sha2::{Digest, Sha256};
use sprisk_contracts::DataFormat;
use url::Url;

use crate::StoreError;

/// Where registered data lives, as a request names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Location {
    /// An absolute path on this machine, not yet resolved.
    Local(PathBuf),
    /// An `s3://`, `gs://` or `az://` URI.
    Remote(Url),
}

/// One data file of a source: its local path or object URI, and its size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    pub path: String,
    pub size: u64,
}

/// What a listing found: the data files, their format, total size and fingerprint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFiles {
    pub files: Vec<SourceFile>,
    pub format: DataFormat,
    pub size_bytes: u64,
    pub fingerprint: String,
}

/// Bounds on one listing: a petabyte source can hold millions of files.
#[derive(Debug, Clone, Copy)]
pub struct ListLimits {
    pub max_files: usize,
    pub timeout: Duration,
}

/// Reads a location: an absolute path, or a `file://`, `s3://`, `gs://` or `az://` URI.
/// A URI with a user, password, query or fragment is refused: that is where a key or a signed
/// token would ride, and the location is kept and shown (rule 6). Control characters are
/// refused too.
pub fn parse_location(raw: &str) -> Result<Location, StoreError> {
    let invalid = |why: &str| StoreError::InvalidLocation(format!("{raw:?}: {why}"));
    if raw.chars().any(char::is_control) {
        return Err(invalid("contains a control character"));
    }
    if raw.starts_with('/') {
        return Ok(Location::Local(PathBuf::from(raw)));
    }
    let url = Url::parse(raw).map_err(|_| invalid("not an absolute path or a URI"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        // Never echo it: it may hold a credential.
        return Err(StoreError::InvalidLocation(format!(
            "a {}:// location may not carry a user, password, query or fragment; credentials come from the environment",
            url.scheme()
        )));
    }
    match url.scheme() {
        "file" => url
            .to_file_path()
            .map(Location::Local)
            .map_err(|()| invalid("not a local file URI")),
        "s3" | "gs" | "az" if url.host_str().is_some_and(|h| !h.is_empty()) => {
            Ok(Location::Remote(url))
        }
        "s3" | "gs" | "az" => Err(invalid("names no bucket or container")),
        other => Err(StoreError::UnsupportedScheme(other.to_owned())),
    }
}

/// The data files at a local path, already resolved and checked against the data roots by the
/// caller. Each listed path is as found under `path`; symlinks are followed, so the caller must
/// check each file again.
pub async fn list_local(path: &Path, limits: ListLimits) -> Result<SourceFiles, StoreError> {
    let store = LocalFileSystem::new();
    let prefix = ObjectPath::from_absolute_path(path)
        .map_err(|e| StoreError::InvalidLocation(format!("{}: {e}", path.display())))?;
    let found = list(&store, &prefix, &path.display().to_string(), limits).await?;
    let mut files = Vec::with_capacity(found.len());
    for meta in &found {
        let local = store
            .path_to_filesystem(&meta.location)
            .map_err(|e| unreadable(&path.display().to_string(), &e))?;
        files.push((local.display().to_string(), meta));
    }
    describe(&path.display().to_string(), files)
}

/// The data files at an object-store URI, with credentials from the environment.
pub async fn list_remote(url: &Url, limits: ListLimits) -> Result<SourceFiles, StoreError> {
    let (scheme, prefix) = ObjectStoreScheme::parse(url)
        .map_err(|e| StoreError::InvalidLocation(format!("{url}: {e}")))?;
    let store: Arc<dyn ObjectStore> = match scheme {
        ObjectStoreScheme::AmazonS3 => Arc::new(
            object_store::aws::AmazonS3Builder::from_env()
                .with_url(url.as_str())
                .build()
                .map_err(|e| unreadable(url.as_str(), &e))?,
        ),
        ObjectStoreScheme::GoogleCloudStorage => Arc::new(
            object_store::gcp::GoogleCloudStorageBuilder::from_env()
                .with_url(url.as_str())
                .build()
                .map_err(|e| unreadable(url.as_str(), &e))?,
        ),
        ObjectStoreScheme::MicrosoftAzure => Arc::new(
            object_store::azure::MicrosoftAzureBuilder::from_env()
                .with_url(url.as_str())
                .build()
                .map_err(|e| unreadable(url.as_str(), &e))?,
        ),
        _ => return Err(StoreError::UnsupportedScheme(url.scheme().to_owned())),
    };
    let found = list(store.as_ref(), &prefix, url.as_str(), limits).await?;
    let files = found
        .iter()
        .map(|meta| (object_uri(url, &meta.location), meta))
        .collect();
    describe(url.as_str(), files)
}

/// The URI of one object in the bucket `url` names: `s3://lake/events/a.csv`.
fn object_uri(url: &Url, object: &ObjectPath) -> String {
    format!(
        "{}://{}/{object}",
        url.scheme(),
        url.host_str().unwrap_or_default()
    )
}

/// The object at `prefix`, or every object under it. Empty is not found; more than
/// `max_files` is refused, never cut, so a fingerprint always covers every file.
async fn list(
    store: &dyn ObjectStore,
    prefix: &ObjectPath,
    location: &str,
    limits: ListLimits,
) -> Result<Vec<ObjectMeta>, StoreError> {
    let listing = async {
        match store.head(prefix).await {
            Ok(meta) => return Ok(vec![meta]),
            Err(object_store::Error::NotFound { .. }) => {}
            Err(e) => return Err(unreadable(location, &e)),
        }
        let mut found = Vec::new();
        let mut stream = store.list(Some(prefix));
        while let Some(meta) = stream
            .try_next()
            .await
            .map_err(|e| unreadable(location, &e))?
        {
            if found.len() == limits.max_files {
                return Err(StoreError::TooManyFiles {
                    location: location.to_owned(),
                    limit: limits.max_files,
                });
            }
            found.push(meta);
        }
        Ok(found)
    };
    let found = tokio::time::timeout(limits.timeout, listing)
        .await
        .map_err(|_| StoreError::ListTimeout(location.to_owned()))??;
    if found.is_empty() {
        return Err(StoreError::SourceNotFound(location.to_owned()));
    }
    Ok(found)
}

/// Why a store could not be listed, in words that hold no URL: an error's own text may carry
/// a signed request (rule 6).
fn unreadable(location: &str, e: &object_store::Error) -> StoreError {
    let why = match e {
        object_store::Error::PermissionDenied { .. } => "permission denied",
        object_store::Error::Unauthenticated { .. } => {
            "not signed in: no valid credentials in the environment"
        }
        object_store::Error::NotFound { .. } => "not found",
        object_store::Error::InvalidPath { .. } => "not a valid object path",
        _ => "the store could not be reached or failed",
    };
    StoreError::SourceUnreadable {
        location: location.to_owned(),
        why,
    }
}

/// The data files' format, size and fingerprint. Names starting with `.` or `_` are tools'
/// bookkeeping (`_SUCCESS`, `.crc`) and are left out.
fn describe(location: &str, listed: Vec<(String, &ObjectMeta)>) -> Result<SourceFiles, StoreError> {
    let mut data: Vec<(String, &ObjectMeta, DataFormat)> = Vec::new();
    for (path, meta) in listed {
        let name = meta.location.filename().unwrap_or_default();
        if name.starts_with('.') || name.starts_with('_') {
            continue;
        }
        let format = match Path::new(name).extension().and_then(|e| e.to_str()) {
            Some("csv") => DataFormat::Csv,
            Some("parquet" | "pq") => DataFormat::Parquet,
            _ => return Err(StoreError::UnsupportedFormat(path)),
        };
        data.push((path, meta, format));
    }
    let Some(format) = data.first().map(|d| d.2) else {
        return Err(StoreError::SourceNotFound(location.to_owned()));
    };
    if data.iter().any(|d| d.2 != format) {
        return Err(StoreError::MixedFormats(location.to_owned()));
    }
    data.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (path, meta, _) in &data {
        let version = meta
            .e_tag
            .clone()
            .unwrap_or_else(|| meta.last_modified.to_rfc3339());
        hasher.update(format!("{path}\t{}\t{version}\n", meta.size));
    }
    Ok(SourceFiles {
        size_bytes: data.iter().map(|d| d.1.size).sum(),
        files: data
            .iter()
            .map(|(path, meta, _)| SourceFile {
                path: path.clone(),
                size: meta.size,
            })
            .collect(),
        format,
        fingerprint: format!("sha256:{}", hex::encode(hasher.finalize())),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    const LIMITS: ListLimits = ListLimits {
        max_files: 10,
        timeout: Duration::from_secs(5),
    };

    #[test]
    fn locations_are_read_by_scheme() {
        assert_eq!(
            parse_location("/data/x.csv").unwrap(),
            Location::Local("/data/x.csv".into())
        );
        assert_eq!(
            parse_location("file:///data/x.csv").unwrap(),
            Location::Local("/data/x.csv".into())
        );
        for uri in ["s3://lake/events/", "gs://b/x.parquet", "az://c/x.csv"] {
            assert_eq!(
                parse_location(uri).unwrap(),
                Location::Remote(Url::parse(uri).unwrap())
            );
        }
    }

    #[test]
    fn other_schemes_relative_paths_and_control_characters_are_refused() {
        for (raw, scheme) in [("https://x.com/a.csv", "https"), ("ftp://h/a.csv", "ftp")] {
            assert!(
                matches!(parse_location(raw), Err(StoreError::UnsupportedScheme(s)) if s == scheme)
            );
        }
        for raw in [
            "data/x.csv",
            "/data/x\n.csv",
            "s3:///no-bucket",
            "file://host/x.csv",
            "s3://AKIA:secret@lake/x.csv",
            "az://c/x.csv?sv=1&sig=abc",
            "gs://b/x.csv#frag",
        ] {
            assert!(
                matches!(parse_location(raw), Err(StoreError::InvalidLocation(m)) if !m.contains("secret") && !m.contains("sig=")),
                "{raw}"
            );
        }
    }

    #[test]
    fn an_object_is_named_by_its_bucket_and_key() {
        let url = Url::parse("s3://lake/events/").unwrap();
        let object = ObjectPath::from("events/day=1/a.parquet");
        assert_eq!(object_uri(&url, &object), "s3://lake/events/day=1/a.parquet");
    }

    #[tokio::test]
    async fn a_folder_lists_its_data_files_and_skips_bookkeeping() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.parquet"), b"aaaa").unwrap();
        std::fs::create_dir(dir.path().join("part")).unwrap();
        std::fs::write(dir.path().join("part/b.parquet"), b"bb").unwrap();
        std::fs::write(dir.path().join("_SUCCESS"), b"").unwrap();

        let listed = list_local(dir.path(), LIMITS).await.unwrap();

        assert_eq!(listed.format, DataFormat::Parquet);
        assert_eq!(listed.size_bytes, 6);
        assert_eq!(listed.files.len(), 2);
        assert!(listed.files[0].path.ends_with("a.parquet"), "{listed:?}");
    }

    #[tokio::test]
    async fn the_fingerprint_changes_when_a_file_does() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("t.csv");
        std::fs::write(&file, b"x\n1\n").unwrap();
        let before = list_local(&file, LIMITS).await.unwrap();
        assert_eq!(before, list_local(&file, LIMITS).await.unwrap());

        std::fs::write(&file, b"x\n1\n2\n").unwrap();

        let after = list_local(&file, LIMITS).await.unwrap();
        assert_ne!(before.fingerprint, after.fingerprint);
    }

    #[tokio::test]
    async fn a_missing_path_an_unknown_format_and_a_mix_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let missing = list_local(&dir.path().join("none"), LIMITS).await;
        assert!(
            matches!(missing, Err(StoreError::SourceNotFound(_))),
            "{missing:?}"
        );

        std::fs::write(dir.path().join("a.json"), b"{}").unwrap();
        let unknown = list_local(&dir.path().join("a.json"), LIMITS).await;
        assert!(
            matches!(unknown, Err(StoreError::UnsupportedFormat(_))),
            "{unknown:?}"
        );

        std::fs::remove_file(dir.path().join("a.json")).unwrap();
        std::fs::write(dir.path().join("a.csv"), b"x").unwrap();
        std::fs::write(dir.path().join("b.parquet"), b"x").unwrap();
        let mixed = list_local(dir.path(), LIMITS).await;
        assert!(
            matches!(mixed, Err(StoreError::MixedFormats(_))),
            "{mixed:?}"
        );
    }

    #[tokio::test]
    async fn more_files_than_the_limit_are_refused_not_cut() {
        let store = object_store::memory::InMemory::new();
        for i in 0..3 {
            store
                .put(&ObjectPath::from(format!("lake/{i}.csv")), "x".into())
                .await
                .unwrap();
        }
        let limits = ListLimits {
            max_files: 2,
            ..LIMITS
        };

        let listed = list(&store, &ObjectPath::from("lake"), "s3://b/lake", limits).await;

        assert!(
            matches!(listed, Err(StoreError::TooManyFiles { limit: 2, .. })),
            "{listed:?}"
        );
    }
}
