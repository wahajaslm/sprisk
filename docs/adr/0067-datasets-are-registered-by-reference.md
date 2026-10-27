# ADR-0067: Datasets are registered by reference
Status: Accepted
Date: 2026-10-27
Arch doc sections: §1.4 (integrate, do not build an object store), §3 (`DatasetVersion`), §4 principle 2 (control plane carries no raw datasets), §18.1 (external sources: no silent raw copies). Builds on ADR-0014, ADR-0038 and ADR-0065.

## Context
- The UI has no way to add data. Files must be copied by hand into a data root, then loaded by a flow.
- Datasets can be terabytes or petabytes. Copying them into sprisk is never an option.
- The v1 baseline names `Dataset` / `DatasetVersion`: "a frozen snapshot or an external versioned reference. Version immutable." Nothing builds it yet.
- Local paths are already limited to the configured data roots (`check_local_paths`).

## Decision
- **A `DatasetVersion` is a reference, never a copy.** `POST /dataset_versions` takes one `location`. sprisk keeps the location and a fingerprint. It reads no row to register.
- **Locations.** An absolute local path or `file://` URI, or an object-store URI: `s3://`, `gs://`, `az://`. Every other scheme is refused (`unsupported_scheme`). A local path is kept as its canonical `file://` URI, so the record names no machine-specific form (rule 12).
- **What is recorded:** name (the last part of the location), format (`csv` or `parquet`, from the file extensions; a mix is refused), file count, total bytes, a fingerprint and the time.
- **The fingerprint is metadata, not content.** `sha256` over each file's path, size, and e-tag or modified time, sorted by path. Hashing a petabyte is not possible.
- **Listing goes through `object_store`** for every scheme, with a time limit and at most 10,000 files. More files is refused (`too_many_files`), not truncated.
- **Data roots are not widened.** A local location, and every file listed under it after following symlinks, must be inside a configured data root. Registering adds nothing to the roots.
- **Credentials come from the environment** and each provider's standard chain (`AWS_*`, `GOOGLE_*`, `AZURE_*`, instance metadata). sprisk never stores them, and they never enter a record, a prompt or a pipeline (rule 6).
- **A location never carries a secret.** A URI with a user, password, query or fragment (a key, a pre-signed URL, a SAS token) is refused and not echoed. A store's failure is reported in fixed words, never with its request URL.
- **Registering again is idempotent.** The same location with the same fingerprint returns the existing version. A changed fingerprint makes a new version; the old one is never edited (rule 5).
- **The profile reads a bounded sample in place.** A profile is made once per fingerprint and profiler code, and kept. To make one, `GET /dataset_versions/{id}/profile` lists the location again and refuses a changed fingerprint (`source_changed`). Rust sends Python a `SourceProfileRequest`: the files, resolved through symlinks and checked against the roots. Python reads exactly those paths (never as patterns), the first 1,000,000 rows and 200 columns, with Polars, without copying the files.
- **The sample is stated honestly.** Parquet row counts come from file metadata, so the total is known. A CSV is read only up to the sample; if it has more rows, `total_rows` is omitted and the page says the total was not counted.
- **Object-store profiling is designed, not built.** Registration of `s3://`, `gs://` and `az://` works. Their profile answers `profile_not_local` until Python reads them in place (Polars cloud readers with the same environment credentials). That needs a network test harness first.
- **Endpoints follow the repo's naming** (`/question_versions`, `/pipeline_versions`): `POST /dataset_versions`, `GET /dataset_versions`, `GET /dataset_versions/{id}/profile`. A `Dataset` grouping of versions waits until a second version of one dataset is needed.

## Alternatives considered
- **Upload or copy into the artifact store.** Rejected: impossible at petabyte scale, and a silent raw copy (§18.1).
- **A content hash of every byte.** Rejected: reads the whole dataset. Size, e-tag and modified time catch changes at listing cost.
- **A random sample.** Deferred: a uniform sample of a huge file needs a full scan. A seeded sample of Parquet row groups is the next step. The first rows are deterministic and the page names them.
- **Adding a registered path to the data roots.** Rejected: the roots are the operator's policy, not something a request may extend.

## Consequences (good and bad)
- Good: data of any size is added in seconds, from the UI, without a copy.
- Good: a profile always says which version it describes; changed data is caught, not silently profiled.
- Bad: the first rows of a sorted file are a biased sample. The page says "first".
- Bad: `object_store` cloud features add a TLS and HTTP client to the build.
- Bad: a flow cannot load a `DatasetVersion` yet; it still loads a path through `file_source`.

## Validation
- Rust: locations parse by scheme; a path outside the roots, a missing path, a symlink out of the roots, a mixed format and too many files are refused; a fingerprint changes when a file's size changes.
- API: register, list, register again (same id), profile, and `source_changed` after an edit.
- Python: a CSV larger than the sample has no total; a Parquet file's total comes from metadata.
- Web: the Add data source form shows each refusal; a new source opens on Explore with its sample note.

## Arch doc edits
- §3: `DatasetVersion` is a reference (location + fingerprint), never a copy, and is immutable.
- §18.1: object-store and local locations are listed through `object_store`; credentials come from the environment only.
