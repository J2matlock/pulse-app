# B — The list (grid)

Reviewed 2026-10-14 on the seeded Human-services example (48 clients, 16 columns) at 1366×768, light theme, plus 1280×720 and 1100×700. Specs: `e2e/ux-review/B.spec.ts`, `e2e/ux-review/B2.spec.ts`; shots in `ux-review-shots/B/` (text of each screen in the matching `.txt`).

## Summary

**Three worst problems**
1. **Half of what a row can do is right-click-only** (Duplicate, View history, Clear cell, Copy/Paste cell, Move to Trash for one client), and the blue tip banner *tells* Linda to right-click and press Shift+?. She never will, so those actions don't exist for her (UX-B-01, UX-B-02).
2. **Deadline colours and shapes are never explained on the list.** "Show only the date" is on by default, so a cell is just "☐ 09/25/2026" on yellow; the only words are a hover tooltip, and when words are switched on they're cut to "09/25/2026 d…" because the column is too narrow (UX-B-04, UX-B-05). After an import no date column gets a rule, so the colours never appear at all (UX-B-06).
3. **The toolbar doesn't fit her screen.** At 1366 it wraps to a second row the moment grouping, a hidden column or a saved filter adds a badge; under ~1150 px (a 1366 laptop at 125 % scaling) every label disappears and she is left with seven icons (UX-B-08, UX-B-09). Add a column is hidden under "More" (UX-B-03).

**What works well:** the "Does this date come due again?" question when adding a date column; the Change type and Edit options dialogs; the Delete column / Delete rule / Move to Trash / Remove sample data confirmations (plain words, 30-day safety net, Undo); the Archive dialog with a reason; the empty list state with three clear next steps; the import wizard's preview with header-row detection, "Undo this import", and its date-format warnings; the examples browser; the search highlight; "Saved" in the footer after an edit.

Counts: Major 16 · Minor 24 · Polish 7 (47 findings).

---

### UX-B-01 · Major · M
**Where:** Any row, right-click (shot: ux-review-shots/B/201-context-menu-text.png, 202-context-menu-date.png)
**What Linda sees / thinks:** Nothing. She never right-clicks, so she never sees Open client · Copy cell · Paste · Clear cell · View history · Star · Duplicate client · Move / Copy to another caseload… · Color rules… · Archive client… · Move to the Trash. With the mouse alone, the only row actions she can reach are the checkbox → bulk bar (Archive, Bulk Edit, Move, Print, Delete) and the profile button.
**Why it's a problem:** Duplicate, View history and "clear this cell" exist only here. Deleting *one* client without the bulk bar is impossible. The menu is also taller than the screen and scrolls (201).
**Fix:** Add a visible per-row "⋯" button in the lead cells (next to the star) that opens the same `GridContextMenu`; keep right-click as a shortcut. Trim the menu: group Copy/Paste/Clear under the cell, put View history and Color rules under "More…".
**Constraint check:** no schema change · `src/renderer/components/grid/GridContextMenu.tsx`, `SortableRow.tsx:188-232`

### UX-B-02 · Major · S
**Where:** Blue tip banner above the grid (shot: 01-grid-default.png)
**What Linda sees / thinks:** "Tip: Click column headers to sort · Right-click column headers for deadline rules, tracking & more · Right-click a client for options · Press Shift+? for all shortcuts". Two of the four tips are things she won't do; "tracking" means nothing to her.
**Why it's a problem:** The one piece of on-screen help steers her to right-click and keyboard shortcuts. The dismissal is `localStorage`, so it comes back on a new computer or after clearing data.
**Fix:** "Tip: Click a column name to sort. The ⋯ next to it has deadline rules, hiding and more. Click the person icon to open a client." Keep the shortcut hint out (Help has it).
**Constraint check:** no schema change · `src/renderer/components/grid/GridNotices.tsx:14`, `DataGrid.tsx:186-194`

### UX-B-03 · Major · M
**Where:** Toolbar → More → "Add a column…" (shots: 24-more-menu.png, 56-addcol-text.png)
**What Linda sees / thinks:** In Excel she'd click the next empty column header. Here the header row ends with no "+" and the toolbar has no "Add column"; it is the first item under "More".
**Why it's a problem:** Adding a column is the second thing a new user does. Hidden under a word that promises nothing, and when found, the form opens hanging off the right edge and shifts the whole toolbar left so "Add Client" is cut off (56–63, 68).
**Fix:** A "+" header cell after the last column (opens the same `AddColumnForm` as a centred dialog) and an "Add column" toolbar button before "More". Stop the toolbar shifting: open the form as a dialog instead of an edge-aware popover.
**Constraint check:** no schema change · `src/renderer/components/grid/GridToolbar.tsx:373-384, 419-445`, `GridHeaderRow.tsx`, `src/renderer/utils/domHelpers.ts:54-70`

### UX-B-04 · Major · M
**Where:** Deadline cells (shot: 73-deadline-hover.png, 55-after-hide.png)
**What Linda sees / thinks:** "☐ 09/25/2026" on yellow, "◇ 11/05/2025" on yellow, "⚠ 09/11/2026" on pink. Nothing on the screen says what yellow, pink, ☐, ◇ or ⚠ mean; the only words are a title tooltip ("Deadline: Nov 6, 2026 · in 23 days") after hovering for a second.
**Why it's a problem:** The colours are Pulse's whole point and they are unexplained. The colour key (`RuleColorKey`) exists but only inside the ⋯ menu → Deadline rule (46-rule-picker.png), three clicks away and only for one column.
**Fix:** Make the clock icon in a date column's header clickable → popover with that rule's colour key and the shapes ("☐ due soon · ◇ coming up · ⚠ overdue"); add "What do the colours mean?" to the status footer when any deadline column is shown.
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnHeader.tsx:283-285`, `components/alerts/RuleColorKey.tsx`, `GridStatusFooter.tsx`

### UX-B-05 · Major · S
**Where:** Deadline column with "Show only the date" off (shot: 221-deadline-words-on.png)
**What Linda sees / thinks:** "09/25/2026 d…", "10/09/2026 due…" — the words she just switched on are cut off at the default column width.
**Why it's a problem:** The switch is the fix for UX-B-04 and it doesn't work without also widening the column by hand (Width + in the menu, which she won't find). The default being "only the date" (per commit af241ab3) hides the problem rather than solving it.
**Fix:** When words are on, auto-fit the column (`column:resize` fit) or render the words on a second line in a taller row; or show "in 23 days" *instead* of the date with the date in the tooltip.
**Constraint check:** no schema change · `src/renderer/components/grid/gridCellStyle.ts:62-82`, `SortableRow.tsx:282-284`, `ColumnSettingsDialog.tsx:76-92`

### UX-B-06 · Major · M
**Where:** Import wizard → Results, then the grid (shots: 247-xlsx-match.png, 249-xlsx-results.png, 244-after-import-bottom.png)
**What Linda sees / thinks:** Her spreadsheet's "Review Due" column comes in as a Date. Done. The grid shows plain dates with no colour. She thinks Pulse doesn't do deadlines, or that she has to find it herself.
**Why it's a problem:** Import is the main way a real caseload arrives, and nothing in the wizard asks "does this date come due again?" the way Add column does. The deadline feature is skipped for exactly the users with the most data.
**Fix:** After a successful import, if any new Date column was created, add a Results-step section "Set up deadlines": one `DeadlineQuestion` per date column ("Review Due — No, it's just a date / Yes, every 12 months / It's the due date"). Same for the setup wizard's spreadsheet path (slice A).
**Constraint check:** no schema change · `src/renderer/components/grid/ImportResultsStep.tsx`, `ImportWizard.tsx:274-313`, reuse `DeadlineQuestion.tsx` and `ensurePlainRule`

### UX-B-07 · Major · S
**Where:** Import wizard → step 4 "Match columns" (shot: 240-import-match-columns.png)
**What Linda sees / thinks:** Table headed "Import Column" / "Map To"; "First Name → Name", "Last Name → Create new column"; options "Skip (do not import)". She doesn't know "map". She sees the first name will become the Name and the last name a separate column.
**Why it's a problem:** Jargon on the one step that needs a decision. In the grid the Name column then shows "Alice" only (the combined display name is used elsewhere, `src/main/import.ts:1336`), which looks wrong in the list.
**Fix:** Headings "Column in your file" / "Goes into"; options "A new column", "Leave it out"; when a first-name and a last-name column are detected, offer "Combine into Name as First Last" (default on) and show "e.g. Alice Johnson".
**Constraint check:** no schema change (combination can be done in the import, not the schema) · `src/renderer/components/grid/ImportMappingStep.tsx:22-34, 86-87`, `src/main/import.ts`

### UX-B-08 · Major · S
**Where:** Toolbar at 1366 with any badge (shots: 12-saved-filters-panel.png, 16-grouped-by-program.png, 55-after-hide.png)
**What Linda sees / thinks:** As soon as she groups by Program ("Program × Grouped by: Program"), hides a column ("More 1 hidden") or saves a filter ("Saved 1"), the toolbar breaks onto two rows and the list-settings icon sits alone on the second row. The grid loses 44 px.
**Why it's a problem:** Normal use makes the main screen look broken on the most common laptop size.
**Fix:** Drop the redundant "Grouped by: Program" text (the chip already says it); move the "n hidden" badge into the More menu only; put the list-settings button into More ("Caseload settings…") or give the toolbar `flex-nowrap` with an overflow "More" that absorbs Reports/View when space runs out.
**Constraint check:** no schema change · `src/renderer/components/grid/GridToolbar.tsx:143, 353-357, 506-516`, `GroupingBar.tsx:118-165`

### UX-B-09 · Major · S
**Where:** Toolbar under ~1150 px (shot: 39-1100-grid.png)
**What Linda sees / thinks:** "Add Client" then ☆, Overdue, Filter, 🔖1, ⧉, 👁▾, 📄▾, More. Which one is Views? Which is Reports?
**Why it's a problem:** `TOOLBAR_LABEL = '@max-5xl:hidden'` removes labels at the width a 1366 laptop has at 125 % Windows scaling (1093 px). Linda reads every word; icon-only is the one thing she can't use.
**Fix:** Keep labels at every width; let the toolbar wrap or push the right-hand group (View, Reports, More) into a single "More" menu instead.
**Constraint check:** no schema change · `src/renderer/components/grid/gridConstants.tsx:101-102`, `GridToolbar.tsx:144-145`

### UX-B-10 · Major · S
**Where:** Column ⋯ → Column settings… (shots: 49-colsettings-date.png, 50-colsettings-text.png, 66-colsettings-dropdown.png)
**What Linda sees / thinks:** A list: "Log changes in timeline  Off", "Required column  Off", "Show only the date  On", "Show on the Calendar  On", "Update from case notes  Off", "When marked done, add checklist  Off". They look like menu items with a status, not switches. "Log changes in timeline" — what timeline?
**Why it's a problem:** She won't know clicking the row flips it, and after clicking she gets no explanation of what changed. The important one for her, "Show only the date", is here and nowhere else.
**Fix:** Real toggle switches (track + knob) with a one-line description under each ("Show only the date — hide words like 'in 5 days'; the colour stays"; "Log changes in timeline — write every change to this column into the client's notes"). Rename "Log changes in timeline" → "Keep a history of changes".
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnSettingsDialog.tsx:51-92, 143-153`

### UX-B-11 · Major · S
**Where:** Bulk bar → Bulk Edit (shot: 83-bulk-edit.png)
**What Linda sees / thinks:** "Edit 3 selected clients · Column to update: Name · New value: ___ · Apply to all".
**Why it's a problem:** The default column is Name. One typed value plus "Apply to all" renames three people to the same thing. Undo exists, but the default invites the mistake.
**Fix:** Default to a "Choose a column…" placeholder (button disabled until chosen); leave the name column out of the list or put it last with "(this will rename them all)".
**Constraint check:** no schema change · `src/renderer/components/grid/BulkEditDialog.tsx:37-38`

### UX-B-12 · Major · M
**Where:** Column ⋯ → Deadline rule (shots: 46-rule-picker.png, 47-rule-picker-no-rule.png)
**What Linda sees / thinks:** The menu grows downward past the screen; the rules list, "Remove deadline rule" and "New deadline rule…" are below the fold and she must scroll inside a menu. Each rule has two 12 px icons (pencil, trash).
**Why it's a problem:** Picking or making a rule is the key setup task and it happens in the most cramped place in the app. The trash icon deletes the rule for *every* column that uses it (the confirm, 223-rule-delete-confirm.png, is good, but the icon shouldn't be here).
**Fix:** "Deadline rule…" opens a dialog: current rule with its colour key, "Use a different rule" list with radio buttons, "New rule…" and "Remove from this column". Editing/deleting rules lives in Settings.
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnHeader.tsx:449-478`, `ColumnRulePicker.tsx`

### UX-B-13 · Major · S
**Where:** Column ⋯ → "Keep columns up to here in view" on a column near the right edge (shot: 71-frozen.png)
**What Linda sees / thinks:** The header row becomes "Name | Date of Birth | Email | Address | C Annua Referr Program" — overlapping, unreadable headers, and the grid can no longer scroll sideways.
**Why it's a problem:** Visibly broken, no way to understand what happened; the way back ("Stop keeping these columns in view") is in the same hidden menu.
**Fix:** Cap the frozen width at ~60 % of the grid width and refuse (with a toast "Too many columns to keep in view at this size") beyond it; call the item "Freeze columns up to here" (Excel's word, which Linda knows).
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnHeader.tsx:414-429`, `DataGrid.tsx` frozen offsets

### UX-B-14 · Major · S
**Where:** Add a column with an existing name (shot: 224-duplicate-column-name.png)
**What Linda sees / thinks:** She adds "Phone" and now has two Phone columns, no warning. (The seed also produced two "Date of Birth" columns the same way.)
**Why it's a problem:** Two identical headers make filters, grouping, reports and the import mapping ambiguous ("Phone" appears twice in every column list — see 240/_log2 mapping options).
**Fix:** In `AddColumnForm` and Rename, if the name matches an existing column (case-insensitive), show "There's already a column called Phone" with "Add as 'Phone 2'" / "Cancel". Optionally refuse in `COLUMN_CREATE`.
**Constraint check:** no schema change · `src/renderer/components/grid/AddColumnPanel.tsx:53-57`, `ColumnHeader.tsx` rename, `src/main/ipc/ipc-grid.ts:203`

### UX-B-15 · Major · S
**Where:** Find & Replace (shots: 32-find-replace-bar.png, 33-find-replace-match.png)
**What Linda sees / thinks:** Nothing — the panel only opens with Ctrl+H. The panel itself is good ("Find in this caseload…", 1 / 12, Replace, Replace All).
**Why it's a problem:** A feature she'd use (fix a misspelt program name across 20 clients) is unreachable by mouse.
**Fix:** Add "Find and replace…" to the More menu (and to the search box as a small link).
**Constraint check:** no schema change · `src/renderer/components/grid/GridToolbar.tsx` More menu, `src/renderer/hooks/useGlobalKeyboard.ts:84`

### UX-B-16 · Major · S
**Where:** Caseload settings and New caseload dialogs at 1366×768 (shots: 34-list-settings-top.png, 108-new-list-dialog.png, 259-new-list-bottom.png)
**What Linda sees / thinks:** The dialog runs off the bottom of the screen; "Use acuity levels…" is half visible and there is no Save / Create button in sight. The page behind scrolls, but nothing says so.
**Why it's a problem:** She may think the dialog is broken or close it with ×, losing what she typed.
**Fix:** Same pattern as the Import wizard: `max-h-[90vh]`, body scrolls, header and footer (Cancel/Save) stay pinned.
**Constraint check:** no schema change · `src/renderer/components/grid/ListSettingsDialog.tsx:189-191, 290-293`, `NewListDialog.tsx:100-102, 186-193`

### UX-B-17 · Minor · S
**Where:** Filter chip bar with two filters (shot: 10-two-filters.png)
**What Linda sees / thinks:** A bold blue pill "Match all" in front of the chips. It reads as a label; she doesn't know it's a button that switches to "Match any", and the explanation is a hover tooltip.
**Fix:** A small labelled select: "Show clients that match: [all of these ▾ / any of these]".
**Constraint check:** no schema change · `src/renderer/components/grid/FilterBar.tsx:87-96`

### UX-B-18 · Minor · S
**Where:** Toolbar + chip bar with a filter on (shots: 11-filter-save-name.png, 12-saved-filters-panel.png)
**What Linda sees / thinks:** Toolbar "Saved", chip bar "Save" and "Saved (1)" all at once; the Views button also offers "Save current view…". Four save-ish things with no sentence about what each keeps.
**Fix:** One place: keep "Save this filter" in the chip bar, drop the toolbar "Saved" button (saved filters list under Filter ▾), and make Views say what it saves.
**Constraint check:** no schema change · `FilterControls.tsx:91-106`, `FilterBar.tsx:133-153`

### UX-B-19 · Minor · S
**Where:** Views dropdown (shots: 13-views-empty.png, 14-views-save.png)
**What Linda sees / thinks:** "SAVED VIEWS — No saved views yet — + Save current view…". She doesn't know what a "view" holds (filters? sort? hidden columns? grouping?) or how it differs from a saved filter.
**Fix:** Rename "Views" → "Layouts" or "My setups"; empty text: "Save the way the list looks right now — filters, sort, grouping and hidden columns — and come back to it with one click."
**Constraint check:** no schema change · `src/renderer/components/grid/SavedViewsDropdown.tsx:130-140, 213`

### UX-B-20 · Minor · S
**Where:** View ▾ → "Turn on acuity levels…" (shot: 19-priority-panel.png, 209-priority-switched-on.png)
**What Linda sees / thinks:** A tiny popover with "Acuity levels [switch]" and nothing else until it's on; then "Give each client an acuity level. Points are totaled in the status bar." with a cut-off "Mediur" row.
**Fix:** Put the explanation above the switch ("Rate each client Low / Medium / High so the most complex ones stand out and the caseload's total points show in the footer"), widen the level rows so "Medium" fits.
**Constraint check:** no schema change · `src/renderer/components/grid/AcuityConfigPanel.tsx`, `GridToolbar.tsx:240-248`

### UX-B-21 · Minor · S
**Where:** Acuity column once on (shot: 210-grid-with-priority.png)
**What Linda sees / thinks:** A header reading "Ac" and a dashed ⊕ in every row.
**Fix:** Header "Level" (or the full word with a tooltip), empty cell text "Set…" instead of the dashed circle.
**Constraint check:** no schema change · `src/renderer/components/grid/AcuityBadge.tsx`, `GridHeaderRow.tsx`

### UX-B-22 · Minor · S
**Where:** Grouped list (shots: 16-grouped-by-program.png, 17-group-picker-active.png)
**What Linda sees / thinks:** Button "Program ×" plus grey text "Grouped by: Program" (says the same thing twice, costs the toolbar a row), and underlined 15 px links "Collapse all · Expand all".
**Fix:** Drop the grey text; make Collapse/Expand all proper small buttons on the group header row.
**Constraint check:** no schema change · `src/renderer/components/grid/GroupingBar.tsx:118-165`, `DataGrid.tsx` group header

### UX-B-23 · Minor · S
**Where:** Colour rules (shots: 51-color-rules.png, 203-cell-color-rules.png)
**What Linda sees / thinks:** Menu says "Color rules for this column…", the dialog is titled "Auto-Highlight Column", the empty state says 'Click "Add rule" below', the button says "Add highlight rule", the save button "Apply".
**Fix:** One name everywhere: "Colour rules for 'Program'"; empty state "No colour rules yet. Add one below."; button "Add a colour rule"; save "Save".
**Constraint check:** no schema change · `src/renderer/components/grid/CellConditionalFormatPanel.tsx:158, 182, 206, 228`

### UX-B-24 · Minor · M
**Where:** A colour rule card (shot: 204-cell-color-rule-card.png)
**What Linda sees / thinks:** "HIGHLIGHT RULE 1 · Name this rule (optional) · WHAT TRIGGERS THIS FORMAT? · This cell's own value · CONDITION · After · STYLE WHEN TRIGGERED · Subtle / Medium / Vivid".
**Fix:** "Colour this cell when… [its own value ▾] [is after ▾] [date]" in one sentence; "Then show it as: [colour swatches]". Drop "trigger"/"format".
**Constraint check:** no schema change · `src/renderer/components/grid/CellFormatRuleCard.tsx`

### UX-B-25 · Minor · S
**Where:** Bulk action bar (shots: 82-bulk-bar.png, 218-bulk-delete-confirm.png, 220-select-all.png)
**What Linda sees / thinks:** A black bar floating over the last rows and the "48 clients" footer: "3 clients selected · Archive · Bulk Edit · Move to caseload… · Print documents… · Delete · x". With acuity on, the buttons wrap to two lines ("Bulk / Edit"). "Bulk Edit" is jargon; red "Delete" sits right next to "Archive".
**Fix:** "Change a column…", "Move to Trash" (matches the confirm), put Delete at the far end after a divider; add bottom padding to the grid while the bar is shown so the last row and footer stay readable; keep labels on one line.
**Constraint check:** no schema change · `src/renderer/components/grid/BulkActionBar.tsx:100-106, 158-169, 240-253`

### UX-B-26 · Minor · S
**Where:** Archive from the bulk bar vs. from one row (shots: 86-archive-confirm.png, 214-archive-one-confirm.png)
**What Linda sees / thinks:** One client: a dialog "Archive client — This client will be hidden… Reason (optional)". Three clients: they vanish immediately with an Undo toast; no dialog, no reason, unless an appointment is coming up.
**Fix:** Same dialog for both (with the reason field); the bulk path already has `archiveAsk`, show it always.
**Constraint check:** no schema change · `src/renderer/components/grid/BulkActionBar.tsx:141-157, 225-239`

### UX-B-27 · Minor · S
**Where:** View ▾ → Show archived clients (shot: 216-show-archived.png)
**What Linda sees / thinks:** Robert Brown's row is faded. No word says "archived"; the View button just gets an amber dot.
**Fix:** An "Archived" pill after the name (like the "Sample" pill) and "Showing archived clients too" in the status footer.
**Constraint check:** no schema change · `src/renderer/components/grid/SortableRow.tsx:151-152, 451`, `GridStatusFooter.tsx`

### UX-B-28 · Minor · S
**Where:** Column ⋯ menu (shot: 44-colmenu-text.png)
**What Linda sees / thinks:** "Use as name" (as whose name?), "Keep columns up to here in view" (long, unfamiliar), "Width − Fit +" (three unlabeled targets), "Change type…" (type of what?).
**Fix:** "Use this as each client's name", "Freeze columns up to here", "Column width: Narrower · Fit · Wider", "Change what it holds (Text, Date…)".
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnHeader.tsx:379, 402-413, 428, 437`

### UX-B-29 · Minor · S
**Where:** Column headers at default width (shot: 41-header-hover.png)
**What Linda sees / thinks:** "Last Conta…", "Annual Re…" — the clock icon and the ⋯ button eat the room, and the full name only shows on hover.
**Fix:** Size new columns to fit their name on creation; let the header wrap to two lines; show the ⋯ only on hover of that header (already) but reserve less width.
**Constraint check:** no schema change · `src/renderer/components/grid/ColumnHeader.tsx:257-305`, `gridColumnSlice.ts` addColumn

### UX-B-30 · Minor · S
**Where:** After "Add" in the Add column form (shot: 64-after-add-dropdown.png)
**What Linda sees / thinks:** The form closes; the grid looks exactly the same. The new "Housing status" column is appended off-screen to the right.
**Fix:** Scroll the new column into view and flash its header (the row path does this with `lastAddedRowId`; do the same for columns).
**Constraint check:** no schema change · `src/renderer/stores/gridColumnSlice.ts:90`, `DataGrid.tsx:423-427`

### UX-B-31 · Minor · S
**Where:** Add column → Type (shots: 57-addcol-date.png, 59-addcol-deadline.png)
**What Linda sees / thinks:** Two similar types, "Date" and "Deadline (worked out by a rule)", and for Date three radios: "No, it's just a date / Yes, every 12 months / It's the due date / More options…". "It's the due date" vs "every" is unclear; "More options…" as a radio button that does something after Add is odd.
**Fix:** Describe in the option text: "It's a one-off due date (colour it as it gets close)"; make "More options…" a link under the radios ("Set it up in detail after adding"). Consider hiding "Deadline (worked out by a rule)" from the type list for new users (reachable via More options).
**Constraint check:** no schema change · `src/renderer/components/grid/DeadlineQuestion.tsx:23-39`, `src/shared/columnTypes.ts:27`

### UX-B-32 · Minor · S
**Where:** Sample-data banner on other caseloads (shots: 110-empty-list.png, 252-empty-list-name-only.png)
**What Linda sees / thinks:** On her brand-new "Volunteers" / "Foster homes" list: "Clients with a ✦ are made-up samples. Remove them when you're done. [Remove sample data]". There are no samples here and these aren't clients.
**Fix:** Show the banner only on lists that contain sample rows, with that list's word.
**Constraint check:** no schema change · `src/renderer/components/shared/SampleDataBanner.tsx`, `components/layout/MainLayout.tsx:206`

### UX-B-33 · Minor · S
**Where:** Import wizard stepper for a CSV (shot: 103-import-step1.png)
**What Linda sees / thinks:** "1 Choose a file — 3 Preview — 4 Match columns — 5 Options — 6 Results". Where is 2?
**Fix:** Number the visible steps 1…5 (the sheet step only appears for multi-sheet files).
**Constraint check:** no schema change · `src/renderer/components/grid/ImportWizard.tsx:326-401`

### UX-B-34 · Minor · S
**Where:** Import wizard → Options (shots: 241-import-options.png, 248-xlsx-options.png)
**What Linda sees / thinks:** "Duplicate detection — None — import all rows / Skip duplicates matching by Name column / … Name + Date of Birth"; "Data cleanup — Clean data before import — Trims extra spaces, normalizes dates and phone numbers".
**Fix:** "If a name is already in this caseload: [Import it anyway / Skip it / Skip it if the date of birth matches too]"; "Tidy up: remove extra spaces and write dates and phone numbers the same way".
**Constraint check:** no schema change · `src/renderer/components/grid/ImportOptionsStep.tsx:32-80`

### UX-B-35 · Minor · S
**Where:** Import results warnings (shot: 250-xlsx-warnings.png)
**What Linda sees / thinks:** Three long amber paragraphs: '2 dates in "DOB" (like 1/2/1960) could be read either way and were read month first, as Settings → Appearance → Date Format says…'.
**Fix:** One short line per warning plus a "Why?" expander; e.g. "DOB: 2 dates read as month/day (US). Written day/month? Change the date format in Settings and import again."
**Constraint check:** no schema change · `src/main/import.ts` warning strings, `ImportResultsStep.tsx:95-125`

### UX-B-36 · Minor · S
**Where:** Add filter panel (shots: 05-filter-panel.png, 06-filter-panel-date.png, 08-filter-chip.png)
**What Linda sees / thinks:** "Add filter condition · Column · Quick: Contains… / Is empty · Condition: contains · Value · [Add Filter]". For a date column the default condition is "due status is". The chip shows the value in monospace ("Housing").
**Fix:** Title "Show only clients where…"; sentence case "Add filter"; "Condition" → "is"; the value in normal text; "due status is" → "deadline is".
**Constraint check:** no schema change · `src/renderer/components/grid/FilterControls.tsx:193-280`, `FilterBar.tsx:104-115`

### UX-B-37 · Minor · S
**Where:** Caseload settings → "How to show each one's name" (shots: 34-list-settings-top.png, 258-list-settings-bottom.png)
**What Linda sees / thinks:** A row of chips that look like filters, a box with placeholder "e.g. {Year} {Make} {Model} – {Plate}" (car-shop words, curly braces), then "Example: Aisha Morales".
**Fix:** Placeholder from this list's own columns ("e.g. {Name} – {Program}"); a sentence first: "Usually the Name column is enough. To show more, click the columns to add them."
**Constraint check:** no schema change · `src/renderer/components/grid/ListSettingsDialog.tsx:247-266`

### UX-B-38 · Minor · S
**Where:** Row lead cells (shots: 206-row-hover.png, 207-starred-profile-hover.png)
**What Linda sees / thinks:** Two unlabeled header cells (a tiny person icon and a star), a purple person button per row, a star that only appears on hover.
**Fix:** Tooltip is there; add a header tooltip/aria for the two lead columns and make the person button read "Open" on hover of the row; keep the star always faintly visible.
**Constraint check:** no schema change · `src/renderer/components/grid/SortableRow.tsx:188-232`, `GridHeaderRow.tsx`

### UX-B-39 · Minor · S
**Where:** New blank row after "Add Client" (shots: 230-after-add-client.png, 111-empty-list-first-row.png)
**What Linda sees / thinks:** A blank row with a blue ring on the Name cell. Typing works (231), but nothing says so; with the mouse she has to double-click.
**Fix:** Open the editor immediately with placeholder "Type the client's name" and a Save-on-Enter hint.
**Constraint check:** no schema change · `src/renderer/components/grid/DataGrid.tsx:423-427`

### UX-B-40 · Minor · S
**Where:** Reports ▾ menu (shot: 20-reports-menu.png, 23-summary-report-dialog.png)
**What Linda sees / thinks:** "Build a report… / Summary report… / Contact requirements summary… / Missing information… / Audit trail… / All reports". "Audit trail" is auditor-speak; the Summary dialog mixes "Coordinator / Worker Name", "Date Range", "Export Report" (Title Case) with the app's sentence case. (Dialog content belongs to slice D.)
**Fix:** "History of changes (PDF)…"; sentence case in the Summary report dialog.
**Constraint check:** no schema change · `GridToolbar.tsx:282-335`, `SupervisorReportDialog.tsx`

### UX-B-41 · Polish · S
**Where:** Search with no match (shot: 31-search-no-match.png)
**What Linda sees / thinks:** "No clients found matching 'zzzz'" with "Collapse all · Expand all" still shown above an empty grid.
**Fix:** Hide the group controls when nothing is shown.
**Constraint check:** no schema change · `src/renderer/components/grid/DataGrid.tsx` group controls

### UX-B-42 · Polish · S
**Where:** Status footer + bottom bar (shot: 01-grid-default.png)
**What Linda sees / thinks:** "48 clients · 16 columns" and under it a second bar that only repeats "Social Worker Caseload" (already in the top bar) until "Saved" appears after an edit.
**Fix:** Merge into one footer line: "Social Worker Caseload · 48 clients · 16 columns · Saved".
**Constraint check:** no schema change · `src/renderer/components/grid/GridStatusFooter.tsx`, `components/layout/StatusBar.tsx`

### UX-B-43 · Polish · S
**Where:** Bulk bar "Print documents…" and More → "Documents and labels…" (shots: 82, 24)
**What Linda sees / thinks:** The same feature under two names.
**Fix:** One name: "Letters and labels…".
**Constraint check:** no schema change · `BulkActionBar.tsx:170-177`, `GridToolbar.tsx:406-414`

### UX-B-44 · Polish · S
**Where:** Context menu "Color rules…" vs header "Color rules for this column…" vs "Edit color rules…" (shots: 201, 50)
**Fix:** "Colour rules for this cell…" / "…for this column…" consistently (see UX-B-23).
**Constraint check:** no schema change · `GridContextMenu.tsx:225`

### UX-B-45 · Polish · S
**Where:** Missing information dialog (shot: 21-missing-info-dialog.png)
**What Linda sees / thinks:** "No columns are marked required yet. In a caseload, open a column's menu and turn on Required column…" — helpful, but "open a column's menu" has no picture of the ⋯.
**Fix:** "…click the ⋯ next to a column name → Column settings → Required column".
**Constraint check:** no schema change · `src/renderer/components/reports/MissingInfoDialog.tsx`

### UX-B-46 · Polish · S
**Where:** Edit options dialog (shot: 67-edit-options.png)
**What Linda sees / thinks:** Good: "Choices for 'Housing status'", up/down/×, "Add a choice". Only the menu entry still says "Edit options…".
**Fix:** Menu entry "Edit the choices…".
**Constraint check:** no schema change · `ColumnSettingsDialog.tsx:114`

### UX-B-47 · Polish · S (cross-slice A/E)
**Where:** First launch (shot: 01-grid-default.png was taken before forcing light)
**What Linda sees / thinks:** The app opens in dark mode on a fresh install (`settingsStore.ts:53` `theme: 'dark'`).
**Fix:** Default to "system" (or light); Linda's Excel and Outlook are light.
**Constraint check:** no schema change · `src/renderer/stores/settingsStore.ts:53`

---

## Checked and fine (no finding)
- 1280×720: everything fits; the tip banner wraps to two lines; filter panel, bulk bar and menus are usable (37-1280-grid.png, 38-1280-filter-panel.png).
- Dark mode of the grid (40-dark-grid.png).
- Change type dialog ("It's Text now. New type… All 40 values fit.") (52, 53).
- Delete column, Delete rule, Move to the Trash, Remove sample data confirmations (70, 223, 218, 260).
- Move / Copy to another caseload (254, 255) — clear words, disabled button until a target is chosen.
- Examples browser (256) — searchable, plain descriptions.
- Import preview with header-row detection and "Undo this import" (104, 242).
- Native date picker in date cells (75, 76) — a typed non-date can't happen, so the "Not a date" state wasn't reachable from the keyboard.
