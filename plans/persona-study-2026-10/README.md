# Phase 3 — persona polish: plans, ownership and waves

From the six persona reports in this folder and the synthesis in `REPORT.md` (scores, the ranked frustrations with verified causes, praises to protect, verdicts). Same constraints as Phases 1–2: **no database migrations** (none of these plans needs one: drafts and restore history use the existing encrypted `settings` table, the new rule flags live in `columns.config` JSON), no network calls, the vocabulary layer for every record, list and note word, 15 px / 44 px / 3 px, the shared components in `src/renderer/components/ui/` (Dialog, buttons, IconButton, RowMenu/MenuButton, Toggle, PageHeader, ToastHost), and the designSystem ratchet only goes down. `npm run gate` green before every commit; `npm run test:tz` for anything with dates.

Fixed already, not planned: the "// On the page, not in a card (Q8)…" comment on every record page (65e773fb, guarded by `jsxCommentText`).

## Plans

| Plan | Area | Personas | Fixes (REPORT.md rows) | Wave | Merge slot |
|-|-|-|-|-|-|
| `plan-R1-dates-and-first-look.md` | A shared `DateField` that refuses partial/impossible dates, 2-digit years as 20xx; Esc in a cell is undoable; first look's Done only on samples | Karen, Joe, Bobby, Linda | D1, D2, D5, #22 | 1 | 1 |
| `plan-R2-notes-and-forms-survive.md` | Note drafts in the encrypted DB (survive quit/crash), unsent-note notice, lock-safe appointment/contact forms, one snippet menu (Enter inserts), Ctrl+Enter everywhere, "saved" feedback | Candy, Mark, Joe | D3, D4, #7, #13 (note form), #23, #24 | 1 (commit 6 after R1) | 2 |
| `plan-R3-safe-hands.md` | Repeat-click guard, one Add / untouched records removed, column Trash confirmation when it has values + Trash page lists columns, "it's in the Trash/archived" on empty search, bulk bar names records | Joe, Mark, Karen, Candy, Bobby | D8, D11, #2, #8 | 1 | 3 |
| `plan-R4-deadlines-tell-the-truth.md` | Blank "only when" column fails safe; rule window explains itself; import reads date values (future = due); future "last done" warns; notes move Last Contact; imported contacts count toward requirements | Mark, Linda | D6, D7, D9, #13 (rule dialog focus) | 1 | 4 |
| `plan-R6-whats-due-counted-once.md` | One count for tiles and tabs (Next 7 / 30 days), labels say people vs deadlines, What's due capped + requirements line, deadlines named by their rule | Bobby, Linda | #4, #15, #18, #21 (optional) | 1 | 5 |
| `plan-R8-examples-that-fit.md` | Example search shows the matched layout; new "Home health nursing" and "Foster home licensing" starters; VSO evidence letters; keywords | Joe, Candy, Bobby, Karen, Mark | #5, #6 (setup), #14 (starter words) | 1 | 6 |
| `plan-R9-trust-and-security-words.md` | Change-password error by the field; security summary (organisation, HIPAA + FERPA, one backup rule, Print); backup says where; recovery wording + used-key nudge; restores in the change history; leftover agency words | Karen, Bobby | #9, #10, #14 (settings), #19 | 1 | 7 |
| `plan-R5-keyboard-and-focus.md` | Focus stays after Enter; arrows clamp; one Tab stop per header; skip to the list; full sidebar rings; row menu names the record; stronger selected row; hint bubbles (Esc, placement); password screen order; Help order | Mark, Bobby, Joe, Linda, Candy | #3, #12, #13 (grid), #16, #17 | **2** (after R1, R3) | 8 |
| `plan-R7-printouts-and-reports.md` | "Print what's due" (next 7/30/90, 12 pt black); legible list PDF; report states use the screen's labels; next-N-day ranges; Miles and minutes preset; descriptions follow settings; proofread PDFs (Roster Roster, plurals, minutes, Total row) | Bobby, Karen, Candy, Mark | D10, #6 (reports), #11, #20 | **2** (after R6) | 9 |

R1–R4 carry every data-integrity and data-loss row (D1–D11, with D10 in R7), and they merge first.

## Waves and merge order

- **Wave 1 (parallel worktrees): R1, R2, R3, R4, R6, R8, R9.** Merge one at a time in slot order (R1 → R2 → R3 → R4 → R6 → R8 → R9), with `npm run gate` between merges. R2 stops before its commit 6 (DateField in CaseLog's When and the appointment dates) if R1 isn't on main yet. The orchestrator runs that commit on main right after merging R2, or relaunches R2's agent in the same worktree after R1 merges.
- **Wave 2 (parallel worktrees, rebased on main after Wave 1): R5, R7.** They're disjoint from each other. Merge R5 then R7.
- **After both waves:** the cross-plan follow-ups below, then `npm run test:tz`, `npm run build`, rerun all six persona specs as regression scripts (each plan's Acceptance names the steps that must now pass), `npm run perf` once (R5 touches grid focus), close-out.

Worktree rules from Phase 1–2 still apply. First command: `ln -s /home/jmatlock/projects/pulse/node_modules node_modules`. Check `git ls-tree <branch> node_modules` is empty before merging. The persona specs and harness are git-excluded: `cp -r /home/jmatlock/projects/pulse/e2e/ux-review e2e/`. Mark's spec reads its steps from the scratchpad (`…/scratchpad/mark-steps.json`), and each plan also asks for a focused `e2e/ux-review/R<n>.spec.ts`. Never edit `e2e/ui-tour.spec.ts` (the owner's uncommitted change). Under parallel load, auth-lockout and perf-timing tests time out; rerun them alone before believing a failure.

## Files more than one plan touches (named hunks, merge order)

| File | Plans (merge order) | Hunks |
|-|-|-|
| `src/renderer/components/grid/SortableRow.tsx` | R1 → R5 | R1: only the `<CellEditor … />` props (`onDiscard`, ~`:461-496`). R5: everything else (onSave focus fallback, selected-row style) |
| `src/renderer/components/grid/ColumnHeader.tsx` | R3 → R5 | R3: the menu block order (~`:497-545`) and `handleDelete` plus its dialog text (`:222-228`, the delete dialog). R5: the header buttons and layout (`:340-420`: tab stops, clock hit area, no hover shift) |
| `src/renderer/views/DashboardView.tsx` | R6 → R7 | R7: only `printWeeklyPlanner` (`:466-475`) and the Print & export items (`:730-738`). R6: tiles, tabs, What's due cap, requirements line |
| `src/renderer/App.tsx` | R2, R3 | Mount lines only: R2 `UnsentNotesNotice` (+ `AppointmentDialogHost` if needed); R3 `useRepeatClickGuard()` |
| `src/renderer/stores/settingsStore.ts` | R2 (maybe) | One `flushNoteDrafts()` line in the lock action, only if a renderer lock skips `APP_FLUSH_PENDING` |
| `src/main/starters.ts` | R4, R9 | R4: `applyDateRules` (`:636…`). R9: the setup-file description (`:247`) |
| `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc-handlers.ts` | R2, R3, R7, (R9) | Append-only. R4 adds one optional field to `DateRuleAnswer` |
| `src/renderer/views/help/faqData.tsx` | R2, R3, R4 | One answer each (unsent notes; deleted columns in the Trash; requirements count Last Contact). The `faqLabelsExist` test catches stale quotes |
| `tests/soft-delete-invariant.test.ts` | R2, R3 | Append entries (note drafts read path; search-elsewhere reads trash on purpose) |
| `tests/renderer/rawDateInputs.test.ts` | R1 (creates), R2 (lowers the baseline) | Baseline number only |
| `src/shared/deadlineLabel.ts` | R6 creates, R7 imports | R7 doesn't edit it |

### Cross-plan follow-ups for the orchestrator after merging
1. R4's volunteer-rule description text goes into the starter JSON. R8 owns those files and was given the text, so check it landed.
2. `deadlineLabel()` (R6) adopted in `DeadlineCardContent.tsx` / `DeadlinePanel.tsx` (R4's files) so the record page also says "Appeal window".
3. After R4 and R7: rerun `tests/compliance.test.ts` (the monthly summary now gets the new requirement counting).
4. After R2 and R1: lower the `rawDateInputs` baseline if R2 skipped its commit 6.
5. CLAUDE.md: the Decision Log rows from each plan (R1, R2, R3, R4, R5, R6, R7, R9; R8 is content only), the test counts, and a "Current state" line for Phase 3.

## Decisions taken in these plans (the owner may want to overrule)

- **R1:** a two-digit year means 20yy for 00–79 and 19yy for 80–99 (birth years). A year typed in full is never changed.
- **R1:** Esc in a cell still **cancels** (the Excel and Sheets convention, and what the hint says). The discarded text goes on the Undo stack ("Not saved: …"), rather than Esc saving.
- **R1:** the first look shows **Done only on sample records**, relabelled "Mark it done". On real or imported records it's Got it only.
- **R2:** note drafts are stored **in the encrypted database** (`settings` rows `note_draft:<rowId>`, hidden from the settings store), so they're also in encrypted backups. Closing the window with a draft **doesn't ask** "are you sure", because nothing is lost.
- **R2:** lock-safe forms are **memory only** (survive a lock, not a quit), and only the appointment and contact-info forms in this pass.
- **R2:** **Enter inserts the highlighted snippet** when the snippet menu is open (Shift+Enter is a newline).
- **R3:** one **global repeat-click guard** (the second click of a double-click is ignored on buttons, menu items, checkboxes, radios, links and backdrops), with `data-allow-repeat` for steppers. It's broader than fixing each button.
- **R3:** an **untouched new record is deleted** (not trashed) when editing leaves it, on list switch or on lock.
- **R3:** a column that **has values asks before going to the Trash**. This partly reverses Phase 2 Q4 for columns, argued as the dependents rule.
- **R4:** a **blank "only when" column fails safe**: the deadline is tracked and labelled "Counted because … is blank". A non-matching value still hides it.
- **R4:** a date in a column that **follows notes counts once toward requirements** on a day with no matching note. The import turns "update from notes" on for contact-like columns.
- **R4:** import treats a date column that's **≥ 60 % future as due dates**, and asks when 20–60 % are future.
- **R5:** each column header becomes **one Tab stop** (↓ / Shift+F10 opens its menu, Space its colour key); the clock and ⋯ leave the Tab order.
- **R5:** the arrow keys **stop at the row's edges**; only Tab wraps.
- **R6:** the dashboard tabs become **"Next 7 days" / "Next 30 days"** (rolling), and the calendar week leaves the dashboard. The separate tasks and checklist tile goes, because those now count in the main tiles.
- **R7:** **"Print this week" is replaced** by "Print what's due" (7/30/90 days, 30 by default, 12 pt black).
- **R7:** report "State" uses each **rule's own colour labels** (Urgent, Due soon…); old saved filters on "On track" are mapped on read.
- **R8:** new starters **"Home health nursing"** (time, mileage and appointments on) and **"Foster home licensing"**, rather than letting Human services variants carry their own words and features (a schema change).
- **R9:** **the HIPAA and FERPA paragraph** in the security summary is new legal-ish wording. The owner should approve the exact text before release.
- **R9:** restores are logged in `settings.restore_history` and printed in the Change history PDF. That's the backup path; the plan allows skipping it if `/backup-integrity` raises anything.

## Out of scope for Phase 3 (seen once, cosmetic or larger)

Two places to save a filter (Linda); the import's "Why?" disclosure scrolling inside its box (Linda); the dark backdrop behind the import step (Linda); the month calendar truncating names at 1280 (Candy); Missing-information nags for unused template columns (Joe); phone-column validation (Joe); entering records at Largest text through the record page, which is slow (Bobby; needs a "form view" idea); saved report names fixed at creation ("Case notes per month" after the words changed, Candy); other dialogs surviving a lock (task form, checklist add); Totals as a PDF (Karen; the monthly summary gains minutes instead); a "critical" flag for rules (Joe); printing Help's shortcut sheet (Mark).
