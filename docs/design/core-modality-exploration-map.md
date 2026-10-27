# Core modality exploration map

## Purpose

This is the first textual reference map for deterministic dataset profiling and
exploration. It covers six core modalities:

1. tabular data;
2. text and documents;
3. images;
4. audio;
5. video; and
6. time series and event data.

It is a catalogue for selecting probes and visual sections. It is **not** a
catalogue of automatic actions. A probe measures evidence. A methodology rule,
using the frozen Question Ledger, may later use permitted evidence to propose an
action.

This catalogue is used inside the Data Understanding workflow's **Plan** and
**Investigate** stages. Its workflow boundary and downstream handoff are defined
in [`multimodal-profiling-workflow-map.md`](multimodal-profiling-workflow-map.md).

```text
source manifest + DatasetVersion + frozen Question Ledger
  -> modality detection
  -> applicable deterministic probes
  -> bounded profile facts
  -> ordered Profile Plan and visual sections
```

## Operating rule

The human contribution happens during investigation setup: they state the
objective, unit of analysis, target, prediction-time boundary, and domain where
applicable. Those facts are frozen in a Question Version. The profile system
does not ask the person to choose routine metrics or thresholds while it runs.

When a fact is absent, the system records `needs_fact` or a limitation; it does
not silently infer semantic meaning from a field name.

## Shared scopes

| Scope | Permitted use | Never use it for |
| --- | --- | --- |
| `input` | Describe the supplied source and help establish understanding. | Fitting learned preparation, feature selection or model choice. |
| `train` | Fit learned preparation and select candidate methods. | Test-set claims. |
| `test` | Final, held-out evaluation only. | Choosing transformations or models. |
| `transformed` | Describe a produced representation and compare it to its input. | Hiding changes made by a transformation. |
| `comparison` | Compare named immutable artifacts, such as train versus test. | Mixing records across their permitted boundary. |

Every profile result names its source artifact, scope, sampler/limit and probe
code version.

## Shared probe vocabulary

| Kind | Meaning |
| --- | --- |
| `integrity` | Is the source readable and internally well-formed? |
| `coverage` | How much of the expected record/field/asset is present? |
| `distribution` | What values, ranges, lengths or frequencies occur? |
| `duplication` | Which exact or near-identical records/assets repeat? |
| `relationship` | What bounded association exists between declared or observed fields? |
| `alignment` | Do linked assets, labels and records agree? |
| `temporal` | Is order, cadence and prediction-time availability coherent? |
| `shift` | How do two immutable artifacts differ? |

All exact thresholds belong to a versioned probe definition or a confirmed
domain/data contract. A chart colour is never itself a decision.

## 1. Tabular

### Activation

Activate for CSV, TSV, Parquet, Arrow, spreadsheet ranges, SQL result tables,
or a structured record collection. A multimodal manifest may activate this pack
as its index table.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `table.shape` | row/column counts and bounded profile coverage | Overview |
| `table.schema` | field names, physical types, parse failures and observed roles | Columns |
| `table.gaps` | null, blank, NaN and infinity counts; co-missing patterns | Data quality |
| `table.duplicates` | exact repeated rows and repeated candidate identifiers | Data quality / entity integrity |
| `table.distribution` | quantiles, histograms, top values, cardinality and constants | Column exploration |
| `table.outliers` | declared robust outlier statistic and its count | Numeric exploration |
| `table.relationships` | bounded correlations and declared target associations | Relationships / Target |
| `table.keys` | candidate-key uniqueness and join cardinality evidence | Entity / relational integrity |

### Limits and boundaries

Observed column roles are descriptive, never semantic confirmation. An
identifier-looking field is not automatically an entity binding; the Ledger
must declare that meaning. Input-scope target associations are for
understanding only; train-scope evidence is required for selection.

## 2. Text and documents

### Activation

Activate for text-typed table fields, `.txt`, HTML, PDF, DOCX, Markdown, or
document references. A document parser records extraction success and the
parser version before text probes run.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `text.extraction` | readable/corrupt assets, extraction failures and extracted-character coverage | Text integrity |
| `text.language` | language identifier and confidence distribution | Language coverage |
| `text.length` | character, token, word and line-length distributions | Text shape |
| `text.empty_noise` | null, blank, whitespace-only, control-character and markup/entity share | Text quality |
| `text.duplicates` | exact hashes and declared near-duplicate algorithm/threshold | Duplicate text |
| `text.pii_patterns` | pattern matches for configured identifiers such as email or telephone formats | Sensitive-data signals |
| `text.vocabulary` | token coverage, rare-token share and out-of-vocabulary rate against a named vocabulary | Vocabulary coverage |
| `text.target_relation` | bounded class/rate summaries for a declared target | Text and target |

### Limits and boundaries

Pattern matches are possible-sensitive-data signals, not proof of a person's
identity or a permission decision. Topic modelling, embeddings and semantic
similarity are separate, versioned probes: their model, language and sampling
must be named. Train-only scope applies where a vocabulary, tokenizer or
embedding model is fit from data.

## 3. Images

### Activation

Activate for image MIME assets, image columns, or image URIs in a manifest.
The manifest must preserve the record-to-asset association without embedding
binary data in profile results.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `image.integrity` | readable/corrupt asset count, MIME agreement and decoder errors | Image integrity |
| `image.geometry` | width, height, aspect ratio, orientation and file size | Image shape |
| `image.appearance` | bounded brightness, contrast, colour and blur statistics | Image quality |
| `image.duplicates` | exact content hash and named perceptual-hash near duplicates | Duplicate images |
| `image.coverage` | records with zero, one or multiple expected assets | Asset coverage |
| `image.labels` | class/annotation presence, class distribution and geometry validity | Annotation coverage |
| `image.target_relation` | image/label coverage by declared target class | Image and target |

### Limits and boundaries

Blur and brightness are measurements, not a judgement that an image is useful.
Perceptual duplicate results always name the hashing method and threshold.
Object/face/medical-image semantic recognition is an explicit model-backed
probe, not an implicit property of generic image profiling.

## 4. Audio

### Activation

Activate for audio MIME assets, audio references, or waveform records. Audio
and transcript links are represented through an asset manifest.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `audio.integrity` | readable/corrupt assets, codec and decoder errors | Audio integrity |
| `audio.format` | duration, sample rate, channels, bit depth and file size | Audio format |
| `audio.signal` | silence share, clipping share, loudness and bounded noise indicators | Signal quality |
| `audio.duplicates` | exact hashes and named audio fingerprint matches | Duplicate audio |
| `audio.coverage` | recordings/transcripts/labels present per record | Asset coverage |
| `audio.language_speaker` | named-model language or speaker-group distributions and confidence | Coverage and balance |
| `audio.target_relation` | declared label coverage by duration/format/group | Audio and target |

### Limits and boundaries

Language and speaker outputs are model-derived measurements, not identity or
demographic facts. The system must not turn voice characteristics into sensitive
attributes without an explicit, permitted domain rule.

## 5. Video

### Activation

Activate for video MIME assets or video references. Video profiling produces an
asset-level summary plus a bounded, deterministic sample of frames; it never
ships full video to the browser.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `video.integrity` | readable/corrupt videos, codec/container and decoder errors | Video integrity |
| `video.format` | duration, frame rate, dimensions, rotation and file size | Video format |
| `video.frames` | deterministic frame sample, brightness/blur and repeated-frame indicators | Frame quality |
| `video.scenes` | named scene-change statistic and scene-density distribution | Scene diversity |
| `video.temporal_labels` | label interval bounds, overlap, gaps and coverage | Temporal annotation quality |
| `video.duplicates` | exact hashes and named visual fingerprint matches | Duplicate video |
| `video.target_relation` | declared class coverage by duration and annotation availability | Video and target |

### Limits and boundaries

Frame sampling must record its seed, rate and coverage. A scene-change statistic
does not identify an event or prove content diversity without a separately
declared semantic model.

## 6. Time series and event data

### Activation

Activate only when the frozen Ledger binds a time field, or an explicit source
descriptor declares event/time-series semantics. Timestamp-looking strings alone
produce a candidate observation, not temporal semantics.

### Deterministic probes

| Probe | Measures | Visual section |
| --- | --- | --- |
| `time.parse` | parse success, timezone/offset forms, min/max coverage | Temporal integrity |
| `time.order` | ordering violations, duplicate timestamps and ties | Event ordering |
| `time.cadence` | interval distribution, expected cadence and gaps | Cadence and gaps |
| `time.entity_coverage` | records and coverage interval per declared entity | Entity timelines |
| `time.seasonality` | named deterministic periodogram/autocorrelation summary | Repeating patterns |
| `time.availability` | event/feature time versus declared prediction time/horizon | Future-leakage evidence |
| `time.shift` | distribution/cadence changes between named spans | Drift and stability |
| `time.target_relation` | target availability relative to prediction time and horizon | Outcome timing |

### Limits and boundaries

Forecasting is not activated merely because a column parses as a date. It
requires a Ledger-declared time binding and prediction horizon. Leakage probes
measure evidence; the Ledger defines the operational availability boundary that
makes a field permissible or impermissible.

## Multimodal composition

A dataset can activate multiple packs. The planner creates a base order, then
adds active modality sections in this order:

```text
Overview → structural quality → tabular fields → text → images → audio → video
→ temporal integrity → declared target/task views → comparison/change views
```

The manifest/alignment pack is activated whenever one record references more
than one modality. It checks that a listing's text, image, audio, video, label
and entity reference point to the intended same record.

## Existing framework roles

| Need | Candidate integration | Sprisk owns |
| --- | --- | --- |
| Declarative table/data contracts | Great Expectations | versioning, Ledger linkage, API result contract and visuals |
| Schema anomalies and train/serving skew | TensorFlow Data Validation | scope boundaries, artifacts and visual explanation |
| Large Spark profiling/constraints | Deequ | deterministic activation and UI model |
| Large-scale approximate metrics | Apache DataSketches | limits, error disclosure and artifact provenance |
| Media decoding/metadata | modality adapters such as FFmpeg/image codecs | canonical profile facts and bounded presentation |

Framework results enter through adapters. No framework's own dashboard becomes
the product UI, and no suggested constraint becomes an accepted semantic rule
without its stated origin and version.

## Delivery order

1. Finish the existing tabular profile plan and gate its visuals by the plan.
2. Add text facts and a text pack for table text fields and documents.
3. Add time/event bindings and temporal integrity pack.
4. Introduce an asset manifest contract, then image integrity/geometry/coverage.
5. Reuse the manifest for audio and video format/integrity probes.
6. Add model-backed semantic probes only with explicit model/version, scope and
   domain permission.
