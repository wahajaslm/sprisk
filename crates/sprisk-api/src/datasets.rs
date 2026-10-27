//! `/dataset_versions` (ADR-0067): data registered by reference. The API lists the files where
//! they live and keeps a fingerprint of their metadata; it never copies or reads the data to
//! register it. A local location stays inside the data roots, file by file.

use std::path::Path;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use serde_json::json;
use sprisk_artifacts::source::{
    ListLimits, Location, SourceFiles, list_local, list_remote, parse_location,
};
use sprisk_contracts::{
    CreateDatasetVersion, DatasetProfile, DatasetVersion, SourceProfileRequest, parse,
};

use crate::{ApiError, AppState, Query, body, id, inside_roots, limit, optional_id};

/// A petabyte source can hold millions of files; more than this is refused, never cut.
const LIMITS: ListLimits = ListLimits {
    max_files: 10_000,
    timeout: Duration::from_secs(30),
};

/// `POST /dataset_versions`: 201 with a new version, or 200 with the one already registered
/// for the same location and fingerprint.
pub(crate) async fn create_dataset_version(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<DatasetVersion>), ApiError> {
    let request: CreateDatasetVersion = body(&text)?;
    let location = parse_location(&request.location).map_err(ApiError::Source)?;
    let (uri, name, listed) = list(&state, &location).await?;
    let doc = json!({
        "schema_version": "sprisk.dataset_version/v1",
        "id": format!("dsv_{}", ulid::Ulid::new()),
        "name": name.chars().take(256).collect::<String>(),
        "location": uri.as_str(),
        "format": listed.format,
        "file_count": listed.files.len(),
        "size_bytes": listed.size_bytes,
        "fingerprint": listed.fingerprint,
        "created_at": sprisk_core::time::now(),
    });
    let version: DatasetVersion =
        parse(&doc.to_string()).map_err(|e| ApiError::Internal(e.to_string()))?;
    let kept = state.store.insert_dataset_version(&version).await?;
    let status = if kept.id == version.id {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(kept)))
}

/// `GET /dataset_versions`: newest first, a page at a time (`?before=`, `?limit=`).
pub(crate) async fn list_dataset_versions(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<DatasetVersion>>, ApiError> {
    let before = optional_id(&query, "before")?;
    Ok(Json(
        state
            .store
            .list_dataset_versions(before.as_ref(), limit(&query)?)
            .await?,
    ))
}

pub(crate) async fn get_dataset_version(
    State(state): State<AppState>,
    UrlPath(raw): UrlPath<String>,
) -> Result<Json<DatasetVersion>, ApiError> {
    Ok(Json(state.store.get_dataset_version(&id(&raw)?).await?))
}

/// `GET /dataset_versions/{id}/profile`: the first rows profiled in place, made once per
/// fingerprint and profiler code. The files are listed again first: data that changed since
/// it was registered is a different version, so it is refused, not profiled.
pub(crate) async fn get_dataset_version_profile(
    State(state): State<AppState>,
    UrlPath(raw): UrlPath<String>,
    query: Query,
) -> Result<Json<DatasetProfile>, ApiError> {
    let version = state.store.get_dataset_version(&id(&raw)?).await?;
    let location = parse_location(&version.location).map_err(ApiError::Source)?;
    if let Location::Remote(_) = location {
        return Err(ApiError::BadRequest {
            code: "profile_not_local",
            message: format!(
                "{} is in an object store; only local sources can be profiled yet",
                version.location.as_str()
            ),
        });
    }
    let fingerprint = version.fingerprint.as_str();
    let code = state.profiler.code();
    let target = query.get("target").map(String::as_str);
    if let Some(kept) = state
        .store
        .stored_profile(fingerprint, code, target)
        .await?
    {
        return Ok(Json(kept));
    }
    let (_, _, listed) = list(&state, &location).await?;
    if listed.fingerprint != fingerprint {
        return Err(ApiError::SourceChanged(version.location.to_string()));
    }
    let mut request = json!({
        "format": listed.format,
        "files": listed.files.into_iter().map(|f| f.path).collect::<Vec<_>>(),
    });
    if let Some(target) = target {
        request["target"] = json!(target);
    }
    let request: SourceProfileRequest =
        parse(&request.to_string()).map_err(|e| ApiError::BadRequest {
            code: "invalid_target",
            message: e.to_string(),
        })?;
    let made = state.source_profiler.profile(&request).await?;
    state
        .store
        .save_profile(fingerprint, code, target, &made)
        .await?;
    Ok(Json(made))
}

/// The location as kept (a local path as its canonical `file://` URI), its name and its files.
/// A local path, and each file under it after following symlinks, must be inside a data root;
/// its files are given resolved, so the profiler reads exactly what was checked.
async fn list(
    state: &AppState,
    location: &Location,
) -> Result<(url::Url, String, SourceFiles), ApiError> {
    match location {
        Location::Local(path) => {
            let path = inside_roots(path, &state.data_roots).map_err(policy)?;
            let mut listed = list_local(&path, LIMITS).await.map_err(ApiError::Source)?;
            for file in &mut listed.files {
                let resolved =
                    inside_roots(Path::new(&file.path), &state.data_roots).map_err(policy)?;
                file.path = resolved.display().to_string();
            }
            let uri = url::Url::from_file_path(&path)
                .map_err(|()| ApiError::Internal(format!("{} is not absolute", path.display())))?;
            let name = path.file_name().map_or_else(
                || path.display().to_string(),
                |n| n.to_string_lossy().into_owned(),
            );
            Ok((uri, name, listed))
        }
        Location::Remote(url) => {
            let listed = list_remote(url, LIMITS).await.map_err(ApiError::Source)?;
            Ok((url.clone(), last_segment(url), listed))
        }
    }
}

fn policy(problem: (&'static str, String)) -> ApiError {
    ApiError::Policy(vec![problem])
}

/// The last part of an object-store URI: the object or folder, else the bucket.
fn last_segment(url: &url::Url) -> String {
    url.path_segments()
        .and_then(|mut s| s.rfind(|s| !s.is_empty()))
        .or(url.host_str())
        .unwrap_or_default()
        .to_owned()
}
