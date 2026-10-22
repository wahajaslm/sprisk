# ADR-0058: Free text becomes word features, passed between steps as a matrix
Status: Accepted
Date: 2026-10-22
Arch doc sections: §4 (domain model), §8 (methodology), §9 (runs). Builds on ADR-0055 (one cell is one step), ADR-0056 (a model fits only the model) and ADR-0057 (a rule can add a step).

## Context
- The reference challenge (Rakuten product types) is free text: 84,916 product titles, 82,265 of them different, and descriptions, 35% empty. 27 classes.
- A model takes numbers (ADR-0056). One-hot works for a few categories, not for free text: the encoding rule names such a column and leaves it out (ADR-0057).
- The standard way to turn text into numbers is word features: one column per word or word pair, weighted by TF-IDF, learnt from the train rows. That is about 50,000 columns, almost all zeros.
- Steps pass tables (Parquet). A table of 84,916 rows × 50,000 columns, stored densely, is about 17 GB. It must stay sparse.
- In Jupyter a person writes `X_train = tfidf.fit_transform(train["designation"])` and then `model.fit(X_train, y)`. The notebook cell should look the same (ADR-0055).

## Decision
**A new value kind, `matrix`.** Rows × named number columns, stored sparse (SciPy CSR in `.npz`, with its column names). Row i is row i of the table it was made from. Steps pass it like any value; a step gets and returns it as a plain pair: a SciPy sparse matrix and its column names.

**An input port may be optional** (`optional: true`). Left unconnected, the step gets nothing for it. Nothing else changes for existing steps.

**New Clean step: Vectorize text** (`sprisk.clean.vectorize_text`, `fits_on_train`).
- Inputs `train`, `test` (tables). Settings: the text columns, and the n-gram range.
- Outputs `train`, `test` (the tables without those columns) and `train_words`, `test_words` (matrices).
- TF-IDF learnt from the train rows only: vocabulary, IDF weights. A word seen only in test rows is ignored. Empty text gives a row of zeros.
- Its plain code is the Jupyter code: `train_words = words.fit_transform(...)`, `test_words = words.transform(...)`.

**Models, evaluation and studies take the words beside the table.**
- Model steps, Evaluate and Feature importance get an optional `words` input. The model fits on the table's number columns and the words side by side.
- A study refits Vectorize text in each fold, like any `fits_on_train` step (ADR-0050).

**The rules add it.** The encoding rule (ADR-0057) recognises free text: a text column with many categories and many words per row. For it, the rule proposes adding Vectorize text before the model, instead of leaving the column out.

## Alternatives considered
- **Vectorize inside the model step.** Rejected: a model fits only the model (ADR-0056), and the cell would do two things.
- **Store the words as a dense table.** Rejected: about 17 GB for Rakuten.
- **Keep only the top few hundred words, as a table.** Rejected: it throws away most of the signal, and the cut-off would be a hidden choice.
- **Hash words into a fixed number of columns.** Rejected for now: columns lose their names, so importance and the notebook can no longer say which word mattered.
- **Carry the words inside the table artifact.** Rejected: every table step would have to keep the block, or lose it silently.

## Consequences (good and bad)
- Good: free text is handled the methodological way, learnt on train rows, and shown as a Jupyter user writes it.
- Good: `matrix` is generic. Image features (pretrained embeddings) can use it later.
- Bad: model, Evaluate, importance and cross-validation get new major versions with an optional input.
- Bad: a matrix cannot be profiled or charted like a table. The step shows its vocabulary size and top words instead.
- Bad: the graph compiler, the worker and the UI learn a new kind and optional inputs.

## Validation
- Worker: a matrix round-trips through `.npz` with its column names; an optional input left unconnected is passed as nothing.
- Python: Vectorize text learns its vocabulary from train rows only; a test-only word is ignored; its plain code gives the same matrices.
- Python: a model with `words` predicts as the plain code does; a study refits Vectorize text per fold.
- Rule: a free-text column gets Vectorize text, a few-category column gets one-hot.
- API: Rakuten-shaped synthetic data runs from Load to Evaluate with steps added by the rules only. The real Rakuten data never enters the repo.

## Amendments
- 2026-10-22: **A matrix is a SciPy array with its names.** A bare SciPy matrix has no column names, and importance must say which word mattered. So a step reads and returns a pair, the SciPy matrix and its names: plain code, no sprisk import (ADR-0022). The worker checks the pair as a `Matrix` (`sprisk_workers.matrix`): finite real numbers, one unique name per column. It is stored as plain NumPy arrays in one `.npz` (media type `application/vnd.sprisk.matrix+npz`), loaded without pickles, so a file cannot run code. A notebook cell still holds the SciPy matrix `fit_transform` returns.
- 2026-10-22: **What the later slices must hold** (methodology review of slice 1).
  - *Rows line up.* A step that takes a table and its words refuses them when their row counts differ. No step that adds, drops or reorders rows sits between Vectorize text and the steps reading its words.
  - *Names never clash.* A word column is named after its source column (`designation:red`), so two text columns, or a table column and a word, never share a name.
  - *Empty text is said.* A missing text is read as empty, on purpose and stated in the step's code, never passed on as a gap.
  - *Cross-validation refits the words.* A fold refits Vectorize text on the fold's train rows and passes its words to the model. A matrix fitted once is never cut into folds: test-fold words would shape the vocabulary and IDF weights.
- 2026-10-22: **Only words are optional.** Inputs are their own contract type, `InputPort`, so an output cannot be optional. The registry lets only a matrix input be optional: a table or model left out would leave a step to guess a default. A notebook cell passes `None` for an optional input left unconnected, as the worker does. Slice 4 must also hold: a model fitted with words is scored with words; a model's words come from the `train_words` of the Vectorize step on its train rows, Evaluate's from that step's `test_words`; a rule inserting a step compares only required inputs, deliberately.
- 2026-10-22: **Vectorize text is built (slice 3).** One scikit-learn `TfidfVectorizer` per column with its defaults (lowercase; words of two or more letters; IDF smoothed; rows scaled to unit length), so the notebook cell is the textbook one. Settings: the columns and `ngram_range`. No vocabulary cut-off. The split-leakage check traces a fitting step's train words, like its train table, to its train input only. Known gaps, each its own later step: a minimum count per word (`min_df`) to bound Rakuten's vocabulary, chosen by the rule or a comparison; and stripping HTML and entities from descriptions before words are learnt (`<br />` would become a word). Until folds carry words (slice 4), a comparison may not refit it per fold: the compiler refuses a preparation step that writes anything but tables.
- 2026-10-22: **Models take words (slice 4).** Linear model, random forest and the baseline move to 3.0.0, Evaluate and Feature importance to 2.0.0, each with an optional `words` input; they replace the old versions in place, as ADR-0056 did. A model fits on the table's numbers and the words side by side, one sparse matrix, and refuses words whose rows differ from the table's. A model fit on words saves its table columns and its word names. Evaluate and importance then refuse a model fit on words given none, one fit without words given some, and other words: only the test words of the same Vectorize text step score it. Importance shuffles each table column alone and each text column's words together ("title (words)"): one word of 50,000 says little, and shuffling each is too slow. Cross-validation keeps its version: its input is still the split's train rows. A fold step that makes words passes on its test table and test words, later steps carry the words along, and the model's input joins them, so each fold refits Vectorize text on its own rows. In a comparison, importance shuffles each raw text column, so a text column is one feature there too. Only one step may make words for a model.
- 2026-10-22: **Words are checked where they are read (slice 4 review).** A comparison is refused unless the flow's model reads the `train_words` of the one step on its train rows that makes words, or there is no such step and no words: the folds would otherwise score a model the flow never fits. The split-leakage check fails an evaluator whose words are not the `test_words` of the step the model's train words came from: train and test words share their columns, so nothing else would notice. A fold step may write tables and words, nothing else. Grouped importance runs through scikit-learn's `permutation_importance`, shuffling a matrix of row positions, one column per group; a group is named after its text column in both importances. Known limits:
  - Rows are matched by count only: a code step that reorders rows without changing their count would misalign words and table.
  - A fold refits Vectorize text at every scoring call, importance included: correct, but slow at Rakuten's size. To speed up with the review.
  - Two steps that make words for one model are refused only when a fold runs, not when the flow compiles.
  - A model with costs tunes its cut-off on folds of rows whose words were learnt from all train rows, as for any preparation step (ADR-0053).
  - In a comparison whose model lists its `features`, importance shows only those columns, so a text column's importance is left out.
