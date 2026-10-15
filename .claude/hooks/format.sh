#!/usr/bin/env bash
# Format the edited file. Never blocks.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] || [ ! -f "$f" ] && exit 0
case "$f" in
  *.rs) command -v rustfmt >/dev/null && rustfmt --edition 2024 "$f" 2>/dev/null ;;
  *.py) ruff=(ruff); command -v ruff >/dev/null || ruff=(uv run --project "$CLAUDE_PROJECT_DIR" ruff)
        "${ruff[@]}" format -q "$f"; "${ruff[@]}" check -q --fix "$f" ;;
  *.ts|*.tsx|*.json|*.css) [ -x "$CLAUDE_PROJECT_DIR/apps/web/node_modules/.bin/prettier" ] && \
      "$CLAUDE_PROJECT_DIR/apps/web/node_modules/.bin/prettier" --write --log-level silent "$f" ;;
esac
exit 0
