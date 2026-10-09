#!/usr/bin/env bash
# PreToolUse(Bash): block running vitest directly. The native SQLCipher module is
# built for Electron's ABI, so bare vitest fails with ERR_DLOPEN_FAILED (or, worse,
# leaves the module built for system Node and breaks `npm run dev`).
cmd=$(jq -r '.tool_input.command // ""')
# Drop quoted strings so `grep "vitest run"` etc. don't trip the check.
bare=$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
if printf '%s' "$bare" | grep -Eq '(^|[;&|(])[[:space:]]*(npx[[:space:]]+)?vitest([[:space:]]|$)' \
   && ! printf '%s' "$bare" | grep -Eq 'vitest[[:space:]]+(--watch|watch)'; then
  echo "Don't run vitest directly — use: npm test -- <test files/vitest args>  (handles the Node/Electron ABI rebuild)." >&2
  exit 2
fi
exit 0
