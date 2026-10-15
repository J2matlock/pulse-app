# Slice D — daily work: sidebar, dashboard, briefing, calendar, tasks, focus mode, reports

Reviewed 2026-10-14 as "Linda" with `e2e/ux-review/D.spec.ts`, `D6.spec.ts`, `D7.spec.ts`
(screenshots in `ux-review-shots/D/`, 1366×768 unless noted, all optional features on,
seeded caseload with overdue deadlines, tasks, checklist items, two appointments and an event).

## Summary

**Worst three**
1. **The sidebar's list "⋯" menu is invisible on a 768-high screen** (the common laptop). With every
   feature on, the sidebar needs scrolling, the "more below" fade mask turns on, and the fixed-position
   menu is clipped behind it. It opens (its text is in the DOM) but Linda sees nothing, clicks again, and
   it closes. Rename / settings / delete of a list are unreachable from the sidebar (UX-D-01).
2. **The dashboard's first screen contains no work.** Getting-started card, five count tiles and a
   "Deadline Colors" toggle fill 1366×768; the list of what is due starts below the fold, and the tiles
   that look like they'd open it don't. Linda reads 16 overdue and can't see one of them (UX-D-02, -06).
3. **Three different numbers for "tasks due"** — sidebar badge 2, briefing "4 tasks due", dashboard tile
   "Tasks & follow-ups due or late 5" — and "Done" on a recurring deadline, the one action she'll take
   twenty times a day, explains itself only in a hover tooltip (UX-D-04, -05).

**What works well**: the morning briefing's counts and the "Show this summary…" checkbox; the toast after
marking done ("next due Oct 14, 2027" with Undo); the calendar's "Add to Wednesday, Oct 14" chooser and
the "Which deadlines…" menu; "Add to your calendar" explains itself fully; the task form's repeat line
("When you tick it off, it comes back on its next date."); Snooze's four plain options; the Reports page
intro, presets, numbered steps and live preview; "Leave without saving?"; the Missing-information
dialog's instructions. Nothing in this slice uses right-click as the only way in.

Counts: 1 Blocker · 12 Major · 25 Minor · 11 Polish (49 findings).

---

## Blocker

### UX-D-01 · Blocker · S
**Where:** Sidebar → a list's "⋯" button, any window ≤ ~800 px high with the default feature set plus
Letters/Focus Mode on (shots: `ux-review-shots/D/B01-sidebar-menu-768.png` — menu open, nothing visible;
`B02-sidebar-menu-900.png` — same click at 900 px, menu visible).
**What Linda sees / thinks:** She hovers the list, a "⋯" appears, she clicks it. Nothing happens. She
clicks again (which closes it). "This button is broken."
**Why it's a problem:** `Sidebar.tsx:498-502` puts `maskImage` on the scrolling `<nav>` whenever there is
more below; a masked ancestor becomes the containing block for the `position: fixed` menu
(`Sidebar.tsx:227-243`), so it is positioned inside the nav and masked/clipped. Measured in `D7`: the
menu's rect is x=204, y=193 but `elementFromPoint` there is the grid's tip banner. Rename, list settings,
Forms, Contact requirements, Move up/down and Delete are all in that menu. At 1280×720 (shot
`97-grid-sidebar-dark-1280x720.png`) the sidebar also needs scrolling, so the bug is the normal case.
**Fix:** Render the menu in a portal on `document.body` (or drop the mask while a menu is open and use an
overlaid gradient `<div>` instead of `mask-image`). Add a `tests/renderer/a11y` check that the menu is
visible when the nav has `data-more-below`.
**Constraint check:** no schema change · touches `src/renderer/components/layout/Sidebar.tsx`

## Major

### UX-D-02 · Major · S
**Where:** Dashboard, first screen (shot `10-dashboard-top.png`; at 1280×720 `51-dashboard-1280x720.png`).
**What Linda sees / thinks:** Title row with five buttons, a big blue "Getting started" box with three
crossed-out lines, five number tiles, "Deadline Colors", then the top edge of a tab bar. "Where are the
16 overdue?" She may not know the page scrolls (the scrollbar is thin and dark).
**Why it's a problem:** The only actionable content is off-screen. `DashboardView.tsx:748` renders
`GettingStartedCard` above the cards every visit until dismissed; the card is 280 px tall with three of
four steps done.
**Fix:** Once ≥3 steps are done, collapse the card to a single line ("Getting started: 1 step left —
Set up backups · Hide") and move it below the tiles. Make the tiles one row of 90 px. Keep the Priority
List's first rows on screen at 768.
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/GettingStartedCard.tsx`,
`src/renderer/views/DashboardView.tsx`

### UX-D-03 · Major · M
**Where:** Sidebar with the default human-services features plus Focus Mode and Letters on, 1366×768 and
1280×720 (shots `02-grid-with-sidebar.png` — "Letters" half-faded, Trash hidden; `97-grid-sidebar-dark-1280x720.png`
— Templates and Letters hidden).
**What Linda sees / thinks:** 14 entries: Dashboard, one caseload, Calendar, Reports, Tasks, Contacts,
Snippets, Templates, Letters, Trash, Focus Mode, Settings, Help, Lock. The last ones fade out; she never
scrolls a sidebar. "Where is the trash?"
**Why it's a problem:** Four bottom buttons (`Sidebar.tsx:860-932`) are pinned, so the scrolling part
gets ~430 px for 10 items of 44 px. Snippets, Templates and Letters are authoring tools she'll use once
a month; Focus Mode is a view of the dashboard; Lock is already in the top-right menu/Ctrl+L.
**Fix:** (a) Fold Snippets, Templates and Letters into one "Templates" entry (tabs on that page), (b)
move Focus Mode into the Dashboard as a button ("Work through this list"), (c) drop the "Workspace" and
"System" headers (UX-D-27) and put Trash under Settings → Data with a sidebar entry only when it has
something in it, (d) make Lock an icon in the top bar. That leaves 8 items, which fit at 720.
**Constraint check:** no schema change · touches `Sidebar.tsx`, `TopBar.tsx`, `App.tsx` routes

### UX-D-04 · Major · S
**Where:** Dashboard → Priority List → a repeating deadline row (shot `20-dashboard-deadline-row-hover.png`,
`24-after-mark-done-toast.png`); Focus Mode rows (`71-focus-mode.png`).
**What Linda sees / thinks:** "Linh Okafor · Annual Review / Social Worker Caseload · based on Sep 19,
2025 / Sep 19, 2026 / 25 days overdue / Extend… / ✓ Done / ⌄". "Done — done what? If I click it does the
review disappear forever? What is the little arrow?"
**Why it's a problem:** What Done means ("sets the date to today, which starts the next cycle") is only
a `title` tooltip (`DeadlineRow.tsx:187-193`), and Linda doesn't hover. The ⌄ is "Done on another day…"
only in its tooltip (`DeadlineRow.tsx:200-212`). "based on Sep 19, 2025" (`:118`) is the engine's view,
not hers. The toast afterwards ("Marked … done; next due Oct 14, 2027", Undo) is excellent — it's the
only place the behaviour is said, and it comes after the click.
**Fix:** Under the tab bar, one grey line: "Done puts today's date in and starts the next cycle. Use ⌄
if it happened on an earlier day." Label the ⌄ button "Done on…" (text, not icon). Change "based on
Sep 19, 2025" to "last done Sep 19, 2025". Same line at the top of Focus Mode.
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/DeadlineRow.tsx`,
`DashboardView.tsx`, `src/renderer/views/focus-mode/ClientFocusItem.tsx`

### UX-D-05 · Major · S
**Where:** Sidebar badge, morning briefing, dashboard tile (shots `01-briefing-after-unlock.png` "4 tasks
due"; `10-dashboard-top.png` "Tasks & follow-ups due or late 5"; sidebar "Tasks 2").
**What Linda sees / thinks:** Three numbers for what sounds like one thing. "Which is right?"
**Why it's a problem:** The badge counts tasks only (`Sidebar.tsx:357-365`); the briefing adds checklist
items (`MorningBriefing.tsx:83`, "task due"); the tile adds follow-ups (`DashboardView.tsx:780`). All
three are correct and none says what it counts.
**Fix:** Use one count everywhere (tasks + checklist items + follow-ups due or late) and one name
("to-dos"); or give each its own words: badge tooltip "2 tasks due today or late", briefing lines "2
tasks due · 2 checklist items due · 1 follow-up due", tile "Tasks, checklist items and follow-ups".
**Constraint check:** no schema change · touches `Sidebar.tsx`, `MorningBriefing.tsx`, `DashboardView.tsx`,
`src/renderer/views/dashboard/tileCounts.ts`

### UX-D-06 · Major · S
**Where:** Dashboard summary tiles (shot `10-dashboard-top.png`).
**What Linda sees / thinks:** "Overdue deadlines 16" in a red box. She clicks it. Nothing.
**Why it's a problem:** Only the tasks tile has `href` (`DashboardView.tsx:785`); the others are static.
Boxes with a number and a coloured border read as buttons.
**Fix:** Every tile opens the matching tab and scrolls to it (Overdue → Overdue tab, 7 days → This Week,
30 days → This Month, Active → the list). Give them `role="link"`/`<button>` and a hover state.
**Constraint check:** no schema change · touches `DashboardView.tsx`, `src/renderer/views/dashboard/SummaryCard.tsx`

### UX-D-07 · Major · M
**Where:** Morning briefing → "Start Focus Mode"; Focus Mode itself (shots `01-briefing-after-unlock.png`,
`71-focus-mode.png`, `A50-focus-mode-bottom.png`).
**What Linda sees / thinks:** The primary blue button is "Start Focus Mode". "A mode? Of what?" If she
clicks, the whole app goes black (also in light theme — `FocusModeView.tsx:364` sets `text-white`,
dark panels), with the same rows as the dashboard but fewer buttons: no Extend, no "done on another day",
and "Done ✓" acts at once. "Exit Focus Mode" top-right.
**Why it's a problem:** The feature description promises "one at a time" (`features.ts:56`) but the view
is a long list of 20 (`71`, `72-focus-mode-scrolled.png`). It doesn't say what it's for or why it's black.
It's the briefing's recommended action, so a new user's first click lands here.
**Fix:** Briefing: make "Open dashboard" the primary button; secondary "Work through them one by one".
Focus Mode: one card at a time with "Done", "Not now (next)", "Extend…", "Open client", a "3 of 20"
counter; follow the app theme; a one-line intro "Each item in turn; Not now skips it for today."
If a redesign is too much, at least add Extend… and "Done on…" to each row and respect the theme.
**Constraint check:** no schema change · touches `src/renderer/components/shared/MorningBriefing.tsx`,
`src/renderer/views/FocusModeView.tsx`, `views/focus-mode/*`

### UX-D-08 · Major · M
**Where:** Calendar → click a deadline or follow-up chip (shots `A31-calendar-month-deadline-hover.png`,
`A32-calendar-month-deadline-clicked.png`).
**What Linda sees / thinks:** Chips read "Dorothy Kowalsk…", "Keisha Patel: Last …" — cut off. She clicks
one to see what it is, and the whole page changes to Keisha Patel's profile ("< Calendar · 48 of 48 ·
Alt+←/→ to navigate"). "Where did my calendar go?"
**Why it's a problem:** `CalendarView.tsx:225-229` navigates away on click for deadlines and follow-ups,
while appointments open a side panel with Done/No-show/Edit (`44-calendar-appointment-panel.png`). Two
different behaviours for look-alike chips; no way to mark a deadline done from the calendar; the full
name is only in the `title` tooltip (`:258`).
**Fix:** Open the same side panel for deadlines and follow-ups: full text, "Due Oct 12 · 2 days overdue",
buttons Done / Done on… / Extend… / Open client. In Week view's all-day row let chips wrap to two lines
(they have the width).
**Constraint check:** no schema change · touches `src/renderer/views/CalendarView.tsx`,
`src/renderer/components/calendar/AppointmentPanel.tsx` (generalise), `DeadlineRow` logic reuse

### UX-D-09 · Major · S
**Where:** Calendar → "Show:" row (shots `40-calendar-month.png`, `41-calendar-which-deadlines-menu.png`).
**What Linda sees / thinks:** "Show: [Appointments] [Events] [Deadlines] [Which deadlines… ⌄] [Follow-ups]
[Tasks]". They look like buttons. She clicks "Deadlines" to see deadlines — they vanish, and so does the
"Which deadlines…" menu. "I broke it."
**Why it's a problem:** Toggle chips with no checked indicator. The outlined (off) vs filled (on) styling
is subtle in both themes; nothing says "showing". No colour key for the chips (red/orange/yellow/green =
urgency, purple = task, blue = appointment, teal = event).
**Fix:** Checkbox chips ("☑ Appointments"), the label "Show:" → "Showing:", keep "Which deadlines…"
visible but disabled when Deadlines is off. Add a one-line legend under the row or a "Colours" toggle
like the dashboard's.
**Constraint check:** no schema change · touches `CalendarView.tsx` (~`:292-325`)

### UX-D-10 · Major · S
**Where:** Dashboard → "Monthly summary" button → dialog (shot `30-monthly-summary-dialog.png`); grid →
Reports → "Contact requirements summary…" (`B13-requirements-summary-dialog.png`).
**What Linda sees / thinks:** A button called "Monthly summary" opens a dialog called "Contact
requirements summary" with "Contact requirements met 0% (0/48)" in her first week. "Is that bad? What's
an exception?" ("The PDF lists every exception by client.")
**Why it's a problem:** Button and dialog names differ (`DashboardView.tsx:715-718` vs
`ComplianceSummaryDialog.tsx:77`); 0% reads as a failing grade for a new workspace; "exception" is
compliance jargon (`:126`).
**Fix:** Name both "Monthly summary"; a sub-line "How the month is going: contact requirements, deadlines
on time, missing information"; "The PDF lists who is behind, by client." When the period has <7 days
elapsed, show "(month just started)" next to the percentage.
**Constraint check:** no schema change · touches `DashboardView.tsx`, `src/renderer/components/reports/ComplianceSummaryDialog.tsx`

### UX-D-11 · Major · S
**Where:** Dashboard → "Print reminder letters" → choose caseload → dialog (shots `32-reminder-letters-choose-list.png`,
`33-reminder-letters-dialog.png`).
**What Linda sees / thinks:** Button "Print reminder letters" → "Which caseload?" → a dialog titled "Print
documents or labels: Social Worker Caseload" with tabs Documents / Address labels, "For: Everyone with a
deadline due between [Next Review] 11/01/2026 and 11/30/2026", template "Introduction Letter", page
options, "This makes 2 documents." The Cancel/Continue buttons are below the window edge and under the
toast at 768.
**Why it's a problem:** Three names for one thing; the dialog is taller than the window with no visible
scrollbar cue; the default template "Introduction Letter" for "reminder letters" is wrong-looking.
**Fix:** Title the dialog "Print reminder letters: Social Worker Caseload" when opened from that button;
cap dialog height at `calc(100vh - 2rem)` with the button row sticky at the bottom; default template =
the one named "Reminder" if present.
**Constraint check:** no schema change · touches `src/renderer/components/documents/BatchDocumentsDialog.tsx`,
`DashboardView.tsx:723-738`

### UX-D-12 · Major · S
**Where:** Tasks → a task row (shots `60-tasks.png`, `65-task-row-hover.png`, `A70-tasks-1280.png`).
**What Linda sees / thinks:** Rows show a checkbox, title, date chip, "High". Only when the mouse happens
to rest on a row do a bell, a pencil, a bin and a "⟳ Repeat" chip appear. She never hovers to look, so
she doesn't know a task can be edited, snoozed or repeated. When she does see "⟳ Repeat" on a
non-repeating task she thinks it already repeats.
**Why it's a problem:** Hover-only actions (`TaskItem.tsx:285, 365, 375`) are invisible to a mouse
user who reads first; the Repeat affordance looks like a state.
**Fix:** Always show one "⋯" (or "Edit") button at the end of each row at low emphasis; inside it: Edit,
Snooze…, Repeat…, Delete. Clicking the title opens Edit (it does today, shot `68-task-clicked.png`, but
nothing says so — add `cursor: pointer` and an underline on hover).
**Constraint check:** no schema change · touches `src/renderer/components/tasks/TaskItem.tsx`

### UX-D-13 · Major · S
**Where:** Calendar → New… → Event form (shot `47-2-calendar-new-event.png`) and Appointment form
(`47-3-calendar-new-appointment.png`).
**What Linda sees / thinks:** The chooser said an Event is "not about one client", yet the form's second
field is "With (optional) — Search clients, or leave empty". On the Appointment form: "When it's done,
log it as: Usual: Visit". "Log it as what? What's 'Usual:'?"
**Why it's a problem:** Contradiction between chooser and form (`AppointmentDialog.tsx:173-174`); "log
it as" and the "Usual:" prefix (`:207-209`) are implementation words for "a case note of this kind is
written when you mark it done".
**Fix:** Hide "With" on events (or relabel the chooser "usually not about one client"). Relabel the
select "When you mark it done, add a case note of this kind" with options "Visit (the usual)", "Phone",
… .
**Constraint check:** no schema change · touches `src/renderer/components/calendar/AppointmentDialog.tsx`,
`NewOnCalendarChooser.tsx:27`

## Minor

### UX-D-14 · Minor · S
**Where:** Sidebar section headers (shot `02-grid-with-sidebar.png`).
**What Linda sees / thinks:** "WORKSPACE" holding only Dashboard; "SYSTEM" holding only Trash.
**Why it's a problem:** Headers that name one item add reading without meaning (`Sidebar.tsx:504-508,
822-829`).
**Fix:** Drop both headers; order: Dashboard, Calendar, Tasks, then "CASELOADS", then "TOOLS" (Reports,
Contacts, Templates), with Trash at the end of Tools.
**Constraint check:** no schema change · touches `Sidebar.tsx`

### UX-D-15 · Minor · S
**Where:** Sidebar → "CASELOADS +" (shot `02`).
**What Linda sees / thinks:** A faint "+" to the right of the header is the only way to add a caseload.
**Why it's a problem:** Icon-only, low-contrast, 16 px glyph (`Sidebar.tsx:545-555`); the tour points
at it once.
**Fix:** A last row under the lists: "+ New caseload" in text (collapsed: keep the icon).
**Constraint check:** no schema change · touches `Sidebar.tsx`

### UX-D-16 · Minor · S
**Where:** Sidebar list row (shot `A02-sidebar-list-row-hover.png`).
**What Linda sees / thinks:** The "⋯" is 40 % opacity until hover (`Sidebar.tsx:212-216`); the drag
handle at the left is also faint.
**Fix:** Full opacity for "⋯" on the active list; hide the drag handle unless there are ≥2 lists.
**Constraint check:** no schema change · touches `Sidebar.tsx`

### UX-D-17 · Minor · S
**Where:** Top bar, right side (every shot): "⟲ ⌄ ⟳  🕓⌄  ?  Press ? for shortcuts".
**What Linda sees / thinks:** Two question marks. "Press ? for shortcuts" is a keyboard hint she won't
use; the circled "?" is the help button but looks like part of the hint.
**Why it's a problem:** `TopBar.tsx:350-362`: the kbd hint is `aria-hidden` decoration that takes 150 px
on every page.
**Fix:** Drop the "Press ? for shortcuts" text (it's on the Help page); label the help button "Help"
with the icon. Undo/redo: add a tooltip-free label on the history chevron ("History").
**Constraint check:** no schema change · touches `src/renderer/components/layout/TopBar.tsx`

### UX-D-18 · Minor · S
**Where:** Top bar, recent-clients button (shot `07-topbar-recent-menu.png`).
**What Linda sees / thinks:** A clock icon with a chevron; she doesn't know it's "Recent clients" until
she clicks.
**Fix:** Text label "Recent ⌄" next to the icon (there is room).
**Constraint check:** no schema change · touches `TopBar.tsx:285-305`

### UX-D-19 · Minor · S
**Where:** Dashboard header buttons (shot `10-dashboard-top.png`).
**What Linda sees / thinks:** "Print this week · Monthly summary · Add to calendar · Print reminder
letters · Customize" — five equal grey buttons she reads every visit.
**Why it's a problem:** Four are occasional actions; the row wraps at 1280 (`51-dashboard-1280x720.png`).
**Fix:** Keep "Customize"; put the others under one "Print & export ⌄" menu.
**Constraint check:** no schema change · touches `DashboardView.tsx:708-746`

### UX-D-20 · Minor · S
**Where:** Dashboard tabs (shot `16-dashboard-overdue-tab.png`).
**What Linda sees / thinks:** "Priority List · Overdue · This Week · This Month · Recently archived".
"Priority list — whose priority?" The tabs have no counts; "This Week"/"This Month" duplicate the
Calendar.
**Fix:** "Everything due (52) · Overdue (16) · Next 7 days (14) · Next 30 days (44)"; move "Recently
archived" to the Customize list as a card.
**Constraint check:** no schema change · touches `DashboardView.tsx:382-387, 506-512`

### UX-D-21 · Minor · S
**Where:** Dashboard → "ⓘ Deadline Colors" (shots `10`, `15-dashboard-color-guide.png`).
**What Linda sees / thinks:** Grey text with an info icon under the tiles; she doesn't know it's a button.
When opened: "The stripe on the left of each row: red = late or due today, orange = due this week,
yellow = due this month." then one rule block per rule in use.
**Why it's a problem:** `DashboardView.tsx:454-465` styles it like a caption; the guide is useful.
**Fix:** Style as a small link "What do the colours mean?" placed in the tab bar's right end.
**Constraint check:** no schema change · touches `DashboardView.tsx`

### UX-D-22 · Minor · S
**Where:** Dashboard → Extend… dialog (shot `22-extend-deadline-dialog.png`).
**What Linda sees / thinks:** "Extend: Annual Review: Linh Okafor · Due now: Sep 19, 2026 · New due date ·
Reason (shows in the timeline and audit trail)". "Audit trail?"
**Why it's a problem:** `ExtendDeadlineDialog.tsx:41`; nothing says the row turns green/yellow until the
new date and "Remove extension" brings it back.
**Fix:** "Reason (kept with the client's history)"; a line "Until the new date this deadline counts as on
time. You can remove the extension later."
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/ExtendDeadlineDialog.tsx`

### UX-D-23 · Minor · S
**Where:** Dashboard → ⌄ → "Done on another day" dialog (shot `23-done-on-day-dialog.png`).
**What Linda sees / thinks:** Title "Annual Review: Linh Okafor", field "Day it was done", "Mark done".
No verb in the title; nothing says the next due date will count from that day.
**Fix:** Title "Mark Annual Review done for Linh Okafor"; helper "The next one is counted from this day."
(`DoneOnDayDialog.tsx:31-36`).
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/DoneOnDayDialog.tsx`

### UX-D-24 · Minor · S
**Where:** Dashboard → Done on a one-off deadline (shot `A21-one-off-done-dialog.png`).
**What Linda sees / thinks:** "Done: Annual Assessment: Dorothy Kowalski · Was due Oct 11, 2026 ·
◉ Renewed: it has a new date · New date · ○ Finished: nothing more is due (the date stays, marked done)".
**Why it's a problem:** Good structure; "(the date stays, marked done)" is implementation-speak
(`OneOffDoneDialog.tsx:58`). The row shows no ⌄ for one-offs so "done on another day" isn't offered.
**Fix:** "Finished — nothing more is due for this." Add "Day it was done" under Renewed too.
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/OneOffDoneDialog.tsx`

### UX-D-25 · Minor · S
**Where:** Dashboard deadline rows → checkboxes (shots `20`, `A11-dashboard-scroll-1.png`).
**What Linda sees / thinks:** Every row has a checkbox at the left. Nothing says what checking does until
one is checked ("3 selected · Mark done · Clear" bar). No "select all".
**Why it's a problem:** `DeadlineRow.tsx:98-106`; bulk done is an expert action shown at full weight.
**Fix:** Hide the checkboxes behind a "Select several…" link in the tab row, or add a header checkbox
with the label "Select all shown".
**Constraint check:** no schema change · touches `DashboardView.tsx:436-447`, `DeadlineRow.tsx`

### UX-D-26 · Minor · S
**Where:** Dashboard → Today card (shot `25-dashboard-task-row.png`).
**What Linda sees / thinks:** Orange box "Needs an outcome — Did these happen? Marking them writes the
case note and counts the contact." Buttons Done… / No-show / Mark cancelled / Edit / Delete.
**Why it's a problem:** "outcome" is the data word (`TodayCard.tsx:47-48`); five buttons per row.
**Fix:** "Still open from earlier — what happened?"; Done… / No-show / Cancelled, with Edit and Delete
under "⋯".
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/cards/TodayCard.tsx`

### UX-D-27 · Minor · S
**Where:** Dashboard → Contact requirements card (shots `A17-dashboard-scroll-7.png`, `A18-monthly-contacts-expanded.png`).
**What Linda sees / thinks:** "Contact requirements this month · 17 days left in October · › Social
Worker Caseload · 0 of 48 done · 48 still behind · Change". Expanded: "Aisha Morales needs Home visit
(0 of 1), Phone check-in (1 of 2)".
**Why it's a problem:** Fine once you know it; "still behind" on day 14 with half a month left is
alarming; the "›" disclosure is small and the row isn't obviously clickable.
**Fix:** "48 still to do this month" before the 20th, "still behind" after; make the whole row the
disclosure button with "Show who".
**Constraint check:** no schema change · touches `src/renderer/views/dashboard/MonthlyContactsCard.tsx:84-94`

### UX-D-28 · Minor · S
**Where:** Toast after an action (shots `25`–`31`, `74-focus-mode-after-done.png`).
**What Linda sees / thinks:** The "Marked … done; Undo" toast sits bottom-centre over the Today card's
buttons for 8+ seconds and over the reminder-letters dialog's buttons (`33`).
**Fix:** The app's `Toaster` is bottom-right (`App.tsx:141`); the undo toast overrides it to
bottom-centre with a longer duration. Use bottom-right for it too, or shorten to 5 s once the mouse moves.
**Constraint check:** no schema change · touches the undo toast helper (grep `position: 'bottom-center'` in `src/renderer`)

### UX-D-29 · Minor · S
**Where:** Calendar first open (shot `40-calendar-month.png` shows Week).
**What Linda sees / thinks:** The calendar opens in Week view with a 7 am–5 pm grid and a cramped all-day
strip of truncated deadline chips; with Appointments off it opens in Month (`CalendarView.tsx:103`).
**Why it's a problem:** The default changes with a feature switch; Week's all-day strip is the worst
place to read deadlines.
**Fix:** Remember the last view per user (setting), default Month; in Week, give the all-day strip up to
4 rows before "+N more".
**Constraint check:** no schema change (uses settings key) · touches `CalendarView.tsx`

### UX-D-30 · Minor · S
**Where:** Calendar → "Deadline for a client" form (shot `47-4-calendar-new-deadline-for-a-client.png`).
**What Linda sees / thinks:** "Client: Search clients · Due on: 10/14/2026 · Set deadline". Which
deadline? (The column choice appears only after a client is picked.)
**Fix:** Show the column select greyed with "Pick a client first" so the shape of the form is visible.
**Constraint check:** no schema change · touches `src/renderer/components/calendar/DeadlineForRecordDialog.tsx`

### UX-D-31 · Minor · S
**Where:** Tasks → Add task / Edit task dialog (shots `A40-tasks-add-dialog.png`, `A41-tasks-add-dialog-repeat.png`).
**What Linda sees / thinks:** Fields Title, Notes, Priority, Due date, Category ("e.g. Admin, Reporting…"),
Caseload ("-- All caseloads --"), Repeat. "Why would a task belong to a caseload? What does Category do?"
**Why it's a problem:** `TaskFormDialog.tsx:184-205`: no helper text; "-- All caseloads --" with dashes
looks like a placeholder.
**Fix:** "Caseload (optional) — shown with that caseload; leave as 'Any' for your own to-dos"; Category →
"Label (optional)". The repeat line "When you tick it off, it comes back on its next date." is good —
keep.
**Constraint check:** no schema change · touches `src/renderer/views/tasks/TaskFormDialog.tsx`

### UX-D-32 · Minor · S
**Where:** Tasks page right half (shot `60-tasks.png`).
**What Linda sees / thinks:** A big empty "Scratch notes" box with "Type / for snippets" and B I U
buttons takes half the page.
**Why it's a problem:** Unexplained, and the snippet hint (`ScratchPad.tsx:318`) is jargon.
**Fix:** Title "Notes to myself (not about a client)"; hint only when snippets exist; let the pane
collapse (remember in settings).
**Constraint check:** no schema change · touches `TasksView.tsx`, `src/renderer/components/profile/ScratchPad.tsx`

### UX-D-33 · Minor · S
**Where:** Tasks → "Templates" button → "Checklist Templates" dialog (shot `B20-tasks-templates.png`).
**What Linda sees / thinks:** "No templates yet · Create your first template · Templates add items to the
existing checklist without replacing them." On the Tasks page there is no checklist.
**Why it's a problem:** The dialog is the profile checklist's dialog reused (`TasksView.tsx:565`).
**Fix:** On Tasks, call it "Add a set of tasks…" and word the footer "Adds these tasks to your list."
**Constraint check:** no schema change · touches `TasksView.tsx`, the template picker component

### UX-D-34 · Minor · S
**Where:** Tasks → Snooze (shot `66-task-snooze-dialog.png`); "Snoozed" group (`TasksView.tsx:804`).
**What Linda sees / thinks:** "Snooze until… Tomorrow / In 3 days / In a week / Custom date". Clear. After
snoozing the task disappears into a collapsed "Snoozed" group at the bottom.
**Fix:** Add "It's hidden until then; find it under Snoozed below." in the dialog, and a toast with Undo.
**Constraint check:** no schema change · touches `src/renderer/views/tasks/SnoozeDialog.tsx`

### UX-D-35 · Minor · S
**Where:** Focus Mode section headings and buttons (shots `71-focus-mode.png`, `A50-focus-mode-bottom.png`).
**What Linda sees / thinks:** "Client deadlines needing attention" / "Admin Tasks Due Today" / "Checklist
Items Due" / "Case note follow-ups due"; buttons "Done ✓", "Complete", "Done".
**Why it's a problem:** Mixed capitalisation and verbs (`FocusModeView.tsx:421, 443, 464, 516`;
`ClientFocusItem.tsx:59`, `TaskFocusItem.tsx:59`).
**Fix:** Sentence case throughout; "Done" everywhere.
**Constraint check:** no schema change · touches `FocusModeView.tsx`, `views/focus-mode/*`

### UX-D-36 · Minor · S
**Where:** Grid toolbar → Reports menu (shot `B10-grid-reports-menu.png`).
**What Linda sees / thinks:** "Build a report… · Summary report… · Contact requirements summary… ·
Missing information… · Audit trail… · Totals… · All reports". "Audit trail?" "Totals of what?"
**Why it's a problem:** Totals opens "No case notes with time, miles or your own numbers this month.
Turn them on in Settings…" (`B11-totals-dialog.png`) — an item that explains it does nothing.
**Fix:** Hide "Totals…" until a time/mileage/measure feature is on; "Audit trail…" → "Change history…";
"Summary report…" → "Report for my supervisor…".
**Constraint check:** no schema change · touches `src/renderer/components/grid/GridToolbar.tsx:275-335`

### UX-D-37 · Minor · S
**Where:** Summary (supervisor) report dialog (shots `B12-summary-report-dialog.png`, `-scrolled`).
**What Linda sees / thinks:** "Coordinator / Worker Name · Title · Organization · Date Range · Columns to
Include (Deselect all) · Include activity log · Export Report".
**Why it's a problem:** No sentence saying what the PDF contains; "Export Report" is jargon; the
column list is a small inner scroll box inside a scrolling dialog (two scrollbars).
**Fix:** Intro line "A PDF of your caseload for the period: who you saw, what came due, and what's
late — for your supervisor."; button "Save PDF…"; prefill the worker name from Settings → Profile.
**Constraint check:** no schema change · touches `src/renderer/components/grid/SupervisorReportDialog.tsx`

### UX-D-38 · Minor · S
**Where:** Sample data banner on every page (all shots: "Clients with a ✦ are made-up samples. Remove them
when you're done. · Remove sample data").
**What Linda sees / thinks:** The same 48 px bar on Dashboard, Calendar, Tasks, Reports, Settings.
**Fix:** Show it on the list page and the dashboard only; on other pages a small "sample data" chip in
the status bar.
**Constraint check:** no schema change · touches `src/renderer/components/shared/SampleDataBanner.tsx`

## Polish

### UX-D-39 · Polish · S
**Where:** Morning briefing (shot `A01-briefing-with-name.png`).
**What Linda sees / thinks:** "Good evening, Linda" — nice. "1 past appointment without an outcome".
**Fix:** "1 appointment from Oct 11 still needs marking done, no-show or cancelled" (`MorningBriefing.tsx:88`).
**Constraint check:** no schema change · touches `MorningBriefing.tsx`

### UX-D-40 · Polish · S
**Where:** Calendar toolbar: "Add to my calendar…" vs dashboard "Add to calendar" (shots `40`, `10`).
**Fix:** One label: "Send to Outlook/Google…" or "Add to my calendar…" in both (`CalendarView.tsx:289`,
`DashboardView.tsx:719-722`).
**Constraint check:** no schema change

### UX-D-41 · Polish · S
**Where:** Calendar "New…" button (shot `40`).
**Fix:** "Add…" — "New" alone is vague; the chooser that follows is excellent (`CalendarView.tsx:290`).
**Constraint check:** no schema change

### UX-D-42 · Polish · S
**Where:** Task row chips "High", "Low" (shot `60-tasks.png`).
**Fix:** "High priority" / tooltip; the red/blue dot in dashboard task rows (`25-dashboard-task-row.png`)
has no label either (`TaskRow.tsx`).
**Constraint check:** no schema change

### UX-D-43 · Polish · S
**Where:** Tasks page header "Tasks · 4 active · 1 overdue · + Add Task · Sort: My order · Group ·
Templates" and progress bar "0 of 4 completed" (shot `60`).
**Fix:** "Group" → "Add a group"; "Sort: My order" → "Order: as I arranged"; drop the progress bar
until there are ≥5 tasks.
**Constraint check:** no schema change · touches `TasksView.tsx:532-570`

### UX-D-44 · Polish · S
**Where:** Reports builder preview "(blank) 40" (shot `84-report-after-preset.png`).
**Fix:** "(no status) 40" — `src/main/report-builder.ts:367`.
**Constraint check:** no schema change

### UX-D-45 · Polish · S
**Where:** Reports builder buttons "Export PDF · Export CSV · Pin to dashboard" (shot `81-report-builder-top.png`).
**Fix:** "Save as PDF…", "Save as spreadsheet (CSV)…", "Show on dashboard".
**Constraint check:** no schema change · touches `src/renderer/components/reports/ReportBuilder.tsx:459-462`

### UX-D-46 · Polish · S
**Where:** Dashboard → Customize panel (shot `B30-dashboard-customize-list.png`).
**What works:** Checkbox list with up/down arrows, "Cards for features that are off aren't listed."
**Fix:** Name "Recent case notes" is off by default and the only unchecked row; say "(off)" beside it so
she knows ticking it adds a card.
**Constraint check:** no schema change

### UX-D-47 · Polish · S
**Where:** Getting-started card step "Put in a date that has a reminder, and watch its color"
(`GettingStartedCard.tsx:49`).
**Fix:** "Add a date with a deadline rule and see it change colour".
**Constraint check:** no schema change

### UX-D-48 · Polish · S
**Where:** Undo button shows a count "⟲ 1" after an action (shot `24-after-mark-done-toast.png`).
**Fix:** The number has no label; tooltip exists. Drop the count or show it only in the history panel.
**Constraint check:** no schema change · touches `TopBar.tsx:227-231`

### UX-D-49 · Polish · S
**Where:** Collapsed sidebar (shot `05-sidebar-collapsed.png`).
**What works:** List initials "SW", tooltips. Nothing to fix beyond UX-D-03.

---

## Things that work well (keep)
- Morning briefing counts, the "Show this summary the first time I unlock each day" checkbox, Undo in
  every toast.
- "Add to Wednesday, Oct 14" chooser: four options, each with a plain sub-line.
- "Which deadlines…" menu: "4 of 4 shown. New deadline columns show until you turn them off."
- "Add to your calendar" dialog: says what's included, privacy default (initials), that it doesn't
  update itself.
- Appointment Done flow: "Note for the record (optional) · Mark done · Never mind"; "This hasn't
  happened yet" guard for future ones.
- Task form repeat explanation; Snooze presets with real dates.
- Reports: the intro paragraph, presets, numbered steps with hints, live preview, "Leave without
  saving?", and the "Your unsaved changes to this report are back" notice.
- Missing information dialog's step-by-step instruction.
- Keyboard-free everywhere: nothing in this slice needs a right-click or a shortcut.
