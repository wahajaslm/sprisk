#!/usr/bin/env bash
# Flag architecture-rule violations in the edited file. Exit 2 = feedback to Claude.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] || [ ! -f "$f" ] && exit 0
msgs=()
case "$f" in
  */tests/*|*_test.*|*test_*.py|*.test.ts|*.test.tsx) exit 0 ;;
esac
case "$f" in
  */crates/*.rs)
    grep -nE '\.unwrap\(\)|\.expect\(' "$f" >/dev/null && msgs+=("No unwrap()/expect() outside tests (crates/CLAUDE.md).")
    grep -nE 'sqlite|Sqlite' "$f" >/dev/null && [[ "$f" != *sprisk-core*/repo/* && "$f" != */migrations/* && "$f" != *sqlite* ]] \
      && msgs+=("SQLite named in domain code. Keep dialects behind repository traits (arch §13).") ;;
  */python/*.py|*/plugins/*.py)
    grep -nE '\b(pickle|joblib)\.load' "$f" >/dev/null && msgs+=("pickle/joblib.load found. Untrusted models are executable code (arch §12).")
    # The code step runs code the user wrote and chose to run (ADR-0020). Only that file may exec.
    grep -nE '\b(eval|exec)\(' "$f" >/dev/null && [[ "$f" != */plugins/code/src/sprisk_code/python_step.py ]] \
      && msgs+=("eval/exec found. No prompt-to-code execution (arch §7).") ;;
  */apps/web/*.ts|*/apps/web/*.tsx)
    grep -nE ': any\b|as any\b' "$f" >/dev/null && msgs+=("'any' used. Use generated contract types.")
    grep -nE "from ['\"]dockview" "$f" >/dev/null && [[ "$f" != */dock-adapter/* ]] && msgs+=("Import dockview only inside src/workbench/dock-adapter.")
    grep -nE "ag-grid-enterprise" "$f" >/dev/null && msgs+=("AG Grid Enterprise is not allowed (arch §2A licensing).") ;;
esac
if [ ${#msgs[@]} -gt 0 ]; then
  printf '%s: %s\n' "$f" "${msgs[@]}" >&2; exit 2
fi
exit 0
