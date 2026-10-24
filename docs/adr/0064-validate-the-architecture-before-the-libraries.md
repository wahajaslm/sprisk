# ADR-0064: Validate the architecture before the method and operator libraries
Status: Accepted
Date: 2026-10-24
Arch doc sections: §4 (principles), §8.3 (decision lifecycle), §9.4 (data-access matrix), §15.1, §21–§22. Builds on ADR-0060 and ADR-0063.

## Context
A validation of the ADR-0063 architecture against the project's goals and the Flow Studio design found the core sound: a walk asks once, decides, checks its promises, seals the test rows and scores them once. It also found five flaws that every method and operator built next would inherit:
- **Two write paths.** A method's option patches the flow directly (`record_decide`). Rules go proposal → preview → idempotent Apply (§8.3). Nodes a method changes carry no decision id.
- **Test labels read before the score.** The `class_shares` producer reads `split.test` with the target. §9.4 allows final labels only to the final authorized score.
- **Holes in the seal.** The `temporal` and `simple_random` split options promise nothing, so nothing checks that test rows come later.
- **Operator names in core code.** The start flow, the cross-validation folds per split and the leakage check name operators. A new split operator needs Rust and Python edits (§15.1).
- **No end and no way back.** Nothing records the answer to the question, and a walk cannot be found again from its question.

## Decision
- **One write path.** A method's decision is a `MethodologyDecision` made by the same Apply as a rule's: idempotency key per walk round, stale base refused, the nodes it changes carry its id. `MethodologyDecision` gains the method, option, promises and bindings (ADR-0063 said it would).
- **No verification reads test labels.** A producer that attaches to a split's outputs may read the test rows' features, never the target. `class_shares_kept` leaves the split's promises; the class shares of train and test are reported with the final score, where §9.4 allows reading them.
- **Every split option promises something.** `temporal` promises `test_after_train` (no test row is earlier than the latest train row), measured on the time column. `simple_random` promises `no_row_in_both`. An option with nothing to check says why in its method.
- **Roles, not names.** Core code finds operators by manifest `role` and declared capability, never by id:
  - the start flow takes each role's default operator;
  - a split manifest declares how its folds are made (`folds: plain | stratified | group | time`);
  - the leakage check finds splits by role.
  A test proves it: a new split operator and a new method, added as folders, are used with no edit to `crates/` or the packs' Python.
- **Walks can be found, and end in a report.**
  - `GET /walks?question_version_id=` lists a question's walks, paged.
  - A completed walk writes one immutable `Report`: the question, the answer as a stated claim, and each claim's evidence by id (decisions, promise checks, runs, the test score) plus its limitations. It is built from records, not written by a model.

## Proof of concept (the gate for this ADR)
The Rakuten walk on the real files passes when all hold:
1. It reaches `complete`; every question is asked in the look, none after.
2. A second walk gives the same trail and refuses to score again.
3. Every step of the final flow resolves to a method, option, reason and promises.
4. Method decisions are decision records made through Apply.
5. No step reads test labels before the score; every split option has a promise.
6. A new split operator and method, added as folders only, are used.
7. The report answers the question and links to its evidence.
8. Reopening the project rebuilds question → decisions → versions → runs → checks → comparison → score from records.

Not in it: forecasting, deploy, copilot, dataset versions. Each needs its own ADR.

## Alternatives considered
- **Build the libraries first, fix later.** Rejected: every method would be written against two write paths and named operators, then rewritten.
- **Keep `class_shares_kept`, allow test labels to verifications.** Rejected: §9.4 and rule 8; a check that reads the answers before the score is a look at them.
- **A report written by a language model.** Rejected: rule 3. A template over records is deterministic; prose can come later as an explanation of a stored report.

## Consequences (good and bad)
- Good: methods and operators built next inherit one path, a complete seal and role-based placement.
- Good: the walk ends in something a person can read and trace.
- Bad: stratification is checked only at the score, not before it. A broken stratified split shows as a limitation of the score, not a stop.
- Bad: `MethodologyDecision` grows a second shape until the old rules go (ADR-0063 slice 6).

## Validation
- The eight proof-of-concept criteria pass on the real Rakuten files, recorded in the PoC report.
- `grep` finds no operator id in `crates/` outside tests and the packs' defaults.

## Arch doc edits
- §8.3: method decisions take the same lifecycle; the method, option and promises are part of the proposal's fingerprint.
- §9.4: add a row: promise verification on split outputs reads features, never final y.
- §4: add `Report` (question, claims, evidence ids, limitations).
