# ADR-0066: An audio pack makes audio results credible
Status: Proposed
Date: 2026-11-07
Arch doc sections: §8 (methodology engine), §9 (runs). Builds on ADR-0059, ADR-0060, ADR-0063 and ADR-0065 (asset bindings).

## Context
- Audio steps exist: audit, librosa features, openSMILE, voice activity, transcription, diarization. No method reads their evidence, so a walk never adds them. A person must wire them by hand.
- A question can already declare audio files: `AssetBinding` with `modality: audio`, a root and a link column.
- A manual run on a music set (120 YouTube tracks, Eastern vs other) found:
  - every `.m4a` was unreadable, and the features were unscaled (both fixed in ac8df6b9);
  - one track was listed twice, under two genres, and nothing flagged it;
  - one "track" was a talking video, not music;
  - the run took 27 minutes: each file was decoded twice, at 44.1 kHz.
- A survey of 114 audio ML job postings (2025–2026) found employers name speech tasks and deployment. They almost never name split rules or metrics (1 of 114 each). Benchmarks and methodology papers treat both as mandatory: artist-disjoint splits (Flexer 2007), frozen-encoder probes (HEAR, MARBLE, SUPERB), each encoder at its native sample rate.

## Decision
**A new pack, `methodology/audio/`.** Its methods apply only when the question has an audio asset binding (`applies_when: { modality: [audio] }`, a new key). It reuses the supervised pack for splits, models and evaluation.

**Must, in decision order:**

| Method | Level | Reads | Does |
| --- | --- | --- | --- |
| `audio.decode_coverage` | 1 | `audio.asset_quality` (exists) | All readable: pass. Some unreadable: leave those rows out and report a limitation. Mixed sample rates: noted, resampled at decode. |
| `audio.recording_group` | 3 | — | Asks which column says who made each recording (artist, uploader, speaker, listener). Binds `common.item_identity`, so the existing split method picks a group split. |
| `audio.same_recording` | 1 | `audio.recording_hashes` (new) | Hashes the decoded samples. Copies of one recording become one item, before the split. Near-duplicates (re-uploads, remasters) use embedding distance once embeddings exist. |
| `audio.representation` | 2 Try | `audio.embedding_coverage` (new) | Compares librosa, openSMILE, CLAP and MERT on the same folds and seed, against the baseline (ADR-0060 Try). MERT routes are one per layer. |
| Evaluation | — | — | Reuses `error_analysis` sliced by the recording group, `bootstrap_robustness` and `ablation_analysis`. |

**A new operator, `sprisk.clean.embed_audio`.** It runs a frozen encoder from a local model folder only (no download, `network: none`, rule 6). It resamples to the encoder's native rate (CLAP 48 kHz, MERT 24 kHz, WavLM 16 kHz) and records the rate. Each option promises `native_rate`.

**Decode once, at the rate the step needs.** `read_audio` gains a target rate and channel count, so librosa features decode at 22.05 kHz mono. Caching decoded audio across steps is left open: caching belongs to Rust (rule 2) and needs an artifact kind for decoded audio.

**Should, next:** quality flags (silence, clipping, low SNR); provenance and consent per file; pitch and intonation features (`librosa.pyin`); time per audio second for each step; a rating-reliability check for listening labels.

**Later:** source separation, A/B analysis, codec embeddings, FAD, ONNX export, speech LLMs, beamforming.

## Alternatives considered
- **Put audio methods in the supervised pack.** Rejected: they apply only with audio files, and music and speech share them.
- **One fixed encoder (CLAP only).** Rejected: which encoder wins depends on the task (HEAR, MARBLE), so it is a Try.
- **Fine-tune encoders.** Rejected for now: costly, and a frozen probe answers "is there signal" first.
- **Chromaprint for near-duplicates.** Deferred: it needs the `fpcalc` binary. Sample hashes catch exact copies today.

## Consequences (good and bad)
- Good: a walk on audio files reaches a verdict without hand-wired steps.
- Good: the two most common audio mistakes (artist leakage, duplicate recordings) are checked by default.
- Good: speech reuses the pack with a different group (speaker instead of artist).
- Bad: encoders need local weights; a project without them gets librosa and openSMILE only.
- Bad: `applies_when: modality` is a Rust change in method loading.

## Validation (how we will know it was right)
- A synthetic stand-in (tones, one duplicated file, two groups) walks to a verdict in tests, with no hand-wired steps.
- On the music set, a walk flags the duplicated track, splits by uploader and compares the four routes with confidence intervals.
- Built one method at a time, test first. Order: decode rate, `applies_when` modality, recording group, same recording, `embed_audio`, representation Try.
