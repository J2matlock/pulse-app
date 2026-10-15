# R5 — Keyboard and focus: your place stays where you left it

Phase 3 polish, **Wave 2** (after R1 and R3 merge; both touch files this plan owns the rest of). Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows #3, #12, #13, #16 and #17.

## Goal

Someone working only from the keys always knows where they are and never has to start again from the top. After Enter saves a cell, the place stays. The first cell is a few keys away, not 66. Arrows stop at the edge. Every focus ring is a full 3 px box. Dangerous controls are never the first thing focused. Hint bubbles never cover what they point at and close with Esc. The password screen doesn't trip a fast typist.

## Personas and findings

- **Mark** (#3): after Enter saved "Rosa Delgado", no cell was lit and the arrows did nothing (`persona-mark/51-right.png`). After Enter on a date, the blue box stayed drawn but the arrows were dead (`85-after-date-enter.png`, `86-arrow-up.png`). He learned to use Tab instead.
- **Mark** (#13): 66 Tabs from the top to the first cell, three stops per column header (`57-tab-60.png`, `58-tab-70.png`). He overshot once and locked the app (`61-oops-locked.png`). Shift+Tab twice "from nowhere" got him in, and nobody told him. Left arrow from the first cell wrapped to the last cell of the row above, and Shift+F10's menu didn't name the record (`124-shift-f10.png`). The lit cell slid under the frozen Name column (`108-needs-bg-cell.png`). The sidebar ring was thin lines above and below the word (`53-sidebar-focus-tasks.png`). Help's Tab order hit "Take the tour" before the answer (`68-tour-by-accident.png`). New report filter rows appear above the ring (`147-add-filter.png`; ReportBuilder is R7's, see there). The example picker let the ring escape the dialog (`29-focus-escaped-dialog.png`; ApplyStarterDialog is R8's, see there).
- **Bobby** (#17): the header's clock slid under his pointer as the drag handle and sort arrows appeared, so he opened the ⋯ menu instead (`persona-bobby/r-13a-hover-clock.png`).
- **Joe** and **Mark** (#16): on the password screen, Tab went to the eye button and Enter then showed the password in plain text (`persona-joe/p1-02-enter-without-terms.png`). "The two passwords don't match" blamed an empty second box (`p1-04-after-create.png`).
- **Linda**, **Joe**, **Candy** (#12): hint bubbles covered the icons they described (`persona-linda/30-reopen.png`), sat on Scratch notes when talking about the note box (`65-after-click-daniel.png`), ignored Esc and covered the dashboard's top rows (`persona-joe/p9-02-esc-hint.png`), and the colour key opened on top of a bubble (`persona-linda/31-colors.png`).
- **Joe**: the selected row was "only a faint blue" before he trashed Bergstrom with the ghosts (`persona-joe/p7-02-five-selected.png`).
- **Bobby**: "Privacy Policy" sends him to a website to learn whether the app uses the internet (`persona-bobby/02-privacy-policy.png`).

## Current behaviour

- `hooks/useGridCellNavigation.ts:85,91`: `next-row` on the last visible row returns `false` with no focus change. `grid/SortableRow.tsx:476-478` calls `onNavigateAfterEdit` and ignores the result, so the editor unmounts and focus falls to `<body>`. `DataGrid.tsx:487-489` passes `navigateCell` straight through. When the save re-sorts the list (a date column under a deadline sort), the target is computed on the old order and the 0 ms `focus()` (`useGridCellNavigation.ts:100-107`) can miss the moved row. `selectedCell` still draws the box.
- `useGridCellNavigation.ts:81-83`: `prev-col` from the first column wraps to the previous row's last column. ArrowLeft uses it (`gridKeyboardNav.ts:110-119`); Tab should wrap, arrows shouldn't.
- `grid/ColumnHeader.tsx:340-420`: the name, the deadline clock badge (`:346-360`) and the ⋯ trigger are each a Tab stop. The hover reveals a drag handle and sort arrows that shift the clock.
- `layout/MainLayout.tsx:194-204`: "Skip to main content" focuses `<main>`, not the list.
- `layout/Sidebar.tsx:188`: `focus-visible:ring-3` on full-width items inside `nav … overflow-y-auto` (`:566`). The horizontal overflow clips the ring's left and right sides.
- `grid/GridContextMenu.tsx`: the row menu has no visible heading naming the record.
- `views/PasswordSetupView.tsx:282-285`: the eye toggle sits between the password and confirm fields in Tab order. `:79` says "don't match" even when the second box is empty.
- `onboarding/ScreenHint.tsx` + `screenHints.ts`: the placement doesn't avoid its target or the neighbouring panel. Esc isn't handled. It can show while another popover is open.
- `SortableRow.tsx`: the selected-row background is a pale blue.

## The change

### 1. The place stays after a save (grid)

- `useGridCellNavigation.navigateCell` stays boolean. `DataGrid.handleNavigateAfterEdit` returns its result. `SortableRow`'s `onSave`: when navigation returns `false` (last row, last column), `setSelectedCell(rowId, colId)` and focus the same cell on the next frame.
- **Re-find after a re-sort**: the scheduled focus (`useGridCellNavigation.ts:100-107`) re-queries by `selectedCell` (rowId + colId), not the computed element, after `requestAnimationFrame` (two frames when the rows array changed), and calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })`. Then it nudges horizontal scroll so the cell isn't under the frozen columns: if `cell.left < frozenRightEdge`, scroll left by the difference, using `frozenLeftOffsets` from DataGrid.
- **The dead box**: in `DataGrid.tsx`, a `keydown` listener on `document` (removed on unmount). If `document.activeElement === document.body` and `selectedCell` is set and no dialog is open, the arrow keys, Enter, F2 and Tab focus `selectedCell`'s element and handle the key. The drawn box never lies.

### 2. Arrows stop at the edge; one Tab stop per header

- `navigateCell` gains an internal `wrap` flag: Tab and Shift+Tab wrap (as today), the arrow keys clamp at the first and last column. `gridKeyboardNav.ts:110-119`: ArrowLeft at the first column (no priority badge) does nothing.
- **Header**: in `ColumnHeader.tsx`, the name button is the column's one Tab stop. The clock badge and ⋯ get `tabIndex={-1}`. On the focused header, **ArrowDown** or **Alt+ArrowDown** or **Shift+F10** opens the ⋯ menu, and **Space** on a deadline column opens the colour key (the clock's job). The header's `aria-describedby` hint says so. `GridHeaderRow.tsx`: ArrowLeft/ArrowRight move between headers (roving). So Tab enters the header row once and a second Tab goes into the cells. The grid's own Tab order goes: toolbar → header row (1 stop) → the current/first cell.
- **Hover doesn't move anything**: reserve the drag-handle and sort-arrow width in the header layout at all times (visibility, not display), so the clock stays where it is on hover. Give the clock badge a 32×32 hit area (it's 17×13 now, per Mark's list), keeping the 44 px header height.
- **"Skip to the list"**: on a grid route, the skip link reads "Skip to the list" and focuses `selectedCell` or the first cell (through a small `pulseEvents.emit('grid:focus-cell')` that DataGrid listens to). Elsewhere it stays "Skip to main content".
- The ? shortcut sheet (`KeyboardShortcutsDialog` or the like; find it with `grep -rln "Shift+F10" src/renderer/components`) gains: "Shift+Tab twice from the top, or the 'Skip to the list' link, goes straight to the list", "On a column name: ↓ opens its menu".

### 3. Rings and menus that say where you are

- `Sidebar.tsx`: items use `focus-visible:ring-inset` (or `outline-3 -outline-offset-3`), so the full box shows inside the scrolling nav. Check every focusable in the sidebar, including the list ⋯ (`:216`, `:344`, `:552`, `:661`).
- `GridContextMenu.tsx`: the row menu's first line is a non-focusable heading with the record's name (bold, 15 px), with `aria-label` "{Record} menu for {name}". Danger items stay last after a separator.
- `SortableRow.tsx`: the selected row gets a stronger fill (blue-100 / blue-900/50) and a 3 px left bar in blue-600, so "selected" can't be mistaken for "hovered". Check contrast in both themes.

### 4. Hint bubbles

- `ScreenHint.tsx`: Esc closes and counts as "seen". The bubble is placed with `computeTooltipPosition` on the side away from its target, so it never overlaps the target's rect, re-measured on resize. Before showing, it checks that no dialog, popover, colour key or first look is open (`document.querySelector('[role="dialog"], [data-popover-open]')`), and waits otherwise.
- `screenHints.ts`: the profile hint "Write what happened in the note box" anchors to the composer's "+ {Activity}" button, not the page column. The grid hint "This icon opens a {record}'s page" anchors to the first row's open icon and sits beside it.

### 5. Password screen

- `PasswordSetupView.tsx`: the eye toggle moves after both fields in Tab order (DOM order: password, confirm, then one "Show passwords" toggle that shows both). Enter in either field submits the form; Enter never toggles the eye.
- An empty second box: "Type the password again in the second box." Only when both are filled and differ: "The two passwords don't match. Type the same password in both boxes."
- Under the title, one sentence that answers Bobby before the link: "Pulse keeps everything on this computer. Nothing is sent anywhere." The Terms and Privacy links stay.

### 6. Help: answers before the tour button

`views/HelpView.tsx`: when the search box has text, the results come next in Tab order, and the "Take the tour" button moves after the results (DOM order, not `tabIndex`). Search results are reachable with ArrowDown from the search box.

## Files owned

- `src/renderer/hooks/useGridCellNavigation.ts`, `src/renderer/components/grid/gridKeyboardNav.ts`
- `src/renderer/components/grid/SortableRow.tsx` (all except R1's `onDiscard` prop line), `src/renderer/components/grid/DataGrid.tsx` (`handleNavigateAfterEdit`, the body-focus listener, the `grid:focus-cell` listener)
- `src/renderer/components/grid/ColumnHeader.tsx` (the header buttons and layout, `:340-420`; **not** the menu block or delete dialog, which are R3's) and `src/renderer/components/grid/GridHeaderRow.tsx`
- `src/renderer/components/grid/GridContextMenu.tsx`
- `src/renderer/components/layout/MainLayout.tsx`, `src/renderer/components/layout/Sidebar.tsx`
- `src/renderer/components/onboarding/ScreenHint.tsx`, `src/renderer/components/onboarding/screenHints.ts`
- `src/renderer/views/PasswordSetupView.tsx`, `src/renderer/views/HelpView.tsx` (button order only)
- The shortcuts sheet component (two lines)
- Tests: `tests/renderer/hooks/useGridCellNavigation.test.ts`, `tests/renderer/components/grid/gridKeyboardNav.test.ts`, the SortableRow, DataGrid, ColumnHeader, GridHeaderRow, Sidebar, ScreenHint, PasswordSetupView and HelpView tests, `tests/renderer/a11y/` (focus-visible, click targets: `clickTargets.test.ts` reads `SortableRow.tsx`, so keep its path), `tests/shortcuts.test.ts`.

Not touched: `CaseLog.tsx` (R2 has Ctrl+Enter, focus after Add and the When date), `ColumnRulePicker.tsx` (R4 has its initial focus), `ReportBuilder.tsx` (R7 has filter-row focus), `ApplyStarterDialog.tsx` (R8 has the focus trap), `TrashView` / `DeletedColumnsSection` (R3 has focus after Restore).

## Commit steps

`npm run gate` before every commit. Rebase on main after R1 and R3 merge, before starting.

1. **The place stays.** `onSave` fallback, re-find after a re-sort, the frozen-column nudge, the body-focus fallback. Tests: Enter on the last row keeps focus on that cell; Enter on a date that re-sorts the row keeps focus on the same row's cell in its new place; with focus on body and `selectedCell` set, ArrowUp moves and focuses.
2. **Arrows clamp; one header stop; skip link.** Tests: ArrowLeft at the first column doesn't move; Tab still wraps; Tab from the toolbar reaches the first cell in ≤ 3 Tabs (count it in a jsdom test with 14 columns); ArrowDown on a header opens its menu; the clock doesn't move on hover (computed left equal before and after `mouseenter`); the skip link focuses a cell on the grid route.
3. **Rings, row menu, selected row.** Tests: sidebar items have `ring-inset`; the row menu's heading names the record; the selected row has the stronger class.
4. **Hint bubbles.** Tests: Esc closes and marks seen; no hint while a dialog is open; the placement rect doesn't intersect the target rect.
5. **Password screen and Help order.** Tests: Tab order password → confirm → toggle; an empty confirm gives the new message; Enter in confirm submits; Help results come before the tour button.
6. **Decision Log row, screenshots, a11y tests.**

## Acceptance

- **Mark's spec as regression.** `persona-mark.spec.ts` reads steps from the scratchpad `mark-steps.json` (git-excluded; copy `/tmp/claude-1000/-home-jmatlock-projects-pulse/2a9dd425-a6a6-4d51-b25c-60fd8a6e1417/scratchpad/mark-steps.json` next to the spec or set `MARK_STEPS`). Also write a keyboard-only `e2e/ux-review/R5.spec.ts` at 1366×768 that logs `document.activeElement` after each key, like Mark's spec does:
  - Ctrl+N, type a name, **Enter** → the active element is a grid cell (not `BODY (no focus)`), and ArrowDown or ArrowUp moves.
  - On a date cell: Enter, type 11022024, **Enter** → a cell is still focused, and the arrows move.
  - From the top of the page, Tab count to the first cell ≤ 6 (was 66), or 1 using "Skip to the list".
  - ArrowLeft on the first cell stays there.
  - The sidebar focus ring is a full box (screenshot `R5/sidebar-ring.light.png`).
  - Shift+F10 on a row shows the record's name at the top of the menu.
- **Bobby** (`persona-bobby.spec.ts` at Largest text): hovering the Claim filed clock doesn't move it (screenshot `R5/header-hover.light.png`).
- **Joe** (`JOE_PHASE=p1`): "Silverado240k", Tab, type again, Enter → the password is created (no eye toggle in between) and isn't shown in plain text.
- **Linda** (`linda 4`): the record-page hint sits next to "+ Note", not over Scratch notes. Esc closes a hint (`R5/hint-placement.light.png`).
- Screenshots light and dark for each of the above with `shotter('R5')`.
- `npm run gate` green. The `tests/renderer/a11y/` axe tests stay green. No new `eslint-disable`; exhaustive-deps warnings stay at 0.
- No migration, no network call. 3 px rings everywhere touched, 44 px targets (the clock hit area grows), 15 px text.

## Risks

- **Fewer header Tab stops** changes muscle memory for anyone who tabbed to the clock or ⋯. The arrow and menu keys are announced in the header's description and the shortcut sheet. Owner decision listed.
- **The body-focus fallback** must not steal keys from dialogs, menus or text fields: it acts only when `activeElement === body` and no `[role="dialog"]` is open.
- **Merge order**: R1's `onDiscard` hunk in SortableRow and R3's menu hunk in ColumnHeader land first. Rebase, don't overwrite them.
- **Perf**: the re-find uses `requestAnimationFrame`, no polling. Q9's grid perf tests (`npm run perf`) must not regress; run them once.

## Decision Log row

`| 2026-10-xx | Grid keyboard: after Enter saves, focus stays on the saved cell when there's no row below and follows the record after a re-sort; arrows stop at the edges (Tab still wraps); each column header is one Tab stop (↓ / Shift+F10 opens its menu, Space its colour key); "Skip to the list" focuses the current cell; hint bubbles close with Esc and never cover their target | 2026-10-15 persona study: a keyboard-only user lost his place after every Enter and needed 66 Tabs to reach the first cell (Mark) |`
