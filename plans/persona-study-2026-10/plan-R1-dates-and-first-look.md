# R1 — A typed date is never silently changed or lost; a welcome box never changes data

Phase 3 polish, Wave 1, merge slot 1. Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows D1, D2, D5 and #22 first.

## Goal

When someone types a date that isn't complete or doesn't exist, Pulse stops them and says so, and the old value stays. It never saves an empty value unless the person cleared the box on purpose, and never rewrites what they typed into some other real date without showing it. A two-digit year means 20xx. Esc in a cell still cancels, but what was thrown away can be put back. The first look's **Done** never touches a real record.

## Personas and findings

- **Karen** (D1, her worst finding and her "probation" condition): typing 02/30/2026 over an IEP date of 10/30/2025 left "—" with the footer saying "Saved" (`persona-karen/26a-feb30-typed.png`, `26b-feb30-after.png`). 31/13/2026 became 03/11/2026 (`24b-bad-date.png`, `25-1b-typed.png`).
- **Joe** (D1): 7/15/26 showed as 07/15/0026, and Enter left the cell blank with no message (`persona-joe/p2-10-date-typed.png`, `p2-11-date-entered.png`). (D5) Esc in the Parents cell threw away "Karl & Jean Bergstrom", and Undo had nothing (`p10-01-typed-parents.png`, `p10-03-after-undo.png`).
- **Bobby** (D1): the checklist "Add with details…" Due date he typed was saved as no date (`persona-bobby/r-28-checklist-details.png` → `r-29-checklist-added.png`).
- **Linda** (D2): the first look's Done wrote today's date into Melissa Ortiz's Last Contact, a contact that never happened (`persona-linda/20-first-grid.png`, `21-after-firstlook-done.png`). (#22) Clicking her long Notes value on the record page selected all of it, ready to type over (`69-notes-clicked.png`).
- **Mark** (D1, partly): the note's When date saved as today when his digits went into the calendar icon. The CaseLog field belongs to R2, which uses this plan's `DateField`.

## Current behaviour

- **The cause of D1.** Chromium's `<input type="date">` reports `value === ''` while the date is partial or impossible (`validity.badInput === true`), and it moves between segments on its own, so "31" in the month segment becomes 03 plus a day digit.
  - `CellEditor.tsx:150` copies that `''` into `localValue`. Enter, Tab and blur then save `null` (`:98`, `:102`, `:152`), which clears the stored date.
  - `:57-60` handles only the 0026 case: `toYmd(val) !== val` cancels quietly, so a blank cell stays blank with no message.
  - `:150` takes whatever the segment logic produced (03/11 for 31/13) and nothing shows the person what was stored.
- `ChecklistAddDialog.tsx:20,36,106-108`: `due_date: dueDate || null`, the same silent drop. `ChecklistItem.tsx`'s "Add date" has the same pattern.
- There are 33 raw `type="date"` inputs in 24 renderer files and no shared date field (`grep -rln 'type="date"' src/renderer`). This plan converts the data-entry ones it owns; the rest go through a ratchet.
- `ymd.ts:6-21`: `MIN_YEAR = 1900`, and `toYmd` rejects impossible dates. Nothing normalises a two-digit year.
- **D5:** `CellEditor.tsx:92-95`. Escape calls `onCancel()`, and the typed text is gone with no trace. The hint says "Escape cancels." (`:89`).
- **#22:** `CellEditor.tsx:77-78` runs `el.select()` on open for every text-like kind, notes and address included. The record page edits through the same component (`profile/GridDataSummary.tsx`).
- **D2:** `onboarding/FirstLook.tsx:75` scores sample rows +1, but falls back to the person's own records (an imported list has no samples). `:273-277` then shows **Done**, which calls `completeDeadlines` (`:203-223`). The text at `:34` tells the person to click Done "when you've seen them".

## The change

### 1. `components/ui/DateField.tsx` (new, shared)

A controlled date field for every data-entry place:
- Props: `value: string | null` (YYYY-MM-DD), `onCommit(value: string | null)`, `onInvalid?(message)`, `label` / `aria-label`, `id`, `min`/`max` (default `MIN_YEAR`/`MAX_YEAR`), `size` (`cell` | `field`), `autoFocus`, `allowClear` (default true), and the usual input props.
- It wraps the native input, so it keeps the calendar picker and the mm/dd/yyyy segments people already know, and adds four things:
  1. **Partial or impossible input is refused.** On commit (Enter, Tab, blur), `inputRef.current.validity.badInput` or a `toYmd` failure → don't call `onCommit`. Show the inline message "That isn't a whole date. Check the month, day and year." under the field (`role="alert"`, 15 px, red-700 / red-300 in dark), keep focus in the field, and leave the stored value as it was.
  2. **Two-digit years.** On change, a value whose year is 0001–0099 becomes 20yy (00–79 → 2000–2079, 80–99 → 1980–1999, so a birth year of 54 means 1954). The field shows the corrected year at once, and the inline note "Read as 2026" stays until the next commit.
  3. **Clearing is deliberate.** An empty commit counts only when the person emptied the box: the input had a value at focus time, `badInput` is false, and the value is ''. Delete/Backspace through every segment, or the existing "Clear" control. A commit while `badInput` is true is never a clear.
  4. **What was stored is visible.** Under a `cell`-size field, a one-line echo in words appears as soon as the value is complete ("Wed, Mar 11, 2026"), so 31/13 → 03/11 is seen before Enter. The echo uses `shortDate` from `src/shared/dates.ts` plus the weekday.
- Shared helpers go in `src/shared/ymd.ts`, with tests: `normalizeTwoDigitYear(ymd)` and `isCompleteDate(value, badInput)`.
- Focus ring 3 px; 44 px height at `field` size; 15 px text. On Shift+Tab into the field, select the month segment (this is Chromium's default when focus enters the input; just don't steal it). Give the calendar-icon button an `aria-label` ("Open calendar").

### 2. The grid and record-page cell editor (`CellEditor.tsx`)

- The `date` case renders `<DateField size="cell">`. Enter or Tab with an invalid value keeps the editor open with the message. Blur with an invalid value cancels (the old value stays) and toasts "That date wasn't saved. It isn't a whole date." (`ToastHost`, not a new toaster). Delete `guardedSave`'s date branch (`:56-60`); `DateField` owns that now.
- **Esc with changed text** (text, notes, address, phone, email, url, number): still cancels, but calls a new optional prop `onDiscard?(typed: string)` when the typed value is non-empty and differs from `value`. `SortableRow.tsx` and `GridDataSummary.tsx` pass `onDiscard` → `useUndoStore.getState().pushWithToast({ id, description: 'Not saved in <column>: "<first 40 chars>"', category, icon, contextLabel: <record name>, contextId: rowId, undo: () => updateCell(rowId, colId, typed), redo: () => updateCell(rowId, colId, old) })` (`UndoItem`, `undoStore.ts:51-62`). Here "undo" means *put the typing back*: the toast's existing Undo button does it. Don't add a second button; `ToastAction` (`:67`) is for Archive's reason. It's a real step, so Ctrl+Z and the history panel work too, and Joe's "No actions to undo" is gone. Dates are excluded (their old value is never lost now).
- **Notes and address**: on open, put the caret at the end (`setSelectionRange(len, len)`) instead of `select()`.
- Update the hint (`:89`): "Enter saves. Escape cancels; you can put it back."

### 3. Other date entry this plan owns

`ChecklistAddDialog.tsx` (Due date), `ChecklistItem.tsx` (Add date / change date), `views/dashboard/DoneOnDayDialog.tsx`, `ExtendDeadlineDialog.tsx`, `OneOffDoneDialog.tsx` and `MeterReadingDialog.tsx` (each has one date): switch to `DateField size="field"`. Each dialog's primary button stays disabled, with the inline message, while the date is partial. In `ChecklistAddDialog`, **Add item** with a partial date is refused with the message and saves nothing (Bobby's fix: never save the item without the date he typed).

### 4. Ratchet: raw date inputs only go down

New `tests/renderer/rawDateInputs.test.ts`: counts `type="date"` across `src/renderer/**/*.tsx`, excluding `ui/DateField.tsx`, and fails if the count is above the baseline written in the test (33 minus the conversions above). The message: "Use <DateField> from components/ui (plans/persona-study-2026-10/plan-R1-dates-and-first-look.md)". Other plans convert their own files later (R2 converts CaseLog's When and AppointmentDialog).

### 5. First look: Done only on samples (`FirstLook.tsx`)

- `pickLateCell`: keep picking a late cell from any row, since the colour lesson is the same. `doneable` additionally requires `sampleRows[row.row_id] !== undefined`.
- **Real record** (any imported or typed row): the card says "{name}'s {column} is red. Red means overdue.", then a second line, "When it's really done, click its date and choose Done.", and one button, **Got it**. Nothing is written.
- **Sample record**: the button label becomes **Mark it done** (not "Done", the word Linda read as "I've read this"), next to **Close**. The text becomes `Red means overdue. This one is made up, so try "Mark it done".` Behaviour is unchanged otherwise (the colour change and the Undo toast are the lesson).
- `FIRST_LOOK_TEXT` keeps every string, so the vocabulary and sentence-case tests can read them. Add `realRecord` and `sampleTry`.

## Files owned

- `src/renderer/components/ui/DateField.tsx` (new)
- `src/shared/ymd.ts` (two helpers appended)
- `src/renderer/components/grid/CellEditor.tsx`
- `src/renderer/components/profile/GridDataSummary.tsx` (the `onDiscard` wiring only)
- `src/renderer/components/profile/ChecklistAddDialog.tsx`, `src/renderer/components/profile/ChecklistItem.tsx`
- `src/renderer/views/dashboard/DoneOnDayDialog.tsx`, `ExtendDeadlineDialog.tsx`, `OneOffDoneDialog.tsx`, `MeterReadingDialog.tsx`
- `src/renderer/components/onboarding/FirstLook.tsx`
- Tests: `tests/renderer/components/ui/DateField.test.tsx` (new), `tests/renderer/rawDateInputs.test.ts` (new), `tests/ymd.test.ts` (extend), and the existing CellEditor, FirstLook, ChecklistAddDialog and dashboard-dialog tests.

**Shared hunk:** `src/renderer/components/grid/SortableRow.tsx`, only the `<CellEditor … />` props block (`:461-496`): add `onDiscard`. R5 owns the rest of SortableRow and merges after R1.

Not touched: `DeadlinePanel.tsx` (R4), `CaseLog.tsx` and `AppointmentDialog.tsx` (R2), the other raw date inputs (ratchet).

## Commit steps

`npm run gate` before every commit.

1. **DateField and helpers.** `ui/DateField.tsx`, `ymd.ts` helpers, unit tests: badInput refused, 2-digit year → 20yy (and 54 → 1954), a deliberate clear allowed, a commit during badInput never clears, the echo text, 3 px ring, `aria-invalid` and `aria-describedby` on the message. Add a `designSystem.test.ts` allow-list entry if the ratchet asks for one; the count must not go up.
2. **The cell editor.** The CellEditor date case on DateField; Esc → `onDiscard` + toast; caret at the end for notes; the SortableRow and GridDataSummary `onDiscard` wiring. Tests: the Karen sequence (stored 2025-10-30, type 02/30/2026, Enter → still 2025-10-30 and the message is shown, `updateCell` not called); the Joe sequence (7/15/26 → 2026-07-15 saved); Esc with changed text pushes one undo step and Undo restores the text; notes open with no selection.
3. **Checklist and dashboard dialogs.** Five dialogs plus ChecklistItem on DateField. Tests: ChecklistAddDialog with a partial date doesn't call `onSave` and shows the message (the Bobby sequence); DoneOnDay with a partial date keeps Save disabled.
4. **The ratchet test.** `rawDateInputs.test.ts` with the new baseline.
5. **First look.** Done only on samples, the new wording, Got it on real rows. Tests: an imported list (no `sampleRows`) with a late repeating deadline → Got it only, and `completeDeadlines` never called; a sample row → "Mark it done" still completes it and pushes Undo.
6. **Decision Log row and screenshots** (below).

## Acceptance

- **Karen's spec as regression** (`e2e/ux-review/persona-karen.spec.ts`; the harness is git-excluded, so `cp -r /home/jmatlock/projects/pulse/e2e/ux-review e2e/` in the worktree). Steps `k25 bad dates` and `k26 impossible date on a filled cell` must now show the inline message, and after Enter the cell still reads 10/30/2025, with no "Saved" for that cell. Compare with the old `25-1c-after-enter.png` / `26b-feb30-after.png`. Steps `k27`–`k28` (history) must show **no** "IEP date cleared" entry.
- **Joe's spec** (`JOE_PHASE=p2`): after typing 7/15/26 and Enter, the cell shows 07/15/2026. **p10**: after Esc in Parents, a "Not saved: …" toast appears, and Undo puts the text back.
- **Bobby's spec** (`bobby resume`, or a new focused `e2e/ux-review/R1.spec.ts`): adding a checklist item with a partial date shows the message and doesn't add the item. A full date adds the item with that date.
- **Linda's spec** (`linda 1`): after import, the first look shows **Got it** and no Done. Clicking it leaves Melissa's Last Contact unchanged (compare `21-after-firstlook-done.png`: no "Marked … done" toast).
- New `e2e/ux-review/R1.spec.ts` (`openSeededApp`, `shotter('R1')`, light and dark at 1366×768): `R1/date-invalid.{light,dark}.png` (the message under a cell editor), `R1/date-echo.light.png`, `R1/esc-put-back.light.png`, `R1/first-look-real.light.png`, `R1/first-look-sample.light.png`. Assert the stored value with `ipc()` after each step.
- Unit tests above. `npm run gate` green. Run `npm run test:tz`, since dates are involved (20yy normalising must not shift a day).
- No migration, no network call. Every word is either plain app text or goes through `useVocab` (no record word hard-coded). 15 px / 44 px / 3 px.

## Risks

- **Locale.** Chromium's segment order follows the OS locale (dd/mm on some machines). `badInput` and the echo line work in any order; the message names month, day and year without assuming an order.
- **The 80/20 century split** for two-digit years: 54 → 1954 suits birth dates, 26 → 2026 suits deadlines. A year typed in full is always kept as typed. Owner decision listed in README.
- **Blur with an invalid date cancels** (it can't keep focus when the person clicked elsewhere). The toast says so; nothing that was stored is lost.
- **Esc toast noise**: only when non-empty text that differs from the stored value is discarded. A plain Esc on an unchanged cell stays silent.
- **First look on imported lists** no longer demonstrates Done. That's intended; the Done lesson stays for samples.
- The `jsxCommentText` guard test from 65e773fb applies; don't write `//` comments inside JSX text.

## Decision Log row (CLAUDE.md, step 6)

`| 2026-10-xx | Date entry goes through one DateField: partial or impossible dates are refused with a message and the old value kept; two-digit years read as 20xx (80–99 as 19xx); a date is cleared only on purpose. Esc in a cell still cancels, but changed text gets an Undo step ("Not saved: …"). The first look's Done only appears on sample records | 2026-10-15 persona study: a mistyped IEP date was erased with "Saved" (Karen), 7/15/26 left a blank (Joe), a checklist due date vanished (Bobby), and the first look marked a real contact done (Linda). tests/renderer/rawDateInputs.test.ts ratchets the remaining raw date inputs |`
