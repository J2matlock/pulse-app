# Persona study — synthesis (Phase 3.2), 2026-10-15

Six people who don't owe Pulse anything drove the built app (main at 675dfedb, before the comment fix) from fresh installs: Bobby (low vision, prints everything), Linda (brings an 80-row messy spreadsheet, mouse only), Joe (double-clicks everything, burned by lost work), Karen (tests like an auditor), Mark (tremor, keyboard only, not a case manager) and Candy (dark mode, interrupted mid-note). Their reports are next to this file; screenshots are in `ux-review-shots/persona-<name>/`. The plans are in `README.md`.

## Short summary

**Every one of them would still be using Pulse in a week** (Bobby "yes for the screen, not yet for the paper", Karen "on probation", Candy and Mark "probably", Linda "carefully", Joe "yes"). What won them over is consistent: an example that already knew their work, deadline cards that show their maths, the dashboard's What's due list with Done right there, their own words everywhere (veterans, students, volunteers, patients, people), nothing lost across relaunches, and honest security screens.

What held the scores down is just as consistent, and it's the thing these users care about most: **Pulse sometimes changes or drops their data quietly.** An impossible date erases an IEP date and the footer says "Saved". A welcome box's "Done" writes a contact that never happened. Closing the window loses a half-written visit note. An expired background check shows white while the dashboard says "All clear". Imported future review dates become "last done". A printout meant to list what's due leaves deadlines off. Each one is a trust problem first and a usability problem second. Mark's trust score (4) and Candy's (5) come straight from these.

The second pattern is **hands that don't do what the app expects**. Double-clicks make duplicate records and open-then-close menus (Joe). Focus disappears after Enter (Mark). One extra arrow press trashes a column, and the Trash page then says it's empty (Mark).

The third is **numbers and paper that disagree with the screen**: three counts on one dashboard (Bobby, Linda), a "This week" printout with nothing on it (Bobby), requirements that say 0 of 80 on day one (Linda), "Roster Roster" (Karen).

The comment leak every persona hit ("// On the page, not in a card (Q8)…" on every record page) is **already fixed** in 65e773fb, guarded by the `jsxCommentText` test, and isn't planned again. Window crashes the personas mention came from the heavily loaded machine (about 80 renderer crashes an hour across all parallel runs, "Disk quota exceeded" in /tmp), not from Pulse.

## Scores

| Persona | First impression | Ease of setup | Daily use | Trust in my data | Would recommend | Average |
|-|-|-|-|-|-|-|
| Bobby | 8 | 7 | 5 | 8 | 6 | 6.8 |
| Linda | 8 | 8 | 5 | 6 | 7 | 6.8 |
| Joe | 6 | 5 | 7 | 8 | 7 | 6.6 |
| Karen | 8 | 8 | 6 | 7 | 7 | 7.2 |
| Mark | 8 | 5 | 6 | 4 | 6 | 5.8 |
| Candy | 6 | 7 | 8 | 5 | 7 | 6.6 |
| **Average** | **7.3** | **6.7** | **6.2** | **6.3** | **6.7** | **6.6** |

First impressions are strong. Daily use and trust are the weak columns, and the plans are aimed at them.

## Cross-persona frustrations, ranked

Severity: gave up = 4, needed help = 3, recovered = 2, cosmetic = 1. Rank = personas × worst severity. **Data integrity and data loss come first whatever the count** (D1–D11), then the rest by rank. "Known" means it was in the Phase 1 review (`plans/ux-review-2026-10.md` and its slice files) or the Phase 2 notes. Causes were checked in the code on main at 65e773fb.

### Data integrity and data loss

| # | Issue | Personas | Worst | New / known | Verified cause | Fix in one line | Plan |
|-|-|-|-|-|-|-|-|
| D1 | A partial or impossible date is silently erased, rewritten or dropped with "Saved": 02/30 erases an IEP date, 31/13 becomes 03/11, 7/15/26 leaves a blank, a checklist due date vanishes, a note's When date falls back to today | Karen, Joe, Bobby, Mark | recovered (compliance risk) | New (only the 0026 guard was known, and it fails silently) | The native date input gives `value === ''` for a partial or impossible date. `CellEditor.tsx:150` stores it and `:98`/`:152` save `null` over the old value. `:57-60` cancels a 0026 year silently. `ChecklistAddDialog.tsx:36,106-108` drops the date the same way. 33 raw date inputs in 24 files | A shared `DateField` that checks `validity.badInput`, reads 2-digit years as 20xx, keeps the old value with a message, and clears only on purpose; a ratchet test counts raw date inputs | R1 |
| D2 | The first look's "Done" marked a real record's deadline done (today's date written as Melissa's Last Contact) | Linda | recovered (nearly a falsified record) | New (Q7) | `FirstLook.tsx:75` falls back to the person's own rows; `:273-277` Done calls `completeDeadlines`; the copy at `:34` says "Click 'Done' when you've seen them" | Done only on sample rows, labelled "Mark it done"; real rows get Got it | R1 |
| D3 | Closing the window or a dead battery loses a half-written visit note (it survives a lock, not a quit) | Candy | recovered (from memory: her worst fear) | New | `noteDrafts.ts:6-8,22`: memory-only `Map`. `index.ts:248-263` flushes cell edits on close, not drafts | Drafts in the encrypted DB, written as you type and flushed on close and lock; "your unsent note is waiting" on unlock | R2 |
| D4 | The appointment form and "Add contact info" are wiped by a lock | Candy | recovered | New | `App.tsx:149` renders only the lock screen, so every form unmounts; `AppointmentDialog.tsx:60-85` is local state | Lock-safe drafts for those forms; the appointment dialog reopens after unlock | R2 |
| D5 | Esc in a grid cell throws away the typing, and Undo has nothing | Joe | recovered | New (by design) | `CellEditor.tsx:93-95` | Esc still cancels; changed text becomes an Undo step ("Not saved: …") | R1 |
| D6 | An expired background check shows no colour and the dashboard says "All clear" / "0 overdue", because "Needs background check" is blank; nothing explains it | Mark | needed help (trust 4) | New | `deadlineEngine.ts:621-623` returns NONE when a `whenFalse:'hide'` condition fails; `conditionHolds` (`:598-608`) treats blank as "not Yes"; `volunteer-manager.json:248` | A blank condition column fails safe ("Counted because … is blank"); the rule window counts blanks | R4 |
| D7 | Imported future review dates become "Last done Dec 4, 2026", so deadlines are a year off | Linda | gave up (that night) | New (Q1a) | `repeatGuess.ts:16-19` guesses from the column name only; `DeadlineCardContent.tsx:76` and `DeadlinePanel.tsx:398` label any stored date "Last done" | The guess reads the values (mostly future = due date; mixed asks once); a future "last done" warns with a fix | R4 |
| D8 | One extra arrow press in the column menu trashes the whole column with no confirmation, and the Trash page says it's empty | Mark | recovered (12 min) | Partly known (Q4 removed the confirmation) | `ColumnHeader.tsx:522-545` puts Deadline rule directly above Trash; `:227` deletes at once; `TrashView.tsx` has no columns, which appear only in `ListSettingsDialog.tsx:232` | Ask when the column has values, put Column settings between the rule and Trash, list deleted columns on the Trash page | R3 |
| D9 | Requirements say 0 of 80 on day one (imported Last Contact dates don't count), and a logged note doesn't move Last Contact, so every contact is entered twice | Linda | gave up (for the month) | New (the feature exists, hidden) | `contact-requirements.ts:95-101` counts notes only; `note_updates` (`note-date-updates.ts:4`) is opt-in and the import never sets it | Import turns on "update from notes" for contact-like columns; such a date counts once on a day with no note | R4 |
| D10 | "Print this week" said nothing was due with a veteran 7 days out; no printout matches What's due (checklist deadlines missing, typing order, tiny grey text, "On track" for a 15-day appeal) | Bobby | gave up (finished by hand) | New | `DashboardView.tsx:466-475` prints Sunday–Saturday; `report-builder.ts:34` uses engine states; `reports.ts:31` has no forward ranges; planner tables at 9 pt | "Print what's due" (7/30/90 days, the What's due rows, worst first, 12 pt black); reports use the screen's labels and offer next-N-day ranges | R7 |
| D11 | A double-click on Add makes two records; Add then Esc, or Add then walking away, leaves a counted nameless record; cleaning up the ghosts is how Joe trashed a real home | Joe, Karen, Mark, Candy | recovered | New | `gridRowSlice.ts:98-117`: no in-flight guard, and the row is created before any typing; `useGridEditing.ts:44-46` never cleans up | One Add at a time, reuse an untouched new row, remove it when left untouched | R3 |

### Everything else, by rank

| # | Issue | Personas | Worst | Rank | New / known | Verified cause / where | Fix | Plan |
|-|-|-|-|-|-|-|-|-|
| 1 | Code comment printed on every record page | all six | cosmetic | 6 | New | **Fixed in 65e773fb** | — | — |
| 2 | A double-click on a button that opens a menu or dialog opens and closes it (renewal Done, Done on…, the column and row ⋯); a double-clicked checkbox unticks | Joe | recovered (nearly gave up on renewals) | 2 | New | `RowMenu.tsx:179,221` toggle; `Dialog.tsx:119` closes on any backdrop click | A global repeat-click guard (`data-allow-repeat` opt-out) | R3 |
| 3 | Focus vanishes after Enter saves a cell (also after Add, Restore, Save); the box stays drawn but the arrows are dead | Mark | recovered | 2 | New | `useGridCellNavigation.ts:91` returns false on the last row, unhandled at `SortableRow.tsx:476-478`; a re-sort loses the element | Stay on the saved cell, re-find it after a re-sort, and arrow keys refocus when focus is on the body | R5 |
| 4 | Dashboard counts disagree (30-day tile 3 vs 4 in the list; 7-day 1 vs "This week (0)"; 36 vs 38 overdue) | Bobby, Linda | recovered | 4 | Known D-05 (partly fixed) | Tiles: rolling, deadlines only (`deadlineTiles.ts:46-54`). Tabs: calendar week and month, checklists included (`tabCounts.ts:11-24`). The tiles open those tabs (`DashboardView.tsx:795-806`). The list counts people (`FilterControls.tsx:135`) | One counting function, "Next 7 / 30 days" tabs, labels say people vs deadlines | R6 |
| 5 | Example search finds the starter but doesn't show which layout matched ("foster" → "Human services · 11 layouts"); no foster-licensing or home-health starter of their own | Joe, Candy (Karen: no school social worker) | recovered (nearly quit) | 4 | New | `schema.ts:314` searches variant names, but `ApplyStarterDialog.tsx:163` shows only a count | "Matches: Foster Care Caseworker" on the card, opening it directly; two new starters | R8 |
| 6 | Home Health leaves Time, Mileage and Appointments off; a monthly mileage total takes a hand-built report | Candy | recovered (luck) | 2 | Known pattern E-02 | Variants can't carry `suggestedFeatures` (`schema.ts:186-193`); no mileage preset (`ReportBuilder.tsx:207-222`) | A Home health starter with them on and a pinned report; a Miles and minutes preset | R8, R7 |
| 7 | The snippet popup is clipped above the card, Enter doesn't insert, and "/" with no snippets shows nothing | Candy | recovered | 2 | New | `CaseLog.tsx:701` `absolute bottom-full`; `:341` Enter only after an arrow key | A portalled `SnippetMenu`, Enter inserts, an empty state | R2 |
| 8 | Search says "No clients found" for a record in the Trash or archived | Joe | recovered (panic) | 2 | New | `GridNotices.tsx:33` | "1 match in the Trash / archived · Show" | R3 |
| 9 | A wrong current password on Change password shows nothing | Karen | recovered | 2 | New | The message is set (`SecuritySection.tsx:138`) but rendered at the top of the form (`:202-203`), out of view | The message under the field, with focus and scroll | R9 |
| 10 | The security summary says "agency" and HIPAA/BAA to a school, and contradicts itself on backups; there's no Print | Karen, Bobby | needed help | 6 | New | `SecuritySummaryDialog.tsx:28,37,39,42` | Organisation wording, FERPA beside HIPAA, one backup rule, Print | R9 |
| 11 | Reports unproofed: "Roster Roster", "4 counseling session", "this year" on a this-month report, misaligned Total, the top line off the page, no minutes in the supervisor report | Karen, Bobby, Candy | recovered | 6 | Partly known (F-wording) | `export-supervisor.ts:246,499`; `ContactRequirementsSettings.tsx:38`; `compliance.ts:97`; `ReportBuilder.tsx:216-217` | Fix each; minutes in the monthly and supervisor reports | R7 |
| 12 | Hint bubbles cover their target or sit on the wrong panel, and ignore Esc | Linda, Joe, Candy | cosmetic | 3 | New (Q7) | `ScreenHint.tsx` placement and keys | Anchor beside the target, Esc closes, wait while another popup is open | R5 |
| 13 | Keyboard: 66 Tabs to the first cell; Left wraps to the row above; the sidebar ring is clipped; the rule dialog opens on "Remove"; the row menu doesn't name the record; Ctrl+Enter fails from Hours | Mark | recovered | 2 | New | `useGridCellNavigation.ts:81-83`; `ColumnHeader.tsx:346-360`; `Sidebar.tsx:188,566` (ring clipped by `overflow-y-auto`); `ColumnRulePicker.tsx:50-55`; `CaseLog.tsx:354` | One header Tab stop, arrows clamp, ring-inset, focus on Close, a name heading, form-level Ctrl+Enter | R5, R4, R2 |
| 14 | Leftover words: the features heading "Records", Profile "Community Services Agency" / "jane.smith@agency.org", "No records or notes" in the setup file, "clients" in Home Health | Karen, Candy | cosmetic | 2 | Known pattern | `FeaturesSection.tsx:60`; `ProfileSection.tsx:30-31`; `starters.ts:247` | Vocabulary labels and neutral placeholders | R9, R8 |
| 15 | A deadline labelled with what isn't done yet ("Appeal filed · Nov 3") | Bobby | recovered | 2 | New | `DeadlineRow.tsx:89` uses the column name even for rules anchored on another column | Lead with the rule's name ("Appeal window") | R6 |
| 16 | Password screen: Tab lands on the eye, Enter reveals the password, and "don't match" blames an empty box | Joe, Mark | recovered | 4 | New | `PasswordSetupView.tsx:79,282-285` | Toggle after both fields; a specific message for an empty box | R5 |
| 17 | The header clock moves under the pointer on hover | Bobby | recovered | 2 | New | `ColumnHeader.tsx` hover layout | Reserve the space; a bigger hit area | R5 |
| 18 | The requirements card sits below 67 due rows and opens on all 80 names | Linda | recovered | 2 | New | `cards/layout.ts:22-24`; What's due is uncapped | Cap What's due at 10 + "Show all"; a requirements line under the tiles | R6 |
| 19 | Trust gaps: "Backup saved." doesn't say where; "saved during setup"; a used recovery key isn't flagged; restores aren't in the change history; ISO dates in cell history; "Pulse 0.0" | Karen | cosmetic | 1 | New | `BackupSection.tsx:137`; `LockScreenView.tsx:349`; `export-audit.ts:85-117`; `CellHistoryPopover.tsx`; `backup.ts:359` | Say the folder, neutral wording, a nudge, log the restore, `shortDate`, check the packaged version | R9 |
| 20 | Grey and small text in PDFs and placeholders | Bobby | cosmetic on screen, real on paper | 1 | Partly known | `export-pdf.ts:32-33`; `export-planner.ts:96,106` | PDFs ≥ 11–12 pt black | R7 |
| 21 | No "not this month" filter; blank or TBD dates drop out of "before" | Linda | recovered | 2 | New | Filter operators | Optional relative filter + "include blank" | R6 (optional) |
| 22 | Clicking a long Notes value selects it all, ready to type over | Linda | recovered | 2 | New | `CellEditor.tsx:77-78` | Caret at the end for notes and address | R1 |
| 23 | No sign a note saved after Ctrl+Enter, or that a record has an unsent draft | Candy | cosmetic | 1 | New | `CaseLog.tsx:378` handleAdd | Status, scroll to the new entry, unsent-note chip and notice | R2 |
| 24 | Weekly repeat shows no day lit | Candy | cosmetic | 1 | New | `AppointmentDialog.tsx:74` | Light the date's weekday | R2 |

Not planned (seen once or cosmetic): two places to save a filter; the import's "Why?" showing no visible text; the dark backdrop behind import; month calendar names truncated at 1280; Missing-information nags for unused template columns; phone-column validation; slow entry at Largest text; "Privacy Policy" opening a website (R5 adds an in-app privacy sentence instead); saved report names that keep old words.

## Praises that recur — protect these

| Praise | Who | Where |
|-|-|-|
| An example that knows the work (VSO's ITF and appeal windows, volunteer background checks, Special education's students and rosters) and shows everything before adding | Bobby, Mark, Karen | Starter gallery |
| The deadline card shows its maths: "Due Nov 3, 2026 (12 months after Nov 3, 2025)", "Last done Jul 10 · Next due Oct 10 · 5 days overdue" | Bobby, Linda | DeadlineCardContent, DeadlinePanel |
| What's due worst first, with Done / Done on… / Extend…; a double-click on Done doesn't hit the next row | Bobby, Joe, Mark | Dashboard |
| Colour plus shape (circle, square, diamond) | Bobby, Mark | Colour key, grid, dashboard |
| Their own words everywhere (Add Volunteer, Add Student, Add Person, "Add a patient") | Mark, Karen, Linda, Candy | Vocabulary layer |
| The import that read a messy spreadsheet, with Undo this import | Linda | Q1a import |
| Nothing lost across relaunches; "Saved"; visible auto-backups | Joe, Bobby, Linda | Footer, backups |
| The Trash and Recently archived restore things whole; the Undo toast; Ctrl+Z restores a column | Joe, Mark | Undo, Trash |
| The recovery key flow (printed card, accepted in lowercase with spaces); typed RESTORE with a safety copy; the wrong-attempt count | Bobby, Linda, Karen | Auth, backup |
| Straight privacy answers (About, the security summary, encryption on the first screen) | Bobby, Karen, Linda | About, summary |
| The note box: kinds, Minutes and Miles with units, "(written Oct 15)", the draft surviving a lock | Candy, Linda, Karen | CaseLog |
| "Does this date come due again?" and import's "Change these" | Mark, Linda | Add column, import |
| Help answering in the user's words with a "Turn on" button | Linda | Help + Q1b |
| Requirements presets and the read-back sentence | Linda, Karen | Requirements dialog |
| Double-click to rename a header; Tab across a row; Ctrl+N; the ? sheet; Alt+arrows | Joe, Candy, Mark | Grid, profile |
| Dark mode in one click, remembered | Candy | Appearance |
| "Every Tuesday" in two clicks; "Ends after 6 times" | Candy | Appointment dialog |
| Double-submit protection where it exists | Joe | Various |

## Per-persona verdicts

**Bobby (6.8).** The program solved his Earl problem on screen: the VSO example knew intent-to-file and appeal windows, the card showed its maths, and What's due became his morning briefing. It failed him on paper, which is the real copy for him: "Print this week" said nothing was due with a vet seven days out, no printout matched the screen, a checklist due date vanished without a word, and three counts on one dashboard disagreed. R7, R6 and R1 turn his "not yet for the paper" into a yes.

**Linda (6.8).** The import was the best moment of the study: eighty people, no retyping, every quirk handled. Then the first look's "Done" nearly falsified a contact. Requirements ignored her spreadsheet's contacts and showed 0 of 80, every call had to be logged twice, and future review dates became "last done". She'll keep her spreadsheet open beside Pulse until R1 and R4 land. They're the fixes that would let her stop.

**Joe (6.6).** Pulse kept everything through four relaunches and two accidents, which is what wins over a man who once retyped a home study in a parking lot. His hands fought it all afternoon: double-clicks made ghost records and menus that blink shut, Esc ate his typing, a two-digit year left a blank, and search didn't say where Bergstrom went. R3 and R1 remove almost all of it without retraining him.

**Karen (7.2).** She proved backup, restore, recovery, history and encryption, and credited each. One finding sets her probation: an impossible date silently erased an IEP date while the footer said "Saved". Behind it come the silent wrong-password failure, a security summary written for a health agency that contradicts itself on backups, and reports that need a proofread. R1, R9 and R7 end the probation.

**Mark (5.8).** He set up a list Ruth would have nodded at, entirely from the keyboard, and the volunteer example made him feel the program was for him. His trust score of 4 comes from one thing: an expired background check sits white while the dashboard says "All clear", because a separate Yes/No column is blank. After that, his place kept vanishing after Enter, and one extra arrow press trashed a column the Trash page couldn't find. R4, R5 and R3 are his.

**Candy (6.6).** Her note surviving the lock made her say "thank God" in a Sonic parking lot, and minutes and miles with units won her over. Then closing the window ate a note (the Mr. Thibodeaux scenario), the appointment form vanished on lock, mileage was off in her own example, and snippets hid under the card's edge. Until R2 lands she'll write notes in her phone first, which is the habit Pulse was meant to break.
