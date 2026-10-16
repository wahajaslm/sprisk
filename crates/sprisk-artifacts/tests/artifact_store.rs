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
    let dir = store.staging_dir("att_1").unwrap();
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("model.skops");
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
async fn staging_dir_rejects_unsafe_attempt_ids() {
    let (_dir, store) = store();
    for attempt in ["../etc", "a/b", "", ".."] {
        assert!(
            matches!(store.staging_dir(attempt), Err(StoreError::UnsafeName(_))),
            "{attempt:?}"
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

#[test]
fn content_hash_is_the_sha256_commit_expects() {
    assert_eq!(
        sprisk_artifacts::content_hash(b""),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}
