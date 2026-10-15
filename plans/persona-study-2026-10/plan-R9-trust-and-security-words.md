# R9 — Trust: security screens that answer plainly, in the right words

Phase 3 polish, Wave 1, merge slot 7. Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows #9, #10, #14 (the settings half) and #19.

## Goal

The screens that guard and explain the data are the ones people judge the whole program by, so none of them is silent, contradictory or written for someone else's job. A wrong current password is said next to the box. The security summary fits a school as well as an agency, and never contradicts itself. A backup says where it went. A used recovery key leads to a new one. A restore leaves a line in the change history. Leftover agency words go.

## Personas and findings

- **Karen** (#9): typing her current password wrong on Change password gave "nothing happens. No red text, no message, nothing", even after 2.5 s (`persona-karen/14c-wrong-current.png`, `15b-wrong-2500.png`, `15c-wrong-top.png`). "On a security screen, silence is the worst message."
- **Karen** (#10, needed help): the security summary talks about "the agency's responsibility" and a HIPAA business associate agreement, to a school district whose superintendent will ask about FERPA. It says "Backups are encrypted too", then lists backups among "(these are not encrypted)" (`45b-security-summary.png`). She'd have to hand-edit it.
- **Bobby** (#10): he'd show the summary to his commander, but there's a "Copy for my supervisor" button and no Print (`persona-bobby/r-46-security-summary.png`).
- **Karen** (#14): the features heading "Records" after she switched to students; Profile placeholders "Community Services Agency" and "jane.smith@agency.org"; "No records or notes are included" inside the shared setup file (`18a-more-words.png`, `52b-after-save-setup.png`).
- **Karen** (#19): "Backup saved." doesn't say where (`23a-backup-now.png`). The recovery screen says "the recovery key you saved during setup", but she made it in Settings (`13b-forgot.png`). A too-short key gets "didn't match" (`13c-partial-key.png`). After a recovery-key reset, Settings still says "Recovery key active" with no nudge to make a new one. Cell history shows 2025-10-30 while the grid shows 10/30/2025 (`28a-cell-history.png`). Restoring a backup isn't in the change history. "Made by: Pulse 0.0" (`29b-restore-step1.png`).

## Current behaviour

- `settings/SecuritySection.tsx:136-139` sets `pwError` correctly ("Your current password is incorrect." when `res.error === 'Incorrect password'`), but `:202-203` renders it **above** the Current password label, at the top of a long form the person has scrolled past to reach "Save new password" (`:253`). The current field gets `aria-invalid` (`:208`) but no visible style. Nothing scrolls or focuses. (Main returns `fail('Incorrect password')`, `ipc/ipc-auth.ts:211-213`; check that `safeInvoke` passes it through unchanged. If `friendlyError` rewrites it, the `wrong` test at `:137` fails and the generic text shows, still at the top.)
- `shared/SecuritySummaryDialog.tsx:20-42`: line 28 "Backups are encrypted too…", line 37 "What stays the agency's responsibility", line 39 "Where backups, exported PDFs/CSVs and saved copies of attached files are kept (these are not encrypted)", line 42 HHS / business associate / BAA. Only HIPAA is mentioned. There's a Copy button and no Print.
- `settings/BackupSection.tsx:137`, `SecuritySection.tsx:71`, `DataSection.tsx:107`: "Backup saved." with no path, though the save dialog returned one.
- `views/LockScreenView.tsx:349`: "Enter the 28-character recovery key you saved during setup." The partial-key and wrong-key messages are the same.
- `settings/FeaturesSection.tsx:60` prints `{group}`, the raw `FeatureGroup` ("Records", "Notes & activity", …) from `shared/features.ts:38-60`.
- `settings/ProfileSection.tsx:30-31`: placeholders "Community Services Agency", "jane.smith@agency.org".
- `main/starters.ts:247`: the setup-file description "No records or notes are included."
- `shared/CellHistoryPopover.tsx`: dates printed as stored (ISO).
- `main/backup.ts:967`, `:1009`: restore replaces the database file. The change-history PDF (`main/export-audit.ts:85-117`) reads rows, cell_history, case_log, case_log_edits, checklist_items and record_link_history, with no restore events.
- `main/backup.ts:359`: `appVersion: app.getVersion()`. "0.0" is most likely the e2e launch (an unpackaged `electron` run reporting a placeholder), not a packaged build.

## The change

### 1. Change password says what's wrong, where it's wrong

- `SecuritySection.tsx`: render `pwError` **under the field it's about** (current / new / confirm; the general case goes above the Save button, next to where the person is looking). The field gets the red border class used by `fieldErrorProps`. The current-password case focuses the field, selects its text and `scrollIntoView({ block: 'center' })`.
- Make sure the message comes through: log `res.error` in the test and assert the "incorrect" branch for main's exact text. If `safeInvoke` maps it, match on an error code (main can return `fail(msg, 'WRONG_PASSWORD')` if `fail` takes a code; check `ipc-utils.ts`), not the English string.
- Lockout ("Too many failed attempts…") shows under the current field too, with the wait time.

### 2. The security summary fits any organisation, and is consistent

`SecuritySummaryDialog.tsx`, the text block `:20-42`:
- "What stays the agency's responsibility" → "**What stays your organization's job**". When Settings → Profile has an organisation name, use it ("What stays Lincoln Elementary District's job").
- Backups, one consistent rule: "**Backups Pulse makes are encrypted** with the same key and can be restored on a replacement computer with the password or recovery key." Under the organisation's job: "Where **exported PDFs and CSVs**, and saved copies of attached files, are kept (**these are not encrypted**)." Backups come out of that list.
- Regulations, one neutral paragraph that names both: "Health and social-care settings (HIPAA): BaringaSoft never receives the data Pulse stores, so under HHS guidance it isn't a business associate and a BAA generally isn't needed. Schools (FERPA): student records stay on the district's own computer and aren't disclosed to BaringaSoft or anyone else by Pulse. Your compliance office makes the final call." **The owner must approve this wording** (README decision); until then the agent writes it behind a constant `REGULATION_TEXT` with a test that it mentions both and claims nothing more.
- A **Print** button next to "Copy for my supervisor": prints the summary as one page through the same hidden-iframe `print()` the recovery card uses (find it with `grep -rn "Print a recovery card" src/renderer`), at 12 pt black.
- The vocabulary tokens already in the text (`{record:many}`) stay.

### 3. Say where things went; recovery keys; the change history

- **Backup location**: the three "Backup saved." toasts become "Backup saved to {folder name} · Show" (the folder's last segment, with the full path in the tooltip). **Show** reveals the file in the system file manager through an existing channel, if one exists (`grep -rn "showItemInFolder" src/main`). If none exists, add `APP_SHOW_IN_FOLDER (path)` with `assertSafePath` and the "path came from our own save dialog" rule. Built with `/ipc-channel`; `/security-review` that step.
- **Recovery wording** (`LockScreenView.tsx:349`): "Enter your 28-character recovery key (from the card or note you saved)." A key shorter than 28 characters after normalising: "That key is too short. It has 28 letters and numbers, in 7 groups of 4." Don't change the matching itself.
- **After a recovery-key reset**: the Security checkup shows "Your recovery key was used. Make a new one, so a lost password can be recovered again." with **Make a new recovery key**. Find the state that marks it used: the recovery flow in `ipc-auth.ts` / `auth.ts`. If there's no stored "used" flag, read it from the existing key metadata. Only if neither exists, add a `recovery_used_at` value to the auth electron-store through `private-files.ts`. No database change.
- **Restore leaves a trace**: after a successful restore, before restart, `backup.ts` writes (into the restored database, once it's open after restart, through a pending marker in the private auth store) a `settings` row `restore_history` (a JSON array of `{ restoredAt, backupMadeAt, appVersion }`, capped at 50). `export-audit.ts` (Change history PDF) prints a "Data restored" section from it, and the record page's change history is untouched. This is in the backup path, so run the `/backup-integrity` skill on this commit. If it gets complicated, ship everything else and report this step as skipped.
- **"Made by Pulse 0.0"**: check in a packaged build (`npm run build` + the AppImage, or `app.getVersion()` under `electron .`). If it's only the e2e launch, add a test note to the harness and change nothing. If it's real, read the version from `package.json` at build time.
- **Cell history dates** (`CellHistoryPopover.tsx`): date values shown with `shortDate` / the grid's date format, the same as the cell.

### 4. Leftover words

- `features.ts`: keep the `FeatureGroup` keys, and add `FEATURE_GROUP_LABEL: Record<FeatureGroup, string>` = { Records: '{Record:many}', 'Notes & activity': '{Activity:many} and activity', Planning: 'Planning', Reports: 'Reports' } (with `as const` lists if the union is built from one). `FeaturesSection.tsx:60` renders `f(FEATURE_GROUP_LABEL[group])`.
- `ProfileSection.tsx:30-31`: placeholders "Your organization", "name@example.org".
- `main/starters.ts:247`: "Lists, columns and deadline rules shared on {date}. No {record:many} or {activity:many} are included." via `word()` (it's in main; `vocab.ts` must not be imported from anything `database.ts` imports, and `starters.ts` already uses `word`; check `tests/vocab-import-graph.test.ts`).

## Files owned

- `src/renderer/components/settings/SecuritySection.tsx`, `BackupSection.tsx` (toast only), `DataSection.tsx` (toast only), `ProfileSection.tsx`, `FeaturesSection.tsx`
- `src/renderer/components/shared/SecuritySummaryDialog.tsx`, `src/renderer/components/shared/CellHistoryPopover.tsx`
- `src/renderer/views/LockScreenView.tsx` (recovery wording and the short-key message)
- `src/shared/features.ts` (the group label map)
- `src/main/backup.ts` (the restore marker only), `src/main/export-audit.ts` (the restores section), `src/main/starters.ts` (line 247 only; R4 owns `applyDateRules`, a different function)
- Auth: the recovery-used state, wherever it lives (`src/main/auth.ts` / `ipc/ipc-auth.ts` hunk, if needed)
- Tests: `tests/renderer/components/settings/SecuritySection.test.tsx` (wrong current password: message under the field, focus), `SecuritySummaryDialog.test.tsx` (no "agency", both regulations, one backup rule, Print button), `tests/backup*.test.ts` (restore writes history), `tests/export-audit.test.ts`, `tests/renderer/vocabStaticText.test.tsx`, `tests/vocab-leak-main.test.ts`, `LockScreenView` tests.

**Shared hunks:** `src/shared/ipc-channels.ts` / `ipc-contract.ts` append-only (`APP_SHOW_IN_FOLDER` if added). `src/main/starters.ts` (one line, see above).

## Commit steps

`npm run gate` before every commit.

1. **Change password message.** Tests: wrong current → the message under Current password, the field focused, `aria-invalid`, the red border; lockout text the same; a correct change unchanged.
2. **Security summary.** The wording constants, organisation name, one backup rule, the regulation paragraph (pending the owner's OK), Print. Tests as listed.
3. **Where things went; recovery.** Backup toasts with the folder and Show; recovery wording and the short-key message; the used-key nudge. Tests for each; `/security-review` if a channel is added.
4. **Restore in the change history.** Marker → `restore_history` → audit PDF section. `/backup-integrity`. Tests: restore round trip writes one entry; the PDF lists it; nothing else in the restored data changes.
5. **Leftover words and cell-history dates.** Tests: with student words, the features heading reads "Students"; profile placeholders; the setup-file description; cell history shows 10/30/2025.
6. **"Pulse 0.0" check** (a note or a fix), the Decision Log row, screenshots.

## Acceptance

- **Karen's spec as regression** (`persona-karen.spec.ts`; copy the harness):
  - `k14`, `k15`: a wrong current password shows "Your current password is incorrect." directly under the field, in view, with the field focused (was nothing in `15b-wrong-2500.png`).
  - `k13`: a partial key gets "too short"; the screen doesn't say "during setup".
  - `k23`: "Backup saved to USB · Show".
  - `k31`: after the restore, the Change history PDF has a "Data restored" line.
  - `k18`: the features heading says "Students".
  - The security summary step (`k4x`): no "agency"; FERPA and HIPAA both named; backups encrypted, exports not, with no contradiction; a Print button.
  - `k28`: cell history in 10/30/2025 form.
- **Bobby** (`bobby resume`): Help → Security and privacy summary has a Print button.
- Screenshots (`shotter('R9')`, light and dark): `R9/wrong-current.{light,dark}.png`, `R9/security-summary.light.png`, `R9/backup-saved-where.light.png`, `R9/recovery-used-nudge.light.png`.
- `npm run gate` green. No migration (settings rows and the auth store only), no network call. Vocabulary layer for every record word; the regulation names are proper nouns.

## Risks

- **Legal wording**: the FERPA line makes a claim (no disclosure to BaringaSoft). It's true of the software's behaviour (no network calls besides the update check), but it's the owner's statement to make. Owner decision; keep it factual and keep "your compliance office makes the final call".
- **The restore marker** touches the backup path, the most safety-critical code in the app. It's isolated behind a marker and written only after the restored database opens; skippable.
- **"Show in folder"** opens the OS file manager on a path Pulse itself chose in a save dialog. Validate it, and never accept a renderer-built path.

## Decision Log row

`| 2026-10-xx | The security summary is worded for any organisation (no "agency"), names HIPAA and FERPA side by side, and says one thing about backups (Pulse's backups are encrypted; exports aren't); it can be printed. Restores are recorded (settings restore_history) and listed in the Change history PDF. Password and recovery messages appear next to the field | 2026-10-15 persona study: a school team lead found the summary written for a health agency and self-contradictory on backups, and a wrong current password produced no visible message (Karen) |`
