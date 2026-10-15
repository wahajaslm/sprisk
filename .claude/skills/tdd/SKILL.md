---
name: tdd
description: Build a feature or fix a bug with strict red-green-refactor TDD. Use for any code change in crates/, python/, apps/web/, or contracts/.
---
# TDD loop

Keep the code simple. Follow "How we write code" in root `CLAUDE.md`.

0. **Look first.** Grep for existing code, patterns and fixtures that already do part of this. Reuse them and match their style.
1. **List behaviors.** Write the small behaviors needed as a short checklist. Include failure cases. Keep it to what was asked.
2. **For each behavior:**
   1. Write one failing test. Run it. Confirm it fails for the expected reason (not a typo or import error).
   2. Write the minimum code to pass. Run the test.
   3. Run the area's full test suite. Fix anything broken.
   4. Refactor only if it makes the code simpler. Re-run tests.
3. **Bug fix:** first test reproduces the bug. It must fail before the fix.
4. **Finish:**
   - Run the area's full checks (fmt, lint, types, tests). Show the output.
   - Run the `simplicity-reviewer` agent on the diff. Apply fixes that make code simpler.
   - Commit: one behavior or one fix per commit.

## Stop and ask when
- The test needs a lot of mocking. The design is probably wrong.
- Passing the test seems to need a new abstraction or dependency.
- A required behavior conflicts with the arch doc.
