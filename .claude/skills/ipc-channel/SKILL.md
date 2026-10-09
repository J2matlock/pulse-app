---
name: ipc-channel
description: Add or change a Pulse IPC channel end to end — channel constant, typed contract, secureWrap handler with validation/enforceWritable, renderer call via safeInvoke/storeInvoke, and tests.
---

# IPC channel — Pulse

1. **Channel constant**: `src/shared/ipc-channels.ts`, following the `DOMAIN_ACTION` naming. The preload allowlist is built from `Object.values(IPC)`, so nothing else is needed there.
2. **Contract**: add `args` and `return` types to `src/shared/ipc-contract.ts`. This gives `safeInvoke` compile-time checking.
3. **Handler** in the domain file `src/main/ipc/ipc-<domain>.ts`, inside that file's `register…Handlers()`:
   ```ts
   secureWrap(IPC.DOMAIN_ACTION, 'ipc-domain', (_e, id: number, value: string) => {
     const guard = enforceWritable(); if (guard) return guard      // any INSERT/UPDATE/DELETE
     if (!validId(id)) return fail('Invalid ID')
     if (typeof value !== 'string' || value.length > 10_000) return fail('…human message…')
     const db = getDb()
     db.transaction(() => { /* cachedStmt('domain_action', '… ? …').run(…) */ })()
     return ok(result)
   })
   ```
   - Args come from the renderer, so treat them as untrusted: check types, lengths, and ownership. For example, confirm that a column belongs to the row's grid.
   - File paths must go through `assertSafePath()`. Prefer `dialog.show*Dialog` in main over paths chosen in the renderer.
   - `fail()` messages are shown to users. Keep them plain English with no SQL error text. Thrown errors pass through `humanizeError`.
   - Timestamps: SQLite `datetime('now')` is UTC with no zone suffix. Convert before the renderer parses it with `new Date()`.
4. **Renderer**: use `safeInvoke` in components (check `res.ok` and `toast.error` on failure) or `storeInvoke` in Zustand stores (it throws). For optimistic updates, roll back and toast in the catch.
5. **Tests**: `tests/ipc-<domain>.test.ts` follows the existing pattern (in-memory DB via `tests/helpers.ts`). Cover the happy path, invalid args, and trial-expired read-only.
6. Run `/verify`.
