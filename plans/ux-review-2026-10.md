# Pulse UX review — 2026-10-14

**Question:** can a non-technical case manager ("Linda", 54, Excel-and-Outlook user, reads every word, never right-clicks, never uses shortcuts, gives a new app five minutes) set Pulse up, use it daily and understand what it can do — without losing the advanced features for people who want them?

**Method:** six reviewers, each owning a slice of the app, drove the built app (2.6.0 + today's commit) with Playwright at 1366×768 and 1280×720, light and dark, from a fresh install and from a seeded 48-client human-services caseload; read every screen's text; then read the source behind what they saw. One reviewer audited every user-facing string in the code without launching. ~650 screenshots are in `ux-review-shots/` (git-excluded); the review specs are in `e2e/ux-review/` (git-excluded, reusable for the after-pass). The six slice files with every finding are in `plans/ux-review-2026-10/`.

**Short answer:** the app is in good shape on the fundamentals — plain confirmations with Undo, honest lock/recovery screens, a clear three-way start, a good dashboard briefing, a reports page that explains itself. Linda's failures are concentrated in five patterns, not spread evenly:

1. **Things she can't see.** Features that are switched off leave no trace (the owner couldn't find contact requirements for this reason); the change timeline is behind a dropdown and labelled "System"; half of a row's actions are right-click-only; task and contact row actions are hover-only; the sidebar's list menu is clipped on a laptop screen; "Add column" is under "More".
2. **Screens that don't fit a laptop.** Settings' tab list, the sidebar, the password card, the New caseload / Caseload settings dialogs, the reminder-letters dialog and the Help landing all cut off at 768 px, and the dashboard's first screen has no actual work on it.
3. **The colours are never explained where they appear.** On first run the deadline columns are off-screen, the tour's "Deadline colors" step points at a white grid, and on the list the only explanation of a colour or shape is a slow native tooltip.
4. **Help that describes a different app.** 14+ FAQ answers and 2 tour steps name buttons and tabs that were renamed or removed; Help search is a substring match with no synonyms ("contacts per month" finds nothing).
5. **One thing, several names.** Color rules / highlight rules / Conditional Format; "View" next to "Views"; four verbs for making a PDF; "timeline" vs "case log"; "Priority List" vs priority levels vs task priority; Title Case and sentence case on the same screen.

Plus three outright bugs found on the way: naming a spreadsheet list "My caseload" during setup turns every client word into "caseload" (A-01); the Security checkup reads "Recovery key created" when there is none (E-01); and a fresh install opens in dark mode regardless of the computer's setting (A-02).

## Counts

| Slice | File | Blocker | Major | Minor | Polish | Total |
|-|-|-|-|-|-|-|
| A First run | `ux-review-2026-10/A-first-run.md` | 1 | 11 | 17 | 5 | 34 |
| B Grid | `ux-review-2026-10/B-grid.md` | 0 | 16 | 24 | 7 | 47 |
| C Profile | `ux-review-2026-10/C-profile.md` | 0 | 7 | 20 | 14 | 41 |
| D Daily work | `ux-review-2026-10/D-daily-work.md` | 1 | 12 | 25 | 11 | 49 |
| E Settings & help | `ux-review-2026-10/E-settings-help.md` | 2 | 13 | 19 | 9 | 43 |
| F Wording | `ux-review-2026-10/F-wording.md` | 0 | 5 | 9 | 3 | 17 (grouped; ~400 strings) |
| | | **4** | **64** | **114** | **49** | **231** |

Severity: Blocker = she'd give up or lose data · Major = lost or needs help · Minor = friction, recovers · Polish = looks off.

## The twenty that matter most

Ranked by how many Lindas hit them × how badly. IDs link to the slice files.

| # | ID | What | Fix in one line | Plan |
|-|-|-|-|-|
| 1 | E-02, C-04, E-20 | Off features are invisible; no way to discover contact requirements, reminders, files, appointments, letters | `FeatureOffer` rows where each feature would appear; "Shows in…" line under each switch; FAQ entries tagged to the feature | P6, P4 |
| 2 | A-01 | "My caseload" as list name → every client is a "caseload" | `wordsFromListName` treats collective names as containers; never pre-select "Something else"; refuse one == many | P2 |
| 3 | D-01 | Sidebar list "⋯" menu clipped at ≤800 px high | Portal the menu to `document.body` | P1 |
| 4 | E-01, A-12 | Security checkup says "Recovery key created" with no key | State-based labels: "No recovery key yet" | P6 |
| 5 | C-01 | Change timeline hidden behind "Show:" and labelled "System" | "N changes hidden — show them" line; "Change" label with column name; one word ("history") everywhere | P4 |
| 6 | B-01, D-12, E-12, E-29, F-04 | Right-click-only and hover-only actions (rows, tasks, categories, snippets, 43 icon-only buttons) | Visible per-row "⋯"/"Edit" buttons; labels beside icons; aria-labels everywhere | P3a, P5, P6, P7 |
| 7 | A-03, A-10, A-11, B-04 | Colours off-screen on first run; tour points at a white grid; no colour key on the list | Rule columns right after Name in starters; tour scrolls to them; clickable clock icon → colour key; "What do the colours mean?" in the footer | P2, P3b |
| 8 | E-03, E-04, A-28, D-03 | Settings tab list and sidebar don't fit 768/720 | One-line tab labels; tighter sidebar, no single-item group headers | P1 |
| 9 | D-02, D-06 | Dashboard first screen has no work; tiles not clickable | Collapse Getting-started once 3/4 done; tiles open their tab | P5 |
| 10 | F-01, E-09, E-10 | Help names controls that don't exist; no FAQ for setting up requirements | Rewrite 16 answers; source-scanning test that quoted labels exist | P6 |
| 11 | B-06, A-07, A-08 | Imported dates get no deadline rule; First/Last names not combined; "Last Contact" guessed yearly | DeadlineQuestion on import results; "Combine into Name" option; monthly guess for contact/visit/call | P3b, P2 |
| 12 | B-08, B-09, B-03 | Toolbar wraps/loses labels at laptop widths; Add column under "More" | Keep labels; overflow into one More; "Add column" button + "+" header cell | P3a |
| 13 | A-04, B-16, D-11, E-17 | Password card, New/Settings caseload dialogs, reminder-letters dialog, Help landing cut off at 768 | Fit or scroll with pinned footers | P2, P3a, P5, P6 |
| 14 | D-04, D-05 | "Done" on a recurring deadline explained only on hover; three different "tasks due" counts | One grey line under the tabs; "Done on…" as text; one count/one name | P5 |
| 15 | F-02, F-03, B-23 | One concept, many names | Naming table adopted (see Decisions) | P7 + each plan |
| 16 | A-02, B-47 | Fresh install is dark | Default theme `system` | P1 |
| 17 | C-02, C-13 | Case log two screens down behind 16 empty fields | Log before details; hide empty columns by default | P4 |
| 18 | E-05, E-06 | Help search silently limited by a chip; no ranking or keywords | Reset chip on typing; `keywords` per FAQ; question matches first | P6 |
| 19 | C-05, E-08 | Letters print "My name is ," when Profile is empty | Warn on empty `my_*` placeholders with a link to Settings → Profile | P4, P6 |
| 20 | B-10, B-12 | Column settings "switches" look like menu items; rule picker scrolls inside a menu | Real toggles with one-line descriptions; "Deadline rule…" dialog | P3b |

## Decisions taken for the implementation

These resolve the places where reviewers disagreed or where a choice had to be made. Reasons in brackets.

- **Naming (from F's style guide, with two changes):** cell colouring is **"Color rules"** everywhere (the current menu label and the owner's own word; F proposed "highlight rules"). The toolbar "View" menu becomes **"Show"**, "Views" becomes **"Saved views"**. Dashboard "Priority List" → **"What's due"**. Making a PDF is **"Save as PDF…"**; "Generate Letter" → **"Make a letter…"**. "Log changes in timeline" → **"Keep a history of changes"**, and the entries are **"Change"** entries in the notes log; the word "timeline" goes. "Workspace" settings tab → **"Words & features"**. Sentence case everywhere except proper nouns.
- **"Show only the date" stays on by default** (owner's request this morning); the fix for B-05 is to auto-fit the column when the words are switched on, not to flip the default.
- **Theme default → `system`** (A-02). Existing installs keep their stored value.
- **Sidebar (D-03):** first try to fit by dropping the single-item WORKSPACE/SYSTEM headers, 40 px tool rows and no blank rows; only if that still doesn't fit at 1280×720 with the human-services defaults + Letters + Focus mode, fold Snippets/Templates/Letters into one "Templates" page with tabs. Lock stays in the sidebar.
- **Focus mode (D-07):** the minimum version — follow the app theme, add Extend… and Done on… per row, a one-line intro, and make "Open dashboard" the briefing's primary button. The one-card-at-a-time redesign is out of this pass.
- **Duplicate (C-03):** copy named "<name> (copy)", the page opens the copy. Done in `ipc-row.ts` (no schema change).
- **Providers skip the Trash (E-14):** wording fix only; moving them into the Trash needs a migration and is out of scope.
- **Out of scope (needs schema or is L):** per-user calendar view memory is fine (settings key), but nothing else stores new data. Focus-mode redesign, Contacts in the Trash, a combined Templates page (only as the D-03 fallback).

## What works well (keep, and copy the pattern)

The "How do you want to start?" screen · the empty-list state with three real buttons · Add Client → type → "Saved" · the sample-data banner and the "Keep this as a real entry?" prompt · "Remove sample data?" (states what, how many, how to undo — the model for every confirm) · lock screen, wrong-password text, "Forgot password?" → honest "No recovery key" page · the Getting-started card ticking itself off · the "Does this date come due again?" question when adding a date column · Change type and Edit options dialogs · Delete column / rule / Trash confirmations · the import preview with "Undo this import" · the examples browser · the note box (kinds as chips, When, follow-up, "/" snippets, the mileage offer) · deadline cards with Done/Extend and Undo · Audit trail, Handoff and Print dialogs' one-sentence explanations · the morning briefing · the calendar's "Add to Wednesday" chooser and "Which deadlines…" menu · the task form's repeat sentence · Snooze presets · the Reports page · typed confirmations (RESTORE, EMPTY) · the "Move to a new computer" wizard · the Requirements dialog's one-click presets · Help's "More features you can turn on" section.

## Implementation plans

Seven packages, in `plans/ux-review-2026-10/`. P1–P6 touch disjoint areas and run in parallel (one agent each, own worktree); P7 is a cross-cutting wording sweep and runs after the others are merged. Each plan lists its finding IDs, files, commit groups and acceptance checks; the slice files hold the exact fix text for each ID.

| Plan | Area | Findings |
|-|-|-|
| `plan-P1-shell.md` | Sidebar, top bar, Settings tab list, theme default, sample banner scope | D-01, D-03, D-14–18, D-38, D-48, E-03, E-04, E-19, E-33, A-02, A-28, B-32, C-41 |
| `plan-P2-first-run.md` | Password, recovery key, setup wizard (3 paths), tour, starters' column order, Getting-started logic | A-01, A-03–A-06, A-08, A-10, A-13–A-22, A-25–A-27, A-29–A-31, A-33, F-16 |
| `plan-P3a-grid-shell.md` | Grid toolbar, tip bar, row actions, filters/views/grouping, bulk bar, list dialogs, footer | B-01–B-03, B-08, B-09, B-13 (DataGrid part), B-15–B-19, B-22, B-25–B-30, B-36–B-43, A-09, A-23, A-24, F-03 |
| `plan-P3b-grid-columns.md` | Column menu/settings, deadline rules on columns, colour key, add column, import wizard, colour rules, bulk edit, acuity | B-04–B-07, B-10–B-12, B-14, B-20, B-21, B-23, B-24, B-31, B-33–B-35, B-44–B-46, A-07, A-22, A-33 |
| `plan-P4-profile.md` | Profile page, notes log, checklist, deadlines panel, letters from a record, duplicate | C-01–C-41 (minus C-24 → P5), E-08 (shared logic) |
| `plan-P5-daily-work.md` | Dashboard, briefing, focus mode, calendar, tasks, reports dialogs | D-02, D-04–D-13, D-19–D-37, D-39–D-47, C-24 |
| `plan-P6-settings-help.md` | Settings sections, feature offers, Help view and FAQ, contacts, snippets, templates, letters | E-01, E-02, E-05–E-18, E-20–E-43, F-01, F-14 |
| `plan-P7-wording.md` | Cross-cutting: naming table, sentence case, confirm/error/empty-state templates, icon-button labels, punctuation, vocab leaks | F-02, F-04–F-13, F-15, F-17 |

Gate for every package: `npm run typecheck` 0, `npx eslint src --quiet` 0, `npm test` green, no new `eslint-disable`, every text change through the vocabulary layer, 15 px / 44 px / 3 px rules kept. After the merge: rerun `e2e/ux-review/*.spec.ts` for the after-screenshots and `npm run test:tz`.
