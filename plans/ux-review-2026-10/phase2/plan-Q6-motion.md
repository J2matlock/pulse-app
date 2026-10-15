# Q6 — Motion and feedback that explain what happened (Wave C)

Idea 6 of Phase 2 (ORCHESTRATION.md "The ten ideas"). When something changes, the screen shows *what* changed and *where it went*: Done → the row slides out and the counts tick; a new record or column slides in and lights up; archive/Trash shrinks the row away. 150–200 ms, nothing longer, and nothing at all for movement when reduced motion is on. Every click is acknowledged within ~100 ms (pressed look at once; a spinner only if the work takes more than 300 ms). Leftover from Phase 1: the Undo toast and react-hot-toast both sit bottom-right and overlap — one toast stack.

Runs in **Wave C**, after Wave B merges. Builds on:
- **Q5** (Wave A): the shared `PrimaryButton`/`SecondaryButton`/`DangerButton`, `Dialog` (pinned footer), `Confirm`, `EmptyState`, design tokens. Motion for dialogs goes into Q5's `Dialog`/`Confirm`; the `busy` behaviour into Q5's buttons. Use the paths Q5 merged.
- **Q4** (Wave B): reversible actions now act at once and show the Undo toast (~8 s) instead of a confirm. Q6's row-leave animation is what makes "it's gone, Undo is there" readable, and the toast stack must hold Q4's toasts. Q4 may have changed `UndoToast.tsx`/`UNDO_TOAST_MS` (`undoStore.ts:92`, 5000 today) — keep Q4's duration and hold rules.
- **Q3** (Wave B): the shared deadline card (Done, Done on…, Extend) on grid cells, profile, calendar, dashboard. Q6 gives its Done the busy state through `useDeadlineActions`, and the card's close a 150 ms exit.
- **Q2** (Wave B): the dashboard's next-step line ("3 visits overdue. Start with …") — its count uses `TickingNumber` too if it's a number in Q6's files; otherwise leave it.

Constraints: no migrations, no network, vocabulary layer for any new text, 15 px / 44 px / 3 px, `npm run gate` before each commit, no new `eslint-disable`. **Motion state is renderer-only** (no new settings, no DB).

---

## Current behaviour (code as of f4fc6be9, after Phase 1)

### Reduced motion — how the app does it today (keep this design)
- In-app switch: Settings → Appearance (`AppearanceSection.tsx:361-367`) → `settingsStore.reducedMotion` (`settingsStore.ts:24, 69, 87`, stored as `reduced_motion`).
- CSS: `useThemeEffect.ts:65` toggles `.reduce-motion` on `<html>`; `globals.css:566-570` sets every transition/animation to 0.01 ms under it. Each keyframe class also has its own `@media (prefers-reduced-motion: reduce)` block (`globals.css:301-304, 327-329, 341-343, 364-367, 379-381, 393-395, …`).
- JS animations: `AppMotionConfig.tsx:10-13` wraps every screen (`App.tsx:138, 150, 162, 174, 192`) in `MotionConfig reducedMotion={on ? 'always' : 'user'}` — motion then skips transform/layout animation and keeps opacity.
- Tests: `tests/renderer/a11y/reducedMotion.test.tsx`, `reducedMotionBeforeUnlock.test.tsx`, `tests/renderer/hooks/useThemeEffect.test.ts`.
- Gap: `.page-enter` (`globals.css:307-313`) has no `prefers-reduced-motion` block (it's also unused, see below).

### Motion that exists
- Shared variants `utils/animations.ts`: dropdown 280 ms in / 180 out (`:7-21`, "slow and slidey"), context menu 180/120 (`:24-36`), backdrop 200/150 (`:39-43`), modal panel **250**/150 with scale 0.95 + 16 px (`:46-60`), tooltip 120/80 (`:63-75`). Used by 27 components (`motion/react` imports: AlertRuleEditor, CategoryManager, ContactImportExport, AcuityBadge, AcuityConfigPanel, BulkEditDialog, DataGrid, FilterBar, FilterControls, GridContextMenu, GridGroupHeader, GridToolbar, ImportWizard, MoveToGridModal, SavedViewsDropdown, SupervisorReportDialog, Sidebar, TopBar, ChecklistTemplateEditor, CellHistoryPopover, ColumnSelectDialog, ConfirmDialog, ImportPreviewModal, KeyboardShortcutsModal, RecoveryKeyDisplayModal, ResetPasswordAfterRecoveryDialog, Tooltip, WhatsNewModal). 63 of the 83 files with `role="dialog"`/`aria-modal` don't import motion, so those dialogs open with no animation at all.
- CSS keyframes in use: `.alert-pulse`/`-dark` (`globals.css:286-300`), `.animate-check-pop` (TaskItem, ChecklistItem), `.animate-star-bounce` (Contacts only: ContactRow, ContactDetail, ContactCard).
- CSS keyframes **defined but used nowhere** in `src/renderer`: `.page-enter` (`:307`), `.animate-modal-enter` (`:337`), `.animate-toast-in/out` (`:346-367`), `.animate-cell-save` (`:375`), `.animate-status-fade` (`:389`), `.animate-row-highlight` (`:407`), `.search-mark-active`/`mark-pulse` (`:420-440`), `.animate-celebration` (`:452`), `.animate-slide-in/out` (`:479-500`).
- New column: widened, scrolled into view, header lit 1.5 s (`DataGrid.tsx:222-252`, `GridHeaderRow.tsx:53` — `bg-blue-100 ring-3`, `transition-colors duration-700`). No slide.
- Pressed state: `.btn` has `:active { transform: scale(0.97) }` (`globals.css:186-189`); `.btn-compact` (`:194-218`, 94 uses) has none; `.profile-btn-glow:active` (`:517`). 1,007 `<button>`s, ≈ 330 lines use `btn-*`; the rest are hand-styled with no pressed state.
- Save feedback: "Saving…/Saved" in the footer (`hooks/useSaveStatus.tsx:14-32`, used by `GridStatusFooter.tsx:115`, `StatusBar.tsx:29`).
- Delayed spinner: `SPINNER_DELAY = 200` (`shared/constants.ts:54`), used once (`DashboardView.tsx:128`).

### Actions that give no (or too little) feedback
- **Dashboard Done**: `DeadlineRow` → `useDeadlineActions.markDone` (`views/dashboard/useDeadlineActions.tsx:60-64`) awaits `completeDeadlines` with no busy state (a second click can fire a second Done); then `onMarkDone` drops the item from the list instantly (`DashboardView.tsx:617-626`). The list key includes the index (`` `dl-${rowId}-${columnId}-${i}` ``, `DashboardView.tsx:617`), so every row after it remounts and nothing can animate out. The tiles jump (`dashboard/SummaryCard.tsx:26`). Same for tasks (`DashboardView.tsx:629-637`) and Week/Month tabs (`WeekViewTab.tsx:120`, `MonthViewTab.tsx:67`).
- **Archive a record**: `gridRowSlice.ts:141-160` waits for `ROW_ARCHIVE` (and optionally the appointment cancel) with nothing on screen, then filters the row out — it just disappears. Trash (`deleteRow`) and Q4's undo-first actions behave the same.
- **Add a record**: `gridRowSlice.ts:80` sets `lastAddedRowId`; `DataGrid.tsx:489-522` scrolls to it and opens the name editor after 50 ms. No highlight (the unused `.animate-row-highlight` was meant for this — "Finding 2.5").
- **Slow IPC with no spinner** (numbers from `npm run perf` at 5,000 records, plan-Q9): PDF export ≈ 1.5 s, CSV export ≈ 356 ms, Empty Trash ≈ 483 ms, list load ≈ 240 ms. Some dialogs show "Saving…" text (`SupervisorReportDialog.tsx:445`, `CellConditionalFormatPanel.tsx:228`, `ImportResultsStep.tsx:156`), most buttons show nothing.

### Toasts overlap
- react-hot-toast `<Toaster position="bottom-right" toastOptions={{ duration: 5500 }}>` at `App.tsx:141, 153, 165, 185, 366` (≈ 300 `toast(...)` calls, incl. custom JSX toasts: `DataGrid.tsx:501-509` "Added — your filter would hide it", `RecoveryKeyReminderToast.tsx:57`).
- `UndoToast` is a separate fixed box `bottom-6 right-6 z-[300]` (`UndoToast.tsx:46`), rendered at `App.tsx:317`, timed by `undoStore.ts:173-190`. Both land in the same corner, so an Undo toast covers a "Saved the PDF" toast (and vice versa). Its text is `text-sm` = 14 px (`UndoToast.tsx:57`), under the 15 px rule.
- `BulkActionBar` sits `fixed bottom-12` centred (`BulkActionBar.tsx:107`); on narrow windows a toast can sit over its right end.

---

## The change

### 1. Motion tokens: one short set, used everywhere
- `utils/animations.ts`: export `MOTION = { fast: 0.12, base: 0.18, enter: 0.2 }` (seconds) and two easings (`easeOut`, `easeIn`). Retune: modal panel 250 → 180 ms in, 120 out, scale 0.98 (not 0.95) and 8 px; dropdown 280 → 160 / 120; backdrop 200 → 150 / 120. Context menu and tooltip already fit. Every variant reads from `MOTION`. Rename the "slow and slidey" comment.
- Q5's `Dialog` and `Confirm` use `backdropVariants`/`modalPanelVariants` so every migrated dialog animates the same way (the 63 unanimated ones get it as Q5 migrates them; Q6 doesn't touch the un-migrated ones).
- New `styles/motion.css`, imported from `globals.css` (one `@import` line): the CSS-side tokens `--motion-fast: 120ms; --motion-base: 180ms; --motion-enter: 200ms;` and the classes below. The unused keyframes listed above are **deleted** from `globals.css`; `row-highlight` moves to `motion.css` as `.motion-flash`.

### 2. Every click acknowledged within 100 ms
- Pressed look: add `&:active:not(:disabled) { transform: scale(0.97); transition-duration: var(--motion-fast) }` to `@utility btn-compact` (`globals.css:194-218`), matching `.btn`. Q5's button components get it through those utilities; no global `button:active` rule (it would hit grid cells and menu items).
- New `hooks/useBusyAction.ts`: `const [run, { busy, showSpinner }] = useBusyAction(fn)`. `busy` is true from the click (button gets `aria-busy="true"`, is disabled against double clicks, keeps its width); `showSpinner` turns true only after **300 ms** (new `SPINNER_AFTER_MS = 300` in `shared/constants.ts`, next to `SPINNER_DELAY`), so fast actions never flash a spinner.
- Q5's buttons get an optional `busy` prop: `aria-busy`, disabled, and a `Loader2` spinner replacing the icon (or before the label) when `showSpinner`. Under reduced motion the spinner doesn't spin (static icon + the existing label, e.g. "Saving…").
- Wire it into the slow or double-click-prone actions only:
  - deadline **Done / Done on… / Extend** — `useDeadlineActions.tsx` exposes `busy`; `DeadlineRow.tsx` and Q3's deadline card pass it to their buttons;
  - dashboard bulk Done (`DashboardView.tsx`, `bulkBusy` already exists — add the spinner);
  - **Empty Trash** (`TrashView.tsx`), **Save as PDF…** / export dialogs that already keep an `exporting` flag, by switching their button to Q5's `busy` prop (no new state).

### 3. Rows that arrive and leave
Renderer-only state in the grid store (row slice), no IPC changes:
- `flashRowId: number | null` — set with `lastAddedRowId` (`gridRowSlice.ts:80`) and on Undo of a trash/archive (the row that came back). `SortableRow` renders `.motion-flash` (blue tint fading over 1.2 s — a colour change, not movement; under reduced motion a static tint for 1.2 s, then none).
- `leavingRowIds: Set<number>` — `archiveRow`, `deleteRow` and Q4's undo-first removals add the id **before** awaiting IPC: the row gets `.motion-row-leave` at once (opacity → 0.4 at 0 ms as the acknowledgement, then height → 0 over `--motion-base`). When the IPC resolves **and** 180 ms have passed, the row is removed from `rows` and from `leavingRowIds`. On failure the id is removed (row comes back) and the existing error toast shows. Under reduced motion: dim at once, no collapse, removed when IPC resolves (today's timing).
- Why CSS, not motion's `AnimatePresence`, in the grid: the virtualizer (`useGridVirtualizer.ts`) keys by index and places rows in normal flow between padding divs (`DataGrid.tsx:681-683`), so a collapsing row height slides the rows below up for free, and nothing has to stay mounted after it leaves the window. Row height comes from `rowHeight`; the leaving row overrides it with an animated `height` and `overflow: hidden`.
- `SortableRow` gets one prop `motionState: 'flash' | 'leave' | null` (computed in `renderSortableRow`, `DataGrid.tsx:533-580`) and one comparator line (`SortableRow.tsx:513-560`). A row isn't keyboard-editable while leaving (focus moves to the next row, as today after removal).
- New column: keep the header light; add a 200 ms `clip-path`/`opacity` reveal on the new column's header and cells (`.motion-col-enter`, using the same `flashColumnId`, `DataGrid.tsx:224-252`; header in `GridHeaderRow.tsx:53` and cells via the row's `motionState`-like `flashColumnId` prop already threaded to `GridHeaderRow`). If threading `flashColumnId` into every row costs a comparator miss for all rows, light the header only (today) and skip the cells.

### 4. Done on the dashboard: slide out, counts tick
- `DashboardView.tsx`: keys become stable (`dl-${rowId}-${columnId}` plus `step` when present — check for duplicates in the same list and keep the index only as a last resort), and the Priority list children are wrapped in `<AnimatePresence initial={false}>`; each `DeadlineRow`/`TaskRow`/`ChecklistDueRow`/`FollowUpDashRow` sits in a `motion.div` with `exit={{ opacity: 0, height: 0, x: 24 }}` over `MOTION.base`. No `layout` prop (the list can hold 2,000 items — `DASHBOARD_PRIORITY`): the exiting height collapse moves the rows below. Same for Week/Month tabs only if the change is one wrapper there; otherwise leave them.
- A repeating deadline that comes back with its next date (the reload after Done) must not re-enter with an animation: `initial={false}` on the presence and no `initial` on items.
- New `components/shared/TickingNumber.tsx`: on change, the old number slides up and fades, the new one comes in from below (`MOTION.fast`, `AnimatePresence mode="popLayout"`, `key={value}`); `tabular-nums` so width doesn't jump; under reduced motion a plain swap. Used in `SummaryCard.tsx:26` (one line). No `aria-live` (the tiles are buttons; the list change is enough).

### 5. One toast stack
- New `components/shared/ToastStack.tsx`, built on react-hot-toast's headless `useToaster()` (v2.6.1 exports it), replacing all five `<Toaster>` lines and the `<UndoToast />` line in `App.tsx`. The 300 `toast()` call sites don't change.
- Layout: one column, `fixed` bottom-right (`bottom: calc(24px + env(safe-area-inset-bottom))`, `right: 24px`), `gap: 8px`, width 300–420 px, newest nearest the corner. **The Undo toast is always the bottom card** (closest to where the user's eyes go after acting), regular toasts stack above it. At most 3 regular toasts visible; older ones collapse into "+N more" (dismisses all on click). When the bulk bar is up (selection > 0 on the grid), the stack lifts above it.
- Motion: cards enter `y: 12 → 0, opacity 0 → 1` over `MOTION.enter`, leave `opacity → 0` over `MOTION.fast`, `layout="position"` on the ≤ 4 cards so they move up smoothly when one goes. Reduced motion: opacity only.
- Behaviour kept: hover/focus pauses (react-hot-toast `handlers.startPause/endPause`; undo store `holdToast`, `UndoToast.tsx:48-51`), Undo countdown bar, `role="status" aria-live="polite"` for normal toasts, `role="alert"` for `toast.error` (as react-hot-toast does), Esc on a focused card dismisses it. Text is 15 px (`text-base`) — fixes `UndoToast.tsx:57`.
- `UndoToast.tsx` becomes the presentational `UndoToastCard` rendered by the stack (countdown/hold logic stays in it, keeping Q4's duration). Colours stay as they are (slate-800 card, blue Undo); colour changes are Q8's.

### 6. Clean-up and guards
- Delete the dead keyframes (§1), keep `@media (prefers-reduced-motion)` + `.reduce-motion` coverage for every class in `motion.css`.
- A source-scan test keeps it that way (see Tests).

---

## Files owned
- `src/renderer/utils/animations.ts`
- `src/renderer/styles/motion.css` (new); `src/renderer/styles/globals.css` — **only**: the `@import` line, the `:active` rule in `@utility btn-compact` (`:194-218`), deleting the unused keyframe blocks in `:306-500`, and `.reduce-motion` (`:566-570`). Not the `.alert-pulse` block (`:286-300`, Q9b's if anyone's) and not colours/spacing (Q8).
- `src/renderer/hooks/useBusyAction.ts` (new); `src/shared/constants.ts` (one constant)
- `src/renderer/components/shared/ToastStack.tsx` (new), `src/renderer/components/shared/UndoToast.tsx`, `src/renderer/components/shared/TickingNumber.tsx` (new)
- `src/renderer/App.tsx` — the five `<Toaster>` lines and the `<UndoToast />` line only
- `src/renderer/stores/gridRowSlice.ts`, `src/renderer/stores/gridTypes.ts` (`flashRowId`, `leavingRowIds`)
- `src/renderer/components/grid/SortableRow.tsx`, `src/renderer/components/grid/DataGrid.tsx`, `src/renderer/components/grid/GridHeaderRow.tsx` (column reveal class only)
- `src/renderer/views/DashboardView.tsx` (Priority list keys/presence, bulk spinner), `src/renderer/views/dashboard/DeadlineRow.tsx`, `src/renderer/views/dashboard/useDeadlineActions.tsx`, `src/renderer/views/dashboard/SummaryCard.tsx` (one line)
- `src/renderer/views/TrashView.tsx` (Empty Trash button → `busy`)
- Q5's button components (add `busy`) and Q5's `Dialog`/`Confirm` (variants) — behaviour only
- Tests listed below; `e2e/ux-review/Q6-motion.spec.ts` (new, git-excluded)

**Overlaps (Wave C runs Q6, Q8, Q9b together):**
- **Q8** (colours, spacing, borders, empty states, icon/About) may restyle `SummaryCard.tsx`, Q5's buttons and the toast colours. Q6 changes one line in `SummaryCard`, only behaviour in the buttons, and no colours anywhere. Merge Q6 before Q8 or let Q8 rebase; in `globals.css`, Q8 stays out of the line ranges above.
- **Q9b** wants `DataGrid.tsx`/`SortableRow.tsx` (memo, a one-line `pruneSelection` call) and maybe `DashboardView.tsx` (list cap) and `App.tsx` (routes). Q6 owns these in Wave C; Q9b lands its grid/dashboard changes after Q6 merges. In `App.tsx` the two touch different lines.
- **Q3's deadline card** file(s): Q6 only passes `busy` from `useDeadlineActions` to its buttons — a two-line change; if the card is in a file Q3 owns, note it in the commit.

## Commits
1. `motion: one short set of durations (120/180/200 ms); dialogs and dropdowns quicker; dead keyframes gone` — `animations.ts`, `motion.css`, `globals.css` deletions/import, Q5 `Dialog`/`Confirm` use the variants, test `motionTokens.test.ts`.
2. `feedback: pressed look on compact buttons; busy buttons with a spinner after 300 ms` — `useBusyAction`, constant, `btn-compact :active`, Q5 button `busy`, Done/Extend (`useDeadlineActions`, `DeadlineRow`, deadline card), dashboard bulk Done, Empty Trash, export buttons with an `exporting` flag.
3. `motion: a new record lights up; archived or trashed records shrink away` — grid store state, `SortableRow` `motionState`, `DataGrid`, failure path; column reveal (or header-only).
4. `motion: Done slides the row out and the counts tick` — dashboard keys + presence, `TickingNumber`, `SummaryCard`.
5. `toasts: one stack — Undo at the bottom, the others above, nothing overlaps` — `ToastStack`, `UndoToast` → card, `App.tsx` lines, bulk-bar lift.
6. `motion: reduced-motion coverage for everything above` — tests + any fixes they find; CLAUDE.md Decision Log row ("Motion: 120/180/200 ms tokens; rows animate with CSS in the grid, motion/react elsewhere; one toast stack on react-hot-toast's useToaster").

## Acceptance checks
Video-free, in the real app, with the UX review harness (`e2e/ux-review/harness.ts`; git-excluded, so run from the main checkout after merge, or copy `harness.ts` into the worktree's `e2e/ux-review/` without committing it). Build first (`npm run build`), then
`env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q6-motion.spec.ts --reporter=line`.
`Q6-motion.spec.ts` (uses `openSeededApp`, `go`, `ipc`, `shotter('q6')`), each step timed in-page with `performance.now()`:
1. **Dashboard Done**: click Done on the first row. ≤ 100 ms: the button has `aria-busy="true"` or the row is exiting (`row.getAnimations().length > 0`). ≤ 400 ms: the row is gone, the next row's `getBoundingClientRect().top` equals the old row's top (it slid up), the tile number changed. Screenshot at +90 ms (`q6/01-done-mid`) and +400 ms.
2. **Archive from the grid row menu**: ≤ 100 ms the row has `.motion-row-leave` and opacity < 1; ≤ 400 ms (IPC done) it's gone; Undo toast shows; Undo → the row is back with `.motion-flash`.
3. **Add a record** (toolbar Add): the new row has `.motion-flash` and the name editor is focused.
4. **Add a column**: header lit, reveal animation duration ≤ 200 ms.
5. **Dialogs**: open a Q5 `Dialog` and a `Confirm`; every animation on them has `effect.getTiming().duration ≤ 200` and they finish ≤ 200 ms after the click (Q9a's dialog timer gives the same number).
6. **Pressed + spinner**: `mousedown` on a `.btn-compact` → computed `transform` is a scale < 1 within 100 ms. Save the 40-record list as PDF (via `mockSaveDialog`): no spinner at +250 ms if done by then; for a slow case use Empty Trash with 300+ records in the Trash — spinner visible after 300 ms, never before 280 ms.
7. **Toast stack**: trigger an Undo toast (archive) and two regular toasts (`ipc` a failing call, then a "Saved" toast); all three bounding boxes are pairwise disjoint, the Undo card is the lowest, all inside the window; hover pauses all. Screenshot `q6/07-stack` light and dark (`setTheme`).
8. **Reduced motion**: `page.emulateMedia({ reducedMotion: 'reduce' })` and, separately, the in-app setting (`ipc settings:update reduced_motion true` + relaunch). Steps 1, 2, 7 again: no running animation with `duration > 1 ms` that changes `transform`/`height`; rows still leave, toasts still appear, the flash is a static tint.
9. Perf guard: Q9a's `npm run perf` DataGrid "One cell edit redraw" and scroll numbers not worse by > 10 % (the new prop and the comparator line), and `e2e/perf` scroll p95 unchanged.

Also: `npm run gate` green; `npm run test:tz` once at the end (timers only, but the dashboard reload is date-driven).

## Tests to add/update
- `tests/renderer/motionTokens.test.ts` (new, source scan): every `duration` in `utils/animations.ts` ≤ 0.2 s; every `animation:`/`transition` duration in `motion.css` ≤ 200 ms except `.motion-flash` (colour, 1.2 s) and the deadline pulse; every `.animate-*`/`.motion-*` class defined in CSS is used under `src/renderer`; every class in `motion.css` has a `prefers-reduced-motion` rule.
- `tests/renderer/a11y/reducedMotion.test.tsx` (extend): `ToastStack`, `TickingNumber`, a leaving row — no transform animation with the switch on; `.reduce-motion` covers `motion.css`.
- `tests/renderer/components/ToastStack.test.tsx` (new): Undo card always last; max 3 + "+N more"; pause on hover; error toasts `role="alert"`; 15 px text; lifts above the bulk bar.
- `tests/renderer/hooks/useBusyAction.test.ts` (new, fake timers): busy at once, spinner at 300 ms not 299, double click runs once, error clears busy.
- `tests/renderer/stores/` row slice test (extend or new `gridRowMotion.test.ts`): archive marks leaving before IPC resolves; removes after both IPC and 180 ms; failure restores; reduced motion removes on IPC; undo sets `flashRowId`.
- `tests/renderer/views/` dashboard test (extend `dashboardDueFirst.test.tsx` or new `dashboardDoneMotion.test.tsx`): keys stable across a removal (other rows not remounted — mount counter); Done button `aria-busy` while pending; tile value updates.
- Update tests that query `UndoToast`'s DOM or `Toaster` mocks (`tests/renderer/views/viewSmoke.test.tsx` and any `vi.mock('react-hot-toast')` that now needs `useToaster` — `tests/perf/datagrid.perf.tsx:22` mocks only the default export; check every `react-hot-toast` mock still satisfies what `ToastStack` imports, or mock `ToastStack` in those tests).
- `tests/renderer/a11y/clickTargets.test.ts` reads `SortableRow.tsx` by path — keep it passing (44 px targets unchanged).

## Risks
- **Leaving rows and the virtualizer / keyboard**: a row that's leaving still occupies an index for 180 ms; selection, focus and `sortedRowIds` (profile prev/next) must ignore it. Keep the window short and test Delete/archive from the keyboard (focus lands on the next row, as now).
- **Optimistic-looking removal that fails**: the dim + collapse starts before IPC; on failure the row must come back cleanly with the error toast. Keep the actual removal from `rows` after IPC success.
- **Toast stack swaps a library surface**: `useToaster` changes how 300 toasts render; custom JSX toasts (`DataGrid.tsx:501-509`, `RecoveryKeyReminderToast`) must render unchanged; react-hot-toast's built-in a11y (`role`, `aria-live`) has to be reproduced. Fallback if it gets hairy: keep `<Toaster>` and render `UndoToastCard` through `toast.custom(…, { id: 'undo', duration: Infinity, position: 'bottom-right' })` so react-hot-toast stacks it — same visible result, less control over order.
- **Perf**: `motionState` and `flashColumnId` reaching every row could break SortableRow's memo; pass per-row values only (`motionState` for that row, `flashCol` only to the column's cells). Q9a numbers guard it.
- **Reduced-motion double path** (CSS class + MotionConfig + media query): each new piece needs all three; the source-scan test enforces the CSS side, `reducedMotion.test.tsx` the JS side.
- **Wave B drift**: Q4 may already have reshaped `UndoToast.tsx` and the undo store; Q3 the Done buttons; Q2 the dashboard header. Read them after merge and build on them, don't redo them.
