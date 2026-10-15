# R7 — Printouts and reports that match the screen

Phase 3 polish, **Wave 2** (after R6, which shares `DashboardView.tsx` and provides `deadlineLabel`). Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows D10, #6 (the report half), #11 and #20.

## Goal

Paper says what the screen says. One button prints what's due in the next 30 days, worst first, every kind of deadline included, in letters a low-vision reader can read. Reports use the screen's words for urgency, offer "next 30 days", describe what they actually count, and are proofread. Mileage and minutes for the month are one click, not a project.

## Personas and findings

- **Bobby** (D10, gave up that day): "Print this week" printed "This week (0) … Nothing due this week" with Tyrone 7 days out; "this week" ended Saturday (`persona-bobby/r-35-print-menu.png`, `p-01-print-this-week.png`). The header read "Don / e". The list PDF was in typing order, "letters so small and grey I need the magnifier" (`p-02-list-save-as-pdf.png`). The report he built dropped Dolores's checklist evidence date and called a 15-day appeal "On track" while the screen said Urgent / Due soon (`p-03-report-next-30-days.png`). There was no "next 30 days" range (`r-50-report-due-date.png`). The supervisor report said "1 has deadlines within 7 days" without naming them (`r-41-supervisor-report.png`).
- **Karen** (#11): "Roster Roster" heading on the supervisor PDF; "4 counseling session a month" (`21c-saved.png`, `43b-monthly-summary.png`); the Monthly summary's top line ran off the page; a "this month" report still described "this year"; the Total row misaligned (`39c-saved-pdf.png`); no minutes in the supervisor report or the Monthly summary; Totals only as CSV (`44a-totals.png`). "So I can build what Dr. Abernathy wants, but from three printouts, not one."
- **Candy** (#6, report half): mileage for the month took a hand-built report (`persona-candy/82-new-report.png`, `84-add-value.png`), and the pinned tile kept the description "How busy each month was, by the visit notes written" (`90-dashboard-mileage-tile.png`).

## Current behaviour

- `views/DashboardView.tsx:466-475` `printWeeklyPlanner`: start of the calendar week → `EXPORT_WEEKLY_PLANNER (weekStart)` (`ipc/ipc-export.ts:505`) → `main/export-planner.ts:71` `exportWeeklyPlanner`. `loadPlannerRows(start, end)` (`:30-69`) already unions deadlines, checklist items, tasks, follow-ups and appointments up to `end`. The table is `fontSize: 9` (`:96`, `:106`). The menu item is at `DashboardView.tsx:734`.
- `main/export-pdf.ts:32-33,95,134` (`exportPdfGrid`): `styles.fontSize = gridFontSize` (small), grey header fill, rows in list order.
- `main/report-builder.ts:34`: `DEADLINE_STATE_LABELS` maps engine states (`ok` → "On track", `soon` → "Coming up") with no tie to the rule's own threshold labels (Urgent, Due soon), which the grid and dashboard show.
- `shared/reports.ts:31`: `DATE_PRESETS = ['this_month', 'last_month', 'this_quarter', 'this_year', 'last_year']`, all past or current, nothing forward.
- `components/reports/ReportBuilder.tsx:207-222`: presets carry a fixed `about` sentence ("…this year"), kept after the person changes the range. There's no miles or minutes preset.
- `main/export-supervisor.ts:246,499`: `` `${ListCap} Roster` ``, so with the list word "roster" it prints "Roster Roster". It has no minutes section.
- `contact-req/ContactRequirementsSettings.tsx:38` and `main/compliance.ts:97`: `` `${r.per_month} ${r.label.toLowerCase()} a ${period}` ``, with no plural. In `compliance.ts` the PDF's first line is one long string and isn't wrapped.
- `main/export-report.ts:49`: the PDF foot row builds totals, and the alignment is off because the foot cells don't take the body's `columnStyles` (`halign: 'right'` for numbers). Check the autoTable call.

## The change

### 1. "Print what's due" (replaces "Print this week")

- The menu item (`DashboardView.tsx:734`) becomes **"Print what's due"**, with the hint "Overdue and the next 30 days, worst first, on paper" and a small choice in a `Dialog`: **Next 7 / 30 / 90 days** (30 preselected, remembered in settings `print_due_days`), plus "Include {appointment:many}" when appointments are on.
- `printWeeklyPlanner` → `printWhatsDue(days)`: `EXPORT_WHATS_DUE (days)`, a new channel built with `/ipc-channel` (`define`, `schemaArg(z.number().int().min(1).max(366))`). The handler calls a new `exportWhatsDue(days, destPath, workerName)` in `export-planner.ts`, which reuses `loadPlannerRows(today, today+days)` and changes the layout:
  - Sorted by days left (overdue first, most overdue first), not by date then name. The same order as What's due.
  - Columns: **Days left** (bold: "12 days late", "Today", "in 7 days"), **Due**, **{Record}**, **What** (deadlines use R6's `deadlineLabel(...).title`, "Appeal window"), **Kind**. No column header splits a word ("Done" never wraps: `cellWidth: 'wrap'` / `minCellWidth`).
  - **12 pt body, 14 pt headings, black text (0,0,0)**, a white header with a 1 pt black bottom border instead of a grey fill. Overdue rows bold, not colour-only. The page title "What's due: next 30 days (Oct 15 – Nov 14, 2026)" and the worker's name.
  - Empty: "Nothing is overdue or due in the next 30 days." That's honest, and it can't happen while the dashboard lists something, because it's the same rows.
- Keep `EXPORT_WEEKLY_PLANNER` and `exportWeeklyPlanner` (other callers, e.g. Focus mode and the command palette, may use it; `grep -rn EXPORT_WEEKLY_PLANNER src`). If nothing else calls it, delete it with its test, in a separate commit.

### 2. Legible list PDF

`export-pdf.ts` `exportPdfGrid`: body at least **11 pt**, black text, header white with a black rule (not slate fill), dates and days-left right-aligned. When the list has a deadline sort on screen, the PDF uses the screen's order: it already gets the rows in some order; pass the grid's current sort from the renderer if it doesn't (check `PdfGridOptions`). Grey (`textColor` 100+) is gone from body cells.

### 3. Reports speak the screen's words

- `report-builder.ts:34`: the deadline "State" value is the **rule's threshold label** for that row (the label the cell's colour carries: "Urgent", "Due soon", "Coming up", "Overdue", "Due today"), worked out through the same engine call the grid uses (`thresholds` on the rule). It falls back to the current map only when the rule has no thresholds. `DEADLINE_STATE_ORDER` (`:38`) becomes most-urgent-first over those labels. Saved reports that filter on "On track" keep working: map the old values on read (`unhandledCase` + fallback).
- `shared/reports.ts`: `DATE_PRESETS` gains `next_7_days`, `next_30_days`, `next_90_days` (`presetRange` cases; `PRESET_WORDS`). They're offered only when the date field is a due date (deadlines' `dl:due`, checklist due, appointments). Stored reports validate against the list, so adding members is safe.
- **Descriptions follow the settings**: `ReportBuilder.tsx` drops a preset's `about` as soon as the config changes from that preset, and the description falls back to the generated sentence (`reports.ts:300`, `describe…`), so "this year" never sits on a this-month report. The pinned dashboard tile (`SavedReportCard.tsx`) shows the saved description, which is now right.
- **New presets** (`ReportBuilder.tsx:207-222`): when Mileage or Time on notes is on, "**Miles and minutes this month**" (source activities, `dateRange this_month`, values: count, sum minutes, sum miles, grouped by record). When appointments are on, "{Appointment:many} in the next 30 days". Words through `words()` / `useVocab`.
- **New filter rows take focus** (Mark, `persona-mark/147-add-filter.png`): after "Add a filter" or "Add a value", focus the new row's first control.

### 4. Proofread the PDFs

- `export-supervisor.ts:246,499`: the section heading is "{List:cap} members" when the list word already ends in a collective word (roster, caseload, list, register) and "{List:cap} roster" otherwise. Simplest: `` `${ListCap}: everyone on it` ``; pick one wording and test it with "Roster", "Caseload" and "List".
- A shared `requirementPhrase(r)` in `shared/contactRequirements.ts`: "4 counseling sessions a month", "1 face-to-face visit a month", "2 contacts (any kind) a month". It pluralises the last word before any parenthesis when `per_month !== 1`, with a small irregular map (visit → visits, session → sessions, check-in → check-ins). Used by `ContactRequirementsSettings.tsx:38` and `compliance.ts:97`.
- `compliance.ts` Monthly summary PDF: the requirement line wraps (`doc.splitTextToSize`) within the margins; add a **Minutes this month** column per record when Time on notes is on. The supervisor report gets a "Time with {record:many}" section (total and per record) when Time on notes is on, which closes Karen's "no minutes anywhere".
- `export-report.ts:49`: the foot row uses the same `columnStyles` as the body (numbers right-aligned), so Total lines up.
- The supervisor report's "{n} have deadlines within 7 days" names them (up to 10, then "and n more").

## Files owned

- `src/main/export-planner.ts`, `src/main/export-pdf.ts` (`exportPdfGrid` styles only), `src/main/export-supervisor.ts`, `src/main/compliance.ts`, `src/main/export-report.ts`, `src/main/report-builder.ts`
- `src/main/ipc/ipc-export.ts` (`EXPORT_WHATS_DUE` appended; no other handler changes)
- `src/shared/reports.ts`, `src/shared/contactRequirements.ts`
- `src/renderer/components/reports/ReportBuilder.tsx`, `src/renderer/views/dashboard/cards/SavedReportCard.tsx` (description only), `src/renderer/components/contact-req/ContactRequirementsSettings.tsx` (line 38)
- New `src/renderer/views/dashboard/PrintDueDialog.tsx`
- Tests: `tests/export-planner.test.ts`, `tests/export-supervisor.test.ts`, `tests/compliance.test.ts`, `tests/report-builder.test.ts`, `tests/reports.test.ts` (presets, ranges), `tests/contactRequirements.test.ts` (phrase), `tests/renderer/components/reports/ReportBuilder.test.tsx`, `tests/vocab-leak-exports.test.ts` (new strings), `tests/ipc-consistency.test.ts`.

**Shared hunks:** `src/renderer/views/DashboardView.tsx`: only `printWeeklyPlanner` (`:466-475`) and the Print & export items (`:730-738`); R6 owns the rest and merges first. `src/shared/ipc-channels.ts` and `ipc-contract.ts`: append-only. `src/shared/deadlineLabel.ts` is R6's; import it, don't edit it.

## Commit steps

`npm run gate` before every commit. Rebase on main after R6 merges.

1. **Print what's due.** Channel, `exportWhatsDue`, `PrintDueDialog`, the menu item, 12 pt black layout, days-left sort. Tests: rows for a fixture with a deadline 7 days out, a checklist item 13 days out and an overdue task → all three, overdue first; the empty message; the title range; no grey text colour in the doc's calls (spy on `setTextColor`).
2. **Legible list PDF.** Tests: font size ≥ 11 and black text in `exportPdfGrid`'s autoTable options.
3. **Report states, ranges and descriptions.** Tests: state labels from thresholds ("Urgent" for 15 days on an Urgent-at-30 rule); an old saved report filtering "On track" still loads; `next_30_days` range; description regenerates after a change; the Miles and minutes preset only when mileage or time is on.
4. **Proofreading.** The roster heading, `requirementPhrase`, the wrapped line, minutes in the Monthly summary and supervisor report, Total alignment, named 7-day deadlines. Tests for each, run against `setDbWords()` with student/roster words.
5. **Decision Log row, screenshots, PDFs rendered to PNG** for the check (the persona harness's `p-0x` approach).

## Acceptance

- **Bobby's spec as regression** (`persona-bobby.spec.ts` `bobby resume`; render the saved PDFs to PNG as the study did): "Print what's due" with 30 days lists **Tyrone (7 days), Dolores's evidence item (13 days), Gene (15), Walt (19)** in that order, at 12 pt black, Walt's line "Appeal window". The report with Due date "Next 30 days" shows Gene as "Due soon" / Urgent per the rule, not "On track".
- **Karen's spec** (`k37`–`k45`): the supervisor PDF has no "Roster Roster", shows a minutes section, and names the 7-day deadlines. The Monthly summary's first line wraps inside the page and reads "4 counseling sessions a month". The "Notes by kind" report with This month says so in its description. Totals line up.
- **Candy's spec** (`candy 8`): New report offers "Miles and minutes this month". One click plus Save shows "Oct 2026 · 1 visit · 50 minutes · 23.4 miles", and the pinned tile's description matches.
- **Mark** (`R7.spec.ts`, keyboard): Add a filter → focus is in the new row.
- Screenshots and PDF renders in `ux-review-shots/R7/`: `whats-due-30.png`, `list-pdf.png`, `supervisor.png`, `monthly-summary.png`, `report-next-30.png`.
- `npm run gate` green; `npm run test:tz` (range boundaries). `tests/vocab-leak-exports.test.ts` green (no hard-coded record words in the PDFs).
- No migration (the date presets are code; saved reports validate on read), no network call.

## Risks

- **The weekly planner disappearing** for anyone who liked Sunday–Saturday on paper: "Next 7 days" covers the same need from today. The planner function stays while anything else calls it. Owner decision listed.
- **State labels from thresholds** differ per rule ("Urgent" on one, "Due soon" on another). That's what the screen does, and grouping by state groups by label text. The order list must cover the standard labels, with the rest after them alphabetically.
- **12 pt** makes long lists span more pages. That's accepted: the whole point is that Bobby can read them.
- **Overlap**: `DashboardView.tsx` with R6 (named hunks). `compliance.ts` gets R4's new requirement counting through `getRequirementStatus`; re-run `tests/compliance.test.ts` after both merge.

## Decision Log row

`| 2026-10-xx | "Print this week" became "Print what's due" (overdue plus the next 7/30/90 days, the What's due rows in the same order, 12 pt black); reports show the rule's own urgency labels (not "On track"), offer next 7/30/90 day ranges and a "Miles and minutes this month" preset, and their descriptions follow their settings; requirement phrases are pluralised; the supervisor report and monthly summary show minutes when time on notes is on | 2026-10-15 persona study: a veterans' navigator printed "Nothing due this week" with a claim due in 7 days and finished his list by hand (Bobby); a school social-work lead needed three printouts for one monthly report (Karen); a nurse's mileage total took a hand-built report (Candy) |`
