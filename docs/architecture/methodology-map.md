# Methodology map

What the methodology decides, where, and how (ADR-0059). One row per decision. Each row is, or becomes, one rule package in `methodology/`.

**Level** is the evaluation ladder:
- **1 Rule:** practice settles it from facts. Same facts, same answer.
- **2 Try:** practice says "it depends". Try the routes on the same cross-validation folds, fixed seed, pick by the stated criterion.
- **3 Ask:** only a person can settle it. A guess is marked `inferred` and confirmed before use.

**Rule:** `active`, `draft`, or `none` (no rule yet).

## Question
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Target and task | 3 | Person states the target; task type measured from its values and confirmed | none | REFORMS (Kapoor et al. 2024), module 1 |
| Unit of prediction | 3 | Person: one row per what? | none | TRIPOD+AI (Collins et al. 2024) |
| Primary metric | 1, else 3 | Stated metric wins; else from task and class balance (unbalanced: macro or weighted F1, not accuracy) | draft | scikit-learn "Metrics and scoring" |
| Cost of each error | 3 | Person | none | Elkan 2001, cost-sensitive learning |

## Data
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Join sources | 1, else 3 | One shared key with matching values joins; an ambiguous key asks | none | — |
| Column roles (id, target, number, category, text, date) | 1, else 3 | Measured: distinct = rows → id; parses as date → date; long varied strings → text. Number-coded labels (postal codes) ask | none | Breck et al. 2019, data validation |
| Missing markers (`?`, `n/a`, `-1`) | 1, else 3 | Values that fail to convert in an otherwise numeric column. `NA` that may be a value (Namibia) asks | none (`file_source.missing_values` exists) | Breck et al. 2019 |
| Wrong types | 1 | Share of values that convert | none | Breck et al. 2019 |
| Exact duplicates | 1 | Row hash. Removed before the split, so no row is in train and test | none | Kapoor & Narayanan 2023 (duplicates leak) |
| Duplicates by key | 3 | Person: which row to keep | none | — |
| Columns not known at prediction time | 3, with a measured hint | Person confirms; a column that predicts the target almost perfectly is flagged | draft (`features.leakage_exclusion`) | Kapoor & Narayanan 2023 |

## Split
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Split method | 1 | Time column + horizon → temporal; entity column → group; unbalanced classes → stratified; else random | active | Roberts et al. 2017; scikit-learn "Cross-validation" |
| Point in time | 1, else 3 | Features must be known before the prediction time | draft | Kapoor & Narayanan 2023 |

## Cleaning (statistics from train rows)
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Missing values | 1, then 2 | Missing target → drop rows. Models that fill gaps themselves → no step. Mostly empty → drop column. Otherwise median vs mean is tried | active | scikit-learn "Imputation" |
| Outliers | 1, else 3 | Impossible values (domain range, asked) → missing. Statistical outliers: clip for linear and distance models, nothing for trees | active | Tukey 1977; scikit-learn preprocessing guide |
| Constant columns | 1 | One distinct value on train rows → drop | draft | scikit-learn `VarianceThreshold` |
| Text spelling | 1, else 3 | Trim, lowercase, accents (key collision). Merges beyond that ask | none (`clean_text` exists) | OpenRefine clustering |

## Features (travel with each candidate model unless marked shared)
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Scaling | 1, then 2 | Trees: none. Linear, distance: standard; heavy outliers: robust | active | Hastie et al. 2009; scikit-learn preprocessing |
| Encoding | 1, then 2 | Few categories → one-hot. Many → target encoding with cross-fitting vs frequency, tried | draft | scikit-learn `TargetEncoder`; Micci-Barreca 2001 |
| Rare categories (shared) | 1 | Below a frequency → "other" | none | scikit-learn `OneHotEncoder(min_frequency)` |
| Text representation | 2 | TF-IDF words vs characters, tried | none | scikit-learn "Text feature extraction" |
| Date parts (shared) | 1 | Year, month, weekday from a date column | none | — |
| Feature selection | 2 | Only inside cross-validation, never on all rows | draft | Ambroise & McLachlan 2002 |
| Dimensionality reduction | 2 | Tried against no reduction | draft | Hastie et al. 2009 |
| Multicollinearity | 1 | Linear models only | draft | — |

## Models
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Model shortlist and selection | 2 | Baseline + candidates on repeated CV; simplest within one standard error | active | Hastie et al. 2009 §7.10; ADR-0050 |
| Settings (tuning) | 2 | Nested CV within a budget | — (studies, ADR-0052) | Cawley & Talbot 2010 |
| Class imbalance | 2 | Class weights vs resampling inside folds vs threshold, tried | draft | He & Garcia 2009 |

## Evaluation
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Decision threshold | 2, costs from 3 | Tuned on CV predictions, never on test rows | draft | scikit-learn `TunedThresholdClassifierCV` |
| Calibration | 2 | Tried when probabilities are used | draft | scikit-learn "Probability calibration" |
| Loop back | 1 | A CV result below the stated minimum reopens the decision that owns it | — (guardrails, ADR-0052) | — |

## Reporting
| Decision | Level | Decided by | Rule | Source |
| --- | --- | --- | --- | --- |
| Fairness, explainability, drift, serving parity | 3 | Person names groups and obligations | draft | TRIPOD+AI |

Unsupervised (clustering, anomaly) rules follow the same levels; see `methodology/unsupervised/`.

## Refusals: course routes the map does not take
| Course route | Map route | Why |
| --- | --- | --- |
| Fill, encode or scale before the split | Fit on train rows only | Test rows would shape the model |
| Select features or set a threshold on test results | Inside cross-validation | The score would be optimistic |
| Tune with no hold-out | Nested CV | Same |
| Drop mostly-empty columns measured on all rows | Measure train rows, drop from all | Statistics from train rows only |
