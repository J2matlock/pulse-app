# Polish pass — 2026-10-11

Follows the usability audit (plans/audit-2026-10). That work merged about 95 commits from seven tracks.
This pass looks for the seams those merges left and for small visible defects of the kind the user just hit:

- text overlapping between cells
- a list that only showed up after moving to another page

## Shape

1. **Review (read-only agents, in parallel).** Each agent covers one area and reports findings as `file:line`, what goes wrong, and a fix. Severity is one of:
   - **bug:** wrong behaviour or data
   - **visible:** layout, clipping or stale screen
   - **polish:** wording, consistency or dead code
2. **Visual sweep (one agent).** Playwright screenshots of every starter's main list, profile, dashboard, reports and settings at 1366×768 and at phone-ish widths. Look for overflow, clipping, overlap and empty-looking screens.
3. **Triage.** I drop false positives and anything that would re-open a decision the user already made (A–H in the audit).
4. **Fix** in small commits, grouped by area. Each group comes with tests where the behaviour is testable.
5. **Verify:**
   - typecheck = 0
   - eslint errors = 0
   - full `npm test`
   - e2e critical paths
6. **Close out:** commit, push, update `plans/progress.md`.

## Areas

| # | Area | Focus |
|-|-|-|
| R1 | Grid, cells, board | overflow/truncation, column widths for rule dates, editors, selection, keyboard |
| R2 | Stale state across views | every mutation (setup, starter, import, restore, trash, sample removal, list delete/rename, words change) and whether every store/view that shows it refreshes |
| R3 | Profile, notes, tasks, calendar, forms, attachments | logic bugs, loading states, empty states |
| R4 | Dashboard, rules, reports | deadline engine edge cases surfaced in UI, report builder flow |
| R5 | Setup, starters, settings, import/export, backup | first run, re-run setup, sample data lifecycle |
| R6 | Main process | IPC validation, transactions, deadline engine, migrations 044–047 |
| R7 | Hygiene | dead code, duplicated helpers, unused exports, exhaustive-deps warnings, leftover TODOs |

## Out of scope

- New features.
- Anything already listed as deferred in progress.md (2026-10-11 entry), unless a reviewer finds it actually broken.
