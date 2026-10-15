#!/usr/bin/env bash
# Block edits to generated code, secrets and lockfiles. Exit 2 = block, stderr goes to Claude.
set -euo pipefail
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0
case "$f" in
  */generated/*|*/sprisk-contracts/src/gen/*)
    echo "Blocked: $f is generated. Edit the schema in contracts/ and run 'just contracts-gen'." >&2; exit 2 ;;
  */.env|*/.env.*|*/secrets/*|*.pem|*.key)
    echo "Blocked: $f may hold secrets." >&2; exit 2 ;;
  */Cargo.lock|*/uv.lock|*/pnpm-lock.yaml)
    echo "Blocked: lockfiles change only via the package manager." >&2; exit 2 ;;
esac
exit 0
