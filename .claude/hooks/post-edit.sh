#!/usr/bin/env bash
# PostToolUse(Edit|Write): fast, per-file guardrails. Exit 2 feeds stderr back to Claude.
f=$(jq -r '.tool_input.file_path // ""')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${f#"$root"/}"

case "$rel" in
  src/main/migrations/[0-9][0-9][0-9]_*.ts)
    if ! grep -q "schema_version" "$f"; then
      echo "Migration $rel never updates app_meta.schema_version — it will re-run on every launch. End it with: db.prepare(\"INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '<N>')\").run()" >&2
      exit 2
    fi
    if grep -q "ADD COLUMN" "$f" && ! grep -q "pragma_table_info\|table_info" "$f"; then
      echo "Migration $rel uses ALTER TABLE ADD COLUMN without a table_info guard (no IF NOT EXISTS in SQLite)." >&2
      exit 2
    fi
    ;;
esac

case "$rel" in
  src/*.ts|src/*.tsx)
    [ -f "$f" ] || exit 0
    # Errors only (warnings like exhaustive-deps are left to /verify)
    out=$(cd "$root" && npx eslint --quiet --format json "$f" 2>/dev/null \
      | jq -r '.[].messages[] | select(.severity==2) | "\(.line):\(.column) \(.message) [\(.ruleId)]"')
    if [ -n "$out" ]; then
      printf 'eslint errors in %s:\n%s\n' "$rel" "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
