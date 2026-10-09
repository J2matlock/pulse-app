#!/usr/bin/env bash
# Runs vitest against the system-Node ABI, then always rebuilds the native
# SQLCipher module for Electron so `npm run dev` keeps working afterwards.
# Extra args pass straight to vitest: `npm test -- tests/auth.test.ts -t "lockout"`.
set -u
npx node-gyp rebuild --directory=node_modules/better-sqlite3-multiple-ciphers >/dev/null || exit 1
npx vitest run "$@"
TEST_EXIT=$?
npx electron-rebuild -f -w better-sqlite3-multiple-ciphers >/dev/null 2>&1 || echo "WARNING: electron-rebuild failed — run: npx electron-rebuild -f -w better-sqlite3-multiple-ciphers" >&2
exit $TEST_EXIT
