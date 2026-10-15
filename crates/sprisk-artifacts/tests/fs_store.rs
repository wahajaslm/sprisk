#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::io::Read;

use sprisk_artifacts::{FsStore, StoreError};

const HELLO_HASH: &str = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

fn store() -> (tempfile::TempDir, FsStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = FsStore::new(dir.path()).unwrap();
    (dir, store)
}

fn stage(store: &FsStore, bytes: &[u8]) -> std::path::PathBuf {
    let path = store.staging_path("att_1", "model").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn commit_moves_staged_bytes_into_store_by_hash() {
    let (_dir, store) = store();
    let staged = stage(&store, b"hello");

    let committed = store.commit(&staged, HELLO_HASH).unwrap();

    assert_eq!(committed.content_hash, HELLO_HASH);
    assert_eq!(committed.size_bytes, 5);
    assert!(committed.uri.starts_with("file://"));
    assert!(!staged.exists(), "staged file should be moved");
    let mut bytes = Vec::new();
    store
        .open(HELLO_HASH)
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    assert_eq!(bytes, b"hello");
}

#[test]
fn commit_rejects_hash_mismatch_and_stores_nothing() {
    let (_dir, store) = store();
    let staged = stage(&store, b"tampered");

    let err = store.commit(&staged, HELLO_HASH).unwrap_err();

    assert!(matches!(err, StoreError::HashMismatch { .. }), "{err}");
    assert!(matches!(
        store.open(HELLO_HASH),
        Err(StoreError::NotFound(_))
    ));
}

#[test]
fn committing_same_content_twice_is_idempotent() {
    let (_dir, store) = store();
    let first = store.commit(&stage(&store, b"hello"), HELLO_HASH).unwrap();
    let second = store.commit(&stage(&store, b"hello"), HELLO_HASH).unwrap();
    assert_eq!(first, second);
}

#[test]
fn commit_rejects_file_outside_staging() {
    let (_dir, store) = store();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), b"hello").unwrap();

    let err = store.commit(outside.path(), HELLO_HASH).unwrap_err();

    assert!(matches!(err, StoreError::OutsideStaging(_)), "{err}");
}

#[test]
fn staging_path_rejects_unsafe_segments() {
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

#[test]
fn malformed_hash_is_rejected() {
    let (_dir, store) = store();
    let staged = stage(&store, b"hello");
    for hash in ["md5:abc", "sha256:XYZ", "sha256:../../etc/passwd"] {
        assert!(
            matches!(store.commit(&staged, hash), Err(StoreError::InvalidHash(_))),
            "{hash}"
        );
        assert!(
            matches!(store.open(hash), Err(StoreError::InvalidHash(_))),
            "{hash}"
        );
    }
}
