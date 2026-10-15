# Q0 — Phase 1 leftovers (Wave B)

Five small fixes Phase 1 left open (see ORCHESTRATION.md "Merge notes" for P4 and "After-screenshots"), plus one thing to tell the owner. Each is S-sized and lives on the record page or its printout. Line numbers are from main at f4fc6be9 (after Phase 1). Grep before each edit; another Wave B branch may have merged first.

Constraints as for every Phase 2 plan: no migration (schema stays 50), no network calls, every record/note word through the vocabulary layer, 15 px / 44 px / 3 px, `npm run gate` green before every commit, no new `eslint-disable`, commit messages end with the Co-Authored-By / Claude-Session lines in effect.

## Goal

The record page reads as one finished screen: checklist items are two lines, not three; every date on the page looks the same; the scratch pad says what it's for; a new checklist heading prompts for a name; and the printout can hold every note, not only the last 10.

## (a) Checklist Edit/Delete words follow the column, not the window

**Now.** `src/renderer/components/profile/ChecklistItem.tsx:457` and `:468` show the "Edit" / "Delete" words with `hidden min-[700px]:inline`, a **viewport** breakpoint (P7 commit 0a7d1b3e, F-04). The checklist sits in the record page's left column, `w-[28%] min-w-[340px] max-w-[420px]` (`src/renderer/views/ProfileView.tsx:525`), so the item's content box is roughly 260–340 px wide while every laptop viewport is over 700 px. The badges row (`ChecklistItem.tsx:352`, `flex-wrap`) then holds date chip + priority button (invisible but still taking room at `:420–422` when priority is normal) + pencil-and-"Edit" + bin-and-"Delete" and wraps, so each item becomes title + two badge lines (seen in `ux-review-shots/after-phase1/12-profile.light.png`).

**Container queries in the codebase.** Tailwind 4 has them built in (no plugin). `@container` is declared once, on the grid toolbar (`src/renderer/components/grid/GridToolbar.tsx:284`), but nothing uses an `@min-*` / `@sm:` variant yet; the toolbar picks its tier with a ResizeObserver hook instead (`GridToolbar.tsx:59–76`). So this is the first `@`-variant use; check that it lands in the built CSS (see Acceptance).

**Change.** In `ChecklistItem.tsx` only:
- Add `@container` to the content wrapper (`:322`, `flex-1 min-w-0`). Block-level and already sized by the row, so `container-type: inline-size` doesn't change its width.
- Replace `hidden min-[700px]:inline` at `:457` and `:468` with `hidden @min-[24rem]:inline`. 24 rem (384 px) is the starting value: measure the badges row with the words in the harness at 1920×1080 and pick the smallest width at which date chip + priority + both labelled buttons fit on one line. In the 340–420 px column that probably means icons only (aria-label and title stay, `:453–454`, `:464–465`), and words wherever the checklist gets room.
- Leave ProfileView.tsx alone (Q2 owns it). Don't put `@container` on the column there.
- Optional while in the file: `CompletedChecklistItem`'s Delete button (`:524–535`) has no 44 px hit area (no `hit-44`, unlike `:450`); add `hit-44`.

## (b) One date style on the record page (C-30)

**Now.** Three styles on one page:
- Details block: `GridDataSummary.tsx:143` renders values through the grid's `CellDisplay`, whose `date` case (`src/renderer/components/grid/CellDisplay.tsx:70–72`) uses the list cell formatter `formatDate` (`CellDisplay.tsx:197–209`, fixed `en-US` 2-digit: **09/25/2026**).
- Deadline panel: its own `formatDate` (`DeadlinePanel.tsx:57–61`) → `shortDate` from `src/shared/dates.ts:27–29` (**Sep 25, 2026**, fixed en-US). Deadline-column cells already say "Sep 25, 2026" too (`CellDisplay.tsx:256–266` via `formatDue`).
- Notes: `CaseLogEntry.tsx:59–63` `formatDate` uses `toLocaleDateString(undefined, …)`, the **computer's** locale. On a US machine it matches shortDate; on a UK one it says "25 Sept 2026". `CaseLogEditHistory.tsx:6` imports it.
- Settings → Date format (`AppearanceSection.tsx:283–300`) says on screen that it's for "CSV and PDF exports, and how a pasted date like 06/10/2026 is read". It doesn't drive any screen.

**Decision.** The record page uses the app's label style, `shortDate` ("Sep 25, 2026"), everywhere. The finding suggested "the Settings → Date format one", but that setting is documented as exports-and-paste only, and making screens follow it is a grid-wide change (P4 skipped C-30 for that reason). The grid keeps MM/DD/YYYY. Mention this in the close-out notes, not the Decision Log (no spec deviation).

**Change.**
- `GridDataSummary.tsx` `renderValue` (`:134–150`): for `col.column_type === 'date'` with a value that parses as a calendar date, render `<span className="tabular-nums">{shortDate(ymdLocalDate(value.slice(0, 10)))}</span>` in place of `CellDisplay`; anything that doesn't parse ("Not a date" values) still goes through `CellDisplay`. The state badge (`:144–146`) is unchanged. Editing (`CellEditor`) is unchanged.
- `CaseLogEntry.tsx:59–63`: `formatDate` returns `shortDate(ymdToDate(dateStr))`, so notes, follow-ups (`:406`) and the edit history match the deadline panel on any locale.
- Checklist chips keep "Oct 19" (`dueDateBadge`); a short relative chip in a narrow column is deliberate.

## (c) Printout: last 10 notes or all of them (C-21)

**Now.**
- Dialog: `ProfileExportDialog.tsx:46` offers `Recent {activities} (last 10)` as one checkbox; `ProfileSections` (`:7–14`) is six booleans, `DEFAULT_PROFILE_SECTIONS` at `:17–19`.
- PDF: `src/main/export-pdf.ts:373–381` selects `… ORDER BY occurred_at DESC, id DESC LIMIT 10` and titles the section `Recent {activities} (last 10)`.
- Print: `ProfilePrintLayout.tsx:57` asks `CASE_LOG_GET` for 10, slices to 10 at `:63`, heading at `:194`. (`CASE_LOG_GET` caps a page at 1000 and puts pinned notes first, `src/main/ipc/ipc-caselog.ts:64–76`.)
- Options type: `PdfProfileOptions` in `src/main/export-shared.ts:161–173`. Handler: `src/main/ipc/ipc-export.ts:448–456`, `define(IPC.EXPORT_PDF_PROFILE, [z.custom<PdfProfileOptions>()], …)` with hand-written checks. Contract: `src/shared/ipc-contract.ts:464` (`options: Record<string, unknown>`).
- ProfileView passes the dialog's `sections` straight through as `includeSections` (`ProfileView.tsx:282–287`) and to the print layout (`:91`, `:652`), so a new field on `ProfileSections` reaches both **without editing ProfileView**.
- The handoff packet calls `renderProfileToDoc` with a literal (`src/main/export-handoff.ts:144`); it keeps the last 10.

**Change.**
1. `ProfileSections` gets `allNotes: boolean`, default `false` in `DEFAULT_PROFILE_SECTIONS` (today's behaviour stays the default). It isn't in the `options` checkbox list, so the "nothing ticked" check (`:50`) is unaffected.
2. Dialog: the notes checkbox reads `{Activities}` (`t('activity', { many: true, cap: true })`); under it, indented, a two-choice radio group, each row 44 px: **"The 10 most recent"** / **"All of them"**. Disabled (and visibly muted) while the notes box is unticked. Vocabulary through `t()`; no hard-coded "case notes".
3. Main: `includeSections.allNotes?: boolean` on `PdfProfileOptions`. In `renderProfileToDoc` the query takes `LIMIT ?` with `10` or `-1` (SQLite: no limit) and the title is `Recent {activities} (last 10)` or `{Activities} (all {n})`, via `term(v, 'activity', { many: true, cap: true })`.
4. Validation, per CLAUDE.md's IPC pattern: replace `z.custom<PdfProfileOptions>()` with `schemaArg(pdfProfileOptionsSchema, 'Invalid export choice')` (the message already used at `ipc-export.ts:444`, so friendlyError has it). Schema: `rowId`/`gridId` as `z.custom<number>(validId)`, `destPath: z.string()`, `includeSections: z.object({ six z.boolean(), allNotes: z.boolean().optional() })`. Keep `assertSafePath` and `refuseUnavailableRecord` in the body (they need the filesystem/database). Put the schema next to the handler in ipc-export.ts. Add `schemaArg` to the `ipc-define` import (`:10`). Tighten the contract line `:464` to `options: PdfProfileOptions`-shaped args only if the contract file already imports main-side types; otherwise leave it.
5. Print layout: with `allNotes`, read `CASE_LOG_GET` in pages of 1000 (`limit 1000, offset n`) until a short page; heading `{Activities} ({n})` instead of `Recent …`. Without it, unchanged.

**Known difference, not fixed here.** Print puts pinned notes first (server order); the PDF doesn't. With "last 10" they can list different notes. Note it in the final report; it isn't C-21.

## (d) A new checklist heading asks for its name (C-19)

**Now.** "Add a heading" (`ChecklistToolbar.tsx:34`) creates a group named "New heading" (`Checklist.tsx:443`) and opens it for typing with the text selected (`src/renderer/components/shared/GroupHeader.tsx:65–79`). The input (`:138–153`) has no placeholder. The shared component is also the Tasks page's group header (`TasksView.tsx:28`, `:744–754`), and its labels say "group": `:114` "Reorder group …", `:177–178` "Rename group", `:206–207` "Delete group (items become ungrouped)" / "Delete group …". `src/renderer/components/profile/ChecklistGroupHeader.tsx:2` is a bare re-export, which `Checklist.tsx:26` imports.

**Change.**
- `GroupHeader.tsx`: two optional props, `noun?: string` (default `'group'`, used in the five labels above) and `placeholder?: string`. When `placeholder` is set and `autoEdit` opens the input, start it **empty** so the placeholder shows; an empty commit already keeps the existing name (`commitRename`, `:81–89`), so leaving it blank leaves "New heading". Without `placeholder`, behaviour is unchanged (Tasks page).
- `profile/ChecklistGroupHeader.tsx`: change the re-export into a thin wrapper that passes `noun="heading"` and `placeholder="Heading, e.g. Paperwork to collect"` (a neutral example: the starter text rule keeps social-work wording out of other workspaces, Decision Log 2026-10-01). So **Checklist.tsx and TasksView.tsx aren't edited.**
- Optional: the progress badge (`GroupHeader.tsx:189`) is `text-xs` (14 px by the theme in `globals.css:23`); make it `text-sm` (15 px).

## (e) Scratch pad says what it's for (C-09)

**Now.** Header text is the `heading` prop, default `'Scratch notes'` (`ScratchPad.tsx:33–34`, `:45`), shown at `:308`. The Tasks page passes its own heading (`TasksView.tsx:902`). The empty editor shows nothing (no placeholder; `@tiptap/extensions` is only a transitive dependency of starter-kit, not in package.json). "Scratch notes" is the name used everywhere else: print dialog (`ProfileExportDialog.tsx:48`), print layout (`ProfilePrintLayout.tsx:218`), PDF (`export-pdf.ts:453`), Handoff (`HandoffDialog.tsx:99`), FAQ (`faqData.tsx:297–298`), tour (`tourSteps.tsx:266–269`).

**Change.** Keep the name (consistency, and Q7 owns the tour); add the fact Linda was missing.
- Default heading → `'Scratch notes (just for you)'`. The editor's accessible name stays "Scratch notes" (`:105`; `noteEditors.a11y.test.tsx` finds it by that name).
- With a `rowId` (record page only, not `globalScope`), when the pad is loaded and empty, show a muted hint over the editor's first line: `f('Reminders, numbers, things to ask. Not part of the {activityLog}, and left out of printouts unless you tick it.')` through `useVocab().f`. Draw it as an `aria-hidden`, `pointer-events-none` overlay inside the wrapper (`:328–333`), shown while `editor.isEmpty`, and give the editor the same sentence as `aria-description` so screen readers get it once. No new dependency (package.json is shared across Wave B; don't touch it).

## (f) Tell the owner: `e2e/ui-tour.spec.ts` fails at seeding

The owner's own spec (uncommitted change in the main checkout; `git status` shows `M e2e/ui-tour.spec.ts`) creates a "Phone" column at `e2e/ui-tour.spec.ts:95` on a list that already has one. Phase 1's duplicate-name guard (`src/main/ipc/ipc-grid.ts:206–209`, B-14) now refuses it: "There's already a column called "Phone"…". **Q0 doesn't edit or commit that file.** Put one line in the final report so the orchestrator tells the owner, with the fix the review harness used: look up the existing column by name and reuse its id instead of creating it.

## Files owned

| File | For |
|-|-|
| `src/renderer/components/profile/ChecklistItem.tsx` | (a) |
| `src/renderer/components/profile/GridDataSummary.tsx` | (b) |
| `src/renderer/components/profile/CaseLogEntry.tsx` (`formatDate` only, `:59–63`) | (b) |
| `src/renderer/components/profile/ProfileExportDialog.tsx` | (c) |
| `src/renderer/components/profile/ProfilePrintLayout.tsx` | (c) |
| `src/main/export-pdf.ts` (case-log block `:373–381` only) | (c) |
| `src/main/export-shared.ts` (`PdfProfileOptions` only) | (c) |
| `src/main/ipc/ipc-export.ts` (`EXPORT_PDF_PROFILE` handler `:448–456` and the `:10` import only) | (c) |
| `src/renderer/components/shared/GroupHeader.tsx` | (d) |
| `src/renderer/components/profile/ChecklistGroupHeader.tsx` | (d) |
| `src/renderer/components/profile/ScratchPad.tsx` | (e) |
| Tests named below | all |

**Not touched (owned by other Wave B plans):** `ProfileView.tsx`, `Checklist.tsx`, `CaseLog.tsx` (Q2 next step), `TasksView.tsx`, `tourSteps.tsx`, `faqData.tsx` (Q7), the import code in `ipc-export.ts` / `src/main/import.ts` / `ImportWizard` (Q1a), `package.json`, `e2e/ui-tour.spec.ts`.

## Commits (in this order; gate before each)

1. **"Checklist items keep to two lines: Edit and Delete words follow the column's width, not the window's"** (a).
2. **"One date style on a record's page: details and notes say Sep 25, 2026 like the deadlines"** (b).
3. **"Scratch notes say they're just for you, and an empty pad says what it's for"** (e).
4. **"A new checklist heading asks for its name; checklist labels say heading, not group"** (d).
5. **"Print or save a record: choose the last 10 notes or all of them"** (c).

(f) is a report line, not a commit.

## Acceptance

- (a) In the harness at 1366×768 and 1280×720 (light and dark), every open checklist item with a date is at most two lines (title + one badge row). At 1920×1080, measure and record the badges row width in the final report. Edit and Delete keep their aria-labels and 44 px targets. `npm run build`, then grep the built renderer CSS (`out/renderer/assets/*.css`) for `@container` and the chosen width to confirm Tailwind emitted the rule. `grep -n "min-\[700px\]" src/renderer/components/profile/ChecklistItem.tsx` returns nothing.
- (b) A record with a plain date, a rule-backed date, a deadline column and a backdated note shows every full date as "Mon D, YYYY" in details, deadline panel and notes. The grid still shows MM/DD/YYYY.
- (c) Dialog: radio group disabled while notes are unticked; "All of them" with 15 notes gives a PDF titled `{Activities} (all 15)` holding all 15, and a print layout with 15 rows; default still 10. A custom workspace word ("visits") appears in both titles. The handoff packet still prints 10. A malformed `includeSections` (missing a key, `allNotes: 'yes'`) is refused with the friendly message.
- (d) Profile → Add a heading: the input is empty with the placeholder, Enter on empty keeps "New heading", typing a name saves it. Labels read "Rename heading", "Delete heading Housing". The Tasks page still says "group" and behaves as before.
- (e) The record page's empty pad shows the hint (with the workspace's note word); typing hides it; the Tasks page pad shows its own heading and no hint.
- Screenshots: the review harness is git-excluded (`.git/info/exclude:18`), so a worktree doesn't have it. After `npm run build`, run it from the main checkout (`/home/jmatlock/projects/pulse/e2e/ux-review/`, e.g. `after.spec.ts` and `C.spec.ts`) pointed at the worktree's build, or leave the screenshot check for the orchestrator after merge and say so. Compare against `ux-review-shots/after-phase1/12-profile.*.png`.
- `npm run gate` green; `npm run test:tz` once at the end (commit 2 touches date formatting).

## Tests to add or update

- `tests/renderer/components/profile/ChecklistItem*.test.tsx` (new small one, or in `ChecklistItemDate.test.tsx`): the labels carry an `@min-[…]:inline` class and the content wrapper has `@container`; aria-labels unchanged. jsdom can't evaluate container queries, so this is a class check plus the harness check.
- `tests/renderer/components/profile/GridDataSummary.test.tsx`: a date cell shows "Sep 25, 2026", a non-date value in a date column still shows as before.
- `tests/renderer/components/profile/CaseLogEntry.test.tsx`: `formatDate('2026-09-25')` → "Sep 25, 2026" whatever the locale (stub `toLocaleDateString` / run under `npm run test:tz`).
- `tests/renderer/components/profile/ProfileExportDialog.test.tsx`: radio disabled when notes unticked; `onSave` receives `allNotes: true` after picking "All of them"; default `false`.
- `tests/export-profile-pdf.test.ts`: 12 notes → 10 by default with "(last 10)", 12 with `allNotes` and "(all 12)"; the vocab word appears in the title (with `setDbWords()`).
- `tests/ipc-export.test.ts` `describe('EXPORT_PDF_PROFILE')` (`:469–479`): keep both rejections; add one for a bad `includeSections` and one for `allNotes: 'yes'`.
- `tests/renderer/components/profile/ScratchPad.test.tsx:88–90`: header text is now "Scratch notes (just for you)"; new: hint shown when empty with a rowId, hidden after typing, absent with `globalScope`.
- `tests/renderer/components/profile/checklistGroupUndo.test.tsx:91–92`: the label is now "Delete heading Housing". Add: Add a heading → empty input with placeholder; blank Enter keeps "New heading".
- Check `tests/renderer/vocabStaticText.test.tsx` and `tests/renderer/friendlyError.test.ts` still pass with the new strings; `tests/ipc-consistency.test.ts` unchanged (no new channel).

## Risks

- **Q4 (undo instead of confirm) and the heading delete.** Q4 will likely change what deleting a checklist heading or task group does (`Checklist.tsx:709`, `TasksView.tsx:751`) and may rewrite `checklistGroupUndo.test.tsx`. Q0 changes only `GroupHeader.tsx`'s labels and the two test lines. If Q4 also has to edit `GroupHeader.tsx` (e.g. the Delete button's title at `:206`), merge Q0 first and have Q4 build on the `noun` prop.
- **Q1a and `ipc-export.ts`.** The import handlers live in the same file. Q0 touches only the profile handler block and the `ipc-define` import on `:10`; a conflict on that import line is trivial (keep both names).
- **Container query is new here.** If Tailwind doesn't pick up the `@min-[…]` class, the words just stay hidden (icon + aria-label), which is safe; the CSS grep in Acceptance catches it.
- **Locale change in notes.** Users on a non-US computer will see note dates switch from their locale order to "Sep 25, 2026", the same as the deadline panel and the rest of the app's labels already show them. That's intended (one style), but worth a line in What's New.
- **"All notes" size.** A record with hundreds of notes makes a long PDF and a long print page. That's expected and only happens when asked for; paging the print fetch at 1000 avoids the `CASE_LOG_GET` cap silently cutting it short.
- **Worktree screenshots.** The harness isn't in worktrees (git-excluded). Don't commit a copy of it.
