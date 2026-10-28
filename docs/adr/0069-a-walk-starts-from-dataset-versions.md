# ADR-0069: A walk starts from registered dataset versions
Status: Accepted
Date: 2026-10-28
Arch doc sections: §3, §4, §18.1

## Context
- `CreateWalk.sources` takes raw file paths (ADR-0060). Data sources are now registered as `DatasetVersion`s, by reference (ADR-0067).
- The chat starts from a registered source (ADR-0068). The browser then turns its `file://` location back into a path. That is a rule about data, living in the UI (rule 9).
- A path names no version. The walk hashes the files to notice change, but nothing links the walk to the record the person profiled and chose.

## Decision
- **`CreateWalk` takes `dataset_version_ids`, not `sources`.** At least one, in order: the first holds the rows to predict on, as before.
- **Rust resolves each id to the file the flow loads.** A version must be one local CSV or Parquet file. A folder, several files or an object store is refused (`dataset_not_loadable`) until a flow can load a `DatasetVersion` itself.
- **The data must still be the version named.** Rust lists the location again and compares the fingerprint, as the profile does (ADR-0067). A changed one is refused (`source_changed`). The resolved path must be inside a data root.
- **The `Walk` records both.** `dataset_version_ids` names what the person chose; `sources` stays as the resolved files, with their hashes. A walk stored before this has no `dataset_version_ids`.
- **The browser sends ids only.** The auto-run form picks registered sources; it never types or derives a path.

## Alternatives considered
- **Accept both paths and ids.** Rejected: two ways to name data (one way per thing).
- **Load a `DatasetVersion` in the flow now** (a source step that reads by id). Deferred: it needs the worker to read object stores and folders, and its own ADR.
- **Check change by file hash only.** Rejected for creation: the fingerprint is how a version is defined. The hash check during the walk stays.

## Consequences (good and bad)
- Good: a walk names the record a person profiled and chose.
- Good: the path rule leaves the browser.
- Bad: a walk cannot start on a file that is not registered. Registering one is a click.
- Bad: only single local files can be walked until a flow loads a version itself.

## Validation
- API: a walk from a registered CSV runs as before and records its id; an unknown id is 404-like `unknown_dataset_version`; a folder is `dataset_not_loadable`; a file changed since registering is `source_changed`.
- Web: the chat starts its walk with the source's id; the auto-run form lists registered sources.

## Arch doc edits
- §4 Walk: starts from `DatasetVersion` ids.
