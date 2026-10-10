# Audit: the record page (profile) and everything you do with one record

Reviewer area prefix: **R**. Evidence: code under `src/` (file:line) and screenshots `test-results/audit-tour/15–18-*.png` and `plans/website/screenshots/*/03-record.png`. Note: `test-results/ui-tour/current/` does not exist on disk, so none of those screenshots were available. `audit-tour/17-profile-job.png` and `18-profile-job-scrolled.png` are not mislabeled. They show a real bug (R-07): a Jobs record opened by link shows "Customer not found".

## Top 5

1. **Stop Escape from leaving the page** (R-01). Today, pressing Escape to close a snippet menu, cancel an edit or close any dialog also jumps to the grid and throws away the half-written note or form.
2. **Keep drafts with their own record** (R-02). Today, moving to the next record carries the unsaved note over, so it can be saved on the wrong person. Scratch pad typing from the last 2 seconds is lost.
3. **Let people date a note** (R-03). Today every note is stamped "now", so a visit written up the next morning counts in the wrong month and sets "Last visit" to the wrong day.
4. **Make the record page the place to work** (R-06, R-04, R-10). Fields should be editable in place, deadlines need a "Done" button, and the note box should move to the top (with visible scrollbars) instead of sitting below six other sections.
5. **Open the right record from anywhere, and print correct deadlines** (R-07, R-08). Recent records, Contacts and Focus Mode should load the record's own list instead of saying "may have been archived or deleted". The profile PDF and handoff packet should use the deadline engine, so they stop marking healthy deadlines OVERDUE.

Counts: Blocker 1 · High 8 · Medium 18 · Low 10 (37 findings).

---

## Findings

### R-01 · Escape anywhere on the record page leaves the page and loses what you typed · Severity: Blocker · Type: bug
- **Where:** `src/renderer/views/ProfileView.tsx:320-337`: a `window` keydown listener calls `goBack()` on every Escape. It only skips when the letter modal or the unused print layout is open. Nothing on the page stops the event before it gets there:
  - `CaseLog.tsx:222-227`: snippet menu Escape calls `preventDefault` only.
  - `CaseLogEntry.tsx:241`: cancel a note edit.
  - `DeadlinePanel.tsx:317`: cancel a date edit.
  - `ProfileHeader.tsx:429, 604`: tag edit and "Add contact info".
  - `LinkedProviders.tsx:236` and `LinkedRecords.tsx:100`.
  - Dialogs: `FillFormDialog.tsx:105-109`, `HandoffDialog.tsx:40-44`, `AuditReportDialog.tsx:37-41`, `ExtendDeadlineDialog.tsx:18-22`, `Checklist.tsx:888-892` (template manager and editor), `NoteFormatsDialog.tsx:21`, `NumberHistory.tsx:46-50`.

  None of these call `stopPropagation`, and the profile handler doesn't check `defaultPrevented` or the focused element.
- **What the user experiences:** A user is typing a case note, types "/" and sees the snippet menu, which says "Esc dismiss". They press Escape and land back on the grid with the note gone. The same happens when they press Escape to:
  - cancel editing a note
  - close the "Fill in a form" dialog (all answers lost)
  - close Extend, Handoff or Audit trail
  - back out of the checklist template editor
- **Why it matters:** This is the main workflow (writing notes), the screen itself tells people to press Esc, and the typed work is lost with no warning.
- **Fix:** In the profile handler, ignore Escape when `e.defaultPrevented`, when focus is in an `input`, `textarea`, `select` or `[contenteditable]`, or when any `[aria-modal="true"]` element is in the DOM. Also make the dialogs call `e.preventDefault()`. Power users keep Escape-to-grid when nothing is focused.
- **Effort:** S

### R-02 · Unsaved note, scratch pad and checklist text carry over to the next record · Severity: High · Type: bug
- **Where:**
  - `App.tsx:211-217`: the `/profile/:rowId` route has no `key`, so Prev/Next (`ProfileView.tsx:302-333`) reuses the same components.
  - `CaseLog.tsx:104-120`: the draft (`newContent`, `fieldValues`, minutes, miles, follow-up) is never reset when `rowId` changes.
  - `ScratchPad.tsx:114-131, 159-172`: the 2-second debounced save reads `rowIdRef` at fire time and only flushes on unmount.
  - `Checklist.tsx:586` (`newTitle`) and `DeadlinePanel.tsx:124` (`editingColId`) are also kept between records.
- **What the user experiences:** A user half-writes a note for Maria, presses Alt+→ (or Option+← on a Mac, which also moves the cursor by word), and sees Robert's page with Maria's note still in the box. Ctrl+Enter saves it on Robert. Anything typed in Maria's scrap notes in the last 2 seconds silently disappears.
- **Why it matters:** This puts documentation on the wrong person (a privacy and records-integrity problem) and silently loses text.
- **Fix:**
  - Key the profile body by `rowId` (`<ProfileView key={rowId}>`, or key the three panels), so every record starts clean and ScratchPad's unmount flush saves to the right row.
  - Optionally keep per-record drafts in `sessionStorage` keyed by row id, so nothing is lost.
  - When a draft exists, show a small "You have an unsaved note" prompt before Prev/Next.
- **Effort:** S

### R-03 · A note can't be dated; late write-ups count in the wrong period and set the wrong "last" date · Severity: High · Type: logic
- **Where:**
  - `src/main/ipc/ipc-caselog.ts:45-69`: the INSERT always uses `datetime('now')` (line 59), and `applyNoteDateUpdates(rowId, logType)` is called without its `noteDate` parameter (`src/main/note-date-updates.ts:17` already accepts one).
  - Monthly requirements count by `created_at`: `src/main/contact-requirements.ts:92-97`.
  - Composer: `CaseLog.tsx:511-636` (no date field). Edit: `CaseLogEntry.tsx:233-279` (no date field).
- **What the user experiences:** A home visit on the 31st is written up on the 1st. The note shows the 1st, the "Visit 1 of 1 this month" line counts it for the new month (last month shows missed), and a "Last face-to-face" column follows the note and jumps to today. There's no way to fix it.
- **Why it matters:** Monthly contact compliance and billing depend on the date of service, not the date of typing. It also makes the requirement and deadline features report wrong numbers.
- **Fix:** Add an optional "When" date, defaulting to today, next to the note type chips. Store it as `occurred_on`, or set `created_at` to that date at the current time. Pass it to `applyNoteDateUpdates` and count requirements by it. Let it be corrected on edit, with the change kept in edit history. Keep `created_at` as the audit timestamp.
- **Effort:** M

### R-04 · No "Done" button for a deadline on the record page · Severity: High · Type: usability
- **Where:** `DeadlinePanel.tsx:292-297`: "Mark done" exists only for sequence steps. Regular interval and plain deadlines only offer "click the date to edit" (`350-377`) and "Extend…" (`380-383`). The dashboard has full completion (`views/dashboard/completeDeadline.ts`: rolls repeating rules to today, clears plain due dates, adds checklists, logs to the timeline).
- **What the user experiences:** The user is on Robert's page and just did the annual tree check. The card says "15 days overdue" but offers only "Extend…". They have to click the old date, type today's date and press Enter. Typing the date doesn't add the follow-on checklist the dashboard would add, and it doesn't log "completed".
- **Why it matters:** "I did it, mark it done" is the most common deadline action. It works on the dashboard but not where the person is actually looking at the record.
- **Fix:** Add a "Done" button on every card that calls `completeDeadlines([...])` with the card's interval, rule kind and checklist template (as `DeadlineRow.tsx:71` does). Keep "click the date" for corrections and "Extend…" as a quieter link.
- **Effort:** S

### R-05 · Focus Mode "Complete" erases a repeating deadline instead of restarting it · Severity: High · Type: bug
- **Where:**
  - `src/renderer/views/FocusModeView.tsx:183-225`: `handleDismissClientItem` sends `CELL_UPDATE(rowId, columnId, null)` for every record deadline.
  - Compare `completeDeadline.ts:31-38, 57-63`: repeating rules get today's date.
  - Focus Mode also filters with `computeDaysUntil` (`:93`), which ignores extensions and non-interval rule kinds.
- **What the user experiences:** In Focus Mode the user clicks Complete on "Annual assessment due". The date is wiped. The card on the record now says "No date set — click to add", the deadline never comes due again, and nothing reminds them next year.
- **Why it matters:** Completion silently turns a recurring obligation into nothing, and it behaves differently from the dashboard's Done.
- **Fix:** Call `completeDeadlines()` from Focus Mode (it already handles undo and logging), and source items from the deadline engine (`DEADLINES_GET`) rather than `computeDaysUntil`.
- **Effort:** S

### R-06 · Record details can't be edited on the record page · Severity: High · Type: usability
- **Where:** `src/renderer/components/profile/GridDataSummary.tsx:157`: `onCellSave` is passed in (`ProfileView.tsx:538`) but never used. `renderValue` (`:107-153`) is display-only. The only editable values on the page are rule-backed dates in the Deadlines panel and, if a form exists, the "Fill in a form" dialog.
- **What the user experiences:** The user opens a client to update their phone, insurance or status. The "Customer details" section shows the values, but clicking does nothing. They have to go back to the grid, find the row and edit the cell.
- **Why it matters:** For Excel users the record page should be the "form view" of a row. Without editing, it reads like a report, and people bounce between screens.
- **Fix:** Make each detail card click-to-edit using the grid's `CellEditor` (or the per-type inputs in `FillFormDialog.tsx:173-191`), saving via `updateCell` with the same undo. Keep read-only types (age, days-until, auto-number, deadline) as is. Show the "Fill in a form" buttons as an alternative, not the only way.
- **Effort:** M

### R-07 · Opening a record from another list says it "may have been archived or deleted" · Severity: High · Type: bug
- **Where:**
  - `ProfileView.tsx:240`: the row is looked up only in the currently loaded list. The not-found message is at `:350-362`. The list switches only when `?gridId=` is present (`:214-222`).
  - Callers that leave it out: `TopBar.tsx:262` (Recent records, even though `RecentProfile.gridId` is stored), `ContactLinkedClients.tsx:93`, `FocusModeView.tsx:229` (deadlines, follow-ups and checklists from any list), and `TourOverlay.tsx:252+`.
  - Screenshot `audit-tour/17-profile-job.png` (a Jobs row while Customers is loaded) shows "Customer not found — it may have been archived or deleted."
  - Archived records are also excluded from `rows` (`gridStore.ts:153-158`), so "(archived)" linked records can't be opened either.
- **What the user experiences:** The user clicks a name in Recent, in a Contact's client list or in Focus Mode and is told the record may be deleted. It isn't. They panic, or go hunting through lists.
- **Why it matters:** This is a false alarm about data loss, and a dead end in common navigation paths.
- **Fix:** When the row isn't in `rows`, ask main for its `grid_id` (a small `ROW_GET_META` IPC) and `loadGrid` it before rendering. Show "Loading…" while `isLoading`. For archived rows, show the page with an "Archived — Unarchive" banner. Pass `gridId` in the callers listed above too.
- **Effort:** S–M

### R-08 · Profile PDF and handoff packet show wrong deadline status · Severity: High · Type: bug
- **Where:** `src/main/export-pdf.ts:305-321`:
  - Only `date` columns with a rule are included, so `deadline` columns and non-interval rule kinds are skipped.
  - `daysUntil` is computed from the stored date itself, ignoring the rule interval and extensions.
  - It uses `Math.round((localMidnight - Date.now())/day)`, so a date due today reads −1 ("OVERDUE") after noon.
  - The same renderer is used by the handoff packet (`export-handoff.ts:139`).
- **What the user experiences:** "Last home visit: Oct 3 (OVERDUE)" in a PDF handed to a supervisor or the next worker, while the app says "Due in 23 days". Extended deadlines also print as overdue.
- **Why it matters:** These PDFs leave the app and are trusted as the official summary. Wrong overdue flags mislead the next person and make the worker look negligent.
- **Fix:** Build the PDF's Deadlines section from the same engine (`evaluateRuleForRow` or the main-side `DEADLINES_GET` for this row). Print "Next due <date> · <state>", and include extensions with their reason.
- **Effort:** S

### R-09 · What goes into the profile PDF and handoff packet is surprising · Severity: Medium · Type: logic
- **Where:**
  - `export-pdf.ts:456-468`: scrap notes are always printed. `includeSections.scratchPad` is hard-coded `true` in `ProfileView.tsx:292` and `export-handoff.ts:139`.
  - "Add contact info" entries (`rows.manual_contacts`, `ipc-row.ts:540-565`) are never printed. `contactInfo` is accepted but unused in `renderProfileToDoc`.
  - Case log "last 10" (`export-pdf.ts:380-385`) includes system entries, so it can be ten "Stage changed to…" lines and no real notes.
  - The "Export PDF" button gives no choice of sections.
- **What the user experiences:**
  - A social worker's private jottings in Scrap Notes ("check w/ mom re: drinking?") end up in a transfer packet sent to another agency.
  - The second phone number they carefully added is missing from it.
  - The "Recent notes" section is full of system noise.
- **Why it matters:** This is a privacy risk and an incomplete handoff.
- **Fix:**
  - Add checkboxes in the Handoff dialog and a small Export PDF options step: "Include scrap notes" (off by default), "Notes: last 10 / all".
  - Print manual contacts in a Contact info section.
  - Exclude `log_type='system'` from "Recent notes" (they're in the audit trail).
- **Effort:** S–M

### R-10 · The note box is far down the page, and the page hides its scrollbars · Severity: High · Type: usability
- **Where:**
  - `ProfileView.tsx:428-551`, section order: Header → requirement line → Forms → Deadlines → Files → Appointments → Stage history → Linked → Linked contacts → **Activity log** → **Details**.
  - All three columns use `no-scrollbar` (`:432, :449, :546`).
  - The header has no "Add note" action: `ProfileHeader.tsx:79` takes `onAddNote` but ignores it.
  - Screens: `audit-tour/15-profile-customer.png` (above the fold: header, Deadlines; no note box), `16-…-scrolled.png` (after one scroll: Files, Appointments, a 13-row "Linked" list, still no note box), and `website/screenshots/human-services/03-record.png`.
- **What the user experiences:** A new user opens a client to write today's note and doesn't see where. Nothing shows the middle column scrolls, so they may never find the Activity log or the Details. The right column shows existing notes but has no box to add one. A customer with 13 linked jobs pushes notes further away.
- **Why it matters:** Writing a note is the single most frequent action on this page, and it's the hardest thing to find.
- **Fix:**
  - Put the note composer directly under the header (collapsed to a one-line "Add a note…" box that expands on focus).
  - Then Deadlines, then Details.
  - Move Files, Appointments, Stage history, Linked and Linked contacts below, collapsed by default when empty, with counts in their headers ("Files (0)").
  - Show normal scrollbars, or at least on the main column.
  - Add "+ Note" as the primary header button (focuses the composer), next to Task.

  Power users keep the ability to reorder or collapse sections.
- **Effort:** M

### R-11 · Two lists of the same notes, and two different things called "Audit" · Severity: Medium · Type: consistency
- **Where:**
  - The Activity log in the main column (`CaseLog.tsx`, user notes, its own search, pin, sort) and the Activity Timeline on the right (`ActivityTimeline.tsx`, the same notes plus system entries, 11+ filter chips, "Manual/System", an "Audit" toggle that shows voided notes).
  - The header also has an "Audit trail" button that makes a PDF (`ProfileHeader.tsx:677-687`).
  - Edit history ("show earlier versions") appears only in the right-hand timeline (`ActivityTimeline.tsx:189-191`), while the left list only says "edited".
- **What the user experiences:** The same note is on screen twice. Its old versions are only on the right, and you can only pin or edit it on the left. "Audit" and "Audit trail" do different things. "Manual" and "System" are programmer words.
- **Why it matters:** This is confusing and uses a lot of space. A third of the right panel is filter chips (screenshot 15).
- **Fix:**
  - Merge into one timeline in the main column: notes with actions plus a "Show changes" toggle for system entries, with type filtering in a single "Show: All kinds ▾" menu.
  - Rename "Audit" to "Show voided notes" (inside that menu) and put "earlier versions" on the note itself.
  - Use the freed right column for Details or Checklist.

  Power users keep filters and voided notes behind the menu.
- **Effort:** M

### R-12 · Note search and "Oldest first" only cover the newest 50 notes; the timeline stops at 200 · Severity: Medium · Type: bug
- **Where:**
  - `CaseLog.tsx:424-433`: search and sort run on the loaded `entries` (50 at a time). "Load more" is hidden while searching (`:723`). The count shows loaded entries, not the total (`:442-444`).
  - `ActivityTimeline.tsx:37` passes no limit, so main's default 200 applies (`ipc-caselog.ts:35`). Its count and "Load more (N remaining)" never reach older entries.
- **What the user experiences:** The user searches "hospital" for a client with 3 years of notes and gets "No entries match" although a note from 2024 says it. "Oldest first" shows notes from last month. The timeline of a long-term client silently ends.
- **Why it matters:** People rely on search to answer audits and court requests, and false "no match" results are dangerous.
- **Fix:** Do search and sort in SQL (`CASE_LOG_GET` with `query` and `order`), show "Showing 50 of 312", and page the timeline from the server.
- **Effort:** S–M

### R-13 · Editing a note down to nothing saves a blank note · Severity: Medium · Type: bug
- **Where:** `CaseLogEntry.tsx:111` sends `editContent.trim()` whenever it differs, including `''`. `ipc-caselog.ts:71-74` has no empty check.
- **What the user experiences:** The user selects all, deletes and clicks Save, expecting it to delete or do nothing. A blank, undeletable note stays in the record.
- **Fix:** Disable Save when empty and reject empty content in `CASE_LOG_UPDATE`, with "To remove a note, use Void."
- **Effort:** S

### R-14 · A voided note can only come back through Undo · Severity: Medium · Type: usability
- **Where:** `CaseLog.tsx:384-397` (void removes it from the list), and `ActivityTimeline.tsx:80-121` (audit mode shows voided notes with no action). `IPC.CASE_LOG_UNVOID` exists but is only used by undo. The icon silently switches from trash to ⊘ after 15 minutes (`CaseLogEntry.tsx:217-225`).
- **What the user experiences:** The user voids the wrong note, the toast disappears, and the note can't be restored. The user also doesn't know why "Delete" became "Void" for older notes.
- **Fix:** Add "Restore" on voided notes in the "show voided" view (logged in the audit trail). In the void form, add one line: "Notes older than 15 minutes stay in the record and are hidden."
- **Effort:** S

### R-15 · Snippet menu pops up in the middle of words, and Enter inserts a snippet · Severity: Medium · Type: bug
- **Where:** `src/renderer/utils/snippetExpander.ts:53-58`: `/\/(\S*)$/` matches any "/" even inside a word. `CaseLog.tsx:216-221` and `ScratchPad.tsx:203-207`: Enter or Tab picks the first match.
- **What the user experiences:** Case notes are full of "f/u", "w/", "c/o", "10/12". Typing "f/u" opens the menu if any snippet starts with "u", and pressing Enter for a new line replaces "/u" with a whole paragraph. Also:
  - The hint "Type / to insert a snippet" (`CaseLog.tsx:583`) shows even when snippets are switched off.
  - That hint is 13px.
- **Fix:**
  - Trigger only when "/" is at the start of the text or follows whitespace (`/(?:^|\s)\/(\S*)$/`).
  - Don't use Enter to accept unless the user has moved the selection with an arrow key (Tab still accepts).
  - Hide the hints when `snippetsOn` is false, and use 15px.
- **Effort:** S

### R-16 · "Format: DAP / SOAP / BIRP" shows above every note box, in every workspace · Severity: Medium · Type: usability
- **Where:** `CaseLog.tsx:511-518`, with built-ins from `src/shared/noteFormats.ts:14-19`. Shown for tree services, vehicles and households alike.
- **What the user experiences:** There's an always-visible dropdown of clinical acronyms between the note type and the text box. Non-clinical users don't know what it means, and it adds a step to every note.
- **Fix:**
  - Seed the built-in formats only under the human-services words (the same rule as built-in snippets in the Decision Log, 2026-10-01).
  - Hide the Format control unless at least one format exists. Show it as a small "Format ▾" link after the box rather than a labelled select.

  Power users keep "Edit formats…" in Settings → Notes.
- **Effort:** S

### R-17 · Duplicate and people-only note types (Phone vs Call, Visit vs Site visit) · Severity: Medium · Type: consistency
- **Where:** `src/main/activity-types.ts:137-153` adds the example's types on top of the defaults. It skips same labels, not same meanings. `src/shared/starters/tree-service.json` adds "Call", "Text", "Site visit" to the defaults "Phone", "Meeting", "Email", "Visit". Screens: `audit-tour/15-…png` (chips Phone and Call, Visit and Site visit), and `website/screenshots/personal-vehicles/03-record.png` (a car with Phone, Meeting, Visit).
- **What the user experiences:** There are two ways to log the same phone call, so filters and the monthly counts split between them. People-centric kinds appear for cars and properties.
- **Fix:** When an example is applied to a fresh workspace, replace the defaults with the example's set (or archive defaults the example marks `replaces: ['phone']`). Never add a near-duplicate.
- **Effort:** S–M

### R-18 · Three "Task" buttons on the page, none related to the Tasks screen · Severity: Medium · Type: consistency
- **Where:**
  - Header "+ Task" (`ProfileHeader.tsx:644-653`) focuses the inline checklist box.
  - Checklist "+ Add Task" (`ChecklistToolbar.tsx:31-37`) opens a dialog.
  - "+ Add task… (press Enter)" (`Checklist.tsx:594, 688`).
  - The sidebar "Tasks" page holds separate caseload tasks with no link to records (`src/main/ipc/ipc-tasks.ts` has no `row_id`).
- **What the user experiences:** The user adds a "task" for a client and then can't find it on the Tasks page. Two buttons with the same name do different things.
- **Fix:** Call record items "Checklist items" (or the vocab word). Make the header button "+ Note", the primary action (see R-10). Keep one "Add" in the checklist that opens the inline box, with "More options…" for the dialog. Longer term, show a record's checklist items with due dates on the Tasks page.
- **Effort:** S

### R-19 · You can't archive, delete, duplicate or move a record from its own page · Severity: Medium · Type: usability
- **Where:** No calls to `archiveRow`, `ROW_DELETE`, `ROW_DUPLICATE` or `MoveToGridModal` from `ProfileView.tsx` or `ProfileHeader.tsx`. The only route is the handoff "Archive this record after saving" checkbox (`HandoffDialog.tsx:96-111`), which needs the handoff feature.
- **What the user experiences:** A client is discharged. The user is on their page and looks for "Archive" or "Close case". They have to go back to the grid, find the row and right-click.
- **Fix:** Add a "More ▾" menu in the header with Archive… (with reason, as in handoff), Duplicate, Move to another list…, and Move to trash. Each should be confirmed and undoable, reusing the grid store actions. After archive or trash, go to the next record or the list.
- **Effort:** S–M

### R-20 · Following a link to another list wipes Undo and loses the way back · Severity: Medium · Type: logic
- **Where:** `LinkedRecords.tsx:66` navigates with `?gridId=` → `ProfileView.tsx:214-222` → `gridStore.loadGrid`, which clears the undo stack when the list changes (`gridStore.ts:145-148`). "Grid" always goes to `/grid` (`ProfileView.tsx:298-300`), now the other list. While loading, the page briefly shows "not found" (`:350`), because `isLoading` isn't checked.
- **What the user experiences:** On a customer, the user voids a note, clicks a linked job to check something, and finds Undo is empty. "‹ Grid" now goes to Jobs, not Customers. Prev/Next walks through jobs. There's no back to the customer except the browser-less breadcrumb.
- **Fix:**
  - Don't clear undo on list switch (entries already carry row ids). At most, drop entries whose rows no longer exist.
  - Make the back button `navigate(-1)` when there's history, labelled with where it goes ("‹ Robert Dubois", "‹ Customers").
  - Show "Loading…" while `isLoading`.
- **Effort:** S–M

### R-21 · Status badges next to the name are always grey · Severity: Medium · Type: bug
- **Where:** `ProfileHeader.tsx:291-298` reads `config.colors[value]`, but status columns store `options: [{label, color}]` (for example tree-service "Stage"; see `CellDisplay.tsx:164-169`).
- **What the user experiences:** The grid shows a purple "Approved" stage, but the record page shows a grey one, so the color cue is lost.
- **Fix:** Use the same lookup as `CellDisplay` (`options.find(o => o.label === value)?.color`).
- **Effort:** S

### R-22 · "Details" shows blanks or raw values, and hides new columns · Severity: Medium · Type: bug
- **Where:** `GridDataSummary.tsx:107-153` handles only checkbox, date and text. So:
  - `age_from_dob`, `calculated_days`, `deadline` and `link` show "—".
  - `tag` shows raw JSON (`["a","b"]`).
  - `currency` shows "1500" rather than $1,500.00, and status has no color.

  Other problems:
  - The deadline badge (`:40-51`) uses `computeDaysUntil`, ignoring extensions and non-interval kinds, so it can say "Overdue" while the Deadlines card says "Extended".
  - The column picker shows internal type names ("calculated_days", "dropdown") (`:301`).
  - Once someone has customised the picker, columns added later never appear (`:175-181`, the saved set is used as-is).
- **What the user experiences:** Age is blank on the record page although the grid shows 34. Tags look like code. A column added last week never shows on the record page.
- **Fix:** Render values with the grid's `CellDisplay` (read-only) or the editors from R-06. Store "hidden columns" instead of "visible columns", so new ones show by default. Use plain type labels from `GridToolbar.tsx:60-75`. Take badge state from the deadline engine.
- **Effort:** S

### R-23 · Deadline cards repeat themselves for some rule kinds; Extend doesn't show the current due date · Severity: Medium · Type: bug
- **Where:**
  - `DeadlinePanel.tsx:271-276` prints the engine's urgency, then `:348-367` prints the stored date plus `formatUrgency` again. Screen `website/screenshots/personal-vehicles/03-record.png`, "LAST ROTATION": "Due in 21 days / 600 mi left… / Feb 21, 2026 / Due in 21 days".
  - `:400` opens `ExtendDeadlineDialog` with `currentDue={null}`, so "Due now:" never shows.
  - The new date isn't checked against the current due date (`ExtendDeadlineDialog.tsx:16`).
- **What the user experiences:** The card says "Due in 21 days" twice, and "Feb 21, 2026" reads like the due date (it's the last rotation). In the Extend dialog the user has to remember the current due date, and can "extend" to an earlier one.
- **Fix:**
  - When `result` is shown, render the stored date with a label ("Last done Feb 21, 2026") and skip the second urgency line.
  - Pass `nextDue` (or `result.due`) as `currentDue`.
  - Require the new date to be after it, or warn when it isn't.
- **Effort:** S

### R-24 · "Generate Letter" on the record page can only copy, and it isn't recorded · Severity: Medium · Type: consistency
- **Where:** `ProfileView.tsx:43-152` is a second, smaller copy of the letters dialog: read-only monospace text, "Copy to Clipboard" only, and no Escape handling (the profile's Escape skips it at `:325`, and the modal doesn't handle it). The Letters page version has "Save as PDF" (`views/letter-template/GenerateLetterModal.tsx:216-234`). Neither logs to the record. The error message is "Could not generate letter".
- **What the user experiences:** The user makes a letter from the client's page and can't save or print it. They paste it into Word. Later there's no trace on the timeline that a letter was sent. Escape doesn't close the dialog.
- **Fix:**
  - Reuse the Letters page dialog, preselected to this record, with editable text, Copy and Save as PDF.
  - Add a "Log on timeline" checkbox (on by default) that writes a note such as "Letter: <template name>".
  - Use a human error message.
- **Effort:** S–M

### R-25 · A filled-in form is thrown away by a stray click or Escape; "Print filled" ignores what's on screen · Severity: Medium · Type: usability
- **Where:** `FillFormDialog.tsx:196` (the backdrop `onClick={onClose}`), `:105-109` (Escape closes, and also leaves the page per R-01), `:166-170` (`FORM_PRINT` prints the record's saved values, not the unsaved answers).
- **What the user experiences:** After ten minutes on an intake form, a click just outside the dialog loses everything. "Print filled" prints the old values unless they saved first.
- **Fix:** If any field has changed, ask "Discard your answers?" before closing (both Escape and backdrop). Disable backdrop-close for forms. Change "Print filled" to save first ("Save and print") or print the current answers.
- **Effort:** S

### R-26 · Several saves on the page fail silently · Severity: Medium · Type: bug
- **Where:**
  - `ScratchPad.tsx:114-131`: `safeInvoke` never throws, so `saveError` is never set and "Save failed — changes may be lost" can never show (it also fails when the database is read-only).
  - `ProfileHeader.tsx:144-151` (manual contacts, optimistic with no rollback or message) and `:190-231` (tags).
  - `CaseLog.tsx:339-360` (edit failure: no toast), `:321-323` (pin) and `:399-401` (follow-up marked done in the UI even if the save failed).
  - `RecordFiles.tsx:43-47` (renaming to an empty name fails silently).
- **What the user experiences:** The user believes something saved when it didn't, and the change vanishes on reload.
- **Fix:** Check `res.ok` everywhere. Show the existing human-style toasts ("We couldn't save your scrap notes — try again") and roll back optimistic state.
- **Effort:** S

### R-27 · Three different places for a record's phone numbers · Severity: Medium · Type: consistency
- **Where:**
  - Phone, email and address columns (shown in the header, `ProfileHeader.tsx:257-263`).
  - "+ Add contact info" entries stored in `rows.manual_contacts` (`ipc-row.ts:540-565`). These are not in the grid, search, CSV, PDF (R-09) or the audit trail.
  - "Linked contacts" from the directory (`LinkedProviders.tsx`), which shows no phone at all.
  - "Add contact info" is also shown on things, for example a car (`website/screenshots/personal-vehicles/03-record.png`).
- **What the user experiences:** The user adds "Guardian cell" via "Add contact info". Later they can't find it by searching, it's missing from exports, and nobody else sees it in the grid.
- **Fix:** Make "Add contact info" create (or offer to create) a phone or email column, or at least include manual contacts in search, exports and the audit log. Hide it when the list doesn't hold people (`useHoldsPeople`). Show each linked contact's phone and the link note (the `notes` field already exists) inline.
- **Effort:** M

### R-28 · Linked contacts show only a name; you must leave the page to see a phone number · Severity: Low · Type: usability
- **Where:** `LinkedProviders.tsx:300-345`. "View" navigates to `/contacts` (`:188-191`), leaving the record. The unlink "X" is at 40% opacity until hover. Targets are 32px (`:345, :363`).
- **What the user experiences:** To call the client's doctor the user leaves the client page, then has to find their way back.
- **Fix:** Show phone and email with copy buttons inline (as the header does) and the role or note. Open details in a side panel or popover. Use 44px targets.
- **Effort:** S

### R-29 · Tag picker deletes a tag from every record without asking; edit and delete icons are invisible to keyboard users · Severity: Low · Type: usability
- **Where:** `ProfileHeader.tsx:223-231, 453-466`: `deleteTag` runs immediately, with no confirm and no undo. The buttons are `opacity-0 group-hover:opacity-100` with no `focus-visible:opacity-100` and no `hit-44`. Tag text uses the tag color on a 13%-alpha background (`:376-385`), which gives low contrast for light colors.
- **What the user experiences:** A user tidying tags on one record wipes that tag from 200 others.
- **Fix:** Confirm with "Delete tag 'X' from all N records?" and make it undoable. Show the icons on focus. Use dark text with a colored dot.
- **Effort:** S

### R-30 · Much of the page's text is 14px or 13px · Severity: Low · Type: accessibility
- **Where:** `text-sm` is 14px (`styles/globals.css:25`) and `text-xs` is 13px (`:23`). These are used for:
  - contact info and identifier fields (`ProfileHeader.tsx:343, 512, 534`)
  - note headers and times (`CaseLogEntry.tsx:123-143`)
  - all timeline text (`ActivityTimeline.tsx:156-196`)
  - detail labels (`GridDataSummary.tsx:95`)
  - deadline column names (`DeadlinePanel.tsx:267`)
  - the snippet hint (`CaseLog.tsx:583`)
  - Scrap Notes title (`ScratchPad.tsx:235`)
- **Fix:** Raise these to `text-base` (15px). Where space is tight, drop the duplicate absolute timestamp under the relative one, or show it on hover.
- **Effort:** S

### R-31 · Wording: "Grid", "records" for events, internal type names · Severity: Low · Type: wording
- **Where:**
  - "‹ Grid" and "Return to grid" (`ProfileView.tsx:380, 358`).
  - The audit trail toast "Saved the audit trail (42 records)" (`AuditReportDialog.tsx:65`, which counts events, not records).
  - Column type names in the Details picker (`GridDataSummary.tsx:301`).
  - "Scrap Notes", while the Help text and the code say "scratch pad".
  - Clearing a mistaken date logs "Last visit completed (was Oct 3)" (`src/main/ipc/ipc-cell.ts:133`).
- **Fix:**
  - "‹ Customers" (the list name) and "Back to Customers".
  - "Saved the audit trail (42 entries)".
  - Plain type labels.
  - Use one name for the scratch pad.
  - Log "Last visit cleared (was Oct 3)" unless it came from a Done action.
- **Effort:** S

### R-32 · Collapsible sections don't say what's inside; collapse state is shared by every list · Severity: Low · Type: usability
- **Where:** `CollapsibleSection.tsx:12-37`. The key is `pulse-section-<sectionKey>` with no list id, and there are no counts in titles. Files shows a 3-line empty state above the notes (`RecordFiles.tsx:55-61, 92`, screenshot 16).
- **What the user experiences:** Collapsing "Linked" on Customers also collapses it on Jobs. A collapsed "Files" gives no hint whether there are any.
- **Fix:** Include counts in titles ("Files (2)", "Appointments (1 coming up)"). Key the collapse state by list. Collapse empty sections to a single "+ Add files" line.
- **Effort:** S

### R-33 · No way to print a record; the print layout is dead code · Severity: Low · Type: usability
- **Where:** `ProfileView.tsx:184, 458, 572-579` passes `onPrint`, but `ProfileHeader.tsx:85` discards it (`onPrint: _onPrint`), so `ProfilePrintLayout.tsx` is unreachable. "Export PDF" always includes everything (`ProfileView.tsx:292`).
- **What the user experiences:** To print a client summary for a meeting, the user must export a PDF, find it and print it. There's no choice of what to include.
- **Fix:** Put "Print / PDF…" behind the header's More menu (R-19), opening one dialog with section checkboxes (R-09) and both Print and Save PDF. Delete whichever layout isn't used.
- **Effort:** S–M

### R-34 · Whole-panel tooltips pop up over the work area · Severity: Low · Type: usability
- **Where:** `ProfileView.tsx:436, 442, 479, 526` put `title=` on the wrappers of Checklist, Scrap Notes, Deadlines and the Activity log. Any child without its own title (text, inputs) shows "Checklist — track tasks for this customer" etc. on hover.
- **Fix:** Remove the wrapper titles. The section headings already say this.
- **Effort:** S

### R-35 · Phone and email links in the header probably do nothing (suspected) · Severity: Low · Type: bug
- **Where:** `ProfileHeader.tsx:56-72` renders `mailto:` and `tel:` anchors with no handler. `src/main/index.ts:220-227` blocks any navigation outside the app's origin, and `setWindowOpenHandler` (`:207-215`) only opens http(s). Not run, so this is unconfirmed.
- **What the user experiences:** A blue, link-styled phone number or email that doesn't open anything when clicked.
- **Fix:** Route `mailto:` and `tel:` through a whitelisted `shell.openExternal` IPC, or render them as plain text with the copy button (already there).
- **Effort:** S

### R-36 · Number history charts are incomplete by default and crowded with many points · Severity: Low · Type: usability
- **Where:** `NumberHistory.tsx:89-93` admits values are missing unless "Log changes in timeline" is on. Every point gets a label (`:76-81`), which overlaps with 20+ points. The sparkline is amber when the value goes down (`:37`), which suggests "bad" for things like weight loss or a debt paid down. The sparkline appears only inside Details, at the bottom of the page.
- **Fix:** Record cell history for number columns regardless of the log setting (it's cheap). Label only the first, last, min and max. Use one neutral color.
- **Effort:** S

### R-37 · Recent-records and back navigation don't remember where you were · Severity: Low · Type: usability
- **Where:** `profileStore.ts:12-33`: `savedScrollTop` exists but nothing on the profile saves or restores the main column's scroll, and the comment at `ProfileView.tsx:339-340` notes it's unused. Prev/Next keeps the scroll position of the previous record, because it's the same component (see R-02).
- **What the user experiences:** After Prev/Next the new record opens half-way down, at the old record's scroll position, showing its Files or Linked section instead of the header.
- **Fix:** Scroll the main column to the top on `rowId` change (free once R-02 keys the page), and restore the grid scroll on return.
- **Effort:** S

---

## Things that work well (keep these when fixing)

- **Note integrity:**
  - Server-enforced 15-minute delete window, then void-with-reason (`ipc-caselog.ts:97-114`).
  - Every edit keeps the earlier version (`case_log_edits`).
  - Undo covers add, edit, delete, void, pin and follow-up.
- **Deadline cards:**
  - Sorted by urgency.
  - High-contrast urgency text (the accent color stays on the border, not the text).
  - "Extend…" with a required reason that lands on the timeline and the audit trail.
  - Sequence steps with "Mark done".
- **Note composer details:**
  - The last-used note type is remembered.
  - Archived types fall back cleanly.
  - Time, mileage and custom measures are validated with human messages.
  - "This note mentions time — track minutes?" offers.
  - Ctrl+Enter saves.
- **Files:**
  - Encrypted inside Pulse.
  - Duplicate check with a native question.
  - Clear notice that opened or saved copies aren't encrypted.
  - Thumbnails, per-note attachments, undoable delete.
- **Linked records:** both directions, key details, and overdue/coming-up rollups of the linked records' deadlines in plain sentences.
- **Handoff packet and audit trail:** a sensible single-purpose dialog, with an optional archive with reason and date ranges. The vocabulary changes "Handoff" to "<Record> packet" for things.
- **Navigation:** "1 of 8" with Alt+←/→, breadcrumb in the top bar, and Recent records list.
- **Appointments:** inline Done / No-show for ones that have come.
- **Stage history:** a plain-language "now, for 12 days (since…)".
- **Number history dialog:** includes an `sr-only` data table.
- **Vocabulary:** used consistently across the page (record, activity, contact, requirement words).
