---
name: verify
description: Verify a change in Pulse before calling it done — typecheck (both tsconfigs, filtered to touched files), eslint, targeted then full tests via npm test (never vitest directly). Use after any code edit and before committing.
argument-hint: "[test files to run first] (optional)"
---

# Verify — Pulse

Typecheck and eslint errors are at zero (2026-09-30). The build uses esbuild and never typechecks, so these gates are the only safety net — keep them at zero.

1. **Changed files**
   ```bash
   CHANGED=$(git diff --name-only HEAD -- 'src/**/*.ts' 'src/**/*.tsx'; git ls-files --others --exclude-standard -- 'src/**/*.ts' 'src/**/*.tsx')
   ```
2. **Typecheck**: `npm run typecheck 2>&1 | grep "error TS"` must print nothing.
3. **Lint**: `npx eslint --quiet src` must report 0 errors. Don't add new `react-hooks/exhaustive-deps` warnings in touched files.
4. **Tests**
   - Targeted first: `npm test -- tests/<area>.test.ts` (extra args go to vitest; `-t "name"` works).
   - Then the full suite: `npm test` (about 25s, plus about 1 minute of native rebuilds).
   - Never run `vitest` directly: the native SQLCipher module is built for Electron's ABI. A hook blocks it.
   - Map areas to tests: `src/main/ipc/ipc-X.ts` → `tests/ipc-X.test.ts`; stores → `tests/renderer/stores/`; migrations → `tests/migrations.test.ts` and `tests/migration-upgrade.test.ts`.
5. **UI changes**: say that you haven't seen the change in the real app, or run `npm run dev` with an isolated data dir: `PULSE_DATA_DIR=$(mktemp -d) npm run dev`.
6. **Report** exact pass/fail counts. If something was skipped, say so.
