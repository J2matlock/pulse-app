# Phase 2 — "It just works": plans, ownership and waves

Approved by the owner on 2026-10-14 (see `../ORCHESTRATION.md`). Each plan names the files it owns, the commits in order, acceptance checks and tests. Same constraints as Phase 1: no migrations, no network calls, vocabulary layer, 15 px / 44 px / 3 px, `npm run gate` green before every commit.

| Plan | Idea | Wave | Merge order inside the wave |
|-|-|-|-|
| `plan-Q5-consistency.md` part 1 | Shared components (`components/ui/`), design tokens, ratchet test, one colour key, one toast stack | A | 1 |
| `plan-Q9-speed.md` Q9a | Measurement: perf tests for profile/dialogs/palette, e2e speed spec | A | 2 |
| `plan-Q0-leftovers.md` | Phase 1 leftovers: checklist container query, one profile date format, PDF "Last 10 / All", GroupHeader placeholder, scratch pad header | B | 1 |
| `plan-Q1c-fewer-settings.md` | Settings audit → "More settings" disclosures | B | 2 |
| `plan-Q1b-feature-suggestions.md` | Features offer themselves when needed | B | 3 |
| `plan-Q2-next-step.md` | One obvious next step per screen; dashboard next-step banner | B | 4 |
| `plan-Q3-change-in-place.md` | One shared deadline card; double-click to rename a column | B | 5 |
| `plan-Q4-undo-not-confirm.md` | Undo instead of confirmations for reversible actions; fix the Undo-toast bug | B | 6 |
| `plan-Q1a-import.md` | Import that just works: one summary screen | B | 7 |
| `plan-Q7-first-five-minutes.md` | First-look card + one-time hints instead of the 7-step tour | B | 8 |
| `plan-Q5-consistency.md` part 2 | Remaining ~53 dialogs and the grid/sidebar ⋯ buttons onto the shared shell | C | 1 |
| `plan-Q8-visual-polish.md` | Whitespace, one accent colour, designed empty states, About, icon candidates | C | 2 |
| `plan-Q6-motion.md` | Motion and feedback (toast stack is in Q5) | C | 3 |
| `plan-Q9-speed.md` Q9b | Speed fixes (DataGrid/SortableRow/Dashboard after Q6) | C | 4 |
| `../../usability-test-kit.md` | Idea 10 — for the owner | done | — |

## Known overlaps (resolve at merge, keep both intents)
- `DataGrid.tsx`: Q3, Q4 (dialog mounts), Q7 (tip bar removal), Q1a, later Q6 and Q9b.
- `ProfileView.tsx` / `CaseLog.tsx`: Q2 (header hunk, suggested note), Q4 (confirm sites), Q1b (three spots), Q0 (none — Q0 stays out).
- `SetupView.tsx`: Q1a (spreadsheet path moved to its own file) and Q7 (done step).
- `ColumnHeader.tsx`: Q3 then Q4.
- `App.tsx`: Q5 (Toaster lines → ToastHost), Q4 (AppToaster — **drop it, use Q5's ToastHost**), Q7.
- `HelpView.tsx`: Q2 (tour button wording) and Q1b (results area).
- `AlertsSection.tsx`: Q1b and Q1c (two lines).
- `ipc-export.ts`: Q0 (`EXPORT_PDF_PROFILE` handler) and Q1a (import handlers).
- `faqData.tsx`: several — the `faqLabelsExist` test will catch stale quotes after each merge.
- Q4 and Q5 both proposed a toast host; **Q5 owns it** (Wave A). Q4 builds on it.

## Decisions taken by the orchestrator while the owner was asleep (2026-10-15; the owner can overrule)
- **Q3:** clicking a column name keeps sorting (the tip bar and Excel teach that); **double-click** renames in place. The plan's fallback commit is the one to use.
- **Q1a:** **summary first, then import** (one screen, one "Import" button) rather than import-then-summary, so nothing lands in the list before the user has seen Pulse's guesses. The plan's flag makes this a one-line switch.
- **Q8:** app icon — make candidates only; don't replace `build/` icons until the owner picks. Window title may show the list name (never a person's name). Dashboard colour key no longer opens on its own.
- **Q9b:** profile prefetch ships only if its staleness guards (use once, 5 s expiry, cleared on any write or lock) pass review; otherwise ship without it.

## Worktree agents: rules learned in Phase 1
- First command: `ln -s /home/jmatlock/projects/pulse/node_modules node_modules` (now git-ignored as a symlink too). Before merging any branch, check `git ls-tree <branch> node_modules` is empty.
- The review harness `e2e/ux-review/` is git-excluded, so it's not in a worktree: `cp -r /home/jmatlock/projects/pulse/e2e/ux-review e2e/` when a plan's acceptance needs screenshots.
- Under parallel load, auth-lockout and perf-timing tests time out; rerun those files alone before treating a failure as real. The orchestrator runs the gate on a quiet machine at merge.
- Never edit `e2e/ui-tour.spec.ts` (the owner's uncommitted change).

## Shared components available after Wave A (Q5 part 1, merged 2026-10-15)
`src/renderer/components/ui/`: `PrimaryButton` / `SecondaryButton` / `DangerButton` (`size` normal|compact, `icon`, `busy`, `tone="inverse"`); `IconButton` (required `label` → aria-label + tooltip, `shortcut`, `variant` ghost|secondary|primary); `Dialog` (`open`, `onClose`, `title`, `description`, `size`, `role`, `initialFocus`, `icon`, `footer`, `dismissible={false}`); `Toggle` / `ToggleRow`; `MenuButton` / `RowMenu` (items `{label, onSelect, description?, icon?, danger?, disabled?}`); `PageHeader`, `Section`; `LAYER` in `ui/layers.ts`. `EmptyState` gained `size`, `secondaryAction`. `ColorKeyPopover` gained `intro`, `triggerVariant`. **One toast stack:** `ToastHost` (rendered once, `withUndo`), `ToastIcon` for warning/key icons — don't add another Toaster. Use these in new or touched UI; `tests/renderer/designSystem.test.ts` is a ratchet (off-system counts may only go down). Tests that mock `motion/react` need `AnimatePresence` in the mock where an `IconButton` renders.

## Wave C staging (orchestrator, 2026-10-15) — the four plans overlap heavily, so they run in stages
- **C1 (parallel):** Q5 part 2 (dialogs + grid/sidebar ⋯ buttons) · Q9b **part 1** — only the fixes outside `DataGrid.tsx`, `SortableRow.tsx`, `DashboardView.tsx` and dashboard rows: profile prefetch (with its guards), `safeInvoke`, `gridFilterSlice` search, `useCommandSearch`/`CommandPalette`, the `CASE_LOG_COUNTS` channel, dialog animation length.
- **C2:** Q8 visual polish (after C1 merges).
- **C3:** Q6 motion (after Q8 merges).
- **C4:** Q9b **part 2** — the DataGrid / SortableRow / DashboardView render fixes (after Q6 merges), then rerun `npm run perf` and `npm run perf:e2e` and compare with the Q9a baseline in `../ORCHESTRATION.md`.
