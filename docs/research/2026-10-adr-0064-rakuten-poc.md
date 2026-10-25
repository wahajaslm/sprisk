# ADR-0064 proof of concept: the Rakuten walk

The gate for [ADR-0064](../adr/0064-validate-the-architecture-before-the-libraries.md), run on
2026-10-24 on the real Rakuten product-type files (`X_train_update.csv`, `Y_train_CVw08PX.csv`,
84,916 listings, 27 classes). The files stay in `.sprisk/data` (git-ignored); this note holds
record ids and aggregate scores only.

Question `qv_01M5NT4MGRMCT8R0A96J0A6YSJ`: "Predict each listing's product type code from its
title and description." Target `prdtypecode`, success bar weighted F1 ≥ 0.5, title bound to
`designation`, and a person's answer: rows with matching titles are one item.

## Result

Walk `wlk_01M5R0JA9KYGX8FDK9CG659H6D` reached `complete` in about 9 minutes (the walk before
the speed fix spent hours in one cross-validation and never finished).

| | Weighted F1 | Balanced accuracy | Accuracy |
| --- | --- | --- | --- |
| Linear model, test rows scored once (17,023) | 0.828 | 0.793 | 0.828 |
| Baseline, same rows | 0.025 | 0.037 | 0.119 |
| Linear model, folds of the train rows | 0.818 ± 0.004 | | |

What the walk decided, in order: keep the spelling; treat matching titles as one item (the
person's answer); split by item groups; join the two files on the row index; classification;
balanced classes (rarest 0.90%); leave out `imageid`, `productid` and the index; strip HTML;
learn word features from the train rows; choose the linear model over the random forest.

## The eight criteria

| # | Criterion | Holds | Evidence |
| --- | --- | --- | --- |
| 1 | Reaches `complete`; questions asked in the look only | Yes | Stop reason `complete`, no asks |
| 2 | A second walk gives the same trail and refuses to score again | Yes | `wlk_01M5R22WXE2M5XPW1EKF7964BH`: the first 26 steps equal (action, decision, option, reason); it stops as a limitation naming the first walk's score |
| 3 | Every step of the final flow resolves to a method, option, reason and promises | Yes, but the two Load steps | Every other step cites a decision record or is shaped by a method's decision; the Loads come from the build step's sources |
| 4 | Method decisions are records made through Apply | Yes | 10 decisions, 10 records (5 by method, 5 by rule) |
| 5 | No step reads test labels before the score; every split option has a promise | Yes | Class shares measured with the score only (largest gap 0.6%); `no_group_overlap` passed (65,757 train, 16,440 test items) |
| 6 | A new split operator and method, added as folders only, are used | Yes | `a_split_operator_and_a_method_added_as_folders_are_used_with_no_code_edit` (commit 9ff5929) |
| 7 | The report answers the question and links its evidence | Yes | `GET /walks/{id}/report`: the answer on the score run and flow, 13 claims each on records, 2 limitations |
| 8 | Reopening rebuilds the trace from records | Yes | Found from its question (`GET /walks?question_version_id=`); its 9 runs, 10 versions and 10 decision records all read back |

## What it showed

- The speed fix works: 2 shuffles of 5 folds on 67,893 train rows, forests on all cores.
- The promises were last checked at round 20. The word features and the model came later, but
  downstream of the split's outputs the checks read, so the checks still held: nothing before
  their evidence changed.
- The scaling rule did not fire, so the gap where a rule changes the flow after the choice did not
  stop this walk. It is in the [backlog](../backlog.md), with the other gaps found on the way.
