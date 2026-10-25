Old-format rules that methods replaced (ADR-0063 slice 6), kept only for the tests of the old
format's mechanics: the review, the proposal and the walk's next action. No pack loads them.
They go with the old format, at the end of slice 6.

- `supervised/rules/data_split`: replaced by the split method (slice 4); an example of a rule
  that replaces a step and reads question facts.
- The rest: dropped or converted in slice 6; see docs/design/slice-6-remaining-rules.md.
