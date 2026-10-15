#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

use sprisk_artifacts::{ArtifactStore, StoreError};

const HELLO_HASH: &str = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

fn store() -> (tempfile::TempDir, ArtifactStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = ArtifactStore::local(dir.path()).unwrap();
    (dir, store)
}

fn stage(store: &ArtifactStore, bytes: &[u8]) -> std::path::PathBuf {
    let path = store.staging_path("att_1", "model").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

#[tokio::test]
async fn commit_moves_staged_bytes_into_store_by_hash() {
    let (_dir, store) = store();
    let staged = stage(&store, b"hello");

    let committed = store.commit(&staged, HELLO_HASH).await.unwrap();

    assert_eq!(committed.content_hash, HELLO_HASH);
    assert_eq!(committed.size_bytes, 5);
    assert!(committed.uri.starts_with("file://"));
    assert!(!staged.exists(), "staged file should be moved");
    let bytes = store.get(HELLO_HASH).await.unwrap();
    assert_eq!(&bytes[..], b"hello");
}

#[tokio::test]
async fn commit_rejects_hash_mismatch_and_stores_nothing() {
    let (_dir, store) = store();
    let staged = stage(&store, b"tampered");

    let err = store.commit(&staged, HELLO_HASH).await.unwrap_err();

    assert!(matches!(err, StoreError::HashMismatch { .. }), "{err}");
    assert!(matches!(
        store.get(HELLO_HASH).await,
        Err(StoreError::NotFound(_))
    ));
}

#[tokio::test]
async fn committing_same_content_twice_is_idempotent() {
    let (_dir, store) = store();
    let first = store
        .commit(&stage(&store, b"hello"), HELLO_HASH)
        .await
        .unwrap();
    let second = store
        .commit(&stage(&store, b"hello"), HELLO_HASH)
        .await
        .unwrap();
    assert_eq!(first, second);
}

#[tokio::test]
async fn commit_rejects_file_outside_staging() {
    let (_dir, store) = store();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), b"hello").unwrap();

    let err = store.commit(outside.path(), HELLO_HASH).await.unwrap_err();

    assert!(matches!(err, StoreError::OutsideStaging(_)), "{err}");
}

#[tokio::test]
async fn staging_path_rejects_unsafe_segments() {
    let (_dir, store) = store();
    for (attempt, port) in [
        ("../etc", "model"),
        ("att_1", "a/b"),
        ("", "model"),
        ("att_1", ".."),
    ] {
        assert!(
            matches!(
                store.staging_path(attempt, port),
                Err(StoreError::UnsafeName(_))
            ),
            "{attempt:?}/{port:?}"
        );
    }
}

#[tokio::test]
async fn malformed_hash_is_rejected() {
    let (_dir, store) = store();
    let staged = stage(&store, b"hello");
    for hash in ["md5:abc", "sha256:XYZ", "sha256:../../etc/passwd"] {
        assert!(
            matches!(
                store.commit(&staged, hash).await,
                Err(StoreError::InvalidHash(_))
            ),
            "{hash}"
        );
        assert!(
            matches!(store.get(hash).await, Err(StoreError::InvalidHash(_))),
            "{hash}"
        );
    }
}
