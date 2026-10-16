#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::sync::Arc;

use arrow_array::{ArrayRef, Int64Array, RecordBatch, StringArray};
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use sprisk_artifacts::{ArtifactStore, StoreError, content_hash};

/// 250 rows in three row groups; `x` is missing on row 120.
fn parquet_bytes() -> Vec<u8> {
    let x: Int64Array = (0..250).map(|i| (i != 120).then_some(i)).collect();
    let name: StringArray = (0..250).map(|i| Some(format!("n{i}"))).collect();
    let batch = RecordBatch::try_from_iter([
        ("x", Arc::new(x) as ArrayRef),
        ("name", Arc::new(name) as ArrayRef),
    ])
    .unwrap();
    let props = WriterProperties::builder()
        .set_max_row_group_row_count(Some(100))
        .build();
    let mut bytes = Vec::new();
    let mut writer = ArrowWriter::try_new(&mut bytes, batch.schema(), Some(props)).unwrap();
    writer.write(&batch).unwrap();
    writer.close().unwrap();
    bytes
}

async fn committed(bytes: &[u8]) -> (tempfile::TempDir, ArtifactStore, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = ArtifactStore::local(dir.path()).unwrap();
    let staging = store.staging_dir("att_1").unwrap();
    fs::create_dir_all(&staging).unwrap();
    let path = staging.join("data.parquet");
    fs::write(&path, bytes).unwrap();
    let hash = content_hash(bytes);
    store.commit(&path, &hash).await.unwrap();
    (dir, store, hash)
}

#[tokio::test]
async fn page_starts_at_offset_and_spans_row_groups() {
    let (_dir, store, hash) = committed(&parquet_bytes()).await;

    let page = store.read_table_page(&hash, 95, 30).await.unwrap();

    assert_eq!((page.offset, page.total_rows), (95, 250));
    let columns: Vec<_> = page.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(columns, ["x", "name"]);
    assert_eq!(page.columns[0].data_type, "Int64");
    assert_eq!(page.rows.len(), 30);
    assert_eq!(page.rows[0].values, ["95", "n95"]);
    assert_eq!(page.rows[29].values, ["124", "n124"]);
    assert!(page.rows[0].missing.is_empty());
}

#[tokio::test]
async fn missing_cell_is_listed_by_column_with_empty_text() {
    let (_dir, store, hash) = committed(&parquet_bytes()).await;

    let page = store.read_table_page(&hash, 120, 1).await.unwrap();

    assert_eq!(page.rows[0].values, ["", "n120"]);
    assert_eq!(page.rows[0].missing, [0]);
}

#[tokio::test]
async fn page_past_the_end_is_empty_but_reports_total() {
    let (_dir, store, hash) = committed(&parquet_bytes()).await;

    let page = store.read_table_page(&hash, 400, 50).await.unwrap();

    assert_eq!(page.total_rows, 250);
    assert!(page.rows.is_empty());
}

#[tokio::test]
async fn bytes_that_are_not_parquet_are_refused() {
    let (_dir, store, hash) = committed(b"not a table").await;

    let err = store.read_table_page(&hash, 0, 10).await.unwrap_err();

    assert!(matches!(err, StoreError::NotATable { .. }), "{err}");
}

#[tokio::test]
async fn unknown_hash_is_not_found() {
    let (_dir, store, _) = committed(&parquet_bytes()).await;
    let unknown = content_hash(b"other");

    let err = store.read_table_page(&unknown, 0, 10).await.unwrap_err();

    assert!(matches!(err, StoreError::NotFound(_)), "{err}");
}
