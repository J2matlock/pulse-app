# Q1a: import that just works

Phase 2, idea 1(a) ("ask fewer questions, make better guesses"). Wave B. No migration, no new IPC channel, no network.

## Goal

Choosing a spreadsheet should be the only real decision. Pulse reads the file, combines first and last names, recognises the date columns (messy ones too), guesses which dates repeat, brings the records in and turns on the colours. Then it shows **one** summary screen: "We brought in 80 clients. Last visit repeats every month, Annual review every year. Change anything?" The answers can be changed there, and two ways out stay open: "Undo this import" and "Match the columns myself…", the current step-by-step wizard.

This applies to both entry points:
- the list's import (`GridToolbar` → `ImportWizard`, and Settings → Data → "Import a spreadsheet…");
- setup's "Bring in a spreadsheet". Today that path is four screens (name the list → wizard → "Each line is one…" → "Which of these dates repeat?"). It becomes the file chooser plus the same summary.

## Current behaviour (after Phase 1)

**Grid wizard**: six steps, `src/renderer/components/grid/ImportWizard.tsx:1-5` (Choose a file, Sheet, Preview, Match columns, Options, Results).
- `handleFileChosen` (`ImportWizard.tsx:205-220`) skips the Sheet step only for single-sheet files. It always stops on Preview (step 3) and then on Match columns (`advanceToMapping`, `:267-304`). That function already combines First + Last names into the name column (UX-A-07, `:284-301`, helper `findNameParts` in `importWizardShared.tsx:109-123`). Notes columns stay text (`isNotesColumn`, `importWizardShared.tsx:105-107`), and only for the exact names "notes/comments/remarks".
- Options (step 5, `ImportOptionsStep.tsx:22-118`) asks about duplicates (default `'none'`, `ImportWizard.tsx:68,100`), "Tidy the data" (default on), link creation and the last-name-first flip. These are questions where a good default exists every time.
- Results (step 6, `ImportResultsStep.tsx:55-196`) shows the count, "Undo this import" and warnings. It also asks "does this date come due again?" once per new date column, through `DeadlineQuestion` (`ImportResultsStep.tsx:131-161`). That question has **no guess**: it starts at "No" (`deadlines.choices[col.id] ?? { mode: 'none' }`, `:149`). Answers save through `ensurePlainRule` (`ImportWizard.tsx:399-424`), which makes rules with the renderer's `DEFAULT_THRESHOLDS`, 60/30/14 days (`components/alerts/plainRule.ts:10-16`). Setup instead uses the standard rules in `src/main/starters.ts:636-653` (`applyDateRules`, through `IPC.ONBOARDING_DATE_RULES`, `ipc-onboarding.ts:233-239`), so the same answer gives different colours depending on the entry point.

**Setup spreadsheet path**: `src/renderer/views/SetupView.tsx`.
- `sheet-name` asks for a list name before any file is chosen (`:323-340`). `createListForImport` makes the list (`:176-186`).
- The wizard runs with `askDeadlines={false}` (`:246-259`). Then `sheet-rows`, "Each line of your spreadsheet is one…", is guessed only from the list name (`guessRows`, `:71-77`; screen `:342-398`). Then `sheet-dates` shows `DateRepeatPicker` prefilled by `suggestRepeat` (`:203-227`, `:400-412`).
- `suggestRepeat` and `yellowDaysBefore` live in `views/setup/DateRepeatPicker.tsx:12-35`.

**Main-side detection**: `src/main/import.ts`.
- Types come from at most **5** non-empty samples among the first 20 rows (`parseImportFile`, `:880-885`). A column is a date only if **every** sample parses (`detectColumnType`, `:183`), so one "TBD" in a date column makes it text.
- The header-name hint (`:887-904`) rescues some columns, but its placeholder filter knows only `—`, `-` and `N/A` (`:894`). "TBD", "pending", "?" and "n/a" defeat it.
- Dates written several ways are already parsed per value (`shared/parseDate.ts:69-120`), and day/month order is voted per column (`analyzeDateOrder`, `import.ts:1213-1223`, with warnings `:351-367`).
- Merged title rows are skipped by `detectHeaderRow` (`:249-319`, big merges `:270-275`). A merged group row above the headers is joined into the names by `buildTable` (`:403-449`). Fully blank rows are dropped (`:440`).
- Unreadable values in a date column are "kept as typed" with a generic warning (`:1340-1342`, `:1406-1408`). Cells over 10,000 characters are cut with a warning (`:1349-1354`, `:1410-1412`).
- `ImportResult` (`:113-121`) returns counts, warnings, skipped names and row ids. It doesn't say which columns were made or what was combined, so a summary can't describe them.
- A long free-text column becomes `text`, although a `notes` column type exists (`shared/columnTraits.ts:11`, importable `:57`).

## The change

### 1. A guessing layer the quick path and the advanced path share

New pure module `src/renderer/components/grid/importGuesses.ts`:
- `planImport(preview, detected, existingColumns, gridRowCount)` returns `{ mappings, combineNames, flipNames, duplicateStrategy, cleanData: true, skipHiddenRows: false, needsAdvanced: null | 'header' | 'sheet' | 'noColumns' }`. It reuses the logic now inline in `advanceToMapping` (`ImportWizard.tsx:267-304`): notes kept as text/notes, name parts combined.
- Duplicates default to `'none'` for an empty list. A list that already has records gets `'by_name'`, or `'name_and_dob'` when a birth-date column is mapped (the same choices Options offers, `ImportOptionsStep.tsx:36-41`).
- `needsAdvanced` is set when `headerDetectionConfidence === 'low'`, when no column has any values, or when the active sheet has no data rows but another sheet does. In those cases the wizard opens the matching advanced step (Preview or Sheet) with one sentence saying why ("We weren't sure which row has the column names. Pick it below, then Pulse does the rest."). It never fails silently.
- `guessRepeats(columns)` maps each new date column to a `DateAnswer` through `suggestRepeat`. `describeRepeats(columns, answers, f)` returns the sentence "Last visit repeats every month; Annual review every year".

Move `suggestRepeat`, `yellowDaysBefore` and the `DateAnswer` type into `src/renderer/utils/repeatGuess.ts`. Re-export them from `views/setup/DateRepeatPicker.tsx`, so `GuidedBlankStart.tsx` and its tests don't change (Q7 may be working near that file). Widen `suggestRepeat` a little: "seen", "home visit", "face to face" → monthly; "recert", "redetermination", "authorization", "plan of care", "ISP" → yearly; "expires", "renewal" stay as the due date. Keep the UX-A-08 ordering (contacts before "last").

### 2. Quick path in `ImportWizard`

- After a file is chosen, `handleFileChosen` picks the active sheet, loads the preview, calls `IMPORT_DETECT_COLUMNS`, runs `planImport` and, unless `needsAdvanced`, imports straight away (progress bar as now). Then it opens the new **Summary** step. Visible steps are just "Choose a file" → "Summary": no stepper dots on the quick path, only a two-step indicator.
- Step 1 gets a small link under the drop zone: "Match the columns myself instead" (`aria-describedby` on the drop zone). It sets `mode = 'steps'`, and the existing steps 2–6 run unchanged.
- The advanced path ends on the same Summary, replacing the current Results step. `ImportResultsStep.tsx` is folded into `ImportSummary.tsx` (or left as a thin wrapper), so there is one results design.

### 3. The Summary (`src/renderer/components/grid/ImportSummary.tsx`, new)

All text goes through `useVocab(gridId)`. 15 px text, 44 px targets, 3 px focus rings. Order:
1. **Heading**: "We brought in 80 clients" (`t('record', { count })`), plus "3 were already here, so they weren't added again: …" when duplicates were skipped (the text from `ImportResultsStep.tsx:103-110`).
2. **Where it came from**, only when it isn't obvious: "From the sheet "Caseload" (the file has 3 sheets)". Or "Column names were on row 3". Either line has a "Use a different sheet" / "Pick another row" button, which undoes the import and opens the advanced step.
3. **What Pulse did**: one short line per guess, only the ones that happened:
   - "First and last names put together, like "Maria Garcia"."
   - "Names written last name first were turned around."
   - "12 columns: Name, Phone, Last visit (date), Annual review (date), Notes (long text)…", as chips with `TypeBadge`.
   - "5 cells in "Annual review" said things like "TBD", so they have no date yet."
4. **Dates that come due**: heading "Which dates come due again?" and the `describeRepeats` sentence, then `DateRepeatPicker` (`views/setup/DateRepeatPicker.tsx:78-117`, unchanged) prefilled with the guesses. With more than 6 date columns, the picker sits under "Change these" (`<details>`, 44 px summary). Answers are applied **on Done or any close** through `IPC.ONBOARDING_DATE_RULES` (standard rules, same as setup). The renderer-only `ensurePlainRule` path in the import goes away; `plainRule.ts` stays, because Add column uses it. Closing by ✕, Escape or a click outside counts as accepting, the same as `closeRef` does today (`ImportWizard.tsx:121-130`).
5. **Things to check**: the existing warnings list with "Why?" (`WarningLine`, `ImportResultsStep.tsx:33-52`), collapsed with its count.
6. **Footer**: primary "Done". Secondary "Undo this import" (existing `IMPORT_UNDO`). Text button "Undo and match the columns myself…": undo, then `mode = 'steps'` at step 3, with the cached file (the main-side cache lasts 5 minutes, `import.ts:613`; a cache miss just re-reads the file).
7. A `slot?: ReactNode` prop renders at the top of the summary, for setup's list name and row word (below), and `beforeDone?: () => Promise<string | null>` returns an error to show instead of closing.

### 4. Main side: better guesses on messy files (`src/main/import.ts`)

- **Samples**: type detection reads up to 20 non-empty values from the first 100 data rows, not 5 (`:880-885`). `samples` for display stays 5.
- **Placeholders**: one exported set, `DATE_PLACEHOLDERS` (`tbd`, `tba`, `n/a`, `na`, `none`, `-`, `—`, `?`, `pending`, `unknown`, `not yet`, `waiting`, `x`), compared lower-cased and trimmed. `detectColumnType` ignores them for the date check, and a column is `date` when at least 80% of the remaining values (and at least 2) parse. The `:894` filter uses the same set.
- **Long text**: a `text` column whose values average over 80 characters, or any over 300, or whose header matches an extended notes pattern (`case notes`, `progress notes`, `comments`, `remarks`, `history`, `notes`), becomes `notes`. Add `'notes'` to the `DetectedColumn['detectedType']` union (`:42`), to `ImportFilePreview` in `src/shared/ipc-contract.ts:176` (one line), and to `COLUMN_TYPES`/`TYPE_BADGE_CLASSES` in `importWizardShared.tsx:74-86` (typed `Record`, so the compiler insists).
- **Totals row**: a last data row whose first non-empty cell starts with "total" (any case) and whose other cells are numbers or blank is left out, with a warning ("Left out the "Total" line at the bottom of the sheet.").
- **Placeholder wording**: in `executeImport`, split `unreadableDates` (`:1227`, `:1340-1342`) into placeholders and other text. Placeholders get the friendlier warning above. Both are still kept as typed, so no data is lost.
- **Richer result**: `ImportResult` gains `columns: Array<{ id: number; name: string; type: string; created: boolean }>`, `combinedNames: boolean`, `flippedColumns: string[]`, `placeholderDates: Array<{ column: string; count: number; example: string }>`, `sheetName?: string` and `headerRow: number`. `'import:file'` is typed `unknown` in the contract (`ipc-contract.ts:469`), so only the main type and the renderer's local copy (`importWizardShared.tsx:52-60`) change.

### 5. Setup's spreadsheet path (`views/setup/SpreadsheetStart.tsx`, new)

So that `SetupView.tsx` (which Q7 also edits, for the "done" step and tour) changes in as few lines as possible, the spreadsheet path moves into its own component, the way `GuidedBlankStart` did.
- "Bring in a spreadsheet" (`SetupView.tsx:306-307`) creates the list with a placeholder name ("My list") and opens the wizard at once. The name screen is gone. Cancel keeps today's clean-up: delete and purge an empty list (`:188-201`).
- After the import, `SpreadsheetStart` renames the list from the file name: the base name without extension, `_` and `-` turned into spaces, collapsed, capped at 60 characters ("caseload_export.xlsx" → "Caseload export"), through `IPC.GRID_UPDATE` with `name`. It also guesses the row word from the list name (`guessRows`), then from the headers: "Client…" → client, "Student…" → student, "Patient"/"MRN" → patient, "Customer" → customer, "VIN"/"Make"/"Model" → vehicle, "Property"/"Unit" → property, "Employee"/"Staff" → staff member, "Job"/"Work order" → job. The guess is written through `GRID_SETTINGS_UPDATE` and `workspaceStore.update` (what `saveRows` does now, `:203-227`), so the summary heading already reads "We brought in 80 clients".
- The summary `slot` shows "List name" (input, 44 px) and "Each line is one: [Clients ▾]" (a select over `ROW_CHOICES` plus "Something else…", which opens the one/many inputs and the People/Things/Jobs radios from `:368-390`). Changing either one saves at once. `beforeDone` checks `ownWordsProblem` (`shared/listWords.ts`).
- Done → `finish()` (`:159-163`). The `sheet-rows` and `sheet-dates` screens stay **only** to resume an interrupted setup saved by an older version (`SetupProgress.step === 'sheet-rows'`, `:152-153`). A resumed `sheet-import` reopens the wizard. The progress schema is unchanged (`ipc-onboarding.ts:44-46`).
- `ROW_CHOICES` and `guessRows` move to `views/setup/rowWords.ts` and are re-exported from `SetupView.tsx` (tests import them from there).
- The `askDeadlines` prop on `ImportWizard` (`:40-44`) is removed. The summary always shows the dates, and `SpreadsheetStart` no longer needs a later page for them.

## Files owned

New:
- `src/renderer/components/grid/importGuesses.ts`
- `src/renderer/components/grid/ImportSummary.tsx`
- `src/renderer/utils/repeatGuess.ts`
- `src/renderer/views/setup/SpreadsheetStart.tsx`
- `src/renderer/views/setup/rowWords.ts`
- `tests/import-messy-files.test.ts`, `tests/renderer/components/grid/importGuesses.test.ts`, `tests/renderer/components/grid/ImportSummary.test.tsx`, `tests/renderer/views/setup/SpreadsheetStart.test.tsx`, `tests/renderer/utils/repeatGuess.test.ts`
- `e2e/ux-review/Q1a.spec.ts` (git-excluded, like the other review specs)

Edited (owned):
- `src/renderer/components/grid/ImportWizard.tsx`
- `src/renderer/components/grid/ImportResultsStep.tsx` (folded into the summary; delete if nothing imports it)
- `src/renderer/components/grid/importWizardShared.tsx`
- `src/renderer/components/grid/ImportMappingStep.tsx` (the `notes` type option only)
- `src/renderer/components/grid/ImportPreviewStep.tsx` (the "why you're here" sentence when `needsAdvanced === 'header'`)
- `src/renderer/views/setup/DateRepeatPicker.tsx` (re-export only; the component is unchanged)
- `src/main/import.ts`
- Tests: `tests/import-smart.test.ts`, `tests/import-robustness.test.ts`, `tests/import-header-detection.test.ts`, `tests/renderer/components/grid/ImportWizard.test.tsx`, `tests/renderer/views/SetupView.test.tsx`, `tests/renderer/views/setup/DateRepeatPicker.test.tsx` (only if an import path moves), `e2e/critical-paths.test.ts` (import case only), `e2e/workspace-words.spec.ts` (import part only)

Shared (small edits; say so in the commit):
- `src/renderer/views/SetupView.tsx`: replace the `sheet-name`/`sheet-import`/`sheet-rows`/`sheet-dates` blocks (`:174-259`, `:323-412`) with `<SpreadsheetStart>`. **Q7 edits the `done` step and tour in this file. Don't touch `:414-450`.**
- `src/shared/ipc-contract.ts:176`: add `'notes'` to the `detectedType` union. One line.

Read, not edited: `ImportOptionsStep.tsx` (unchanged; the advanced path still shows it), `src/main/starters.ts` (`applyDateRules` reused as is), `src/main/ipc/ipc-onboarding.ts`, `src/main/ipc/ipc-export.ts`, `components/alerts/plainRule.ts`, `components/grid/DeadlineQuestion.tsx` (still used by Add column), `GridToolbar.tsx` and `settings/DataSection.tsx` (their `<ImportWizard>` calls keep working: no required prop changes).

Uses Q5's shared buttons/dialog footer if Q5 has merged. Otherwise the existing `btn-primary`/`btn-secondary` classes, swapped when Q5 lands.

## Commit steps

Each commit passes `npm run gate`.
1. **Main: guesses on messy files.** Placeholder set, 20-sample typing with the 80% rule, `notes` detection, totals row, placeholder warnings, richer `ImportResult`, contract union. Tests: `import-messy-files.test.ts`, with fixtures built in-test with ExcelJS and CSV strings:
   - a title row merged across, a merged group row ("Contact" over "Phone"/"Email"), real headers on row 3;
   - a date column written as `3/4/2026`, `March 4, 2026` and `2026-03-04`, plus `TBD`, `n/a` and blank;
   - blank rows between records;
   - a 2,000-character notes cell and a 12,000-character one;
   - a "Total" row;
   - first/last name columns;
   - an existing "Phone" column, so matching is exercised.
   Update `import-smart`/`import-robustness` where the 5-sample assumption shows.
2. **Renderer guesses.** `repeatGuess.ts` (moved and widened, re-exported), `importGuesses.ts`, `rowWords.ts`, with unit tests.
3. **Summary component.** `ImportSummary.tsx`, with the advanced path's step 6 switched to it. Rules go through `ONBOARDING_DATE_RULES` on Done/close. `ImportWizard.test.tsx` updated.
4. **Quick path.** Import on file choice, the `needsAdvanced` fallbacks, the "Match the columns myself" link, "Undo and match the columns myself…".
5. **Setup.** `SpreadsheetStart.tsx`, the slimmer `SetupView.tsx`, list name from the file, row word from the headers. `SetupView.test.tsx` updated, `SpreadsheetStart.test.tsx` added.
6. **Screenshots and close-out.** Run `e2e/ux-review/Q1a.spec.ts`, look at the shots, and write the plan's notes in `ORCHESTRATION.md`'s Phase 2 progress line for the merger. Don't push.

## Acceptance checks

- Grid → Import → choose `caseload.xlsx` (80 rows: First, Last, DOB, Phone, Last visit, Annual review, Notes). The summary appears **without any other screen** and says "We brought in 80 clients". The name column holds "Maria Garcia". Last visit is guessed monthly, Annual review yearly, DOB no reminder. After Done, the grid shows coloured Last visit and Annual review cells straight away.
- The same file with "TBD" in 5 Annual review cells: the column is still a date column, the 5 cells keep "TBD", and the summary says so.
- A file with a merged title row: imports on the quick path with the headers right. A file whose header row can't be found with confidence opens Preview with the one-sentence reason, and finishing it ends on the same summary.
- A file with two sheets: imports the active sheet; the summary offers "Use a different sheet".
- "Undo and match the columns myself…" puts the records in the Trash and opens Match columns with the same file. Finishing gives the summary again.
- Closing the summary with ✕ applies the shown repeat answers. "Undo this import" then ✕ leaves the list as it was, with no rules applied.
- Setup → "Bring in a spreadsheet" → choose the file → summary with "List name: Caseload export" and "Each line is one: Clients" → Done → "You're all set". Three clicks after the start card, down from at least seven.
- Setup with `students.csv` (header "Student ID"): row word guessed "students"; the heading reads "We brought in 25 students".
- Vocab: in a workspace with car-shop words, the summary says "vehicles"/"jobs", never "clients" (covered by `ImportSummary.test.tsx` with `setWords`).
- 15 px minimum text, 44 px targets, 3 px focus rings. Keyboard: Tab reaches every picker and button; Escape closes (and applies). Screen reader: the heading is announced as `role="status"` when the import finishes.
- Screenshots: `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q1a.spec.ts` (after `npm run build`). It writes `ux-review-shots/Q1a/` at 1366×768, light and dark, for:
  - `01-import-choose`
  - `02-import-summary` (80-row file)
  - `03-import-summary-messy` (TBD, three date styles, merged headers)
  - `04-import-advanced-header` (low-confidence fallback)
  - `05-grid-after-import` (colours visible)
  - `06-setup-summary`
  - `07-setup-done`

  Check: the summary fits at 768 px high without scrolling for 2 date columns, the primary button is visible, and there's no second primary action.

## Tests to add or update

- New: `tests/import-messy-files.test.ts`, `tests/renderer/components/grid/importGuesses.test.ts`, `tests/renderer/utils/repeatGuess.test.ts`, `tests/renderer/components/grid/ImportSummary.test.tsx`, `tests/renderer/views/setup/SpreadsheetStart.test.tsx`.
- Update: `tests/renderer/components/grid/ImportWizard.test.tsx` (quick path, advanced link, fallbacks, apply-on-close); `tests/renderer/views/SetupView.test.tsx` (no name screen, resume of old `sheet-rows` still works); `tests/import-smart.test.ts`, `tests/import-robustness.test.ts`, `tests/import-header-detection.test.ts` where expectations change; `tests/renderer/a11y/entryScreens.a11y.test.tsx` if it renders the setup spreadsheet path.
- Check the source-scanning tests still pass: `tests/renderer/friendlyError.test.ts` (new `fail()` and warning strings), `tests/vocab-leak-main.test.ts` (new main warnings use `word()` where they name records), and the eslint vocab rule on the new JSX.

## Risks

- **Importing before showing anything.** A wrong guess means records are already in the list. Mitigations: `needsAdvanced` fallbacks for the uncertain cases, "Undo this import" and "Undo and match the columns myself…" on the summary, and the import staying one transaction (`import.ts:1037-1040`). If the owner prefers confirm-then-import, the same summary can render before the import with a "Bring them in" button. That is a one-flag change in `ImportWizard`; ask at review.
- **Columns made by an undone import stay** (today too: `IMPORT_UNDO` only trashes rows, `ipc-export.ts:631-639`). "Undo and match…" followed by a second import could give "Phone 2". Mitigation: before the second run, the advanced path maps headers onto the columns the first run made (exact name match in `autoMatchColumns`, `import.ts:965-966`, already does this).
- **80% date rule false positives**: a text column with a few dates becomes a date column, and its other values are kept as typed with a warning. Requiring at least 2 parsed values and the 80% share keeps this rare. The tests include a "Notes" column that mentions dates.
- **Rule colours change** for the grid import: from the 60/30/14 renderer thresholds to the standard rules in `starters.ts`. That's intended (one look everywhere). Log it in CLAUDE.md's Decision Log at close-out.
- **SetupView overlap with Q7.** Keep the diff to the blocks named above. Whichever plan merges second rebases.
- **Tests that click through steps 3–5** for the grid import either need the "Match the columns myself" link first, or should just expect the summary. `e2e/workspace-words.spec.ts:98-110` loops over Next/Import/Done, so the quick path should still reach Done; run it. `e2e/critical-paths.test.ts:262-300` imports a CSV: update its expectations if it waits for the Preview step. Both are owned for that purpose only. The user's locally modified `e2e/ui-tour.spec.ts` is **not** touched.
