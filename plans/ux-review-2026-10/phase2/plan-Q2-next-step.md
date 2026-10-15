# Q2 — One obvious next step on every screen

**Idea 2 (ORCHESTRATION.md, Phase 2):** each screen has one primary action and one sentence saying what it's for. The dashboard opens with the next thing to do ("3 visits overdue. Start with Maria Garcia →"). On a profile with an overdue contact, the note box is already open with the matching kind selected.

**Also in this plan:** the Phase 1 leftover (ORCHESTRATION.md:115 (2)). The dashboard colour key starts expanded until "Got it" and pushes the due rows below the fold at 768 px.

**Wave B.** This plan builds on Q5's shared components (wave A). Where Q5 shipped `PrimaryButton` / `SecondaryButton` / a menu button, use them. Don't add new raw `btn-primary` class strings, and don't write a second menu component.

No migrations. No new IPC channels: every setting key used below is already allowed by `ipc-settings.ts:42/63` or by `ALLOWED_SETTINGS_KEYS`. No network. Vocabulary layer everywhere. 15 px / 44 px / 3 px.

---

## Goal

A user who opens any screen can tell in two seconds (a) what the screen is for and (b) the one thing to click next. "One primary" means one solid-blue button per screen header, marked `data-primary-action`. Everything else on the header is secondary or lives in a menu. "One sentence" means a single plain line under the title, rendered by a new `PurposeLine` (`<p data-purpose>`, `text-base`). There's no sentence where a dynamic next-step line takes its place (dashboard) or where the screen is the work surface itself (grid, profile).

**Rule shared with Q7, so the two don't say the same thing twice:** the purpose sentence (Q2) is permanent and says *what the screen is for*. Q7's one-time hint says *how to do one thing*, points at one control, and shows once. Q2 owns the purpose sentences listed below. Q7 owns the hint text in its own file. Both reviewers check the pair for repeats before merging.

---

## Screen by screen: today and proposed

| Screen | Primary action today (file:line) | Purpose sentence today | Proposed primary | Proposed sentence |
|-|-|-|-|-|
| Grid | "Add {Record}" `btn-primary` (`components/grid/GridToolbar.tsx:287-298`) | None visible: h1 is `sr-only` (`views/GridView.tsx:173`). The first-use tip bar (`components/grid/GridNotices.tsx:15`) is removed by Q7. | Keep "Add {Record}" as the only primary. The next step is the **Overdue chip with a count**: "Overdue (3)", red text when > 0 (`components/grid/FilterControls.tsx:51-63`). | None permanent: the grid is the work surface. The empty list keeps "Pick a way to start…" (`views/GridView.tsx:132`). Q7's first-look explains red once. |
| Dashboard | None. "Print & export" and "Customize" are both secondary (`views/DashboardView.tsx:781-795`). | None. The colour key auto-opens (`DashboardView.tsx:107-119, 541-558`). | **Next-step banner** under the title. Its button "Start with {Name} →" is the primary. | The banner sentence, e.g. "3 deadlines are overdue." When nothing is due: "Everything due across your {list:many}, most urgent first." |
| Profile | "{Activity}" (Case note) solid blue (`components/profile/ProfileHeader.tsx:734-742`) ✓ | None | Keep. With an overdue contact the note box is **already open**, with the matching kind picked. | The reason line in the note box: "Last Face-to-Face is 12 days overdue, so Visit is picked." Only when a suggestion applies. |
| Calendar | "Add…" `btn-compact-primary` (`views/CalendarView.tsx:306`) ✓ | The colour line only (`CalendarView.tsx:332-336`, `text-sm`) | Keep "Add…" and mark it `data-primary-action`. | One line, `text-base`, merged with the colours: "Click a day to see what's due or add to it. Red = late, orange = due now, yellow = coming up, green = not yet due." (Replaces line 334. Still shown only while the Deadlines layer is on; otherwise just the first sentence.) |
| Tasks | "+ Add task" (`views/TasksView.tsx:551-557`). "Add a set of tasks…" is blue-tinted `btn-compact-soft` and competes (`TasksView.tsx:577-583`). | None. Only counts (`TasksView.tsx:547-549`). | Keep "+ Add task" as the primary. "Add a set of tasks…" becomes plain secondary. | "Work that isn't about one {record}: reports, meetings, calls to make." |
| Contacts | "Add {Contact}" solid blue (`views/ContactsView.tsx:234-240`), next to four bordered buttons: Import, Export, Print, Categories (`:212-233`) | The h1 suffix "— your {contact} directory" (`ContactsView.tsx:201-204`) | Keep "Add {Contact}". Fold Import…, Export…, Print… and Categories… into one "More ▾" menu (Q5's menu button). | h1 is just "{ContactDirectory}". Sentence: "The people and places you work with. Link them to {a record} from {a record}'s page." |
| Reports | "New report" `btn-primary` (`views/ReportsView.tsx:102`) ✓ | Two sentences, 3 lines at 1366 px (`ReportsView.tsx:107-110`) | Keep | One sentence: "Each report answers a question about your work. Open one to see it, print it or pin it to the dashboard." |
| Settings | None (changes save as you go). h1 is `sr-only` (`views/SettingsView.tsx:133`). Each tab has its own heading and description. | Per tab | **Owned by Q1c**: no change here. Q2 asks Q1c to keep one sentence per tab and no primary button. | (Q1c) |
| Help | Search box. The first visible buttons are three equal `btn-secondary`s: tour, What's new, Security (`views/HelpView.tsx:251-265`). | None | Search is the primary control (autofocus on arrival). The three buttons become one quiet row of text links under the topics: "Take the tour · What's new · Security and privacy summary". "Retake the full tour" becomes **"Take the tour"** (Q7 removes the short tour, so "full" and "Retake" are wrong for a new user). | Under the h1: "Type a question, or pick a topic below." |
| Trash | None. "Empty the Trash" is a red-outline danger button, right (`views/TrashView.tsx:153-161`), which is right as it is. | "Items are removed for good after 30 days", `text-sm` (`TrashView.tsx:149-151`) | No page primary: Restore is per item. Empty the Trash stays danger. | `text-base`: "Deleted {record:many} and {list:many} wait here for 30 days, then go for good. Restore brings one back." |
| Templates | No page primary. Two sections: "Open a layout file…" and "Save this {list}'s layout…" are bordered (`views/TemplateManagerView.tsx:276-304`). "New checklist template" is solid blue (`:383-388`). | Two-part `<strong>` sentence (`TemplateManagerView.tsx:251-255`) | "New checklist template" is the one primary, with `data-primary-action`. Layout buttons stay secondary. | One sentence: "Reuse a {list}'s columns and rules (layouts), or a standard to-do list for {a record}'s page (checklists)." |
| Letters | "New" `bg-blue-500` (`views/LetterTemplateView.tsx:117-125`). The label is just "New". | None in the header. The right pane says "Choose a template on the left…" (`:181`). | Label "New letter", Q5's PrimaryButton. | Under h1: "Letters fill in {a record}'s details for you. Print one from {a record}'s page: Make a letter…" |
| Snippets | "New snippet" solid blue (`views/SnippetsView.tsx:278-289`) ✓ | "Type /trigger in any {activity}…", `text-sm`, hidden below `sm` (`SnippetsView.tsx:275-277`) | Keep, with `data-primary-action`. | Always visible, `text-base`, on its own line under the h1: "Text you type often. Type / and its name in {an activity} or scratch notes to put it in." |

Wording follows the Phase 1 style guide (sentence case, "and" not "&", "…" for dialogs, no jargon). Every `{…}` is a vocab token through `useVocab().f` or `t()`/`w()`.

---

## The changes

### 1. Dashboard colour key: behind the link only (Phase 1 leftover)

`DashboardView.tsx:107-119` reads `dashboard_color_guide_seen` and opens the key until it's closed once. At 768 px that pushes every due row off the first screen (see `ux-review-shots/after-phase1/11-dashboard.light.png`: the key fills y=430-660).

- `showColorLegend` starts `false` and only the link "What do the colors mean?" (`:534-538`) opens it. Delete the `SETTINGS_GET` effect (`:109-113`). `toggleColorLegend` just toggles; it no longer writes the setting. Keep the `COLOR_GUIDE_SEEN` constant out: drop it. The stored key is harmless and needs no migration.
- Discoverability moves to Q7's one-time dashboard hint, which names the link.
- While here, move the search box (`:579-588`, a whole row just for one right-aligned input) into the "Done puts today's date in…" row (`:567-574`), right of "Select several…". The row wraps on narrow widths. That saves about 60 px.

Result at 1366×768 with sample data: title, banner, tiles, Getting-started line, tabs, Done line, then at least the first two due rows on screen. At 1024×768 at least the first row.

### 2. Dashboard next-step banner

New `src/renderer/views/dashboard/nextStep.ts` (pure, tested) and `src/renderer/views/dashboard/NextStepBanner.tsx`.

`nextStep({ overdueItems, priorityItems, words })` returns one of:

- **Overdue** (from `overdueItems`, `DashboardView.tsx:384-392`, which already sorts by `sortKey`, most overdue first):
  - all deadlines, one column: "{Column} is overdue for {n} {record:count}." (e.g. "Last Face-to-Face is overdue for 3 clients.")
  - all deadlines, mixed columns: "{n} deadlines are overdue."
  - mixed kinds: "{n} things are overdue: {a} deadlines and {b} tasks." (Only the kinds present; "1 deadline", "1 task", "1 follow-up", "1 checklist item".)
  - The button names the first item: "Start with {Name} →". Name is `clientName` for deadline/checklist/follow-up, `title` for a task. A second muted line gives the detail: "{Column}, {k} days late" (or "Due {date}" for tasks).
- **Due today** (no overdue, `daysUntil === 0` items): "{n} due today." + "Start with {Name} →".
- **Next up** (nothing overdue or due today, but `priorityItems` not empty): "Nothing overdue or due today." + a secondary-styled link "Next: {Name}, {Column} in {k} days →".
- **null**: nothing due at all, still loading, load error, or `stats.totalActive === 0`. The existing empty and "All clear!" states (`:591-611`) speak instead, and the banner shows the purpose sentence "Everything due across your {list:many}, most urgent first." (When there are no records the empty state already explains, so no banner.)

The button opens the item. Deadline, checklist and follow-up go to `/profile/${rowId}?gridId=${gridId}`, as `DeadlineRow.tsx:89` does. A task goes to `/tasks`. The profile then opens the note box with the kind picked (change 3), so "Start with Maria Garcia →" lands where the work is done.

Placement: directly under the h1 row (`DashboardView.tsx:777-799`), above `DashboardCards`. It isn't a card, so Customize can't hide or move it. Style: one row, `min-height: 44px`, sentence `text-base`. The overdue icon is red (status colour only). The button is Q5's PrimaryButton with `data-primary-action`. The whole thing is a `role="status"` region, so the sentence is announced when it changes after a Done. Dashboard search doesn't filter it: it always reflects the whole workload.

`useVocab(null)` for words (the dashboard spans lists). Counts use `t('record', { count })`.

### 3. Profile: note box open with the matching kind

New `src/renderer/utils/suggestedNote.ts` (pure, tested):

`suggestedNote(row, columns, rulesById, activeTypes): { typeKey: string | null; columnName: string; daysLate: number } | null`

1. Candidates: columns with a deadline rule (`ruleOfColumn`, `utils/filterMatch.ts:50`) whose deadline is late. Use `evaluateRuleForRow(...)` (`utils/deadlineCalc.ts:57`) and count it late when `daysUntil < 0` and the state is neither `done` nor `paused`, exactly as `dueStatusIs` does (`filterMatch.ts:56-63`). Take the most overdue.
2. The kind, in order:
   1. The column's `note_updates` (date columns opt in: `src/main/note-date-updates.ts:4`; e.g. human-services "Last Face-to-Face" → `["visit"]`, `src/shared/starters/human-services.json:2233`). Use the first key that's an active type.
   2. Otherwise, the column name contains an active type's label or key as a whole word, case-insensitive. "Last Visit" → Visit, "Last Phone Contact" → Phone.
   3. Otherwise `typeKey: null`: the box still opens with the reason, keeping the remembered kind.
3. Only rule columns that look like a contact count: the column has `note_updates`, **or** step 2.2 matched. An overdue "Annual Review" with no matching kind returns `null`. A review isn't something a note does, so don't open the box for it.

`ProfileView.tsx` (`:538-567` only) works out `suggestion` with `useMemo` from `row`, `columns + hiddenColumns`, `alertRules` and `useActivityTypes().active`, and passes it to `<CaseLog suggestion={…}>`.

`CaseLog.tsx` gets a new optional prop `suggestion` (Props near `:102`). Applied **once per `rowId`** via a ref, and only when there's no saved draft (`draft0`, `:152`):

- `setComposerOpen(true)`, **without** moving focus. The page shouldn't jump focus on load. `openComposer` (`:174-177`) focuses, so call `setComposerOpen` directly. With `focusRef` set (header-button mode, `:598`), the open box shows.
- `setNewType(typeKey)` when `typeKey` isn't null, but **don't** call `pickType`. That would save `note_type_last` (`:147-150`), and a suggestion isn't a choice. If the user picks a chip, normal behaviour resumes. Mind the race with the `note_type_last` load (`:141-145`): the suggestion wins if it lands first or second (track it in a ref).
- A reason line above the kind chips (`:610`), `text-base`, slate: "{Column} is {k} days overdue, so {Type} is picked." When there's no type: "{Column} is {k} days overdue." (`f` and `t('activity')` for any note word.)
- After a save, the row updates (note dates move the column), the suggestion goes `null`, and nothing re-opens or re-picks.

### 4. Grid: "Overdue (n)"

`FilterControls.tsx:51-63`: count the rows that match the existing overdue filter with `matchFilter(row, { columnId: ANY_DEADLINE_COLUMN_ID, operator: 'due_status', value: 'overdue' }, columns, undefined, rulesById)` over `useGridStore` rows, memoised on rows, columns and rules. Show "Overdue (3)" with `tabular-nums`, and red text when > 0 and the filter is off. The title says "Show the 3 {record:many} with an overdue deadline". At 0 the label stays "Overdue". `aria-pressed` is unchanged. This puts the grid's next step one click away without a new banner on the work surface.

### 5. Purpose sentences and one primary everywhere else

New `src/renderer/components/shared/PurposeLine.tsx`: `<p data-purpose className="text-base text-slate-600 dark:text-slate-300 max-w-3xl">{children}</p>`. (Check first whether Q5 shipped a page-header part that does this; use it if so.)

Apply the table above to Tasks, Calendar, Contacts, Reports, Trash, Templates, Letters, Snippets and Help (header hunks only, lines cited in the table). Mark each page-level primary `data-primary-action`.

---

## Files owned

New: `src/renderer/views/dashboard/nextStep.ts`, `src/renderer/views/dashboard/NextStepBanner.tsx`, `src/renderer/utils/suggestedNote.ts`, `src/renderer/components/shared/PurposeLine.tsx`, and their tests.

Edited, whole file in this wave: `src/renderer/views/DashboardView.tsx`, `src/renderer/components/grid/FilterControls.tsx`.

Edited, named hunks only (another plan may touch other parts of the same file; keep the diff inside these lines):

| File | Hunk | Others who may touch the file |
|-|-|-|
| `src/renderer/views/ProfileView.tsx` | `:538-567` (suggestion + prop) | Q4 (archive confirm `:650-665`), Q3 |
| `src/renderer/components/profile/CaseLog.tsx` | Props (`~:60-102`), `:129-182`, `:608-611` | Q4 (note delete), Q5 |
| `src/renderer/views/TasksView.tsx` | `:542-583` | Q4 (task delete), Q5 |
| `src/renderer/views/CalendarView.tsx` | `:288-336` | Q3 (deadline card on calendar items, in `components/calendar/*`) |
| `src/renderer/views/ContactsView.tsx` | `:195-245` | Q4, Q5 |
| `src/renderer/views/ReportsView.tsx` | `:100-110` | Q5 |
| `src/renderer/views/TrashView.tsx` | `:143-161` | Q4 |
| `src/renderer/views/TemplateManagerView.tsx` | `:248-256`, `:376-390` | Q4 (template delete), Q5 |
| `src/renderer/views/LetterTemplateView.tsx` | `:112-125` | Q4, Q5 |
| `src/renderer/views/SnippetsView.tsx` | `:270-289` | Q4, Q5 |
| `src/renderer/views/HelpView.tsx` | `:226-275` (header, three-button row, tour confirm text) | Q1b (search results and feature offer, `:170-180` and the list), Q7 (no edit: Q2 does the "Take the tour" rename for Q7) |

Read only (import, don't edit): `utils/filterMatch.ts`, `utils/deadlineCalc.ts`, `hooks/useActivityTypes.ts`, `views/dashboard/DeadlineRow.tsx` (Q3 owns it), `views/dashboard/types.ts`.

Not touched: `SettingsView.tsx` and `components/settings/*` (Q1c), `DeadlinePanel.tsx` (Q3), `GridToolbar.tsx`, `DataGrid.tsx`.

Tests owned: `tests/renderer/views/DashboardView.test.tsx`, `tests/renderer/views/dashboard/nextStep.test.ts` (new), `tests/renderer/utils/suggestedNote.test.ts` (new), `tests/renderer/components/profile/CaseLog.test.tsx`, `tests/renderer/views/ProfileView.test.tsx`, `tests/renderer/components/grid/FilterBar.test.tsx` (or a new `FilterControls.test.tsx`), `tests/renderer/views/onePrimaryAction.test.tsx` (new), `tests/renderer/views/TrashView.test.tsx`, `tests/renderer/views/trashView-data.test.tsx`, `tests/renderer/views/viewSmoke.test.tsx` (Trash sentence, `:525`), `tests/renderer/ReportBuilder.test.tsx` (`:192`), `tests/renderer/help/helpSearch.test.tsx` (`:97`), and the Contacts, Tasks, Snippets, Letters and Templates view tests where header text changes.

---

## Commits, in order (`npm run gate` green before each)

1. **Dashboard colour key behind its link; search joins the Done row** (leftover). `DashboardView.tsx`. Update `DashboardView.test.tsx:263-272`: closed on load, opens from the link, no settings write.
2. **Dashboard says what to do next.** `nextStep.ts` + `NextStepBanner.tsx` + mount in `DashboardView.tsx`. Tests: every branch of `nextStep` (single column, mixed columns, mixed kinds, due today, next up, null for loading/empty/error), names and counts in a car-shop vocabulary (`setWords`), and a render test that the button navigates to `/profile/<id>?gridId=<g>` (and `/tasks` for a task).
3. **A profile with an overdue contact opens the note box with that kind.** `suggestedNote.ts`, `ProfileView.tsx` hunk, `CaseLog.tsx` prop. Tests: `note_updates` wins over the name match; name match on whole words only ("Visitation Review" does not match Visit); archived type is skipped; done or paused deadlines aren't late; non-contact overdue (Annual Review) returns null. CaseLog: the box opens without stealing focus, the chip is pressed, `note_type_last` is **not** written, a draft wins over a suggestion, and the suggestion applies once (re-render after save doesn't re-pick).
4. **Grid: Overdue shows how many.** `FilterControls.tsx`. Tests: count matches the filter's own result; 0 shows plain "Overdue".
5. **One sentence and one primary on every other screen.** `PurposeLine.tsx` + the header hunks. New `onePrimaryAction.test.tsx`: render each of Tasks, Calendar, Contacts, Reports, Trash, Templates, Letters, Snippets, Help and Dashboard with the existing view-smoke mocks (`tests/renderer/views/viewSmoke.test.tsx` setup). Assert `≤ 1 [data-primary-action]`, `≤ 1 [data-purpose]` (Dashboard: the banner instead), and that the purpose text has no hard-coded vocab words (render under car-shop words). Update the text assertions listed under "Tests owned". `tests/renderer/vocabStaticText.test.tsx` and the eslint vocab rule must stay green.
6. **Screenshots** (no code): run the spec below and compare.

Commit messages end with the Co-Authored-By / Claude-Session lines from the brief. Don't push.

---

## Acceptance checks

- `npm run gate` green, `npm run test:tz` green (the banner counts days: use `useToday` / local dates only).
- No new `eslint-disable`, no hard-coded record or list words, every new text 15 px, buttons 44 px, focus rings 3 px.
- Dashboard at **1366×768 and 1024×768**, seeded app: the banner is visible without scrolling, and the first due row is above the fold. The colour key is closed until the link is clicked.
- "Start with {Name} →" opens that record. If that record's overdue column has `note_updates` (or a matching name), the note box is open with that kind pressed, plus the reason line, and focus hasn't moved.
- Writing the Visit note recolours the Last Face-to-Face card. Reloading the page doesn't re-open the box.
- Grid shows "Overdue (n)" with the same n the filter shows when clicked.
- Each listed screen has exactly one solid primary in its header and one purpose line (Settings excepted, per Q1c).

### Screenshot check (`e2e/ux-review/Q2.spec.ts`, local; the folder is git-excluded)

`openSeededApp()`, then:

1. `sizeWindow(ctx, 1366, 768)`, `go(page, '#/dashboard')`, shoot `Q2-dashboard.light`/`.dark`. Repeat at `1024×768`.
2. Set `note_updates: ["visit"]` on the seeded "Last Contact" column via `ipc(page, 'column:update', …)`. Find the first row whose Last Contact is more than 30 days old (`grid:get-full`). `go` to its profile and shoot `Q2-profile-suggested`.
3. Shoot grid (`Q2-grid-overdue-chip`), tasks, calendar, contacts, reports, trash, templates (`#/templates`), letters (`#/letter-templates`), snippets, help, light and dark.

Run with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q2.spec.ts`. After Q7 merges, call its harness `silenceHints(page)` first, so hints don't cover the shots.

---

## Risks

- **Wrong guess on the profile.** A name match can pick the wrong kind ("Phone" in "Phone Screening Due"). Mitigations: `note_updates` always wins, whole-word match only, the reason line says why, one click changes it, and the guess is never saved as the remembered kind. Only contact-like columns qualify.
- **Focus.** Opening the box on load must not steal focus or scroll the page. Covered by a test and checked by hand with a screen reader announcement (the reason line sits inside the labelled section).
- **The banner duplicates the morning briefing.** The briefing is a once-a-day dialog; the banner is the steady state. Same counting rules: use the tiles' `isLateDeadline` (`tileCounts.ts`) via `overdueItems`, so the two never disagree.
- **Merge conflicts.** About ten view headers are shared with Q4 and Q5. Keep the diffs inside the listed hunks and merge Q2 after Q5 (wave A) and, if possible, before Q4. Then Q4's dialog changes rebase onto small header diffs.
- **Overdue count cost on big lists.** `matchFilter` per row and per rule column, memoised. At 5,000 rows it's the same work the cell colouring already does. Note it for Q9's measurements.
- **HelpView is shared with Q1b.** Q2 stays in the header block (`:226-275`). If Q1b needs the search input's handler, it uses the existing `handleSearchChange` without moving the input.
