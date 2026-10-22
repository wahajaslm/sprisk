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
**A new value kind, `matrix`.** Rows × named number columns, stored sparse (SciPy CSR in `.npz`, with its column names). Row i is row i of the table it was made from. Steps pass it like any value; a step gets it as a `Matrix`: a SciPy CSR array and its column names.

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
- 2026-10-22: **A matrix is a SciPy array with its names.** A bare SciPy matrix has no column names, and importance must say which word mattered. So a step reads and returns a `Matrix` (`sprisk_workers.matrix`): a CSR array and one name per column, refused when they differ. It is stored as plain NumPy arrays in one `.npz` (media type `application/vnd.sprisk.matrix+npz`), loaded without pickles, so a file cannot run code. A notebook cell still holds the SciPy matrix `fit_transform` returns.
- 2026-10-22: **What the later slices must hold** (methodology review of slice 1).
  - *Rows line up.* A step that takes a table and its words refuses them when their row counts differ. No step that adds, drops or reorders rows sits between Vectorize text and the steps reading its words.
  - *Names never clash.* A word column is named after its source column (`designation:red`), so two text columns, or a table column and a word, never share a name.
  - *Empty text is said.* A missing text is read as empty, on purpose and stated in the step's code, never passed on as a gap.
  - *Cross-validation refits the words.* A fold refits Vectorize text on the fold's train rows and passes its words to the model. A matrix fitted once is never cut into folds: test-fold words would shape the vocabulary and IDF weights.
- 2026-10-22: **Only words are optional.** Inputs are their own contract type, `InputPort`, so an output cannot be optional. The registry lets only a matrix input be optional: a table or model left out would leave a step to guess a default. A notebook cell passes `None` for an optional input left unconnected, as the worker does. Slice 4 must also hold: a model fitted with words is scored with words; a model's words come from the `train_words` of the Vectorize step on its train rows, Evaluate's from that step's `test_words`; a rule inserting a step compares only required inputs, deliberately.
