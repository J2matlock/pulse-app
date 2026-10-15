# R2 — Notes and forms survive closing, crashes and locks; note entry is quick and sure

Phase 3 polish, Wave 1, merge slot 2 (commit 6 waits for R1, see below). Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows D3, D4, #7, #13 (Ctrl+Enter), #23 and #24.

## Goal

A half-written note is never lost: not to a lock, not to the window's X, not to a dead battery. The data-entry forms Candy uses (the appointment form, "Add contact info") come back after a lock exactly as she left them. Snippets show what they'll insert and go in with Enter. Saving a note is unmistakable. Ctrl+Enter works from anywhere in the note form.

## Personas and findings

- **Candy** (D3, her worst finding): a half-written visit note on Odette, then the window's X, and it's gone on reopen. There was no warning (`persona-candy/54-before-battery-dies.png` → `57-visit-note-after-restart.png`, `111-after-reopen.png`). "That is *exactly* how I lost Mr. Thibodeaux's last visit."
- **Candy** (D4): the appointment form was wiped by a lock (`64-appt-filled.png` → `66-dialog-after-unlock.png`), and so was a half-typed phone number under "Add contact info" (`52-contact-info.png` → `53-contact-after-unlock.png`).
- **Candy** (#7): the snippet popup was clipped above the card, showing only "Tab inserts · …" (`95-snippet-popup.png`, `95b-popup-again.png`). Enter made a new line. "/" with no snippets showed nothing (`46-slash-snippet.png`).
- **Candy** (#23): Ctrl+Enter just cleared the box, with no sign it saved (`48-note-saved.png`). There was no sign a record had an unsent draft (`100-left-midnote.png`).
- **Candy** (#24): Weekly repeat showed no day lit (`68-weekly-days.png`).
- **Mark** (#13): "Ctrl+Enter saves" did nothing from the Hours box (`persona-mark/142-shift-note-saved.png`). The When date's digits went into the calendar icon and the note saved as today (`155-when-filled.png`). Focus vanished after Add.
- **Joe** (praise to keep): the case note kept its text on Esc (`persona-joe/p10-08-case-note-after-esc.png`).

## Current behaviour

- `utils/noteDrafts.ts:6-8,22`: drafts are a module-level `Map`, memory only, on purpose ("localStorage … written to disk unencrypted"). They survive a lock because the module survives, but not a quit or a crash. `clearAllNoteDrafts` (`:38`) is never called.
- `profile/CaseLog.tsx:160-206`: the composer restores from `getNoteDraft(rowId)` and writes back with `setNoteDraft` on change (`:206`).
- `main/index.ts:248-263`: closing the window flushes pending *cell* edits through `APP_FLUSH_PENDING` (renderer side `hooks/useAutoLock.ts:97-104`, `flushPendingEdits()`), then closes. Drafts aren't part of that.
- `App.tsx:149`: while locked only `LockScreenView` renders, so every open dialog and inline form unmounts. `calendar/AppointmentDialog.tsx:60-85` and `profile/ProfileHeader.tsx:118-124` (`showAddContact`, `newContactType`, value) keep everything in `useState`.
- Snippets in the note box: `CaseLog.tsx:700-701` draws the list `absolute left-0 bottom-full` inside the card, so the card clips it. `:341`: Enter inserts only after an arrow key moved the highlight (`selectedIndex` starts at -1, `:217`, `:226`). The menu renders only when `items.length > 0`. `ScratchPad.tsx:64-65` already positions its own menu from the caret (`snippetMenuPos`). There are two copies of the same idea.
- Ctrl+Enter: handled on the textarea (`CaseLog.tsx:354`) and on structured fields (`:666`), not on the Minutes, Miles, measures or When inputs.
- After `handleAdd` (`:378`) the box clears, and the new entry is further down the page, out of view. No status is announced.
- `AppointmentDialog.tsx:74`: `byDay` starts `[]` for a new weekly rule; the schedule uses the date's weekday, but no day button shows as pressed.

## The change

### 1. Note drafts in the encrypted database (no migration)

- **Storage**: the encrypted `settings` table (it exists, `001_initial_schema.ts:261`), one row per record, key `note_draft:<rowId>`, value = the `NoteDraft` JSON plus `savedAt`. This is the same database file as everything else, so it's encrypted at rest, goes into backups, and nothing touches the disk unencrypted. No schema change.
- **Main**: new `src/main/note-drafts.ts` with `getDraft(rowId)`, `putDraft(rowId, draft)` (an empty draft deletes the row), `listDrafts()` (rowId, record name, savedAt for **live rows only**, using `liveRow('r')` from `shared/liveRecords.ts`), and `deleteDraftsFor(rowIds)`. A size cap of 200 KB per draft, the same as a note.
- **IPC** (via the `/ipc-channel` skill; `defineHandler`, `idArg`, `schemaArg` with a zod `NoteDraft` schema using `textLength`, `{ write: true }` for put/delete): `NOTE_DRAFT_GET (rowId)`, `NOTE_DRAFT_PUT (rowId, draft)`, `NOTE_DRAFT_LIST ()`. New file `src/main/ipc/ipc-drafts.ts`, registered in `ipc-handlers.ts`.
- **Keep drafts out of the settings store**: `ipc/ipc-settings.ts` `SETTINGS_GET_ALL` (`:49-54`) skips keys starting `note_draft:`. `SETTINGS_UPDATE`'s allow-list already refuses them (`:42-43`), so the renderer can't write them by that route.
- **Renderer** `utils/noteDrafts.ts` keeps its API, but writes through: an in-memory cache (instant, as today) plus `NOTE_DRAFT_PUT` debounced at 600 ms, flushed at once by `flushNoteDrafts()`. `getNoteDraft` reads the cache. On a cache miss, `loadNoteDraft(rowId)` asks main, and the composer restores when it answers, unless the person has started typing.
- **Flush points**: `useAutoLock.ts`'s `APP_FLUSH_PENDING` handler calls `flushNoteDrafts()` next to `flushPendingEdits()` (one line). Check whether a lock started in the renderer (Ctrl+L, the sidebar Lock, auto-lock) goes through `APP_FLUSH_PENDING`. If it doesn't, call `flushNoteDrafts()` in that lock action too (one line in `settingsStore.ts`), and add a `beforeunload` flush. That covers the window's X (main already waits for the flush, `index.ts:258-262`), a forced lock and a quit. A dead battery loses at most the last 600 ms.
- **A sent note deletes its draft** (already true through `setNoteDraft` with an empty draft, now also in the database).
- **Trash and Empty Trash**: a draft for a trashed record is hidden (`listDrafts` and `getDraft` use `liveRow`) and comes back if the record is restored. A purge doesn't need a hook. There are four purge paths (`ipc/ipc-row.ts:343,372,386` and the 30-day sweep, `database.ts:313`), so don't touch them. Instead, `listDrafts()` first deletes orphans: `DELETE FROM settings WHERE key LIKE 'note_draft:%' AND CAST(substr(key, 12) AS INTEGER) NOT IN (SELECT id FROM rows)`. Add `note_draft` to `tests/soft-delete-invariant.test.ts` (read path), and add a test that a purged record's draft is gone after the next list.
- **No close prompt.** With the draft persisted, closing loses nothing, so Pulse doesn't ask "Are you sure?". That matches the app's undo-not-confirm direction, and the owner can overrule (README).

### 2. "Your unsent note is waiting"

- New `components/shared/UnsentNotesNotice.tsx`, mounted once in `App.tsx` next to the toast host (one line). After unlock (and at launch-unlock) it calls `NOTE_DRAFT_LIST`. If there's at least one draft, it shows one `ToastHost` notice: "You have an unsent {activity} for Odette Guidry · Open" (for several: "…for 2 {record:many} · Show"). **Open** goes to that record's page with the composer open. **Show** opens a small list (a `Dialog`) of records with drafts.
- The record page header shows a small "Unsent {activity}" chip (pencil icon + words) while a draft exists for it: `ProfileHeader.tsx`, a hunk next to the name. It's a 44 px button that scrolls to the composer.
- Words through `useVocab` (`{activity}`, `{record:many}`).

### 3. Forms that survive a lock (memory only, like note drafts were)

- New `utils/formDrafts.ts`: `Map<string, unknown>` keyed by form id (`appointment:new:<rowId|none>:<date>`, `appointment:edit:<id>`, `contact-info:<rowId>`), plus `openAfterUnlock: string | null`. Memory only: these aren't case notes, and they matter across a lock, not a quit. A quit loses them, which the risks section accepts.
- New `hooks/useLockSafeDraft.ts`: `useLockSafeDraft(key, initial)` → `[value, setValue, clear]`, which mirrors state into `formDrafts` on change.
- `AppointmentDialog.tsx`: group its 15 `useState` fields into one draft object through `useLockSafeDraft`. When it unmounts because of a lock (`useSettingsStore.getState().isLocked` at unmount), set `openAfterUnlock = key`. `CalendarView` and `ProfileView` already decide whether the dialog is open. Rather than editing those, the dialog's opener (`components/calendar/useAppointmentDialog` if it exists; otherwise a tiny `AppointmentDialogHost` mounted in `App.tsx` beside the unsent notice) reopens it from `openAfterUnlock` with "We kept the {appointment} you were adding." as its description line. Save or Cancel clears the draft.
- `ProfileHeader.tsx` "Add contact info": `showAddContact`, the type, label and value go through `useLockSafeDraft('contact-info:<rowId>')`, so the inline form is open and filled after unlock.
- A test lists which dialogs are lock-safe (appointment, contact info, the note composer). Others (task form, checklist add) are named in README "later".

### 4. One snippet menu, visible, Enter inserts

- New `components/profile/SnippetMenu.tsx`: portalled to `document.body` on the popover layer (`ui/layers.ts`), placed under the caret using ScratchPad's caret maths (`ScratchPad.tsx:65`, move that helper into the component), flipping above when there's no room. 15 px text, 44 px rows.
- **Enter inserts the highlighted item**, and the first item is highlighted as soon as the menu opens (`selectedIndex` starts at 0). Shift+Enter makes a new line. Tab inserts (as now), Esc closes. The footer reads "Enter or Tab inserts · ↑↓ picks another · Esc closes".
- **No snippets yet**: "/" followed by a letter, with snippets on and the library empty, shows one row, "No snippets yet. Make one…", which opens the Snippets page in a new route. Shown once per session, so it doesn't nag.
- `CaseLog.tsx` and `ScratchPad.tsx` both use `SnippetMenu`; delete the two inline copies.

### 5. Saving a note is unmistakable; Ctrl+Enter everywhere

- Ctrl+Enter (`isMod`) is handled on the composer's `<form>` (capture), so it works from Minutes, Miles, measures, When and follow-up, as the hint promises.
- After `handleAdd` succeeds: announce "{Activity} saved" in a `role="status"` region, flash the new entry (Q6's row flash class) and `scrollIntoView({ block: 'nearest' })`. Focus goes to the composer's first kind chip, not the body, which fixes Mark's "my place disappears".
- After Ctrl+Enter, a `ToastHost` success "{Activity} saved for {name}" for 3 s, plain and no Undo. Deleting a note within the window already has Undo.

### 6. Dates in this plan's files use R1's DateField (after R1 merges)

`CaseLog.tsx`'s "When" field and `AppointmentDialog.tsx`'s Date and "Ends on" fields switch to `<DateField size="field">`, and the R1 ratchet baseline goes down by 3. **Do this commit only once R1 is on main**: rebase first. If R1 isn't merged when the rest is done, stop after commit 5 and say so in the final report; the orchestrator runs commit 6 after merging R1.

### 7. Weekly repeat shows its day

`AppointmentDialog.tsx`: when `repeat === 'weekly'` and `byDay` is empty, the date's weekday button shows as pressed (`aria-pressed`) and is saved explicitly when the person clicks Schedule. Changing the date while only that implied day is selected moves the highlight.

## Files owned

- `src/renderer/utils/noteDrafts.ts`, `src/renderer/utils/formDrafts.ts` (new), `src/renderer/hooks/useLockSafeDraft.ts` (new)
- `src/renderer/components/profile/CaseLog.tsx`, `src/renderer/components/profile/ScratchPad.tsx`, `src/renderer/components/profile/SnippetMenu.tsx` (new)
- `src/renderer/components/calendar/AppointmentDialog.tsx`
- `src/renderer/components/profile/ProfileHeader.tsx` (contact-info form + unsent chip hunks)
- `src/renderer/components/shared/UnsentNotesNotice.tsx` (new), and `AppointmentDialogHost.tsx` (new) if needed
- `src/renderer/hooks/useAutoLock.ts` (one line in the flush handler)
- Main: `src/main/note-drafts.ts` (new), `src/main/ipc/ipc-drafts.ts` (new), `src/main/ipc/ipc-settings.ts` (the `SETTINGS_GET_ALL` filter). The purge paths aren't touched (orphans are swept on list).
- Tests: `tests/note-drafts.test.ts` (main), `tests/renderer/utils/noteDrafts.test.ts`, `tests/renderer/components/profile/SnippetMenu.test.tsx`, `tests/renderer/hooks/useLockSafeDraft.test.tsx`, the CaseLog, ScratchPad and AppointmentDialog tests, `tests/soft-delete-invariant.test.ts` (append).

**Shared, append-only or one line:** `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc-handlers.ts` (R3 and R7 also append); `src/renderer/App.tsx` (one mount line; R3 adds its own one line); `src/renderer/views/help/faqData.tsx` (one answer: "What happens to a note I haven't saved?").

## Commit steps

`npm run gate` before every commit.

1. **Drafts in the database.** `note-drafts.ts`, `ipc-drafts.ts`, the channels and contract, the `SETTINGS_GET_ALL` filter, the orphan sweep, `noteDrafts.ts` write-through and flush, the `useAutoLock` line. Tests: put/get/delete round trip; an empty draft deletes; a trashed record's draft is hidden from `listDrafts` and back after restore; a purged record's draft is swept; `SETTINGS_GET_ALL` never returns `note_draft:` keys; the size cap; `ipc-consistency` green. Run `/security-review` on this step (a new write path from the renderer).
2. **Unsent-note notice and chip.** `UnsentNotesNotice`, the App mount, the ProfileHeader chip, the FAQ answer. Tests: a notice after unlock when a draft exists, Open navigates with the composer open; no notice when none exists.
3. **Lock-safe forms.** `formDrafts`, `useLockSafeDraft`, AppointmentDialog and contact info. Tests: fill the appointment form, simulate lock (unmount with `isLocked` true) and unlock → the dialog reopens with every field; Cancel clears; the contact-info form is the same.
4. **SnippetMenu.** The shared component, Enter inserts, the empty state, both call sites. Tests: Enter inserts the first match without an arrow key; Shift+Enter is a newline; the empty state appears once; the menu is portalled (not inside the card).
5. **Saving feedback and Ctrl+Enter.** The form-level handler, status, scroll and flash, focus to the first chip, the weekly-day highlight. Tests: Ctrl+Enter from Minutes saves; after save, focus is on a chip and the status text is present.
6. **DateField adoption** (after R1 merges): the When and appointment dates; lower the `rawDateInputs` baseline.
7. **Decision Log row, screenshots.**

## Acceptance

- **Candy's spec as regression** (`e2e/ux-review/persona-candy.spec.ts`; copy the git-excluded harness into the worktree):
  - `candy 11: close the window with a note unsent`: on relaunch and unlock the notice "You have an unsent visit note for Odette Guidry" appears, and Open shows the text, minutes and miles intact (it was empty in `111-after-reopen.png`).
  - `candy 10`: the same after "close the lid". The spec closes the app; a hard kill of the Electron process, added to `R2.spec.ts`, must lose at most the last 600 ms.
  - `candy 5: interruptions`: the lock keeps the note (unchanged), the contact-info form is open and filled after unlock (`53-contact-after-unlock.png` was empty).
  - `candy 6`: the appointment form is back after a lock with every field (`66-dialog-after-unlock.png` was empty), and Weekly shows Tuesday pressed.
  - `candy 9`: typing "/ed" shows the full snippet row below the caret, and **Enter** inserts it.
- **Mark** (new `e2e/ux-review/R2.spec.ts`, keyboard only): Ctrl+Enter from Hours saves; focus is on a kind chip afterwards (`document.activeElement` isn't the body).
- **Joe**: Esc in the composer still keeps the text (regression of a praise).
- `R2.spec.ts` screenshots (`shotter('R2')`, light and dark, 1280×720 for Candy): `R2/unsent-notice.dark.png`, `R2/appointment-after-unlock.dark.png`, `R2/snippet-menu.dark.png`, `R2/note-saved.dark.png`.
- Unit tests above. `npm run gate` green; `npm run test:tz` (`savedAt` and the When date).
- No migration (the `settings` table exists). No network call. Drafts never go to localStorage, sessionStorage or electron-store (a test greps `noteDrafts.ts` and `formDrafts.ts` for `localStorage|sessionStorage|electron-store`).

## Risks

- **Write rate**: one debounced write per 600 ms of typing, a single-row upsert into a 2-column table. That's negligible next to cell edits. Check that the autosave doesn't put "Saved" in the status footer for every keystroke (it shouldn't: the footer belongs to cell saves).
- **Drafts in backups**: drafts are case-note text in the encrypted database and its encrypted backups, the same protection as notes. A restore brings back the drafts that existed then. Say so in the FAQ answer.
- **A key-switch re-encrypt** (`key-switch.ts`) rekeys the whole database, drafts included. Nothing extra to do.
- **Forms across a quit** aren't kept (memory only). Candy's loss was across a lock; the note, the thing she can't reconstruct, is kept across anything.
- **Two windows**: Pulse has one window; no conflict handling is needed.
- **Enter inserting a snippet** could surprise someone who types "/word" and wants a newline. The menu shows only when a snippet matches, and Shift+Enter or Esc gets out. Owner decision listed.
- **Overlaps**: `App.tsx` (R3's one line), the IPC files (append-only), `faqData.tsx`. R5 must not touch `CaseLog.tsx`; Mark's note-form fixes live here.

## Decision Log row

`| 2026-10-xx | Unsent note drafts are kept in the encrypted database (settings rows note_draft:<rowId>, hidden from the settings store) and written as you type, so they survive a quit, a crash and a lock; the next unlock says which records have one. Closing with a draft doesn't ask (nothing is lost). The appointment and contact-info forms survive a lock (memory only). Enter inserts the highlighted snippet | 2026-10-15 persona study: a home-health nurse lost a half-written visit note by closing the window, and the appointment form vanished on lock (Candy). Drafts stay out of localStorage/electron-store on purpose (unencrypted) |`
