# R4 — Deadlines and requirements tell the truth

Phase 3 polish, Wave 1, merge slot 4. Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows D6, D7 and D9 first.

## Goal

A date the person typed is never hidden by a rule's fine print. An expired background check is red, even when a helper column is blank. A review date in the future is never shown as "last done". The contacts already in an imported spreadsheet count toward this month's requirements. Logging a visit or a call moves Last Contact without a second entry. Every rule says plainly what it's waiting on.

## Personas and findings

- **Mark** (D6, his trust score of 4): Rosa's and Harold's background checks, 13 and 18 days out, showed no colour, and the dashboard said "All clear! No deadlines need attention" (`persona-mark/90-dashboard.png`). Ernest's check expired in January and stayed white with "0 overdue" (`164-overdue-but-no-color.png`). Colour appeared only after he guessed that "Needs background check" had to be Yes (`122-colors-after-yes.png`). The rule window didn't say why (`107-deadline-rule.png`) and opened with focus on "Remove from this column".
- **Linda** (D7): "PLAN REVIEW: Last done Dec 4, 2026", "REDETERMINATION: Last done Nov 27, 2026" (`persona-linda/85-melissa-future-lastdone.png`). The import's "Which dates come due again?" took every date as last-done (`12-due-again.png`). She gave up for the night.
- **Linda** (D9): Requirements showed "0 of 80 done · 80 still to do" on day one, though her Last Contact column had 30 October contacts (`62-requirements-card.png`, `63-show-who.png`). A logged phone note didn't move Last Contact, which stayed "14 days overdue" until she also clicked Done (`82-melissa-call-logged.png`, `84-melissa-lastcontact-done.png`). That's two entries per contact, 160 a month. She also wasn't sure whether one visit counts for both requirement lines (`49-two-contacts.png`).

## Current behaviour

- `shared/deadlineEngine.ts:621-626`: `if (!conditionHolds(...)) { if (whenFalse === 'hide') return NONE … }`. `conditionHolds` (`:598-608`) reads a blank value as `''`, so `op: 'is', values: ['Yes']` is false for a blank. The volunteer starter's background-check rule is exactly that (`starters/volunteer-manager.json:248`: `whenFalse: "hide"`); check `volunteer-safety.json` and the other starters (`grep -l rule_condition src/shared/starters/*.json`).
- `grid/ColumnRulePicker.tsx:30-60` (`ColumnRuleDialog`): it shows `ruleSummary(...)` and `RuleColorKey`, but nothing about how many records the condition is currently hiding. The first focusable element is "Remove from this column" (`:50-55`), and `Dialog` has an `initialFocus` prop that isn't used.
- `utils/repeatGuess.ts:16-19`: `suggestRepeat(name)` decides from the column name only ("review" → every year). `importGuesses.ts:136` `guessDateAnswers` passes only `{ id, name }`, no values. The summary (`ImportSummary.tsx:165,253-262`) states the guess, and "Change these" opens `DateRepeatPicker`.
- `components/deadlines/DeadlineCardContent.tsx:76` and `profile/DeadlinePanel.tsx:338,398` label any stored date of a recurring rule "Last done", even one in the future.
- `main/contact-requirements.ts:95-101`: the requirement tally counts `case_log` rows only.
- `main/note-date-updates.ts:4`: a date column follows notes when its config has `note_updates: ['visit', 'phone', …]`. It's off unless set by hand in Column settings → "Update from notes" (`grid/NoteUpdatePicker.tsx`). The import never sets it.
- `main/starters.ts:636` `applyDateRules(gridId, answers)` turns the import's date answers into rules; the answer schema is at `ipc/ipc-onboarding.ts:38-41`.
- `contact-req/ContactRequirementsDialog.tsx`: no line saying a note counts toward every requirement it matches.

## The change

### 1. A blank condition column fails safe (`deadlineEngine.ts`)

- `evaluate`: when the condition fails **only because its column is blank** (`raw === ''` and `op` is `is` or `not_empty`), evaluate the rule normally, and append to `detail`: "Counted because {column} is blank". The column name comes in through the engine's existing column lookup; add a `conditionColumnName` to `EngineRule` from the caller if there's no lookup. A value that is present and doesn't match ("No") keeps today's behaviour (`hide` → nothing, `pause` → paused).
- `op: 'empty'` and `op: 'is_not'` are unchanged, because blank already satisfies them.
- One function in the engine, so the grid, dashboard, briefing, exports and main's deadline loads all agree. The tests `tests/deadlines-parity*.test.ts` must stay green; add cases.
- Volunteer starters: no JSON change needed. The rule's description ("only for volunteers who need one") gains ", or when it isn't filled in". **R8 owns the starter JSON**; hand it this text in the final report and don't edit the JSON here.

### 2. The rule window explains itself (`ColumnRulePicker.tsx`)

- Under the current rule's summary, when it has a condition, add one line: "Only for {record:many} whose {column} is Yes. Right now: {a} match, {b} are blank (counted anyway), {c} don't match (no color)." Count from the grid store's rows in memory.
- `initialFocus` on the dialog's **Close** button (the footer), not "Remove from this column".
- "Remove from this column" becomes a secondary text button **after** the list of other rules, so no Tab from the top lands on it first.

### 3. Imported dates: read the values, ask once when it matters

- `repeatGuess.ts`: `guessRepeats(columns, samples?)`, where `samples` is up to 200 parsed `YYYY-MM-DD` values per column from the import preview. Rule: if at least 60 % of a column's dates are after today → `{ repeat: 'due' }` (a due date), whatever the name says. If 20–60 % are future → keep the name's guess but mark the column `mixed: true`.
- `importGuesses.ts:136`: pass the preview's parsed dates to `guessRepeats`, using the date parsing the preview already does (don't re-parse).
- `ImportSummary.tsx`: for each `mixed` column, one plain question above "Change these": "Some dates in **Plan Review** are in the future. Are these the dates it's **next due**, or the dates it was **last done**?" with two radio buttons (44 px). "Next due" sets `{ repeat: 'due' }`. "Last done" keeps the repeat, and those future values get flagged after import (step 4). Answering is required before **Import**; the default selection is "next due" when more than half are future.
- The repeat sentence (`:253`) names due-date columns as such ("Plan Review is a due date").

### 4. A future "last done" warns, with the fix one click away

- New tiny shared helper `lastDoneInFuture(storedYmd, ruleKind, today)` in `src/shared/deadlineEngine.ts` (same file, next to `evaluate`). It's true for recurring kinds (interval, calendar) when the stored date is after today.
- `DeadlineCardContent.tsx:76` and `DeadlinePanel.tsx:398`: instead of "Last done Dec 4, 2026", show "**Dec 4, 2026 is in the future.** Is that when it's due?" with a button **Make this column's dates the due dates** (opens the existing "Date is the deadline" rule choice in the column's rule dialog through `openDeadlineCard`'s path; check `ColumnRulePicker`'s `onSetRule` / New rule flow), plus a quiet "It's right" that hides the warning for this cell in this session.
- The deadline engine's result is unchanged. This is wording plus a shortcut, so the "shows its maths" line stays (a Bobby praise).

### 5. Logging a note moves Last Contact; imported contacts count

- **Import sets "update from notes"** for contact-like date columns: the `DateRuleAnswer` schema gains `followsNotes?: string[]` (activity-type keys). `importGuesses` sets it when the column name matches `/last (contact|visit|seen|call|f2f|face)|contact date|home visit/i`, to the grid's active types whose key is in {visit, phone, email, meeting, call} (whatever the list's activity types are; read them with `ACTIVITY_TYPES_LIST`). `starters.ts` `applyDateRules` writes `note_updates` into that column's config. The import summary says so in one line: "Logging a Visit, Phone or Email note will update Last Contact." It sits in "Change these" with a checkbox to turn it off.
- **Requirements count a followed date once** (`contact-requirements.ts`): for each requirement period, for each record, if a date column of that list has `note_updates` and its date falls in the period, **and** no counted note of one of those types exists on the same local day, add 1 to the tally of the **first** type in `note_updates` that the requirement counts. Write it as a second prepared statement over `cells` joined to `columns` (`json_extract(col.config,'$.note_updates') IS NOT NULL`), using `liveRow('r')`. A note logged on the same day (which itself set the date through `note-date-updates.ts`) is never counted twice.
- `ContactRequirementsDialog.tsx`: two plain lines under the list: "A {activity} counts toward every requirement it matches." and, when such a column exists, "Dates in {column} count too, once per day, for {records} without a {activity} that day."
- Help: the requirements FAQ answer gains one sentence about the date column (`faqData.tsx`, that answer only).

## Files owned

- `src/shared/deadlineEngine.ts` (the condition branch + `lastDoneInFuture`)
- `src/renderer/components/grid/ColumnRulePicker.tsx`
- `src/renderer/utils/repeatGuess.ts`, `src/renderer/components/grid/importGuesses.ts`, `src/renderer/components/grid/ImportSummary.tsx`
- `src/renderer/components/deadlines/DeadlineCardContent.tsx`, `src/renderer/components/profile/DeadlinePanel.tsx`
- `src/main/contact-requirements.ts`, `src/main/starters.ts` (`applyDateRules` only), `src/main/ipc/ipc-onboarding.ts` (`dateAnswersSchema` only)
- `src/renderer/components/contact-req/ContactRequirementsDialog.tsx`
- Tests: `tests/deadlineEngine*.test.ts` (condition cases), `tests/deadlines-parity*.test.ts` (stay green), `tests/renderer/utils/repeatGuess.test.ts`, `tests/renderer/components/grid/ImportSummary.test.tsx`, `tests/contact-requirements.test.ts`, `tests/starters*.test.ts` (applyDateRules with `followsNotes`), the DeadlineCardContent, DeadlinePanel and ColumnRulePicker tests, `tests/migration-ladder.test.ts` untouched (no migration).

**Shared hunks:** `src/shared/ipc-contract.ts` (`DateRuleAnswer` gains an optional field; others only append); `src/renderer/views/help/faqData.tsx` (requirements answer only).

Not touched: starter JSON (R8), `compliance.ts` (R7; it reads `getRequirementStatus`, so the new counting flows into the monthly summary for free; check R7's tests after merge).

## Commit steps

`npm run gate` before every commit.

1. **Engine: a blank condition column fails safe.** Tests: blank → evaluated with the detail; "No" → hidden (hide) or paused (pause), unchanged; `empty`/`is_not` unchanged; parity tests green; the dashboard count includes a blank-condition overdue record.
2. **Rule window.** The condition line with counts, initial focus on Close, Remove after the list. Tests: counts for match/blank/no-match; `document.activeElement` is Close on open.
3. **Import reads values.** `guessRepeats(columns, samples)`, the mixed question, the due-date sentence. Tests: 80 % future → due; 30 % future → mixed + question required; all past → name guess unchanged (Last Contact monthly, Plan Review yearly).
4. **Future last-done warning.** The helper and both renderings. Tests: a future stored date on a yearly rule → the warning and button; past → "Last done" as today; one-off "due" rules never warn.
5. **Notes move Last Contact; imported contacts count.** `followsNotes` through the schema → `applyDateRules`; the requirement counting; the dialog lines; the FAQ sentence. Tests: an imported Last Contact of Oct 5 counts 1 for October; a Visit note on Oct 5 plus Last Contact Oct 5 counts 1, not 2; a Phone note on Oct 12 moves Last Contact to Oct 12 (through the existing `note-date-updates`) and counts 1 more; a trashed record isn't counted; `test:tz` safe (local days).
6. **Decision Log row, screenshots.**

## Acceptance

- **Mark's regression** (`e2e/ux-review/persona-mark.spec.ts` reads its steps from the scratchpad `mark-steps.json`; also write a focused `e2e/ux-review/R4.spec.ts`): the volunteer-manager starter with no samples, two volunteers with Background check 13 and 18 days out and Needs background check blank → the cells are orange and yellow, and the dashboard says "Next: Rosa Delgado, Background check in 13 days" (was `90-dashboard.png` "All clear"). Ernest at 01/01/2024 → red, counted overdue (was `164-overdue-but-no-color.png`). The rule window says "2 are blank (counted anyway)" and opens with focus on Close.
- **Linda's regression** (`persona-linda.spec.ts`, steps `linda 1` and `linda 4`/`5`, with her generated spreadsheet):
  - The import asks about Plan Review / Redetermination future dates, and with "next due" Melissa's page shows "Due Dec 4, 2026", never "Last done Dec 4, 2026" (was `85-melissa-future-lastdone.png`).
  - The requirements card on day one shows the ~30 people with an October Last Contact as 1 of 2 contacts, not 0 of 80 (was `63-show-who.png`).
  - Logging a phone note for Melissa moves Last Contact to today without clicking Done (was `82-melissa-call-logged.png`).
- `R4.spec.ts` screenshots (`shotter('R4')`, light and dark): `R4/blank-condition-colors.light.png`, `R4/rule-window-condition.light.png`, `R4/import-future-question.light.png`, `R4/future-last-done.{light,dark}.png`, `R4/requirements-day-one.light.png`.
- Unit tests above; `npm run gate` green; `npm run test:tz` green (period boundaries and same-day matching).
- No migration (`note_updates` lives in `columns.config` JSON), no network call, vocabulary layer (`{record:many}`, `{activity}`; column names are the user's own).

## Risks

- **Changing the engine's meaning** of a blank condition column. Some list may use "only when Status is Active" with a blank Status meaning "not active", and would now see colour on blank-status records. Mitigation: the detail line says why, the rule window counts the blanks, and the person can set "pause" or fill the column. Fail-safe was chosen because a hidden expired check is worse than an extra colour. Owner decision and a Decision Log row.
- **Counting a date as a contact** is an inference: Last Contact on Oct 5 is taken as one contact that day. It's counted once per day, only for columns that follow notes, and the dialog says so. A person who doesn't want it unticks "update from notes" in Column settings.
- **The 60 % future threshold** is a guess; the mixed question covers the uncertain band.
- **The parity tests** compare main and renderer deadline maths. Both use the shared engine, so one change covers both; run the whole suite.

## Decision Log row

`| 2026-10-xx | A rule's "only when <column> is …" condition no longer hides a deadline when that column is blank: the deadline is tracked and says "Counted because <column> is blank" (a value that doesn't match still hides or pauses). Import reads the dates: mostly-future columns become due dates, mixed ones get one question, and a future "last done" shows a warning. Contact-like columns follow notes after import, and a date in such a column counts once toward requirements on a day with no matching note | 2026-10-15 persona study: an expired background check showed white while the dashboard said "All clear" (Mark), future review dates became "last done" and requirements read 0 of 80 on day one with every contact entered twice (Linda) |`
