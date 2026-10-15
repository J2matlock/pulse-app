# Q3 — Change things where you see them

Phase 2 idea 3. Wave B. Written 2026-10-15 against `main` after Phase 1 (f4fc6be9).

## Goal

1. **One deadline card.** A deadline behaves and reads the same wherever it shows: the due date in words, "Last done …" for repeating dates, the engine's own line (extension, moved off a weekend), and the same buttons in the same order: **Done · Done on… · Extend… (or Remove extension) · Open {record}**. It works on grid cells (which have no deadline actions today), on the profile's Deadlines panel, in the Calendar's side panel and on dashboard rows.
2. **Rename a column by clicking its name.** The name turns into a text box and the column menu opens under it, so renaming and everything else about the column happen in one place.
3. **Resizing feels instant and obvious.** Drag the edge (easy to find and grab), double-click it to fit, and Fit sizes to what's really on screen.

No database migration and no new IPC channel. `DEADLINES_GET` already returns everything the card needs. No network calls. Every word goes through the vocabulary layer. 15 px text, 44 px targets, 3 px focus rings.

## Current behaviour (after Phase 1)

### A. Deadline actions: four places, four different sets

| Place | File | What it offers | Where its data comes from | Gaps |
|-|-|-|-|-|
| Dashboard "What's due" row | `views/dashboard/DeadlineRow.tsx:108-162` | Extend… / Remove extension, then Done (or "Mark {step} done"), then Done on…; Renew… for quota | `ExtendedDeadlineInfo` from the dashboard query | Order is **Extend first, Done second**. Open is the name link (`:88-91`). |
| Calendar side panel (P5, UX D-08) | `components/calendar/CalendarItemPanel.tsx:213-246` (`DeadlineActions`), loaded at `:260-270` | Done · Done on… · Extend… / Remove extension · Open {record}; Renew… for quota | `DEADLINES_GET {rowIds:[id]}` turned into `ExtendedDeadlineInfo` by a local `toInfo()` (`:198-209`) | The closest to the target. `toInfo` is private to this file. |
| Profile "Deadlines" panel | `components/profile/DeadlinePanel.tsx:461-487` (buttons), `:245-280` (own `markStep` / `markDone`), `:503-524` (own Extend / one-off / meter dialogs) | Done · Extend… only. The Remove extension link sits separately (`:350`). The step's "Mark done" is inside the steps list (`:362-366`). | Renderer engine (`evaluateRuleForRow`, `:168-201`) plus the grid store's `deadlineContext` | **No Done on…**. Buttons are `minHeight: 36` (`:474`, `:482`). It duplicates the dialog wiring that `useDeadlineActions` already has. Done is hidden for sequence and quota (`:327`). |
| Grid cells | `components/grid/SortableRow.tsx:322-324, 491-505`; `gridCellStyle.ts:32-86` | Nothing. Colour, shape (`alertIcon`), optional words chip, tooltip. A single click selects (`:401-407`) and a double-click edits the stored date (`:408-413`). `deadline`-type cells can't be edited and do nothing on click. The context menu hides Paste and Clear for them (`GridContextMenu.tsx:130`). Delete is blocked (`gridKeyboardNav.ts:211-216`). | — | To mark something done you have to leave the list. |

The shared pieces already exist:
- `views/dashboard/useDeadlineActions.tsx:41-106` has the one set of Done / Done on… / Extend… / Remove extension logic and its dialogs: meter reading, Renewed or Finished, which day. The dashboard row and the calendar panel use it. The profile doesn't.
- `views/dashboard/completeDeadline.ts:116-202`: `completeDeadlines()` makes one undo step with a toast and patches the grid store cell (`patchCell`, `:47-50`).
- `views/dashboard/extendDeadline.ts:10-43`: `extendDeadline()` and `removeExtension()`, both undoable with a toast.
- Focus mode (`views/focus-mode/ClientFocusItem.tsx`) calls `completeDeadline` directly. It's out of scope here (see Risks).

Screens: `ux-review-shots/after-phase1/12-profile.light.png` (cards with Done and Extend… only), `11-dashboard.*.png`, `15-calendar.*.png`, `10-grid.*.png`.

### B. Column rename

`components/grid/ColumnHeader.tsx`:
- A click on the name sorts, after a 250 ms wait (`SORT_CLICK_DELAY`, `:38-39`, `:269-274`) so a double-click can rename instead (`:275-278`). Every sort click is a quarter-second late.
- Rename is an underline input in place of the name (`:249-264`), with a duplicate-name guard (`:173-187`). The menu also has "Rename" (`:377-383`).
- The menu opens from "…" (`:319-332`) or a right-click (`:226-231`), anchored at the pointer or at the "…" button (`:342-355`).
- The sort arrows show only on hover when the column is unsorted (`:312-315`, `data-testid="sort-hint"`).
- FAQ `views/help/faqData.tsx:139-141` ("grid-sort") says "Click any column header to sort…".
- Tests: `tests/renderer/components/grid/ColumnHeader.test.tsx:137-175` (click sorts, cycles, double-click renames).

### C. Column resize (most of it exists)

- Drag: `GridHeaderRow.tsx:68-82` has a 6 px handle (`w-1.5`) at 20 % opacity, tooltip "Drag to resize · Double-click to auto-fit". `DataGrid.tsx:372-376` sets `columnResizeMode: 'onChange'`, so widths follow the pointer live.
- Saving: `hooks/useGridColumnSizing.ts:64-86` waits 500 ms, then one `COLUMN_BATCH_UPDATE_WIDTHS`. It's also saved on leaving the list (`:54-56`).
- Fit: `useGridColumnSizing.ts:89-105` estimates width from character counts (`CHAR_WIDTH_HEADER 9`, `CHAR_WIDTH_CELL 8`, `HEADER_PADDING 72`, `CELL_PADDING 32`, `gridConstants.tsx:20-23`) over at most 500 rows, capped at 400 px. Double-click on the handle (`GridHeaderRow.tsx:73`) and the menu's Narrower · Fit · Wider (`ColumnHeader.tsx:412-428`) both use it.
- Gaps: the handle is hard to see and to grab. Fit underestimates wide text and bold headers and ignores the header's icons (clock, sort, "…"), so names still truncate after Fit. Nobody has measured whether a drag re-renders rows.

## The change

### 1. The deadline card (shared)

New folder `src/renderer/components/deadlines/`:

- **`useRecordDeadlines.ts`**: `useRecordDeadlines(rowIds: number[] | null)` calls `DEADLINES_GET { rowIds }` once and returns `Map<"rowId:columnId", ExtendedDeadlineInfo>`, plus `reload()`. `toInfo()` and the `Loaded` type move here from `CalendarItemPanel.tsx:191-209` unchanged. It reloads on `pulseEvents` `deadline:changed` and on `IPC.CASE_LOG_CHANGED` for these rows (quota counts), as `DeadlinePanel.tsx:216-224` does today. The engine in main is the single source, so the grid card, the profile, the calendar and the dashboard can't disagree.
- **`DeadlineCardContent.tsx`**: the body. It takes `info`, `where: 'grid' | 'profile' | 'calendar' | 'dashboard'`, `layout: 'stack' | 'row'`, `onChanged` and `onDone`, and calls `useDeadlineActions`. It renders:
  - Words (stack layout only; the dashboard row already shows them): "Due Oct 26 · in 11 days", using the same `formatDue` + `daysAwayLabel`/`daysOverdueLabel` as `CalendarItemPanel.tsx:273`; "Last done Sep 26" when `act.recurring`; `info.label` for non-interval kinds that aren't used up; `info.detail` (the engine's line).
  - Buttons, always in this order:
    1. **Done**, or "Mark {step} done" for a sequence; for quota, **Renew…**, which opens the record (hidden on the profile, where the start, end and "how many" fields are right there).
    2. **Done on…** when `act.canPickDay`.
    3. **Extend…**, or **Remove extension** when `info.extensionId`.
    4. **Open {record}** (`t('record')`), hidden when `where === 'profile'`.
    5. **Change date…**, only for `date` columns (not `deadline` type), on the grid and the profile. On the grid it closes the card and opens that cell's editor (`setEditingCell`). On the profile it starts the panel's existing date editor (`DeadlinePanel.tsx:282-301`).
  - When the state is `done` or `paused`, or there's no due date: the words ("Done", "Paused", "Nothing due yet") and no Done or Done on…. Add `canMarkDone` to `useDeadlineActions` for this (today `DeadlinePanel.tsx:327` works it out locally).
  - Buttons use the existing `btn-compact-primary` / `btn-compact-secondary` classes, or Q5's `PrimaryButton`/`SecondaryButton` if Q5 has landed (Wave A runs first). Every button is ≥44 px high with a 3 px focus ring.
- **`DeadlineCard.tsx`**: the popover shell for the grid. It's portalled, anchored under the cell, flips above when there isn't room and stays inside the window with a 16 px margin. It's 320 px wide (`max-width: calc(100vw - 32px)`), `role="dialog"`, `aria-labelledby` the title, and its title is "{column name} · {record name}". It uses `useFocusTrap` with focus on the first button. Escape or a click outside closes it and puts focus back on the cell. A grid scroll closes it too, so it never floats loose. It loads its info through `useRecordDeadlines([rowId])` and shows "Loading…" for the brief fetch, as the calendar does.
- **`DeadlineCardHost.tsx`**: listens to a new `pulseEvents` event `'deadline:open-card': { rowId: number; columnId: number; anchor: HTMLElement }` and renders one `DeadlineCard` at a time. It's mounted once in `GridView.tsx`, next to `<DataGrid />` (`GridView.tsx:187`). Because it's an event and not a prop, `SortableRow`'s memo comparison (`SortableRow.tsx:514-545`) doesn't change.

`useDeadlineActions.tsx` stays where it is. Moving it would touch more files and the source-scanning tests. It gains `canMarkDone` and keeps its dialogs.

### 2. Where the card appears

| Place | How it shows | Change |
|-|-|-|
| Grid | Popover | Ways to open it: **(a)** a click on the cell's deadline shape (`alertIcon`, `SortableRow.tsx:492`), which becomes a `button` with `tabIndex={-1}`, `aria-label="Deadline: mark done or extend…"`, and `hit-44`, keeping the existing `aria-hidden` on the shape itself; **(b)** a single click anywhere in a `deadline`-type cell (these can't be edited, so a click does nothing today); **(c)** **Space** on a focused cell whose column has a rule (in `gridKeyboardNav.ts:187-208`, plain Space currently only toggles checkboxes); **(d)** a new first item in the context menu's "This cell" group, **"Mark done or extend…"**, for cells with a rule (`GridContextMenu.tsx:114-130`). That also covers Shift+F10 and the ContextMenu key (`SortableRow.tsx:416-419`). Double-click on a date cell still edits the date. |
| Profile | Inside each deadline card | `DeadlinePanel.tsx` keeps its cards, colours, progress bar, steps list and date editor. Its button row (`:461-487`), its separate Remove extension link (`:347-353`) and the step "Mark done" button (`:362-366`) are replaced by `<DeadlineCardContent where="profile" layout="stack" />`, without the words, which the card already shows. The local `extendingCol` / `askReading` / `askOneOff` / `doneBusy` state and `markDone` / `markStep` (`:139-142`, `:245-280`, `:503-524`) go away. The panel gets its `ExtendedDeadlineInfo` from `useRecordDeadlines([row.row_id])`. After Done or Undo, `onChanged` runs the existing `refreshRow()` (`:257-264`), so the page shows the new date. The profile **gains Done on…** and 44 px buttons. Sequence rules get "Mark {step} done" in the same row as everywhere else. |
| Calendar | Side panel (P5's `CalendarPanel`) | `CalendarItemPanel.tsx`'s private `DeadlineActions` (`:213-246`) and fetch (`:256-270`) are replaced by `useRecordDeadlines([item.rowId])` + `<DeadlineCardContent where="calendar" layout="stack" />`. The panel shell stays: converge on P5's panel, don't replace it. Follow-ups are unchanged. |
| Dashboard | Inline in the row | `DeadlineRow.tsx:108-162` is replaced by `<DeadlineCardContent where="dashboard" layout="row" info={deadline} />`, without the words, which the row already shows. Its info is already `ExtendedDeadlineInfo` from the dashboard query, so no extra fetch. **The order becomes Done · Done on… · Extend…** (today Extend… comes first). Open stays on the name link. Show "Open {record}" in the row as well only if the row has room at 1280 px; otherwise the name link is enough. Decide from the screenshot. |

The words on the buttons, their order, their tooltips (`act.doneTitle`, "It happened on an earlier day: choose which", "Give it a new due date, with a reason") and the dialogs they open are the same in all four places, because one component renders them.

### 3. Click a column name to rename it, with the menu below

In `ColumnHeader.tsx`:
- **A click on the name** (or Enter/Space when it has focus) turns the name into the text box with the text selected **and** opens the column menu right under the header, anchored to the header's bottom-left (`rootRef.getBoundingClientRect()`), not to the pointer. Focus stays in the text box. ArrowDown moves into the menu (`useMenuKeys`, already used at `:93`). Enter saves and closes both; Tab saves and moves into the menu; Escape puts the old name back and closes both. A click outside saves if the name changed and is valid, and closes. Choosing a menu item first saves a changed, valid name, then does the item. The duplicate-name guard (`:173-187`) still applies: the box stays open with the existing error toast.
- **Sorting moves to the arrows.** The sort indicator (`:301-316`) becomes a real button that's always visible: `ChevronsUpDown` at muted colour when unsorted, `ChevronUp`/`ChevronDown` when sorted. Its `aria-label` is "Sort by {column}" or "Sorted A to Z: click to reverse"; it's `hit-44` and keeps the same three-step cycle (`handleSortClick`, `:147-171`), with Shift+click for multi-column sorting. The menu keeps "Sort ascending / descending" first. `SORT_CLICK_DELAY` and its timer (`:38-39`, `:74-75`, `:269-277`) are deleted, so sorting is instant.
- The "…" button and right-click still open the menu without renaming. The menu keeps "Rename" for that path.
- The tooltip on the name changes from "Click to sort · Double-click to rename" (`:266`) to "Click to rename or change this column".
- `aria-sort` on the header (`GridHeaderRow.tsx:51`) is unchanged.
- FAQ "grid-sort" (`faqData.tsx:139-141`) becomes: "Click the arrows next to a column's name to sort by it; click again to reverse. Hold Shift and click another column's arrows to sort by both. You can also click the column's name and choose Sort ascending or Sort descending." Add a sentence to the column-rename FAQ entry if there is one (grep "rename" in faqData).

This is a deliberate move away from the spreadsheet "click header = sort" convention, so it gets a Decision Log row (see Risks). Fallback if the owner rejects it after the screenshot check: keep click = sort and make the menu open under the header when renaming starts (double-click or menu "Rename"). Steps 5–6 are written so that swap is one commit.

### 4. Resize: easy to grab, instant, honest Fit

- `GridHeaderRow.tsx:68-82`: the handle becomes a 12 px hit zone straddling the border (`right: -6px`, `z-20`) that draws a 3 px bar: transparent at rest, `slate-400` when the header is hovered, `blue-500` on hover, focus or drag. Cursor `col-resize`. Same tooltip text, in sentence case: "Drag to resize · Double-click to fit". The handle is pointer-only; the keyboard way is the menu's Narrower · Fit · Wider, which stays.
- `useGridColumnSizing.ts`: `autoFitColumn` measures instead of estimating. One shared off-screen canvas `measureText` using the grid cell's computed font (read once from a `.grid-cell`, falling back to the 15 px system stack), and the header's font (semibold) plus the real icon widths: drag handle 0 because it shows on hover, rule clock 24, sort button 24, "…" 32, padding. `cellFitText` (`CellDisplay.tsx`) stays the source of what a cell shows. Sampling stays at 500 rows; the cap stays at 400. The `CHAR_WIDTH_*` constants stay only as the fallback when canvas isn't available (jsdom).
- Save when the drag ends (`mouseup`/`touchend` on the handle calls `flushColumnWidths`) instead of waiting out the 500 ms debounce. The debounce stays for menu presses.
- **Measure before optimising:** add a DataGrid perf case to `tests/perf/datagrid.perf.tsx` with 500 rows × 20 columns, 30 consecutive `columnSizing` changes on one column, recording React commit time per change. Target: below 16 ms each. If it misses, make sure widths reach rows only through the `--cw-*` CSS variables (`useGridColumnSizing.ts:121-128`) and that `SortableRow` doesn't re-render on `columnSizing`, for example by not passing `columnSizing` through `tableState` (`DataGrid.tsx:356`) to the rows' render path. Record the before and after numbers in the commit message.

## Files owned

New:
- `src/renderer/components/deadlines/useRecordDeadlines.ts`
- `src/renderer/components/deadlines/DeadlineCardContent.tsx`
- `src/renderer/components/deadlines/DeadlineCard.tsx`
- `src/renderer/components/deadlines/DeadlineCardHost.tsx`
- `tests/renderer/components/deadlines/DeadlineCard.test.tsx`
- `tests/renderer/components/deadlines/deadlineCardParity.test.tsx`
- `tests/renderer/components/deadlines/useRecordDeadlines.test.tsx`
- `tests/renderer/components/calendar/CalendarItemPanel.test.tsx`
- `e2e/ux-review/Q3.spec.ts` (git-excluded harness)

Edited (owned for this wave):
- `src/renderer/views/dashboard/useDeadlineActions.tsx`
- `src/renderer/views/dashboard/DeadlineRow.tsx`
- `src/renderer/components/calendar/CalendarItemPanel.tsx`
- `src/renderer/components/profile/DeadlinePanel.tsx`
- `src/renderer/components/grid/SortableRow.tsx` (deadline shape as a button; click on `deadline`-type cells)
- `src/renderer/components/grid/gridKeyboardNav.ts` (Space)
- `src/renderer/components/grid/GridContextMenu.tsx` ("Mark done or extend…")
- `src/renderer/components/grid/GridHeaderRow.tsx` (resize handle)
- `src/renderer/hooks/useGridColumnSizing.ts`
- `src/renderer/components/grid/gridConstants.tsx` (icon widths for Fit)
- `tests/renderer/components/profile/DeadlinePanel.test.tsx`, `tests/renderer/components/grid/ColumnHeader.test.tsx`, `tests/renderer/components/grid/GridHeaderRow.test.tsx`, `tests/renderer/components/grid/GridContextMenu.test.tsx`, `tests/perf/datagrid.perf.tsx`

Shared files touched narrowly (name the hunk, keep it small):
- `src/renderer/components/grid/ColumnHeader.tsx`: Q3 owns the name/rename/sort/menu-anchor parts (`:38-39`, `:57-75`, `:147-187`, `:249-332`, `:342-383`). **Q4 edits only `handleDelete` (`:189-194`) and the delete `ConfirmDialog` block (`:562-582`).** Merge Q3 first.
- `src/renderer/views/GridView.tsx`: one line mounting `<DeadlineCardHost />`. Q4 stays out of this file.
- `src/renderer/events.ts`: add `'deadline:open-card'` to the event map (append only).
- `src/renderer/views/help/faqData.tsx`: the "grid-sort" entry only. Q1b and Q7 may also edit FAQ entries; touch only that entry's `answer`.
- `src/renderer/components/shared/KeyboardShortcutsModal.tsx`: one row, "Space: on a deadline, mark done or extend". Check `tests/shortcuts.test.ts` for its key list or exemptions.

Not touched (other owners): `DashboardView.tsx` (Q2), `DataGrid.tsx` and `GridDialogs.tsx` (Q4), `undoStore.ts` / `UndoToast.tsx` (Q4), ConfirmDialog / Dialog / Button primitives (Q5), `FocusModeView.tsx` / `ClientFocusItem.tsx` (follow-up), `tourSteps.tsx` (Q7).

## Commit steps

Run `npm run gate` before every commit. Run `npm run test:tz` after step 2 (date words) and at the end.

1. **Shared card content, calendar and dashboard converge.** Add `useRecordDeadlines` (move `toInfo` / `Loaded` out of `CalendarItemPanel`), `DeadlineCardContent`, and `canMarkDone` in `useDeadlineActions`. Switch `CalendarItemPanel` and `DeadlineRow` to it. Dashboard order becomes Done · Done on… · Extend…. Tests: `useRecordDeadlines.test`, `CalendarItemPanel.test`, the first half of the parity test.
2. **Profile uses the same actions.** `DeadlinePanel` loads info with `useRecordDeadlines`, renders `DeadlineCardContent where="profile"`, and loses its own Done / Extend / meter / one-off / step wiring. It gains Done on… and 44 px buttons. Update `DeadlinePanel.test.tsx`; the parity test now covers the profile.
3. **Grid card.** Add `DeadlineCard` and `DeadlineCardHost`, the `deadline:open-card` event, the mount in `GridView`, and the four ways to open it (shape click, `deadline`-cell click, Space, context menu). Done patches the cell (already in `completeDeadlines`) and calls `useGridStore.getState().refreshDeadlineContext()` in `onChanged`. Tests: `DeadlineCard.test`, a keyboard-nav test for Space, the `GridContextMenu.test` item, parity on the grid.
4. **Change date… from the card** (grid and profile, date columns only). Add a test that the grid path opens the cell editor.
5. **Click the name to rename, with the menu below; sort on the arrows.** Remove `SORT_CLICK_DELAY`. Rewrite `ColumnHeader.test.tsx:131-175`. Update the FAQ entry. Run `npm test -- tests/renderer/components/shared/TourOverlay.test.tsx` and the tour target scan in case a tour step points at the header name.
6. **Resize.** The bigger handle, measured Fit, save on drag end, and the perf case (numbers in the commit message). Update `GridHeaderRow.test.tsx`.
7. **Screenshots and polish.** Run `e2e/ux-review/Q3.spec.ts`, fix what the screenshots show, and add the Decision Log rows to CLAUDE.md in the same commit.

## Acceptance checks

Behaviour:
- For one deadline ("Last Contact" on a sample record), the grid card, the profile card, the calendar panel and the dashboard row show **the same buttons in the same order with the same words and tooltips**. The parity test asserts this; the screenshots confirm it.
- Done on the grid card: the cell's colour and date change at once, the Undo toast says what happened ("Marked "Last Contact" done for Maria Garcia; next due …"), and Undo puts the cell back.
- The profile shows Done on…. A meter rule asks for the reading, a one-off asks Renewed or Finished, a sequence shows "Mark {step} done", a quota shows no Done on the profile and Renew… elsewhere, and a finished or paused deadline shows no Done. All of these behave the same in all four places.
- Keyboard: arrow to a date cell with a rule, press Space, and the card opens with focus on Done. Escape closes it and focus is back on the cell. Shift+F10 then "Mark done or extend…" does the same.
- Clicking a column name opens the text box with the name selected and the menu under the header. Typing a new name and pressing Enter renames it (one undo step, as today: `gridColumnSlice.ts:153-161`). Escape changes nothing. Clicking the arrows sorts at once, with no 250 ms wait.
- Dragging a column edge follows the pointer with no visible lag at 500 rows. Double-clicking the edge fits so that the header name and the longest sampled value both show untruncated, up to 400 px. The new width is still there after switching lists and back.
- No migration (schema stays at 50), no new IPC channel, no new network call. `npm run gate` and `npm run test:tz` pass.

Screenshots (`env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q3.spec.ts --reporter=line`; `openSeededApp()` from `e2e/ux-review/harness.ts`, `shotter('Q3')`, light and dark at 1366×768, plus 1280×720 for the dashboard row):
- `Q3/grid-card.{light,dark}.png`: Space on a Last Contact cell; the card sits inside the window, under the cell.
- `Q3/grid-card-bottom-row.light.png`: the card on the last visible row flips above it and isn't clipped.
- `Q3/profile-deadlines.{light,dark}.png`: Done · Done on… · Extend… on each card.
- `Q3/calendar-panel.light.png`: a deadline chip clicked.
- `Q3/dashboard-row.light.png` at 1280×720: Done · Done on… · Extend… with nothing wrapping onto two lines.
- `Q3/header-rename-menu.{light,dark}.png`: the name in a text box and the menu right under the header.
- `Q3/resize-hover.light.png`: the handle's bar visible on hover.
- Print `visibleText(page)` with each card open and check the button labels match across the four.

## Tests to add or update

- `deadlineCardParity.test.tsx` (new, the key guarantee): render `DeadlineRow`, `CalendarItemPanel` (mocked `DEADLINES_GET`), `DeadlinePanel` and `DeadlineCard` for the same interval, meter, one-off, sequence, quota and extended deadline. Assert the ordered list of button accessible names is identical, minus Open on the profile and minus Change date… on the calendar and dashboard. Call `setWords()` with a non-default vocabulary so "Open {record}" proves it uses the vocabulary layer.
- `DeadlineCard.test.tsx`: opens from the event, focus lands on Done, Escape restores focus to the anchor, a click outside closes, it flips near the bottom, and it shows "Loading…" then content.
- `useRecordDeadlines.test.tsx`: maps rows to `ExtendedDeadlineInfo` exactly as the calendar did (port the `toInfo` cases), and reloads on `deadline:changed`.
- `CalendarItemPanel.test.tsx`: deadline and follow-up branches. There are no tests for it today.
- `DeadlinePanel.test.tsx`: Done on… present; 44 px (`minHeight` or `hit-44`); no local dialogs; the date editor still works.
- Grid keyboard: Space on a rule cell emits `deadline:open-card`; Space on a checkbox still toggles; Shift+Space still selects.
- `GridContextMenu.test.tsx`: "Mark done or extend…" only on cells with a rule.
- `ColumnHeader.test.tsx`: a click on the name opens rename + menu (no sort call); the arrows button sorts asc → desc → off at once; Shift on the arrows multi-sorts; Escape restores the name; a duplicate name keeps the box open.
- `GridHeaderRow.test.tsx`: double-click on the handle calls fit; save on drag end; Fit uses the measured width when `measureText` is stubbed.
- `tests/renderer/a11y/clickTargets.test.ts` reads `SortableRow.tsx`. Keep the new shape button `hit-44` so it passes, and update that test's expectations if it counts buttons.
- `tests/renderer/vocabStaticText.test.tsx` / the eslint vocab rule: no "client" and no hard-coded "record" in the new files.

## Risks

- **Click-to-sort convention.** People who know spreadsheets expect a click on a header to sort. Mitigations: always-visible arrows, Sort first in the menu, the FAQ, and the fallback described in §3. Decision Log row (add in step 7): `| 2026-10-xx | A click on a column's name renames it, with the column menu under it; sorting is on the arrows beside the name and in the menu | Phase 2 idea 3 ("change things where you see them"); removes the 250 ms sort delay and the hidden double-click; 2026-10-14 UX review for non-technical users |`
- **One deadline card**: Decision Log row: `| 2026-10-xx | One deadline card (Done · Done on… · Extend… · Open) on the grid, the profile, the Calendar and the dashboard, all from main's DEADLINES_GET | The same deadline offered different actions in each place; the profile had no Done on…; the grid had none at all |`
- **Engine parity.** The grid's colours come from the renderer engine; the card's words come from main. They share `src/shared/deadlineEngine.ts`, so they should agree. `deadlines-parity` tests exist; if the card ever disagrees with the cell, the cell's tooltip (`alertTooltip`) is the thing to compare.
- **Grid performance.** The host is mounted once and opened by event; the shape button adds no props to `SortableRow`, so its memo stays intact. Check with the perf case.
- **Profile refresh.** The profile today re-reads the row after Done (`refreshRow`). Keep that in `onChanged`, or the card shows the old date until the next visit.
- **Merge overlaps.** `ColumnHeader.tsx` with Q4 (separate hunks; merge Q3 first). `DeadlineRow.tsx` / dashboard with Q2 (Q2 owns `DashboardView.tsx`; if Q2 needs a "next step" link in the row, it adds a prop, not a new button set). Q5's primitives: if Q5 renamed the button classes or added a `Popover`, use them. Q6 (Wave C) will animate the card and the Done row; leave room, don't add motion here.
- **Focus mode** keeps its own buttons (`ClientFocusItem.tsx`). Moving it onto `DeadlineCardContent` is a one-file follow-up for Wave C or Phase 3; list it in the README, don't do it here.
- **Source-scanning tests** that name paths (`tests/renderer/a11y/clickTargets.test.ts`, the tour target scan): run them after each step.
