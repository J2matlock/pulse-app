# Clipboard Clear on Lock/Quit

## Problem
When a user copies sensitive data (client name, phone number, case note), it stays on the system clipboard after the app locks or quits. Another person using the same computer could paste it.

## Solution
Call `electron.clipboard.clear()` in two places:
1. When the app locks (user-initiated or auto-lock timeout)
2. When the app quits

## Changes

### 1. `src/main/auth.ts` — `lockApp()`
- Import `clipboard` from `electron`
- Add `clipboard.clear()` at the top of `lockApp()` before any other logic

### 2. `src/main/index.ts` — app quit handler
- Find the `app.on('before-quit', ...)` or `app.on('will-quit', ...)` handler
- Add `clipboard.clear()` there
- If no quit handler exists, add one: `app.on('will-quit', () => { clipboard.clear() })`

### 3. `src/main/index.ts` — auto-lock timeout
- The auto-lock timer already calls `lockApp()`, so this is covered by change #1
- Verify no code path locks without going through `lockApp()`

## Files touched
- `src/main/auth.ts` (1 line added)
- `src/main/index.ts` (1-2 lines added)

## Testing
- Add test in `tests/ipc-auth.test.ts`: verify `clipboard.clear` is called when `lockApp()` runs
- Update the electron mock to track `clipboard.clear` calls

## Estimated effort
10 minutes.
