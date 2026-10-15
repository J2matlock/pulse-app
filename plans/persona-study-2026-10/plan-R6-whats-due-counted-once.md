# R6 — What's due, counted once and called by its name

Phase 3 polish, Wave 1, merge slot 5 (before R7, which also edits `DashboardView.tsx`). Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows #4, #15, #18 and #21.

## Goal

Every number on the dashboard counts the same things the list under it shows, and says whether it counts people or deadlines. "Next 7 days" means the next 7 days everywhere. A deadline is called by what's due ("Appeal window"), not by what hasn't happened yet ("Appeal filed"). The thing someone just set up (Requirements) is visible without scrolling past 67 rows.

## Personas and findings

- **Bobby** (#4): "Due in the next 30 days: 3" over a What's due list with 4 inside 30 days (Dolores's checklist evidence date was in the list but not the tile). "Due in the next 7 days: 1" next to a "This week (0)" tab (`persona-bobby/r-30-dashboard.png`, `r-33-dashboard-scrolled.png`). "When numbers disagree, I trust none of them until I've counted myself."
- **Bobby** (#15): "Appeal filed · Nov 3" on the dashboard, the page and PDFs, when the appeal *isn't* filed: that's the point (`r-21-walt-deadlines-after.png`, `r-34-dashboard-scrolled2.png`).
- **Linda** (#4): "Overdue (36)" on the list vs "38 deadlines are overdue" on the dashboard (`persona-linda/32-overdue.png`, `60-dashboard.png`). "This week (44)" when she wanted four (`96-this-week.png`).
- **Linda** (#18): the Requirements card sat below 67 What's due rows, about six screens down (`62-requirements-card.png`), and opened on all 80 names alphabetically (`63-show-who.png`).
- **Linda** (#21, optional step): no "not seen this month" filter, and the nine "TBD" people dropped out of "Last Contact before 10/01" (`37-not-seen-this-month.png`).

## Current behaviour

- Tiles: `views/DashboardView.tsx:776-806`, counted by `dashboard/tileCounts.ts:14-28` → `shared/deadlineTiles.ts:46-54` (`countDeadlineTiles`): rolling `DAYS_THIS_WEEK` / `DAYS_THIS_MONTH`, **column deadlines only**. Tasks, checklist items and follow-ups are a separate "otherDue" tile.
- Tabs: `DashboardView.tsx:418-420` "Overdue / This week / This month", counted by `dashboard/tabCounts.ts:11-44`: **calendar** week (`daysLeftInWeek`) and **calendar** month, and the week tab also counts tasks, checklist items and follow-ups. The 7-day and 30-day tiles open these tabs (`:799`, `:806`), so a tile labelled "next 7 days" opens a list that ends on Saturday.
- What's due (`whatsDue` in `DashboardView.tsx`, rendered by the cards in `dashboard/cards/DashboardCards.tsx`) is uncapped. With 67 rows it pushes every later card (Requirements is next by default, `cards/layout.ts:22-24`) far down.
- The grid's quick filter `grid/FilterControls.tsx:125-136`: "Overdue (36)" counts **records** with any overdue deadline; its `minHeight` is 36, under the 44 px rule. `dashboard/nextStep.ts:21` says "38 deadlines are overdue." Both are right; neither says what it counts.
- `dashboard/DeadlineRow.tsx:22,89`: the row's label is `columnName`. For a rule whose date comes from another column (`kind: 'relative'` with `anchorColumnId !== 'self'`, `deadlineEngine.ts:101,154,290-295`), the column is the place you record that it's done ("Appeal filed"), and the rule's name says what's due ("Appeal window", from `veterans-service-officer.json`: `alert_rule_name`).

## The change

### 1. One counting function for tiles and tabs

- New `shared/dueWindows.ts` (or extend `deadlineTiles.ts`; keep one file): `countDue(items, today)` over **every kind the What's due list shows** (deadlines, checklist items with a due date, tasks with a due date, follow-ups), returning `{ overdue, next7, next30 }` with rolling windows (0–7 and 0–30 days from today, overdue excluded from both). `isLateDeadline` semantics are unchanged (a used-up quota counts as late).
- Tiles: "Overdue", "Due in the next 7 days", "Due in the next 30 days" use it. The separate "Tasks, checklist items and follow-ups due or late" tile goes, because those are inside the three now. Keep the tile only if `tasks` is on and checklists are off, to avoid an empty change; check what `showTasks || showChecklists` hides.
- Tabs become **"Overdue (n)" / "Next 7 days (n)" / "Next 30 days (n)"**, filtered and counted by the same windows (`tabCounts.ts`: replace `daysLeftInWeek` / `deadlineInMonthTab` with the window test; keep the exports the Calendar uses, if any, by checking `grep -rn "daysLeftInWeek\|deadlineInMonthTab" src`). The calendar week and month stay on the Calendar page, where "week" means a calendar week.
- A test asserts that, for a fixture with deadlines, checklist items and tasks, each tile's number equals its tab's count equals the rows the tab shows.

### 2. Say what's counted

- `FilterControls.tsx` quick filter: "**{n} {record:many} overdue**" (`t('record', { count })`), 44 px tall, with the tooltip unchanged.
- `nextStep.ts`: "{d} deadlines are overdue, for {p} {record:many}." when d ≠ p; "{d} deadlines are overdue." when every record has one. The numbers come from the same data.
- The Overdue tile's sub-line: "for {p} {record:many}".

### 3. What's due shows the top, then "Show all"

- The What's due card shows the first 10 rows (worst first, as now), then a button "**Show all {n}**" (44 px) that expands in place. Its state is remembered per session, not stored.
- When the Requirements feature is on, one summary line goes under the tiles: "**{Requirement:many} this month:** {met} of {total} {record:many} done · {behind} behind with under 7 days left · Show who". **Show who** scrolls to the Requirements card and opens it on the "behind" filter. The card's own list starts with the people who are behind *and* have the least time left, then the rest (sort in `MonthlyContactsCard.tsx`).
- Default card order unchanged (`cards/layout.ts`); the cap makes the order work.

### 4. Call a deadline by what's due

- New `shared/deadlineLabel.ts`: `deadlineLabel(rule, column) → { title, doneLabel }`. When the rule's kind is `relative` with an anchor column other than `self`, `title` is the rule's name ("Appeal window") and `doneLabel` is the column's name ("Appeal filed"). Otherwise `title` is the column's name, as today.
- `DeadlineRow.tsx` shows `title` with `doneLabel` in the row's tooltip and in Done's `aria-label` ("Mark Appeal filed done for Walt Brennan"). R7's "Print what's due" uses the same helper. R4's `DeadlineCardContent` / `DeadlinePanel` can adopt it after both merge; that's a follow-up for the orchestrator.

### 5. (Optional; skip if time runs short) "Not in this month" and blank dates

- `shared` filter operators (`utils/filterMatch.ts` and the operator union, defined `as const`): add `not_this_month` and `before_this_month` for date columns, with `unhandledCase` on stored values. Add an "Include blank or not-a-date" checkbox to date filters, stored as `includeBlank: true` on the filter.
- `FilterBar` / `FilterControls` UI: the new operators in the date operator list. A saved filter using them is read with the existing safe fallback on older versions.

## Files owned

- `src/renderer/views/DashboardView.tsx`: the tiles block `:770-830`, the tabs `:410-440`, What's due capping, the requirements summary line. **R7 later edits only `printWeeklyPlanner` (`:466-475`) and the Print & export items (`:730-738`).**
- `src/renderer/views/dashboard/tabCounts.ts`, `tileCounts.ts`, `nextStep.ts`, `DeadlineRow.tsx`, `MonthlyContactsCard.tsx`, `WeekViewTab.tsx` and `MonthViewTab.tsx` (labels and filters), `cards/DashboardCards.tsx` (the What's due cap, if it lives there)
- `src/shared/deadlineTiles.ts` (or the new `src/shared/dueWindows.ts`), `src/shared/deadlineLabel.ts` (new)
- `src/renderer/components/grid/FilterControls.tsx`; optional step: `src/renderer/utils/filterMatch.ts` and the filter operator list
- Tests: `tests/renderer/views/dashboard/tabCounts.test.ts`, `tileCounts.test.ts`, `nextStep.test.ts`, `DeadlineRow.test.tsx`, `DashboardView*.test.tsx`, `FilterControls.test.tsx`, `tests/deadlineLabel.test.ts` (new), and a new parity test `tests/renderer/views/dashboard/countsAgree.test.tsx`.

Not touched: `export-pdf.ts` / printing (R7), `deadlineEngine.ts` (R4).

## Commit steps

`npm run gate` before every commit.

1. **One count.** `countDue`, tiles and tabs on it, tab labels, the "otherDue" tile decision, the counts-agree test.
2. **Say what's counted.** FilterControls label at 44 px, the nextStep sentence, the tile sub-line. Update the vocab and sentence-case tests.
3. **What's due cap and the requirements line.** Show all, the summary line, the behind-first sort.
4. **Deadline label.** `deadlineLabel.ts`, DeadlineRow. Tests: a VSO-style anchored rule → "Appeal window" with "Appeal filed" in the tooltip; an interval rule → the column name.
5. **(Optional) relative filters.**
6. **Decision Log row, screenshots.**

## Acceptance

- **Bobby's spec as regression** (`persona-bobby.spec.ts`, `bobby resume`; copy the harness): on the dashboard, the 30-day tile shows **4** (Tyrone, Dolores's checklist item, Gene, Walt), the 7-day tile shows 1, the "Next 7 days" tab shows **(1)** and lists Tyrone, and the Walt row reads "Appeal window" (`R6/bobby-dashboard.light.png` at Largest text, 1280×720).
- **Linda's spec** (`linda 2`, `linda 4`, `linda 7`): the list button reads "36 people overdue", the dashboard sentence "38 deadlines are overdue, for 36 people". The requirements line is visible on the first screen without scrolling at 1366×768 with 67 due rows, and "Show who" opens behind-first.
- Screenshots (`shotter('R6')`, light and dark, 1366×768): `R6/tiles-tabs.{light,dark}.png`, `R6/whats-due-capped.light.png`, `R6/requirements-line.light.png`, `R6/overdue-filter-label.light.png`.
- Unit tests above, especially the counts-agree test. `npm run gate` green; `npm run test:tz` (window boundaries at local midnight).
- No migration, no network call. Every record word goes through the vocabulary layer; "deadline" is an app word. 15 px, 44 px (FilterControls fixed), 3 px.

## Risks

- **Dropping the calendar week from the dashboard tabs** changes what "this week" meant for anyone planning Sunday–Saturday. The Calendar keeps calendar weeks, and the old printout name goes in R7. Owner decision listed.
- **Removing the otherDue tile**: checklist items and tasks now count inside the main tiles. People who used it as "my tasks" still have the Tasks page and its sidebar badge.
- **Overlap**: `DashboardView.tsx` with R7 (named hunks; R6 merges first). `DeadlineRow.tsx` is R6's only.

## Decision Log row

`| 2026-10-xx | The dashboard counts one way: tiles and tabs are "Overdue / Next 7 days / Next 30 days" (rolling, from today) and count every kind of item the What's due list shows (deadlines, checklist items, tasks, follow-ups); labels say whether they count records or deadlines; a deadline whose date comes from another column is called by its rule's name | 2026-10-15 persona study: three different counts on one dashboard (Bobby), 36 vs 38 overdue (Linda), and "Appeal filed" read as done when it was due (Bobby). The calendar week stays on the Calendar |`
