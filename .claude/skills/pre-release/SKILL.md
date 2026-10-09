---
name: pre-release
description: Release gate for a Pulse build — automated checks (typecheck, lint, tests, audit, schema/version sanity), packaging, signing, update feed, and a manual smoke test. Produces a ship/block verdict.
disable-model-invocation: true
argument-hint: "[version, e.g. 1.2.0]"
---

# Pre-Release — Pulse $ARGUMENTS

Run every automated check yourself, then list the manual checks for the user. Report PASS, FAIL, or SKIP for each item, with evidence.

## 1. Automated gates (run these)
```bash
npm run typecheck 2>&1 | grep -c "error TS"     # must be 0
npx eslint src --quiet 2>&1 | tail -5            # must be 0 errors
npm test                                         # full suite; never vitest directly
npm audit --omit=dev                             # only production deps ship
git status --short                               # clean tree, nothing stray
```
- **Version**: `package.json` version is bumped, and the git tag doesn't exist yet (`git tag -l v<ver>`).
- **Schema**: the last entry in `migrations[]` in `src/main/database.ts` equals the number of the last file in `src/main/migrations/`. Each migration writes `schema_version`.
- **Tests track migrations**: `LATEST_SCHEMA_VERSION` in `tests/helpers.ts` matches.
- **Credentials**: every stored credential is readable by the new build — no change to `normalizePassword` or to the wrapping format that lacks a fallback.
- **No debug leftovers**: `grep -rn "console.log\|debugger" src/main src/renderer | grep -v test`.
- **Placeholders**: no leftover `caseconnect`, `example.com`, or TODO URLs (`grep -rni "caseconnect\|example\.com" src build LICENSE`).

## 2. Build & sign
- `npm run package:win` (portable exe) and `npm run package:linux` (AppImage).
- Builds are not code-signed (decided 2026-10-09). Publish a `SHA256SUMS.txt` with every release.
- Source maps are excluded (`!out/**/*.map`). Fuses are applied (`scripts/afterPack.js`).
- `sbom.json`, `licenses.txt` and `THIRD_PARTY_LICENSES.txt` are regenerated with `npm run licenses` if dependencies changed, then copied to the website's `docs/`.

## 3. Update feed
- `https://raw.githubusercontent.com/J2matlock/pulse-releases/main/latest.json` gets the new version. Its download URL must start with `https://github.com/J2matlock/pulse-releases/` (enforced in `ipc-app.ts`).
- The previous release still sees the update prompt and never auto-restarts.

## 4. Manual smoke test (hand to the user)
- [ ] Upgrade path: install the previous release, add data, close it, launch the new build → unlock works, data is intact, and the pre-migration backup exists.
- [ ] Fresh install: onboarding → first client in under 3 minutes.
- [ ] Deadlines: colors and dashboard counts are right; a note created now shows the correct local time.
- [ ] Import an Excel/CSV file with dates → the dates match the source (check a timezone east of UTC too).
- [ ] Backup → delete a client → restore → the client is back. Restore a garbage file → a friendly error, and the data is untouched.
- [ ] New-computer restore: on a clean VM/user account, first-run → "Restore from a backup" with a `.pulse-backup` + old password (and again with the recovery key) → data opens.
- [ ] Copy `PulseData` to another Windows account → lock screen offers "Restore from a backup" instead of a dead end.
- [ ] Lock → unlock; auto-lock fires; the clipboard is cleared on lock.
- [ ] Windows 10/11 on a clean VM: SmartScreen behavior, portable data folder next to the exe, 1366×768 at 150% zoom.

## Output
```
## Pre-Release Report — v<ver>
PASS n / FAIL n / SKIP n
Failures: …   Warnings: …
Verdict: CLEAR TO SHIP | SHIP WITH KNOWN ISSUES (list) | BLOCK
```
