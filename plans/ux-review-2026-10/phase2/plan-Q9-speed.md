# Q9 — Speed you can feel (Q9a measurement harness, Wave A · Q9b fixes, Wave C)

Idea 9 of Phase 2 (ORCHESTRATION.md "The ten ideas"). **Measure first.** Q9a builds the measurements and records a baseline; Q9b fixes only what the numbers point at, ranked below by expected impact, and re-measures after every fix.

Targets (owner, 2026-10-14):

| Moment | Target | How it's judged |
|-|-|-|
| Profile open from the grid | < 150 ms to settled | click → page settled (definition in Q9a.2), median of 10, 600 and 5,000 records |
| Dialog open | "instant": content painted ≤ 100 ms, animation finished ≤ 200 ms | click → `[role=dialog]` painted; → its animations finished |
| Command palette / search | local matches in the next frame (≤ 50 ms after a keystroke); other lists ≤ 300 ms | keystroke → first `[cmdk-item]` text matches |
| Grid scroll at 500+ records | 60 fps: p95 frame ≤ 16.7 ms, < 5 % frames over 25 ms | 2 s constant-speed scroll, rAF frame intervals |

Constraints: no migrations, no network calls, `npm run gate` before each commit, no new `eslint-disable`. A fix that doesn't move its number is reverted, not kept "because it should help".

---

## Current behaviour (code as of f4fc6be9, after Phase 1)

### Baseline: `npm run perf`, 2026-10-15 (5,000 records × 40 custom columns; system Node 22.22.0, not Electron's Node 24)

Main process (`tests/perf/workspace.perf.ts`, real IPC handlers on the encrypted test DB):

| Measure | Median ms | Min | Max | Runs |
|-|-|-|-|-|
| Cold grid load (GRID_GET_FULL + GRID_DEADLINE_CONTEXT) | 323.8 | 316.4 | 326.9 | 3 |
| View switch back to the big list | 251.5 | 248.4 | 321.3 | 5 |
| GRID_GET_FULL alone (warm) | 241.7 | 232.3 | 273.8 | 5 |
| GRID_GET_FULL with archived (warm) | 273.2 | 271.9 | 286.8 | 5 |
| Cell edit, text column (CELL_UPDATE) | 0.3 | 0.2 | 0.6 | 50 |
| Cell edit, name column | 0.4 | 0.3 | 6 | 50 |
| Cell edit, deadline date column | 0.3 | 0.3 | 2.7 | 50 |
| Dashboard (DASHBOARD_GET_ALL) | 127.8 | 117.5 | 169.1 | 5 |
| Morning briefing | 118 | 116.2 | 120.4 | 5 |
| Recent activity | 2.7 | 2.7 | 3 | 5 |
| All deadlines (DEADLINES_GET) | 117.6 | 114.9 | 125 | 5 |
| Grid deadline context | 10.1 | 9.2 | 10.6 | 5 |
| Empty Trash, 500 records | 483 | 419.9 | 561.9 | 3 |
| CSV export, 42 columns | 355.6 | 350 | 358.4 | 3 |
| PDF export, 8 columns | 1496.7 | 1496.7 | 1496.7 | 1 |

Renderer (`tests/perf/datagrid.perf.tsx`, jsdom — compare before/after only, not what people see; 30 rows mounted = 20 + overscan 10):

| Measure | Median ms | Min | Max | Runs |
|-|-|-|-|-|
| DataGrid mount (wall clock, incl. table model) | 372.8 | 283.9 | 702 | 5 |
| DataGrid mount (React commit) | 335.2 | 251.8 | 631.1 | 5 |
| One cell edit redraw (wall clock) | 27.6 | 23.8 | 55.5 | 25 |
| One cell edit redraw (React commit) | 20.3 | 17 | 47.2 | 25 |
| Records redrawn per cell edit | 1 | 1 | 1 | 25 |

Reading it: SortableRow's memo works (one record redrawn per edit), so the 20 ms commit per edit is DataGrid's own O(n) work over 5,000 rows, not rows. Main-side reads are all fast except the list load (≈ 240 ms, already optimised in the sweep, D-050) and exports. **Nothing measures the profile, dialogs, the palette or scrolling today** — that is Q9a's job.

### What the four moments do now

**Profile open from the grid.**
- The open button: `SortableRow.tsx:210-218` → `handleNavigateToProfile` `DataGrid.tsx:125-136` (saves scroll, adds to Recent, `navigate('/profile/:id')`). The grid route unmounts; `ProfileView` (static import, `App.tsx:16`) mounts.
- The record itself is already in the grid store (`rowInList`, `ProfileView.tsx:167`), so the header can paint at once. Everything else is fetched by each section on mount. Read calls on a default human-services profile (to be counted exactly by Q9a.3): `SNIPPET_GET_ALL` (`ProfileView.tsx:127`); `ProfileHeader`: `ROW_GET_MANUAL_CONTACTS`, `TAG_GET_ALL`, `TAG_GET_FOR_ROW`; `CaseLog`: `SETTINGS_GET note_formats` (`CaseLog.tsx:207`), `CASE_LOG_GET` + **four** `CASE_LOG_COUNT` (`CaseLog.tsx:233-247`: one for the page, three in `refreshHidden`); `ScratchPad`: `GLOBAL_NOTE_GET`, `SCRAP_NOTE_GET`; `Checklist`: `CHECKLIST_GET`, `CHECKLIST_GROUP_GET_ALL`, `CL_TEMPLATE_GET_ALL`; `GridDataSummary`: `SETTINGS_GET_ALL`; `RecordFiles`: `ATTACHMENT_LIST`; `RecordAppointments`: `APPT_FOR_RECORD`; `LinkedProviders`: `CONTACTS_GET_CLIENT_LINKS`; `ContactStatusLine`: `CONTACT_REQ_STATUS`, `APPT_LIST`; `LinkedRecords` (links on): `RECORD_LINKS_GET`, `DEADLINES_GET {rowIds}`. ≈ 20–25 round trips, serialised in main (better-sqlite3 is synchronous), each section painting when its own answer lands → several layout shifts.
- Back to the list remounts `DataGrid` (jsdom mount 373 ms at 5,000; the grid store keeps the rows, `GridView.tsx:99-101` doesn't reload).

**Dialog open.** Opening is synchronous React state; what the user waits for is the animation: `modalPanelVariants` 250 ms in (`utils/animations.ts:46-60`), dropdowns 280 ms ("slow and slidey", `animations.ts:7-21`). Some dialogs also fetch on open (e.g. `ProfileExportDialog`, `AuditReportDialog`). Animation lengths are **Q6's** to change; Q9 measures them.

**Command palette / search.**
- Palette `CommandPalette.tsx` is mounted all the time (`App.tsx:312`) and subscribes to `rows`/`columns` (`CommandPalette.tsx:42-44`) even while closed, so every cell edit re-renders it up to `if (!open) return null` (`:212`).
- On open it runs `pruneRecentProfiles` (`CommandPalette.tsx:59`) = up to 10 parallel `ROW_LOCATE` calls (`profileStore.ts:52-71`).
- Each keystroke: `useMatchedRecords` (`hooks/useCommandSearch.ts:34-46`) rebuilds every record's display name with `getClientName` (5,000 calls) before fuzzy-matching; other lists via `SEARCH_CLIENTS_CROSS_GRID` 200 ms after typing stops (`useCommandSearch.ts:57-67`). Not in the main-process benchmark.
- Grid search box: 150 ms debounce (`TopBar.tsx:121-126`) → `searchQuery` → TanStack global filter over all rows in `DataGrid`. `TopBar` also subscribes to `rows` (`TopBar.tsx:66-68`).

**Grid scroll.**
- `useGridVirtualizer` (`hooks/useGridVirtualizer.ts:6, 41-53`): fixed row height, overscan 10, index keys; rows in normal flow between padding divs (`DataGrid.tsx:681-683`).
- Every scroll frame re-renders `DataGrid` (virtualizer state) and recomputes `renderedRowIds`/`tabStop` (`DataGrid.tsx:437-450`); existing rows skip via the comparator (`SortableRow.tsx:513-560`); rows entering the window mount with all their cells (each cell runs `deadlineCellInfo`, `gridCellStyle.ts`, and `rowHighlightStyle`, `SortableRow.tsx:133`).
- Overdue cells run an infinite **background-colour** animation (`.alert-pulse`, `globals.css:286-300`): paint, not compositor, on every visible overdue cell, every frame — a likely cost on low-end laptops while scrolling.
- `onScroll` syncs the header's `scrollLeft` (`DataGrid.tsx:670-675`), cheap.

**Other O(n)-per-change work found while reading** (candidate causes of the 20 ms edit commit):
- `setSortedRowIds(visibleRows.map(...))` on every `visibleRows` change (`DataGrid.tsx:389-391`) always stores a new array (`gridFilterSlice.ts:296`), so every subscriber of `sortedRowIds` (ProfileView's prev/next, `ProfileView.tsx:104-107, 250-253`) re-renders after any edit.
- The selection-pruning effect builds a 5,000-entry `Set` per change even with nothing selected (`DataGrid.tsx:394-397`).
- Dashboard Priority list renders up to `DASHBOARD_PRIORITY: 2000` items unvirtualised (`query-limits.ts:10`, `DashboardView.tsx:613-640`) with index-suffixed keys (`DashboardView.tsx:617`).
- Lazy views (`CalendarView`, `ReportsView`, `HelpView`, `App.tsx:26-28`) show the "Loading…" Suspense fallback (`App.tsx:195`) on first visit.

---

## Q9a — Measurement harness (Wave A)

Goal: four repeatable numbers (profile, dialog, palette/search, scroll) in real Electron, plus jsdom and main-process numbers that explain them; a baseline table appended to this file. **No app code changes** — measure from outside so Wave B's agents aren't touched.

### Change

**Q9a.1 — main process: profile reads and cross-list search** (`tests/perf/workspace.perf.ts`). Add an `it('profile open: every read the page makes')` that invokes the read channels listed above for one seeded record, in the order the sections mount, as one timed block (`Profile reads (N channels)`), and each channel alone. Add `SEARCH_CLIENTS_CROSS_GRID 'per'` (3 letters) and `ROW_LOCATE × 10`. Their statements join the EXPLAIN pass already there, so a scan shows by name.

**Q9a.2 — real Electron timings** (new, tracked: `e2e/perf/perfKit.ts`, `e2e/perf/speed.spec.ts`). Tracked, not in the git-excluded `e2e/ux-review/`, because worktree agents (Q9b) don't get excluded files. Imports only `../helpers`. Skips unless `PULSE_PERF=1`, so `npm run test:e2e` is unchanged.
- `seedRecords(page, n, columns)` — via IPC like `e2e/ux-review/harness.ts:82-166`: one list, 20+ columns (2 rule date columns, dropdown, phone, text…), `n` records (`PULSE_PERF_RECORDS`, default 600; also run at 5,000 for the record), ~25 % overdue so pulse cells are on screen, notes/checklist/tasks on 10 records. Relaunch + unlock so everything loads cold, like `openSeededApp` (`harness.ts:174-189`).
- `timeToSettled(page, act, readySelector)` — inside one `page.evaluate`: install a `MutationObserver` on `document.body`, `t0 = performance.now()`, run the click in-page (same clock), record `tReady` when `readySelector` first matches, then `tSettled` = time of the **last mutation before a 300 ms quiet window** (quiet window not counted). Returns both; no app instrumentation needed.
- `frameSampler(page, scrollEl, pxPerSec, ms)` — scroll the grid body with `scrollTop += v·dt` each rAF for 2 s; collect rAF deltas; return p50/p95/max, % > 16.7 ms, % > 25 ms.
- CPU throttling: `page.context().newCDPSession(page)` → `Emulation.setCPUThrottlingRate {rate: 4}` for a "care coordinator's old laptop" pass; if the CDP session isn't available under Electron, log and run unthrottled.
- Specs (each prints a table and writes `PERF_OUT_DIR/e2e.json`):
  1. **Profile open** ×10 different records: `tReady` = profile header name visible, `tSettled`; then **Back to list** (`history.back()` → `[role=row][data-row-index]`, settled).
  2. **Dialogs**: Add column panel, row menu → Trash confirm (or Q4's replacement), profile More → Save as PDF…, Settings → a dialog, Ctrl+K palette. For each: `tPainted` (dialog in DOM and `getBoundingClientRect().height > 0`), `tAnimDone` (`dialog.getAnimations({subtree:true})` all finished, or computed opacity ≥ 0.99 polled per rAF since motion may animate on the main thread), and any IPC-driven content settled.
  3. **Palette/search**: Ctrl+K, type "mar" one key per 120 ms; per keystroke → first `[cmdk-item]` updated; time to "In other lists" group present. Grid search box: type "gar", → row count settled (150 ms debounce reported separately).
  4. **Scroll**: 600 and 5,000 records, 1× and 4× CPU, reduced motion off/on (in-app setting via `settings:update reduced_motion` + relaunch, and `page.emulateMedia({ reducedMotion: 'reduce' })`) — on/off isolates the `.alert-pulse` paint cost.
  5. **First visit of lazy views** (Calendar, Reports, Help): did the "Loading…" fallback appear, and for how long.
- Script: `"perf:e2e": "npm run build && PULSE_PERF=1 playwright test e2e/perf"` in `package.json`. Run with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 npm run perf:e2e` on this machine.

**Q9a.3 — renderer jsdom: profile mount and grid scroll window** (`tests/perf/profile.perf.tsx` new; `tests/perf/datagrid.perf.tsx`).
- `profile.perf.tsx`: render `ProfileView` in `MemoryRouter` at `/profile/:id` over the same 5,000 × 40 store as the DataGrid bench, `safeInvoke`/`storeInvoke` mocked with a **recorder** that returns small realistic payloads after a microtask. Report: mount commit ms, number of commits until quiet, **IPC calls by channel** (the exact list behind "≈ 20–25"), and ProfileView re-renders caused by one grid cell edit (expect 0 after Q9b.1; today ≥ 1 via `sortedRowIds`).
- `datagrid.perf.tsx`: make the mocked virtualizer's window movable (start index in a hoisted variable) and add "Scroll one screen (commit ms, rows mounted)" and "Search keystroke: set `searchQuery` to 'Person 12' (commit ms)".

### Files owned (Q9a)
- `tests/perf/workspace.perf.ts`, `tests/perf/datagrid.perf.tsx`, `tests/perf/profile.perf.tsx` (new)
- `e2e/perf/perfKit.ts` (new), `e2e/perf/speed.spec.ts` (new)
- `package.json` — the one `perf:e2e` script line only
- this plan file — the "Baseline" section only

### Commits (Q9a)
1. `perf: profile reads, cross-list search and Recent checks in the main-process benchmark` (Q9a.1).
2. `perf: ProfileView mount benchmark with an IPC recorder; movable grid window and search in the DataGrid benchmark` (Q9a.3).
3. `perf: real-app timings for profile, dialogs, palette, scroll and lazy views (PULSE_PERF=1)` (Q9a.2 + script).
4. `perf: baseline numbers in plan-Q9` — run all three at 600 and 5,000; paste tables under "Baseline (Q9a)" below, with machine, CPU throttle and commit hash.

### Acceptance (Q9a)
- `npm run perf` and `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 npm run perf:e2e` both run green, twice in a row, medians within ±15 % of each other (otherwise raise runs).
- `npm test` and `npm run test:e2e` unchanged (perf specs skip without `PULSE_PERF=1`; `vitest.perf.config.ts` already keeps `*.perf.*` out of `npm test`).
- The baseline section names, for each target, the measured number and pass/fail.
- `npm run gate` green.

### Risks (Q9a)
- **MutationObserver "settled" can be pushed out** by something that keeps mutating (UndoToast's rAF countdown `UndoToast.tsx:30-36`, a pulsing overdue badge if it's done with DOM changes, the clock). Mitigation: observe only `main` (or the route container), ignore `[role=status]` subtrees, dismiss toasts first.
- **jsdom times ≠ Chromium times.** Only use jsdom for before/after on the same machine; targets are judged on the e2e numbers.
- **Seeding 5,000 records by IPC** is ≈ 35k calls; budget a few minutes; keep 600 the default.
- CDP throttling may be unavailable in Playwright-Electron; the spec must degrade, not fail.

---

## Q9b — Fixes (Wave C, after Q9a's baseline and Wave B merge)

Ranked by expected impact on the four targets. Each fix: change, how to verify, and a keep/revert rule. Re-run Q9a's numbers on top of merged Wave B first — Q2/Q3/Q4 change the profile and dashboard.

1. **Stop O(n) store churn on every edit** (grid edit, profile prev/next). `setSortedRowIds` keeps the old array when the ids are equal (length + element compare; `gridFilterSlice.ts:296`); the selection-pruning work in `DataGrid.tsx:394-397` returns early when the selection is empty — *in the store setter, not DataGrid*: add `pruneSelection(shownIds)` to the slice and call it with the same arguments, so DataGrid's line changes by one call (see overlaps). TopBar's and CommandPalette's `rows` subscriptions move to the narrow values they use (count, palette only while open — see 4).
   Verify: `datagrid.perf` "One cell edit redraw (wall)" 27.6 → ≤ 12 ms; `profile.perf` "ProfileView re-renders per grid edit" → 0. Keep if edit redraw drops ≥ 30 %.

2. **Preload the hovered record's profile data.** New `utils/prefetch.ts`: a document-level `pointerover`/`focusin` listener (installed from `main.tsx`) that, after 120 ms on a `[role=grid] [data-row-id]` cell or the open-record button (or the palette's active record item), issues the profile's read calls (the channel list from Q9a.3) for that row. Results sit in a **consume-once cache** keyed by `channel + JSON(args)`, TTL 5 s. `safeInvoke` (`utils/safeInvoke.ts:33-46`) checks the cache only for an allowlist of read channels; **any non-allowlisted call clears the whole cache** (all writes go through safeInvoke/storeInvoke/mustInvoke), as do `app:locking`, `CASE_LOG_CHANGED` and `cell:saved`. No section file changes. Never more than one row in flight; hover over a new row cancels nothing in main (calls are cheap) but replaces the cache.
   Verify: e2e "Profile open" `tSettled` median drops (target < 150 ms at 600 and 5,000, 4× CPU reported); a unit test proves a write between prefetch and mount causes a fresh fetch. Keep only if ≥ 25 % faster; log in CLAUDE.md's Decision Log (it bends "load fresh on every view switch": data ≤ 5 s old, consumed once, dropped on any write).

3. **Fewer profile round trips.** `CaseLog` asks `CASE_LOG_COUNT` four times on every load (`CaseLog.tsx:233-247`): one new read channel `CASE_LOG_COUNTS` (total for the current filter + changes + all + live in one statement) via the `/ipc-channel` skill; `refreshHidden` and `load` use it. Then, by Q9a.3's list, fold any other same-table pairs (Checklist's items + groups) only if the e2e number says the profile is still over target.
   Verify: `profile.perf` IPC count −3 or more; main `Profile reads` block time; e2e `tSettled`. Keep if `tSettled` improves ≥ 10 ms or IPC count drops without a regression.

4. **Palette that costs nothing while closed and little per key.** Split `CommandPalette` into a shell (open state, keyboard) and a body rendered only when open, so the store subscriptions (`CommandPalette.tsx:42-48`) exist only while it's up. `useMatchedRecords` builds a name index once per `[rows, columns]` (`useCommandSearch.ts:34-46`), not per keystroke. `pruneRecentProfiles` runs after the first paint (`requestIdleCallback`) instead of on open.
   Verify: e2e palette keystroke→results ≤ 50 ms at 5,000; open→painted unchanged or better; existing palette tests stay green (`tests/renderer/**/CommandPalette*`).

5. **Back to the list without remounting** (spike first, keep only if clean). React 19.3's `<Activity mode="hidden">` around the grid route while a profile is open would keep DataGrid's tree and scroll, making Back instant. Risk: hidden effects are torn down and re-run; keyboard handlers, `useAutoLock`, and the `lastAddedRowId` effect must behave. If the spike needs more than `App.tsx` route wiring, drop it and say so.
   Verify: e2e "Back to list" settled time (jsdom mount 373 ms today); all GridView/ProfileView tests; e2e smoke.

6. **Pulse cells cheap to paint.** If Q9a.4 shows ≥ 10 % worse p95 with motion on than off: make `.alert-pulse` / `.alert-pulse-dark` animate the **opacity of a `::before` overlay** (compositor-only) instead of `background-color` (`globals.css:286-300`), same colours and timing so the deadline look is unchanged (`tests/renderer/a11y/urgencyContrast.test.ts`, `colorConsistency.test.tsx` must still pass).
   Verify: scroll p95 at 4× CPU, motion on, back within 10 % of motion off.

7. **Row mount cost while scrolling** (only if scroll p95 > 16.7 ms at 1× CPU after 6). Measure with the movable window bench; candidates: memoise per-cell `deadlineCellInfo`/style by `(value, column, deadlineContext)`; hoist `rowHighlightStyle` inputs. Lands after Q6 (both touch `SortableRow.tsx`).

8. **Lazy views ready before the first click.** After unlock and first paint, `requestIdleCallback` → `import('./views/CalendarView')`, `ReportsView`, `HelpView` (same specifiers as `App.tsx:26-28`, so Vite reuses the chunks), from `main.tsx`.
   Verify: e2e lazy-view check — the "Loading…" fallback never appears.

9. **Dashboard list length** (only if e2e dashboard settled > 300 ms at 5,000 after Wave B): render the first 100 Priority items and a "Show all N" button. `DashboardView.tsx` is Q6's in Wave C; do this after Q6 merges or hand it to Q6.

Not in Q9b: dialog/dropdown animation length (Q6 shortens `animations.ts`; Q9a's dialog numbers verify it), grid load SQL (sweep D-050 already; 240 ms is under one view switch).

### Files owned (Q9b)
- `src/renderer/utils/prefetch.ts` (new), `src/renderer/utils/safeInvoke.ts`, `src/renderer/main.tsx`
- `src/renderer/stores/gridFilterSlice.ts` (`setSortedRowIds`, new `pruneSelection`)
- `src/renderer/hooks/useCommandSearch.ts`, `src/renderer/components/shared/CommandPalette.tsx`
- `src/renderer/components/profile/CaseLog.tsx` (count calls only); `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc/ipc-caselog.ts` (+ its case-log module) for `CASE_LOG_COUNTS`
- conditional: `src/renderer/App.tsx` route wiring (fix 5), `src/renderer/styles/globals.css` lines 286-300 `.alert-pulse` block only (fix 6), `TopBar.tsx` subscription line (fix 1)
- tests: `tests/perf/*`, new `tests/renderer/utils/prefetch.test.ts`, `tests/renderer/stores/sortedRowIds.test.ts`, case-log IPC test in `tests/` next to the existing case-log tests, `tests/ipc-consistency.test.ts` passes unchanged (contract entry added)

**Overlaps:** `DataGrid.tsx` (one call line, fix 1), `SortableRow.tsx` (fix 7), `DashboardView.tsx` (fix 9) belong to **Q6** in Wave C — Q9b lands those after Q6 merges, or skips them. `App.tsx`: Q6 edits only the `<Toaster>`/`<UndoToast>` lines, fix 5 only the grid/profile `<Route>`s. `globals.css`: Q8 must not edit lines 286-300; Q6 owns the animation keyframes block and `.reduce-motion`. `CaseLog.tsx` may have Wave B (Q2: note box open on overdue contact) changes — rebase, touch only `load`/`refreshHidden`.

### Commits (Q9b) — each with before/after numbers in the message
1. `speed: no store churn when a cell changes (sortedRowIds, selection)` (fix 1).
2. `speed: palette costs nothing while closed; name index per list, not per key` (fix 4).
3. `speed: CASE_LOG_COUNTS — one count call for the notes log` (fix 3).
4. `speed: preload the hovered record's page` (fix 2) + Decision Log row.
5. `speed: lazy views load while idle` (fix 8).
6. Conditional, each separate: fix 6, fix 5, fix 7, fix 9.
7. `perf: after numbers in plan-Q9` — "After (Q9b)" table next to the baseline.

### Acceptance (Q9b)
- e2e at 600 and 5,000 records, 1×: profile settled median < 150 ms; dialogs painted ≤ 100 ms and animations done ≤ 200 ms (with Q6); palette local results ≤ 50 ms per key; scroll p95 ≤ 16.7 ms and < 5 % frames > 25 ms. At 4× CPU: reported, no target, no regression vs baseline.
- `npm run perf`: no main-process measure > 10 % slower than the baseline; DataGrid edit redraw ≤ 12 ms wall.
- Visual check (ux-review harness, from the main checkout after merge): `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/after.spec.ts` with `AFTER_LABEL=after-q9b` — screens look the same as before (prefetch and memo must not change pixels).
- `npm run gate` green; `npm run test:tz` once at the end (prefetch TTL uses timers, not dates, but run it).

### Tests to add/update (Q9b)
- `prefetch.test.ts`: hover → cached; mount consumes once; second read goes to IPC; any write clears; lock clears; TTL expiry; allowlist only.
- `sortedRowIds.test.ts`: equal ids keep the same array reference; different order replaces.
- `CASE_LOG_COUNTS`: handler test (counts match the four old calls on the same data, voided and system entries included); `CaseLog` renderer tests still pass with the one call (update mocks in `tests/renderer/**/CaseLog*`).
- Palette: closed palette doesn't re-render on a store `rows` change (render counter).

### Risks (Q9b)
- **Stale data from the prefetch cache** — the main correctness risk. Consume-once + 5 s TTL + clear on any non-read call + clear on main-sent change events. If any doubt remains in review, ship without fix 2.
- **Activity (fix 5)** can surprise effects (auto-lock, keyboard shortcuts bound while hidden). Spike behind the e2e smoke; drop if it needs more than routing.
- Wave B may move numbers (Q3's deadline card on every cell, Q2's dashboard header). Re-baseline before fixing.
- A memo that hides a real update (fix 1/7): every change needs a test that the visible value still updates.
- Pulse redesign (fix 6) must look identical; contrast tests guard it.

## Baseline (Q9a)
_To be filled by Q9a: e2e and jsdom tables, machine, CPU throttle, commit._

## After (Q9b)
_To be filled by Q9b._
