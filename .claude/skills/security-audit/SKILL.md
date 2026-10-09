---
name: security-audit
description: Project-specific security audit of Pulse (Electron + SQLCipher, PHI-adjacent data) — Electron hardening, IPC surface, key handling, backups, import/export, licensing, supply chain. For a generic diff review use the built-in /security-review or /code-review instead.
disable-model-invocation: true
argument-hint: "[area: ipc | keys | backup | import | network | deps] (optional)"
---

# Security Audit — Pulse

Audit this app like a security researcher, not a pattern matcher: trace data end to end and reason about what an attacker, or a careless user, could actually do. The data is sensitive (client names, DOBs, Medicaid IDs, case notes). There is one local user, no server, and network access only for the update check and license activation.

If `$ARGUMENTS` names an area, audit only that area. Before reporting, read `SUPER_AUDIT_REPORT.md` and `plans/SECURITY_ARCHITECTURE_BRIEF.md` so you don't re-report fixed items. Verify that a fix exists in the code; don't trust the documents.

## 1. Electron shell (`src/main/index.ts`, `src/preload/index.ts`)
- BrowserWindow: sandbox, contextIsolation, nodeIntegration off, devTools off in packaged builds.
- CSP from `onHeadersReceived`, `will-navigate` guard, `setWindowOpenHandler`, and permission handlers.
- Custom protocols `app://` and `pulse-file://` must have path-traversal guards. `pulse-file://` should not exist at all if nothing uses it any more (Documents was removed in migration 031).
- Preload: only `invoke`, `on`, `copyToClipboard`, and `setZoomFactor` are exposed. Check the channel allowlist.
- Fuses: `scripts/afterPack.js`.

## 2. IPC surface (replaces the old /ipc-inventory)
- Count the channels: `grep -c "secureWrap(IPC\." src/main/ipc/*.ts src/main/index.ts`.
- For every handler in `src/main/ipc/ipc-*.ts`, check:
  - argument validation (`validId`, type and length checks);
  - that writes call `enforceWritable()`;
  - that file paths go through `assertSafePath()`;
  - that no SQL is built from strings except `buildColumnCases` and `buildSafeSetClause`.
- `secureHandle` only rejects subframes; it does not check `senderFrame.url`. Note whether that still matters.
- Flag cross-entity writes, for example `CELL_UPDATE` with a `columnId` from a different grid than the row.
- Output one table: `| Channel | Args validated | Writes | FS path | Risk |`.

## 3. Key handling (`src/main/auth.ts`, `ipc-auth.ts`, `ipc-app.ts`)
- Key wrapping: PBKDF2 600k, AES-256-GCM, a bcrypt pre-check, and `normalizePassword` (the SHA-256 prehash for passwords over 72 bytes).
  - Check that every entry point normalizes the password the same way.
  - Check that there is a fallback for credentials created before normalization existed.
- `safeStorage` wraps the password-wrapped **and** the recovery-wrapped DB key. On Windows portable builds, `PulseData/` moved to another PC or Windows profile cannot be decrypted. Check whether the recovery key and backups are still usable in that case.
- Corrupt `pulse-secure.json` handling: the file must never be deleted, because it is the only copy of the wrapped key.
- Recovery key generate/revoke: does it require re-authentication? Does it warn that the old key is invalidated?
- Lockout state lives in `electron-store` and can be edited. Judge it against offline attacks, not online ones.

## 4. Data at rest and backups (`src/main/backup.ts`, `database.ts`)
- File modes are 0600/0700. Temp snapshot and extraction files are cleaned up on every path.
- Zip-bomb and path-traversal checks in `restoreFromPulseBackup` and `verifyBackup`.
- Plaintext leakage: logs (`src/main/logger.ts`), exported CSV/PDF files, the clipboard (cleared on lock), and crash dumps.

## 5. Import / export
- `sanitizeCsvFormula` coverage for every CSV writer.
- exceljs/papaparse limits: file size, row count, cell length.
- PDF content: every text field comes from the user, so jsPDF must not interpret any of it.
- DOMPurify config for tiptap HTML (letter templates, scratch pad).

## 6. Network surface
- The update check (`ipc-app.ts`) is the only outbound request. Anything new that calls out is a finding.
- The update URL and the download URL prefix stay pinned to `J2matlock/pulse-releases`.

## 7. Supply chain
- `npm audit --omit=dev`: only production deps ship.
- Unpinned `^` ranges in `dependencies`.
- `sbom.json` freshness.
- The asar contents: `npx asar list dist/*-unpacked/resources/app.asar | head`.

## Output
For each finding give: severity, confidence, `file:line`, a concrete scenario, and a fix. Then try to disprove every finding and drop any you can't defend. End with:
- counts by severity;
- the top 3 fixes;
- one line on the overall posture.
