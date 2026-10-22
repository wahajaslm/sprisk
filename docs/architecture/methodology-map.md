# Methodology map

What the methodology decides, where, and how (ADR-0059). One row per decision. Each row is, or becomes, one rule package in `methodology/`.

**Level** is the evaluation ladder:
- **1 Rule:** practice settles it from facts. Same facts, same answer.
- **2 Try:** practice says "it depends". Try the routes on the same cross-validation folds, fixed seed, pick by the stated criterion.
- **3 Ask:** only a person can settle it. A guess is marked `inferred` and confirmed before use.

**Evidence chart:** the one chart, drawn from train rows, that shows why the decision went the way it did. It is its own Explore step (one chart per step).

**Rule:** `active`, `draft`, or `none` (no rule yet). Numbers such as "15 categories" are default settings, never hard-coded.

**Sources:** published guidance first; `knowledge:` is the course (`knowledge/`); `ref-v3` is the user's reference workflow (Deterministic ML Project Workflow v3.0).

## Question
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Objective and success bar | 3 | Person: the business goal in units (money, risk, time) and the score that counts as good enough | — | active (`question.objective`) | knowledge: Methodology_in_Data_Science, step 1; ref-v3 0.1 |
| Hard constraints | 3 | Person: interpretability (high, medium, low), latency, budget, fairness limits. Only interpretability is asked for yet | — | active (`question.hard_constraints`) | ref-v3 0.4 |
| Latency and cost | 3, then 1 | Person states the limits (ms per prediction, cost per training run); candidates over a limit are ruled out, never ranked | Prediction time per candidate | draft (`question.operational_constraints`) | ref-v3 0.4 |
| Personal data | 1, then 3 | Detected per column (names, emails, IDs); a person confirms what may be used | — | none | `presidio`; EU AI Act risk tiers |
| Target available, or derived | 3 | Person: which column, or how to build it. A built label is checked against a sample a person labels (Cohen's κ ≥ 0.7) | Target distribution | active (`question.target_definition`; building a label is not offered yet) | knowledge: step 1; ref-v3 1.2 |
| Task type | 1, then 3 | Measured from the target: two values → binary, few → multiclass, number → regression; confirmed. Subtypes: multi-label, ordinal, count, survival, quantile | Target distribution | active (`question.task_type`) | REFORMS (Kapoor et al. 2024), module 1; ref-v3 1.3 |
| Unit of prediction | 3 | Person: one row per what? Rows are aggregated to it before the split | — | active (`question.unit_of_prediction`; aggregation is not offered yet) | TRIPOD+AI (Collins et al. 2024) |
| Class imbalance | 1 | Rarest class under a fifth of an even class's share (10% of rows for two classes). Unequal costs move the threshold instead (Elkan 2001) | Class balance bar | active (`question.class_balance`) | ref-v3 1.5; He & Garcia 2009 |
| Primary metric | 1, else 3 | Stated metric wins. Else: binary balanced → ROC-AUC; binary unbalanced → PR-AUC or F1; multiclass → macro or weighted F1; costs stated → expected cost; regression → MAE or RMSE | — | draft | scikit-learn "Metrics and scoring"; ref-v3 1.4 |
| Cost of each error | 3 | Person | — | active (`question.error_costs`; costs read by ADR-0053) | Elkan 2001 |

## Data
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Join sources | 1, else 3 | One shared key with matching values joins; an ambiguous key asks | Key match counts | none | — |
| Column roles (id, target, number, category, text, date) | 1, else 3 | Measured: distinct = rows → id; parses as date → date; long varied strings → text. Number-coded labels (postal codes) ask | Column type summary | none | Breck et al. 2019 |
| Missing markers (`?`, `n/a`, `-1`) | 1, else 3 | Values that fail to convert in an otherwise numeric column. `NA` that may be a value (Namibia) asks | Top non-numeric values | active (`data.missing_markers`) | Breck et al. 2019 |
| Wrong types | 1 | Share of values that convert; codes with leading zeros ask | — | active (`data.type_repair`) | Breck et al. 2019 |
| Exact duplicates | 1 | Row hash. Removed before the split, so no row is in train and test | — | active (`data.exact_duplicates`) | Kapoor & Narayanan 2023 |
| Duplicates by key | 3 | Person: which row to keep | — | none | — |
| Same entity on both sides | 1 | An entity column with repeated values → group split | Rows per entity | active (part of split method) | Kapoor & Narayanan 2023; ref-v3 2.5 |
| Columns not known at prediction time | 3, with a measured hint | Person confirms; a column that alone predicts the target almost perfectly on train rows is flagged | Single-feature score per column | draft (`features.leakage_exclusion`) | Kapoor & Narayanan 2023; ref-v3 2.5 |

## Split
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Split method | 1 | Time column + horizon → temporal (with a gap when the horizon needs one); entity column → group; unbalanced classes → stratified; else random. The test rows are scored once, at the end | Class balance per side | active | Roberts et al. 2017; scikit-learn "Cross-validation"; ref-v3 1.6 |
| Point in time | 1, else 3 | Features must be known before the prediction time | Target over time | draft | Kapoor & Narayanan 2023 |

## Cleaning (statistics from train rows)
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Missing values | 1, then 2, else 3 | Missing target → drop rows. Mostly empty (default 60%) → drop column. Otherwise fill after the split: median for skewed, else mean. When gaps relate to the target, add a "was missing" column (tried). Model-based filling (iterative) is tried only when simple filling scores worse. Why values are missing is asked when it matters | Missing share per column; gaps by target | active | scikit-learn "Imputation" (`add_indicator`, `IterativeImputer`); Little & Rubin 2019; ref-v3 2.3 |
| Outliers | 1, else 3 | Impossible values (domain range, asked) → missing. Real extremes: clip for linear and distance models, nothing for trees, robust scaling instead when many | Box plot per column | active | Tukey 1977; ref-v3 2.4 |
| Constant columns | 1 | One distinct value on train rows → drop | — | draft (`select_columns` reads one table, so it cannot be added before a model) | scikit-learn `VarianceThreshold` |
| Text spelling | 1, else 3 | Trim and lowercase before the split (structure, nothing fitted). Accent-only variants and the target's labels ask: 'año' and 'ano' differ | Top variants per value | active (`data.text_spelling`, common pack) | OpenRefine clustering |

## Features (Clean steps, ADR-0056; "model" = the answer depends on the model family)
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Encoding (model) | 1, then 2 | Under 15 categories → one-hot before the model (ADR-0057). 15–100 → target encoding with cross-fitting vs frequency, tried. Over 100 → group rare values or hashing, tried | Categories per column | active | scikit-learn `TargetEncoder`; Micci-Barreca 2001; ref-v3 3.1 |
| Rare categories | 1 | Text with more categories than one-hot takes (15): under 1% of train rows → "other", keeping at most 15 so one-hot then takes it, before the model. Its own value for most rows → an identifier, left alone | Category frequency | active (`features.rare_categories`) | scikit-learn `OneHotEncoder(min_frequency)` |
| Skewed numbers (model) | 1, then 2 | Trees: none. Linear models: \|skewness\| over 1 → Yeo-Johnson before the model (0/1 columns never). Quantile transform vs none, tried, is not built | Histogram per column | active (`features.skew_transform`) | scikit-learn `PowerTransformer`; ref-v3 3.2 |
| Scaling (model) | 1, then 2 | Trees: none. Linear, distance: standard; many outliers: robust | — | active | Hastie et al. 2009; scikit-learn preprocessing |
| Date parts | 1, then 2 | Year, month, weekday from a date column; cyclic (sin/cos) for months and weekdays; kept when they help in cross-validation (not built: the parts are always added) | Target by month | active (`features.date_parts`) | knowledge: step 3; ref-v3 2.6 |
| Lags and rolling statistics | 1 | Time-series questions only, computed from past rows only | Target over time | draft (time-series pack) | ref-v3 3.4 |
| Interactions | 2 | Linear models only, a few chosen pairs, tried | — | none | ref-v3 3.3 |
| Text representation | 2 | TF-IDF words vs characters, tried; embeddings when the text is long or semantic | Text length per row | none (ADR-0058 proposed) | scikit-learn "Text feature extraction"; ref-v3 3.5 |
| Feature selection | 2, else 3 | Only inside cross-validation; permutation importance, stable across folds; a person may veto a drop | Importance per fold | draft | Ambroise & McLachlan 2002; Meinshausen & Bühlmann 2010; ref-v3 3.6 |
| Dimensionality reduction | 2 | Tried against no reduction | — | draft | Hastie et al. 2009 |
| Multicollinearity (model) | 1 | Linear models only | Correlation heatmap | draft | — |

## Models
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Baseline | 1 | Always: a model with no features (most frequent class, mean) | — | active (part of selection) | ADR-0044; ref-v3 4.1 |
| Model shortlist and selection | 2 | Baseline + candidates on repeated CV; simplest within one standard error | Score per fold per model | active | Hastie et al. 2009 §7.10; ADR-0050; ref-v3 4.2 |
| Need for interpretability | 3 | From the hard constraints: high → linear models and shallow trees only. A forest is replaced by a linear model and left off the shortlist; no single-tree model is registered yet | — | active (`modeling.interpretability_requirement`) | knowledge: step 4; ref-v3 4.4 |
| Settings (tuning) | 2 | Nested CV within a budget | Score per trial | — (studies, ADR-0052) | Cawley & Talbot 2010; ref-v3 4.6 |
| Class imbalance | 2 | Class weights vs resampling inside folds vs threshold, tried | Recall per class | draft | He & Garcia 2009; ref-v3 4.5 |

## Evaluation
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Decision threshold | 2, costs from 3 | Tuned on CV predictions, never on test rows | Cost vs threshold | active (ADR-0053) | scikit-learn `TunedThresholdClassifierCV` |
| Calibration | 2 | Tried when probabilities are used | Reliability diagram | draft | scikit-learn "Probability calibration" |
| Over- or underfitting | 1 | Train vs validation score gap, and the learning curve | Learning curve | none | ref-v3 4.8 |
| Error analysis | 1 | Errors by segment and class; a segment far worse than the rest reopens features or data | Confusion matrix; residual plot | none | ref-v3 4.8 |
| Ablation | 2 | Drop each feature group and refit the whole flow inside the same CV folds (LOCO); a drop counts beyond one corrected standard error (Nadeau & Bengio). Predictive reliance, not cause | Score drop per group | draft (`evaluation.ablation`) | Lei et al. 2018; Fisher, Rudin & Dominici 2019 |
| Sensitivity | 1 | Rerun CV with other model and split seeds, and each tuned setting one step away; fragile when the SD across seeds is over half the lift. Reported, never used to pick | Score spread per seed and setting | draft (`evaluation.sensitivity`) | Bouthillier et al. 2021 |
| Bootstrap interval | 1 | After the one hold-out scoring: a 95% BCa interval, and a paired interval of model minus baseline (groups resampled whole; time splits not yet). Reported, never used to choose | Score with interval | draft (`evaluation.bootstrap_interval`) | Efron & Tibshirani 1993; Efron 1987 |
| Fairness slices | 3, then 1 | Person names the groups; scores per group against stated limits | Score per group | draft | ref-v3 4.7 |
| Loop back | 1, bar from 3 | No lift over the baseline (the selection's own test) stops and reports. A model the selection did not choose reopens the model choice. A chosen model below the success bar a person states in the comparison's metric reopens the features. Reopens stop after 3 looks across the flow's family | — | active (`evaluation.loop_back`; reopens the features only until fit diagnosis and error analysis point elsewhere) | knowledge: step 4; Cawley & Talbot 2010 |

## Reporting
| Decision | Level | Decided by | Evidence chart | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| Action rule (who to act on) | 3, then 2 | Person gives the budget or capacity; score bands are set on CV predictions | Score bands | none | knowledge: step 5; ref-v3 5.2, 5.5 |
| Business impact | 1 | The model compared with the current rule, in the person's cost units | Cost vs current rule | none | knowledge: step 5; ref-v3 5.3, 5.4 |
| Model card | 1 | Built from the recorded decisions, never written by hand | — | none | Mitchell et al. 2019 |
| Fairness, explainability, drift, serving parity | 3 | Person names groups and obligations | — | draft | TRIPOD+AI |

Deployment and monitoring (ref-v3 stage 6) wait for M5 and M6. Unsupervised rules (clustering, anomaly) follow the same levels; see `methodology/unsupervised/`.

## Refusals: routes the map does not take
| Reference route | Map route | Why |
| --- | --- | --- |
| Course: fill, encode or scale before the split | Fit on train rows only | Test rows would shape the model |
| Course: select features or set a threshold on test results | Inside cross-validation | The score would be optimistic |
| Course: tune with no hold-out | Nested CV | Same |
| Course and ref-v3 gate 4: judge the hold-out score, then iterate | Iterate on cross-validation results; the hold-out is scored once and reported, never tuned on | Iterating on the test set tunes the model to it. ref-v3's own first rule forbids it |
| Course: drop mostly-empty columns measured on all rows | Measure train rows, drop from all | Statistics from train rows only |
| ref-v3: leakage check by feature-target correlation | Measured on train rows only | Same |
| ref-v3: "deterministic gates only, no maybe" | Rule, try or ask | Some answers depend on the data. Trying routes on fixed folds makes them repeatable without pretending they are certain |
| ref-v3: missingness mechanism decides the fill (MCAR, MAR, MNAR) | A "was missing" column and model-based filling are tried; the mechanism is asked only when it matters | The mechanism cannot be proven from the data alone |
