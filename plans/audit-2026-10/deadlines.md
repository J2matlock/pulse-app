# Audit: deadlines, deadline rules, dashboard and reminders (prefix D)

Reviewer scope: turning a date into a deadline, the rule editor (all six kinds, "Only when…", working days, colors, extensions), the engine (`src/shared/deadlineEngine.ts`, `src/main/deadlines.ts`), marking done / undo, the dashboard and its cards, the morning briefing and desktop reminders.

Note on evidence: `test-results/ui-tour/current/` doesn't exist on disk, so screenshots come from `test-results/audit-tour/` and `plans/website/screenshots/*/02-dashboard.png`. Everything marked "confirmed" was traced through the code. Nothing was run.

## Top 5

1. **Send every deadline screen through the engine.** Focus Mode, the Monthly summary PDF and the record's data cards still use the old "date + interval" math. They show relative, calendar, sequence, meter and quota deadlines wrongly or not at all, and Focus Mode's "Done ✓" erases repeating dates (D-01, D-02, D-03).
2. **Make "Done" do what people mean.** A calendar deadline done before its due date should count as done (D-04). Marking an "Expires" date done should ask for the new date, not clear it (D-06). Show which step or count a row is about (D-08), and let people pick the date it was done (D-12).
3. **Make rules belong to a list and clean up after them.** The column menu offers every rule from every list. The editor opened from Settings uses whichever list was last open. Deleting a rule leaves broken links that turn every date in the column into an "overdue" deadline (D-05, D-09, D-10, D-11).
4. **Fix two engine bugs.** "Count working days only" drops a sequence's step number, so that step can never be marked done anywhere, and it also wipes out quota warnings (D-07). A used-up quota reads as "Due today" (D-13).
5. **Make setup and the dashboard plainer.** Offer "Does this date come due?" when someone adds a Date or Deadline column (D-15). Rename "Alert rules" to "Deadline rules", pick the kind first and fill in the name automatically (D-16, D-17). Use one meaning for "this week" and "this month" (D-20), and stop burying the priority list under cards (D-21).

## Findings

### D-01 · Focus Mode "Done ✓" erases repeating deadlines instead of starting the next cycle
Severity: High · Type: bug
- **Where:** `src/renderer/views/FocusModeView.tsx:183-218` (`handleDismissClientItem` writes `null` to the cell for every rule). Compare `src/renderer/views/dashboard/completeDeadline.ts:47-50, 87-89`.
- **What the user experiences:** The morning briefing's "Start Focus Mode" takes them to Focus Mode. They click "Done ✓" on "Annual review – Jane". The date is wiped. On the dashboard, the same button sets the date to today and the next review comes due a year later. In Focus Mode the review simply disappears and never comes back. The toast says "Cleared deadline", which is easy to miss.
- **Why it matters:** This is silent loss of tracking on the main thing the app tracks. The same word, "Done", does two different things on two screens.
- **Fix:** Have Focus Mode call `completeDeadlines()` with `ruleKind`, `interval`, `step` and the checklist id, as `DeadlineRow` does. Ask for a reading for meter rules and send quota rules to "Renew…".
- **Effort:** S

### D-02 · Focus Mode does its own deadline math: drops most rule kinds, shows calendar rules as long overdue, ignores extensions
Severity: High · Type: bug / consistency
- **Where:** `src/renderer/views/FocusModeView.tsx:93, 112`. It recomputes `computeDaysUntil(r.date_value, toRuleInterval(r))` and ignores the `due` and `daysUntil` the loader already sent.
- **What the user experiences:**
  - Relative, sequence and quota deadlines on Deadline-type columns have an empty `date_value`, so they vanish from Focus Mode.
  - A calendar rule's column holds the date it was last done. Focus Mode treats that as the due date: "Estimated taxes, 178 days overdue" here, "due Jan 15" on the dashboard.
  - An extended deadline shows on its old date. A business-day roll-back is ignored.
- **Why it matters:** Focus Mode is the "work through what's urgent" screen, and it disagrees with the dashboard, the briefing and the grid.
- **Fix:** Use `r.daysUntil` and `r.due` from `loadDeadlines` (the same `RawDeadlineRow`), as `DashboardView.tsx:228` does.
- **Effort:** S

### D-03 · The Monthly summary PDF treats every rule as "date + interval"
Severity: High · Type: bug
- **Where:** `src/main/compliance.ts:105` (`evaluate({ kind: 'interval', … condition: null, businessDays: false })`). The query at `:76` takes Date columns only.
- **What the user experiences:** A supervisor's monthly PDF lists exceptions that aren't real:
  - Calendar and relative rules whose column holds the date it was done show as overdue from that date.
  - Records where the rule is hidden or paused by "Only when…" (discharged clients, for example) are counted.
  - Deadlines that were extended count as late, even though the same page says "3 extended".
  - Sequence, quota and calendar rules on Deadline-type columns are left out entirely.
- **Why it matters:** This is the report people hand to supervisors and auditors. Wrong exceptions mean lost trust or wasted follow-up.
- **Fix:** Build the "value at cutoff" as now, then run the real rule. Use `engineRuleFrom` and a full `RecordContext` (other columns as of the cutoff, the extension in force, the work calendar) with `today = asOf`. Include Deadline columns.
- **Effort:** M

### D-04 · Calendar rules ignore a deadline done before its due date (when the rule has no lead time), so "Done" seems to do nothing
Severity: High · Type: logic
- **Where:** `src/shared/deadlineEngine.ts:320-331`. `early = min(cfg.lead ?? 0, …)` gives 0 grace when there's no lead, so the next date must be strictly after the done date. A test pins this down: `tests/deadline-calendar.test.ts:15-16` (done Apr 10 → still due Apr 15, overdue May 1). Starters affected: tax-preparer "Estimated taxes" / "Monthly close" / "1099s due", grant-manager "Quarterly report".
- **What the user experiences:** A tax preparer pays a client's April estimate on Apr 10 and clicks Done on the dashboard. The row comes straight back: "Estimated taxes – Apr 15 – 5 days". On Apr 16 it turns red, "1 day overdue", although it was paid.
- **Why it matters:** People usually finish things before the due date. Done looks broken, and paid items show as overdue.
- **Fix:** With no lead set, use a default grace of half the gap between dates (the cap that already exists). Done at any point in the half-gap before a date then counts for that date. Update the test.
- **Effort:** S

### D-05 · Deleting a rule leaves its columns linked to a missing rule, and every date in them becomes an "overdue" deadline
Severity: High · Type: bug
- **Where:**
  - Settings delete has no confirm and no undo, and doesn't touch columns: `src/renderer/components/settings/AlertsSection.tsx:73-81`.
  - The main-process delete only deletes the rule: `src/main/ipc/ipc-alerts.ts:95-103`.
  - The column-menu delete clears only the current column: `src/renderer/components/grid/ColumnHeader.tsx` (delete confirm, "removed from all columns that use it").
  - The loader keeps orphaned links on purpose: `src/main/deadlines.ts:88-90` (`LEFT JOIN … ar.id IS NULL OR …`, tested in `tests/deadlines-parity.test.ts:68`).
- **What the user experiences:** They delete "Every year" from Settings with one click. The grid looks fine: no colors, no bell. But the dashboard Overdue tile, the Overdue tab, This Week/This Month, the briefing, desktop reminders, the calendar file and the weekly planner now treat every past "Consent signed" or "Last review" date as overdue on the date itself. The Priority List "All" tab hides these rows (no rule means no color threshold), so the counts and that list disagree.
- **Why it matters:** One click floods every reminder channel with false overdue items, and nothing on screen explains why.
- **Fix:** Deleting a rule should run in one transaction:
  - remove `alert_rule_id` from every column that uses it;
  - ask first: "Used by 4 columns in 2 lists. They'll stop being deadlines.";
  - add an undo.
  The loader should drop rule ids that don't exist. The legacy "date is the deadline" case can stay for columns with no `alert_rule_id`, if any still exist.
- **Effort:** S–M

### D-06 · "Done" on a plain due date or expiry clears the date, so renewals stop being tracked
Severity: High · Type: usability / logic
- **Where:** `src/renderer/views/dashboard/completeDeadline.ts:39-41, 86-87`. The only explanation is a hover tooltip at `DeadlineRow.tsx:159`. Rules affected: "Expires", "Expires (60 days ahead)", "Scheduled date" (tree-service, staff-credentials and many others).
- **What the user experiences:** "Ana Torres – CPR / first aid expires – Done". The expiry date is erased. Unless they remember to open the grid and type the new expiry, CPR is never tracked again. For a job, "Scheduled for – Done" wipes the date the job happened, so the calendar and reports lose it.
- **Why it matters:** Expiring credentials, licences and permits are a core use. Clearing a date isn't what "done" means for a renewal.
- **Fix:** When the rule has no interval, "Done" opens a small dialog:
  - **Renewed:** "New expiry date [ ]" (the default).
  - **Finished, nothing more due:** keeps the date and marks it complete (store a done flag or a "last done" value) rather than clearing it.
  Power users can still clear the cell in the grid.
- **Effort:** M

### D-07 · "Count working days only" drops a sequence's step number and wipes quota states
Severity: High · Type: bug
- **Where:**
  - `src/shared/deadlineEngine.ts:569-573`: the roll-back result passes only `{ estimated, label }`, so `step` is lost, and `result()` recomputes the state.
  - Dashboard Done skips steps it can't identify: `completeDeadline.ts:71` (`if (item.step === undefined) continue`).
  - The record only shows "Mark done" when `result.step === st.index`: `DeadlinePanel.tsx:292`.
  - The editor offers the checkbox for every kind: `AlertRuleEditor.tsx:430-433`.
- **What the user experiences:**
  - **Sequence:** with the box ticked, any step whose date lands on a weekend or holiday can't be completed. Dashboard "Done" does nothing (no toast). The record shows no "Mark done" button for that step. The sequence is stuck for good. An extension added then is stored with no step and then sticks to whichever later step also lands on a day off.
  - **Quota:** "12 of 12 used" (should be overdue) or "1 left" (should be soon) turns back into a plain "ok/in 40 days" whenever the end date falls on a weekend.
- **Why it matters:** The app quietly gets stuck, and warnings vanish.
- **Fix:** Spread the original result and override only the due date, detail, state and daysUntil: `{ ...res, due: rolled, detail, ...stateFields }`. For quota, keep `res.state` when it's overdue or soon. Hide the checkbox for quota rules. Add a test for a sequence step on a Saturday.
- **Effort:** S

### D-08 · Dashboard rows don't say which step, how many are left, or how much use is left
Severity: Medium · Type: usability
- **Where:** `src/renderer/views/dashboard/DeadlineRow.tsx:107-121`. `deadline.detail` and `label` only appear in the row's `title` tooltip. Screenshot: `plans/website/screenshots/early-intervention/02-dashboard.png` ("Frank Rivera · IFSP timeline · 15 days overdue").
- **What the user experiences:** "IFSP timeline – Done" doesn't say whether this is the IFSP meeting or the 6-month review. A quota row doesn't say "10 of 10 used", and a meter row doesn't say "35 hours left". People click Done without knowing what they're completing.
- **Why it matters:** Sequences and quotas are confusing enough already.
- **Fix:** Render `deadline.label` (or a short `detail`) on the second line for non-interval kinds, for example "IFSP meeting (step 1 of 4)". Change the button to "Mark IFSP meeting done".
- **Effort:** S

### D-09 · Editing a rule from Settings uses whichever list happens to be open
Severity: High · Type: bug / usability
- **Where:** `src/renderer/components/alerts/AlertRuleEditor.tsx:230-233` (`columns` and `rows` come from `useGridStore`, the last-opened list). Rules are global (`alert_rules` has no list). Screenshot: `test-results/audit-tour/38-rule-editor.png`: Jobs' "Estimate follow-up" rule opened while Customers was the open list.
- **What the user experiences:** The "Worked out from" and "Only when…" dropdowns list Customers' columns. The saved anchor ("Estimate sent on", a Jobs column) shows as "Choose the date…". If they "fix" that by picking a Customers column, the rule silently stops working for Jobs. The preview shows customers, and for interval rules it always says "nothing due", because no column is passed (`RuleKindFields.tsx:335`).
- **Why it matters:** The editor shows wrong information and invites a change that breaks the rule.
- **Fix:** Work out the rule's list from the columns that use it (or store `grid_id` on rules that refer to columns) and load that list's columns, hidden ones included. If a rule is used in more than one list, show a list picker. Preview on the first column that uses the rule.
- **Effort:** M

### D-10 · The column-menu rule picker offers every rule from every list
Severity: Medium · Type: usability / logic
- **Where:** `src/renderer/components/grid/ColumnHeader.tsx:430-470` (`alertRules.map` with no filter).
- **What the user experiences:** On Crew's "Hire date" menu they see "Estimate follow-up" (a Jobs relative rule), "Service" (an Equipment meter rule) and "Sessions left". Picking one points at another list's columns, and the result is always "—" or nothing due, with no error.
- **Why it matters:** It's an easy mistake, with no explanation afterwards.
- **Fix:** Show only rules that need no columns (interval or calendar-fixed with no condition) or that refer to this list's columns. Put the others under "Rules from other lists (won't work here)", or leave them out.
- **Effort:** S

### D-11 · Changing a shared rule changes every column that uses it, with no warning
Severity: Medium · Type: usability
- **Where:** `ColumnHeader.tsx:451-456` ("Edit rule" pencil). `AlertsSection.tsx:58-63` shows only "5 thresholds". Starters combine rules by name (`src/main/rule-columns.ts:115-148`), so "Every year" covers Customers, Equipment and Crew in tree-service.
- **What the user experiences:** They change Crew's "Every year" warning to 30 days, and Equipment's inspections change too. Starters that differ slightly produce "Every year 2" and "Expires 2", which look alike in the picker.
- **Why it matters:** Unexpected side effects in other lists.
- **Fix:** Show "Used by: Customers → Last tree check, Equipment → Aerial lift…" in the editor and in the Settings list. When it's used in more than one place, offer "Change for all" or "Make a copy for this column".
- **Effort:** M

### D-12 · "Done" always means today; there's no way to record when it was actually done
Severity: Medium · Type: usability
- **Where:** `completeDeadline.ts:86` (`newValue = repeat ? today : null`), `src/main/deadline-actions.ts:44` (meter), `:97` (steps, `done_at` today).
- **What the user experiences:** A worker writes up Friday's home visit on Monday and clicks Done. The next 30-day cycle starts Monday, three days late. The only workaround is to type into the grid.
- **Why it matters:** Cycles drift, and compliance dates come out wrong.
- **Fix:** Keep the one-click Done (today), and add a small "▾ Done on another day…" with a date picker. Use the same option in the meter dialog.
- **Effort:** S

### D-13 · A used-up authorization reads "Due today" every day until it ends
Severity: Medium · Type: bug / wording
- **Where:** `src/shared/deadlineEngine.ts:446-449` (`daysUntil: Math.min(daysUntil, 0)`, so 0 while the end date is in the future). The display comes from `DeadlineRow.tsx:33-36`, `CellDisplay.tsx:224-226` and `deadlines.ts:172` (briefing "due today").
- **What the user experiences:** "Sessions left – Dec 31, 2026 – Due today" in red, and "1 deadline due today" in the briefing every morning for weeks.
- **Why it matters:** The wording contradicts itself, and the daily summary loses credibility.
- **Fix:** Keep `state: 'overdue'` and treat it as needing action, but show the label ("All 12 used") instead of a day count when the quota is used up. Count it as overdue in `deadlineCounts`, or give it its own "used up" line.
- **Effort:** S

### D-14 · A late calendar completion can hide the next due date (quarterly or monthly with a lead time)
Severity: Medium · Type: logic
- **Where:** `src/shared/deadlineEngine.ts:320-323`. The grace (`early`, up to half the shortest gap) is added to any done date, late ones included.
- **What the user experiences:** Quarterly estimates [Jan, Apr, Jun, Sep 15] with a 60-day lead get 28 days of grace. The April payment is made late on May 20. The engine reads that as an early June payment, skips Jun 15 and shows Sep 15 next. With monthly items and a 14-day lead, finishing March's item on Mar 20 hides Apr 1.
- **Why it matters:** A real obligation silently drops off the list.
- **Fix:** Only apply the grace when no date is still owed. If the most recent date on or before `doneOn` is later than the previous done date (that is, it's unpaid), count `doneOn` for that date rather than the next one. A simpler option: grace applies only when `doneOn` is within `lead` days before a date and after the previous date.
- **Effort:** M

### D-15 · Nothing guides someone from "a date" to "a deadline"
Severity: Medium · Type: usability
- **Where:** `src/renderer/components/grid/GridToolbar.tsx:189-215`. Adding a Date or Deadline column asks nothing about deadlines. A new Deadline column shows "Choose a rule" in every cell (`CellDisplay.tsx:219`), and that text isn't clickable. The only path is right-click on the header → "Alert Rule" (`ColumnHeader.tsx:400-479`), with a 12px bell icon at 70% opacity as the only sign that a column has a rule.
- **What the user experiences:** Someone used to Excel adds "Annual review", types dates, and nothing ever turns red. They don't find the right-click menu.
- **Why it matters:** This is the first thing people need to work, and it's hidden.
- **Fix:** In Add Column, for Date: "Does this date come due again? ( ) No ( ) Every __ months ( ) It's the due date ( ) More options…". "More options" opens the full editor. Make the "Choose a rule" cell text a button that opens the editor. Show a clearer header badge, for example a clock with the rule's summary in the tooltip.
- **Effort:** M

### D-16 · Inconsistent naming: "Alert rule", "Alerts", "thresholds", "Deadline"
Severity: Medium · Type: wording / consistency
- **Where:**
  - `ColumnHeader.tsx:408, 422, 427, 478` ("Alert Rule", "Remove alert", "Create alert rule…").
  - `AlertRuleEditor.tsx:334, 352, 440` ("New Alert Rule", "Rule Name", "Color Thresholds").
  - `AlertsSection.tsx:37-40, 62, 104` ("Alert Rules… color-code date columns", "5 thresholds", "Add Alert Rule").
  - The grid tip, "Right-click column headers for alerts…".
  - CLAUDE.md says "Deadlines", not "alerts".
- **What the user experiences:** The menu says "Alert Rule", the editor asks "How is this deadline worked out?" and the dashboard says "Deadlines". "Thresholds" is jargon. The Settings list shows "5 thresholds" instead of what the rule does.
- **Why it matters:** People can't connect the setting to what they see.
- **Fix:**
  - "Alert Rule" → "Deadline rule" or "When is it due?".
  - "Color Thresholds" → "Colors as it gets close".
  - In each Settings row, show the engine's plain summary (`describeInterval`, or the kind summary, for example "45 days after Referral date, only while Status is Active") and the "Used by" list (D-11).
  - The editor's "e.g. Annual Plan of Care" placeholder is human-services wording, so use the vocab layer.
- **Effort:** S

### D-17 · The editor asks for a name before anything else, and the name describes timing, not the thing
Severity: Low · Type: usability
- **Where:** `AlertRuleEditor.tsx:284-286, 350-364`. Starter names such as "Expires" vs "Expires (60 days ahead)", where the difference is only the colors.
- **What the user experiences:** The first field is a required "Rule Name". A new user doesn't yet know what they're building, and "Rule name is required" blocks saving.
- **Why it matters:** It slows down the most common case.
- **Fix:** Put "How is this deadline worked out?" first. Fill in the name automatically from the summary ("Every 6 months", "45 days after Referral date"), editable under "More". Hide the description field by default.
- **Effort:** S

### D-18 · "Count working days only" is misleading, and the interval kind can't count working days
Severity: Medium · Type: wording / logic
- **Where:** `AlertRuleEditor.tsx:430-433`, `deadlineEngine.ts:568-574`. Working-day counting exists only as a unit in "From another date" and "A series of steps" (`RuleKindFields.tsx:25`). Relative rules can't use "this column" (`RuleKindFields.tsx:100`, no `allowSelf`).
- **What the user experiences:** They tick "Count working days only" on "Every 30 days" and expect 30 working days. They get 30 calendar days, moved back to Friday if that lands on a weekend. There's no way to say "10 working days after the date in this column".
- **Why it matters:** Wrong due dates in exactly the cases (school days, court days) where users are careful.
- **Fix:**
  - Rename the checkbox to "If it lands on a weekend or day off, move it to the working day before".
  - Add a third option, "…to the next working day", which is what most court and agency rules use.
  - Add "working days" as a unit for the interval kind's Custom setting.
- **Effort:** M

### D-19 · Dashboard summary tiles, briefing and reminders count different things under the same words
Severity: Medium · Type: consistency
- **Where:**
  - Tiles `DashboardView.tsx:291-303`: Overdue and Due This Week include tasks, checklist items and follow-ups; "This week" is days 0–7; "This month" is days 0–30.
  - Briefing `deadlines.ts:167-176` and `MorningBriefing.tsx:73-78`: deadlines only, "this week" is days 1–7.
  - Desktop reminder `reminders.ts:107-113`: deadlines only.
  - "Items Due Today" (`DashboardView.tsx:490-497`) counts overdue items as well.
- **What the user experiences:** The briefing says "3 overdue deadlines", and the dashboard tile next to it says "Overdue 7". "Items Due Today 4" includes things due last week.
- **Why it matters:** Numbers that disagree make people distrust all of them.
- **Fix:** Pick one definition. Either show deadlines and other items separately ("7 overdue: 3 deadlines, 4 tasks/follow-ups"), or count everything everywhere. Rename the tile to "Tasks due or late".
- **Effort:** S

### D-20 · Four different meanings of "this week" and two of "this month"
Severity: Medium · Type: consistency
- **Where:**
  - Tile: days 0–7. Briefing: days 1–7.
  - "This Week" tab: days −1 to 7 (`WeekViewTab.tsx:34`), so items two or more days late vanish.
  - "Print this week": the calendar week from the user's chosen start day (`DashboardView.tsx:405-414`).
  - "Due This Month" tile: the next 30 days. "This Month" tab: the calendar month, past days included (`MonthViewTab.tsx:15-19`), deadlines only.
- **What the user experiences:** "Due This Month 16" against a This Month tab listing 11.
- **Fix:** Use the calendar week and month (with the week-start setting) everywhere, or rename the rolling ones "Next 7 days" and "Next 30 days". Show overdue items at the top of the This Week tab.
- **Effort:** S

### D-21 · The priority list is buried under cards, and "Overdue" appears twice
Severity: Medium · Type: usability
- **Where:** `DashboardView.tsx:462-500` (cards render before the tabs), `:357-368` (a top-level "Overdue" tab and an "All | Overdue" sub-filter). `DashboardCards.tsx:96-99`: pinned reports always come after the other cards and can't be reordered in Customize. Screenshots: `test-results/audit-tour/05-dashboard-top.png` (no list above the fold: tiles, Today, Stages, Due for service), `06-dashboard-scrolled.png` (both Overdue controls).
- **What the user experiences:** They open the dashboard to see what's due and have to scroll past three or four cards. Then they find two "Overdue" controls that do the same thing. "Recently Archived" sits among the deadline tabs.
- **Fix:** Make "What's due" (the tabs) a card in the Customize order, second by default. Drop the "All | Overdue" sub-filter, which the top-level Overdue tab already covers. Move "Recently Archived" behind a link. Put pinned reports in Customize too.
- **Effort:** M

### D-22 · The record page and Week/Month tabs have no "Done" for most kinds
Severity: Medium · Type: consistency
- **Where:** `src/renderer/components/profile/DeadlinePanel.tsx:292-297` (only sequence steps get "Mark done"). Interval, relative, calendar and meter rules only get click-to-edit-date. `WeekViewTab.tsx` and `MonthViewTab.tsx` rows only navigate to the record.
- **What the user experiences:** From This Week they click a client, land on the record and look for Done. It isn't there. They have to know to retype the date (and, for a meter rule, two readings by hand).
- **Fix:** Reuse `DeadlineRow`'s Done, Extend and Renew actions in `DeadlinePanel` cards and in the Week/Month rows.
- **Effort:** M

### D-23 · Relative rules on Date columns: typing a planned date counts as "done"
Severity: Medium · Type: usability / logic
- **Where:** `deadlineEngine.ts:270-276`. The only explanation is the editor hint `RuleKindFields.tsx:102`. Tree-service "Estimate follow-up" and "Follow-up call" are Date columns with relative rules.
- **What the user experiences:** In the "Follow-up call" column someone types the day they *plan* to call (Excel habit). Since that's on or after "Completed on", the engine treats the call as done. The reminder and color disappear, and the cell just shows the date.
- **Why it matters:** One natural action silently switches the reminder off.
- **Fix:** For relative, calendar and sequence rules, make the column a Deadline column (shows "Due Oct 17" / "Done Oct 12") or show "Done ✓" next to the date in Date cells. When converting, label the column "…done on". A cheaper version: show a small "✓ done" badge in `SortableRow` when `state === 'done'`.
- **Effort:** M

### D-24 · Relative "before" rules: the window for counting as done reaches back too far (and the comment says otherwise)
Severity: Low · Type: logic
- **Where:** `deadlineEngine.ts:257-262` (comment: "the due date for 'before' rules") vs `:272` (`applyOffset(due, offset)`, which is anchor − 2×offset).
- **What the user experiences:** CASA "Court report due, 10 working days before Next hearing". A report filed late for the previous hearing (within 20 working days of the new one) counts as done for the new hearing, so the new report never comes due.
- **Fix:** Pick one rule and make the comment match. Safest is "done on or after (due − offset) and after the anchor changed". Store the anchor value alongside the done date, as sequences do, if needed.
- **Effort:** S

### D-25 · Deleting or renaming a column a rule depends on silently breaks the rule
Severity: Medium · Type: logic
- **Where:** No reference check on column delete (no use of `rule_config` or `rule_condition` outside the loader, the starters and the rule editor). `conditionHolds` treats a missing column as empty: `deadlineEngine.ts:537-546`.
- **What the user experiences:** They delete the "Stage" column. Every "Scheduled date" deadline with "Only while Stage is not Done" disappears, because an empty Stage doesn't match "is not Done", so the deadline is hidden. Deleting "Referral date" makes the IFSP timeline show "—" everywhere. Renaming a dropdown option ("Done" → "Completed") makes the condition stop matching.
- **Fix:** Before deleting a column, list the rules that use it ("Used by: Scheduled date (only when…)") and ask. In the editor, flag references to missing columns in red.
- **Effort:** S–M

### D-26 · The rule editor hides hidden columns, and conditions on checkboxes need the hidden word "true"
Severity: Low · Type: usability
- **Where:** `AlertRuleEditor.tsx:230-233` (`columns` excludes `hiddenColumns`). `RuleKindFields.tsx:268-274, 296-301` (suggestions only for dropdowns).
- **What the user experiences:** If "Status" is hidden it can't be chosen for "Only when…", and a saved reference to it shows as unset. For a checkbox column, typing "Yes" never matches (stored as `true`/`1`), so the deadline is hidden for everyone.
- **Fix:** Include hidden columns, marked "(hidden)". For checkbox columns, replace the text box with "is checked / is not checked".
- **Effort:** S

### D-27 · Thresholds editor isn't usable by keyboard and is below the size rules
Severity: Medium · Type: accessibility
- **Where:** `AlertRuleEditor.tsx:464-469`: the row that opens the color picker is a `div` with `onClick`, no role and no tabIndex. `:480-515`: inputs with `minHeight: 30`. `:519-524`: the delete button has no aria-label. `:170-180`: the 32px color input.
- **What the user experiences:** Keyboard and screen-reader users can't change a threshold's color. Small targets.
- **Fix:** Make the swatch a `<button aria-expanded>` labelled "Change color for Due soon". Make inputs 44px tall. Add `aria-label="Remove this color step"`.
- **Effort:** S

### D-28 · Dashboard rows break the 15px / 44px rules
Severity: Low · Type: accessibility
- **Where:**
  - `DeadlineRow.tsx`: the Done, Extend…, Renew… and Remove extension buttons are `minHeight: 36` (`:132, 141, 150, 169`). Secondary text is `text-sm`, which is 14px (`globals.css:25`).
  - The search box (`DashboardView.tsx:598-599`) and the Deadline Colors toggle (`:510`) are `minHeight: 36`.
  - `aria-label="Mark done"` doesn't say which record.
- **Fix:** Make them 44px and `text-base`. Use `aria-label={\`Mark ${columnName} done for ${clientName}\`}`.
- **Effort:** S

### D-29 · The "Deadline Colors" legend doesn't match the rules' actual colors
Severity: Low · Type: consistency
- **Where:** `DashboardView.tsx:518-544`: a fixed green→pulse legend ("Critical: significantly overdue"). Rules set their own colors, and the defaults make 1 day late pulse (`AlertRuleEditor.tsx:236-242`). Suspected, not confirmed: `06-dashboard-scrolled.png` shows "Ana Torres · CPR / first aid expires · 5 days overdue" tinted yellow, unlike the other overdue rows. The cause wasn't found in code; it may come from that DB's rule.
- **Fix:** Build the legend from the rules actually in use, or describe only the left stripe (bucket color), which is fixed.
- **Effort:** S

### D-30 · The morning briefing's plurals are broken
Severity: Low · Type: wording (bug)
- **Where:** `src/renderer/components/shared/MorningBriefing.tsx:74-78, 109`: `{label}{n === 1 ? '' : 's'}`, applied to labels whose last word isn't the noun.
- **What the user experiences:** "3 deadline due todays", "4 more due this weeks", "2 follow-up dues", "5 task dues".
- **Fix:** Store `[one, many]` per line, for example `['deadline due today', 'deadlines due today']`.
- **Effort:** S

### D-31 · The meter "Done" dialog has no unit, no current value and no sanity check
Severity: Low · Type: usability
- **Where:** `src/renderer/views/dashboard/MeterReadingDialog.tsx:26-30`, `src/main/deadline-actions.ts:42`.
- **What the user experiences:** "Current reading [ ]" with no unit and no hint of the last reading. A typo of 4521 for 45210 is saved as the last-service reading, and the item becomes "40,689 mi over" straight away. Undo exists, but the result looks bizarre.
- **Fix:** Pre-fill the current reading and show the unit ("45,180 mi now"). Warn when the value is below the last-service reading or more than 10× the interval away.
- **Effort:** S

### D-32 · Meter forecasts need three readings; the first one is never used
Severity: Low · Type: logic
- **Where:** `src/main/deadlines.ts:219-231` (uses only `new_value` at `changed_at`, never `old_value`). `deadlineEngine.ts:367-386` needs two points at least 7 days apart.
- **What the user experiences:** The odometer was entered in July and updated today. That's one history point plus today's, both on today's date, so there's no rate. With no "typical use" set, nothing shows until a third reading.
- **Fix:** Add the `old_value` of the first history row as a point at the cell's previous `updated_at` (or the row's `created_at`) when it's earlier.
- **Effort:** S

### D-33 · Calendar rules with a lead time are missing from "Add to calendar" and the month views
Severity: Low · Type: logic
- **Where:** `deadlineEngine.ts:340` returns `due: null` beyond the lead. `export-ics.ts:81`, `MonthViewTab`, the planner and reminder letters all filter on `due`.
- **What the user experiences:** The six-month calendar file leaves out "Annual report to the court" (lead 60) until 60 days before it's due. People who rely on Outlook won't see it coming.
- **Fix:** Add a `includeUpcoming` option to `loadDeadlines` that keeps the computed next date for exports (the lead is about nagging, not about existing).
- **Effort:** S

### D-34 · Bulk "Mark done" silently skips some selected items
Severity: Low · Type: usability
- **Where:** `DashboardView.tsx:388-391`. Quota rows are dropped with no message, and sequence rows with an undefined step are skipped by `completeDeadlines` (D-07).
- **What the user experiences:** "5 selected → Mark done". Three disappear, two stay ticked, and nothing says why.
- **Fix:** Toast "2 couldn't be marked done here: Sessions left (renew on the record)…".
- **Effort:** S

### D-35 · "Print reminder letters" uses whichever list was last open
Severity: Low · Type: usability
- **Where:** `DashboardView.tsx:446-452` (`openGridId` from the grid store).
- **What the user experiences:** The dashboard covers every list, but the letters dialog quietly works on the last list opened. It doesn't say which one, and the button disappears if no list has been opened since launch.
- **Fix:** Add a list picker at the top of `BatchDocumentsDialog` when it's opened from the dashboard.
- **Effort:** S

### D-36 · The extension dialog accepts an earlier date and the record doesn't show the current due date
Severity: Low · Type: usability
- **Where:** `ExtendDeadlineDialog.tsx:31-33` (no `min`). `DeadlinePanel.tsx:399` passes `currentDue={null}`.
- **Fix:** Set `min` to the day after the current due date (or relabel the dialog "Change due date"), and pass the engine's due date from the record.
- **Effort:** S

### D-37 · Changing a sequence's start date silently resets every step that's been done
Severity: Low · Type: usability
- **Where:** `deadlines.ts:154-156`, `deadlineCalc.ts:77-80` (progress is filtered by the anchor value).
- **What the user experiences:** Correcting a typo in "Referral date" makes every IFSP step show as not done again (undoing the edit brings them back).
- **Fix:** When the anchor changes and the steps done so far are within the first cycle, ask "Is this a correction or a new referral?" and move the progress over if it's a correction.
- **Effort:** M

### D-38 · "Daily summary" and "Desktop reminder each morning" are easy to confuse
Severity: Low · Type: wording
- **Where:** `AlertsSection.tsx:116-134` (in-app pop-up), `RemindersSection.tsx:45, 57` (system notification), `reminders.ts:300` (test text: "what the daily summary looks like").
- **Fix:** Call them "Summary when I first unlock Pulse" and "Desktop notification at a set time". Put them together under one "Reminders" heading, above the rules.
- **Effort:** S

## Things that work well (keep them)

- **One engine, mostly shared.** `deadlineEngine.ts` is pure, has a zod schema per kind, and `engineRuleFrom` falls back safely. The dashboard, briefing, reminders, grid, record panel, calendar file, planner, supervisor report and letters all go through `loadDeadlines` or `evaluateRuleForRow`. The fixes above mostly bring the stragglers into line.
- **Dates done right:** `ymd.ts` uses DST-safe `daysBetween` and rejects impossible dates. Month maths stays within the month (Jan 31 + 1 month = Feb 28/29), and leap-day anniversaries clamp correctly, including sequence repeats, which are computed from the base each time. The business-day helpers guard against a misconfigured calendar where every day is off.
- **"Done" is one undo step**, voids its timeline entry and removes any checklist it added. The meter "Done" restores both readings. Extensions are tied to their date and step, so a new cycle never inherits one. Both extending and removing an extension can be undone.
- **Rule editor:** the plain-language kind cards, the live preview on a real record, and `draftToConfig` validating with the engine's own schema (the editor can't save settings the engine would ignore). Clear errors such as "Choose the date this deadline is worked out from."
- **Privacy:** reminders while locked work from counts only. The calendar file uses initials for people by default. Desktop notifications never include names unless the user opts in.
- **Starter rules refer to columns by name** (`rule-columns.ts`) and fall back to a plain rule, with a warning, rather than failing.
- **Dashboard Customize** keeps the place and setting of cards whose feature is switched off.
