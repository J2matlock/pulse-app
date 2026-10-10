# Audit: settings, workspace setup, getting data in and out (X)

Reviewer area: Settings (all tabs), words and feature switches, backup/restore/move, security, import, export, setup templates, letters/batch documents, snippets, reports (light pass), trash/archive/sample data/factory reset.

Screens used: `test-results/audit-tour/22-23, 25-37, 39, 40`. (`test-results/ui-tour/current/` doesn't exist on this machine, so those screens weren't checked.) Every audit-tour shot shows the top bar title "Customers" while on Settings, Reports and Templates. That's the last-opened list's name, not the page. This is probably another reviewer's area (layout), so it's noted here only.

## Top 5

1. **Fix the three broken safety buttons:** "Save new password" can never be pressed (X-01), backup "Run now" always fails (X-04), and there's no "Back up now" button unless scheduled backups are on (X-03).
2. **Make backups trustworthy by default.** Report failed scheduled backups (X-06), allow backups over 200 MB to be restored (X-05), and show backup status outside Settings. Nudge people to keep one copy off this computer (X-07).
3. **Stop silent data loss on "safe" actions.** Deleting a deadline rule in one click (X-13), "Remove sample data" deleting the user's own additions (X-12), and import's "Name + Date of Birth" option matching on name only (X-16).
4. **Make "delete" and "restore" mean what they say.** A deleted list is kept forever but called permanent, and Trash points to a restore screen that doesn't exist (X-11). A backup made on another computer can't be restored from Settings (X-08).
5. **Trim Settings from 11 tabs to about 7 and make the tab list scroll.** On a 1366×768 laptop, Shortcuts, Snippets and About can't be reached with the mouse (X-02, X-25). Use "deadline" consistently instead of "alert" (X-26).

## Findings

### X-01 · Changing your password is impossible · Blocker · bug
- **Where:** `src/renderer/components/settings/SecuritySection.tsx:142,174-175`
- **What the user experiences:** Settings → Security → Password → "Change…" opens the form. The "Save new password" button stays greyed out no matter what they type, and Enter does nothing either: when a form's submit button is disabled, Enter doesn't submit.
- **Why it matters:** Agencies require password rotation, and someone who thinks a coworker saw their password can't change it. Nothing else in the app calls `AUTH_CHANGE_PASSWORD`, and no test covers this path.
- **Fix:** Remove `isChangingPassword ||` from `disabled` (the form only renders while it's true). Use a separate `saving` flag to block double submits. Add a renderer test that fills the form and submits it.
- **Effort:** S

### X-02 · Settings tab list is cut off; the last tabs can't be reached by mouse · High · bug
- **Where:** `src/renderer/views/SettingsView.tsx:132-134` (the `nav` has no `overflow-y-auto`, and its parent is `overflow-hidden`). Screens 25-37 show "Notes" cut off at the bottom, with no scrollbar for the tab list.
- **What the user experiences:** On a 1366×768 laptop (common for agency laptops), Notes is half visible, and Shortcuts, Snippets and About are below the edge. The mouse wheel doesn't scroll the list.
- **Why it matters:** About holds update checks and the version number support will ask for. Anyone at 125% zoom loses even more tabs.
- **Fix:** Add `overflow-y-auto` to the nav. Shortening each tab description to one line (see X-25) gets most tabs on screen anyway.
- **Effort:** S

### X-03 · No "Back up now" button unless scheduled backups are on · High · usability
- **Where:** `BackupSection.tsx:247-251` (info box promises "Manual backup lets you save on demand"), `:270` ("create a manual backup below"), `:351-429` (the only manual-backup button, "Save to different location…", sits inside `scheduledConfig.enabled &&`). Screens 32/33 show no such button.
- **What the user experiences:** A supervisor says "make a backup on your USB stick". The user opens Backup and finds Restore buttons, a scheduled-backup checkbox and a reminders checkbox, but nothing that makes a backup. The red warning after a failed auto-backup tells them to use a button that isn't there. The only other route is "Move to a new computer…", which they wouldn't think of.
- **Why it matters:** This is the single most important safety action in the app.
- **Fix:** Put a primary "Back up now…" button at the top of the Backup tab, always visible, saving a `.pulse-backup` wherever the user picks. Show "Last backup saved to another place: <date>" beside it. Keep "Run now" inside Scheduled for power users.
- **Effort:** S

### X-04 · Scheduled backup "Run now" always fails · High · bug
- **Where:** `BackupSection.tsx:219-224` sends `intervalDays: 0`. `src/main/ipc/ipc-export.ts:70-71` rejects `intervalDays < 1` by throwing.
- **What the user experiences:** They tick "Enable scheduled backups", choose a USB folder and click "Run now" to test it. They get "Backup did not run: Invalid backup config: intervalDays must be 1-365". It looks broken, and the message is developer text. (A backup does run within 15 minutes, because `lastRunISO` was cleared first, but they're never told.)
- **Why it matters:** People test a backup right after setting it up. A failure here makes them distrust or abandon the feature.
- **Fix:** Add a `BACKUP_SCHEDULED_RUN_NOW` path that runs `createPulseBackup` to the configured folder and updates `lastRunISO` in the main process. Drop the renderer's three-step set/run/set sequence.
- **Effort:** S

### X-05 · Backups over 200 MB can be made but never checked or restored · High · logic
- **Where:** `src/main/backup.ts:156` (`MAX_BACKUP_ZIP_BYTES` 200 MB), `:498`, `:534-536`, `:841-844`, `:1008`. Compare `src/shared/attachments.ts:17-18` (file room defaults to 1000 MB and can go up to 4000 MB). `BackupSection.tsx:39,255-258` warns only above 500 MB.
- **What the user experiences:** With Files switched on and about 250 MB of scanned documents, scheduled and manual backups save without complaint. On restore, or on a new computer, they get "Backup file exceeds 200 MB — will not restore". The encrypted database doesn't compress, so the zip is about the size of the database. The Move wizard's check would catch it ("didn't pass its check"), but scheduled backups never do.
- **Why it matters:** Backups that can't be restored are worse than none, because people rely on them.
- **Fix:** Tie the restore limit to the file allowance plus headroom (e.g. allowance + 512 MB), or keep only the uncompressed-size bomb check (already 2 GB at `:869`). Have `createPulseBackup` refuse, loudly, to write anything the restore path would reject.
- **Effort:** M

### X-06 · Scheduled backups fail silently · High · logic
- **Where:** `backup.ts:688-717` (`checkAndRunScheduled` only logs errors). `BackupSection.tsx:403-407` shows only "Last run". `SecurityCheckup.tsx:344-345` passes as soon as scheduled backups are on.
- **What the user experiences:** They set scheduled backups to a USB stick, then unplug it or the network share goes away. Every 15 minutes the backup fails and goes into a log file. Settings still says "Last run: <weeks ago>" with no warning, and the security checkup stays green.
- **Why it matters:** The off-computer copy is the one that saves them when the laptop dies. They find out it stopped only on that day.
- **Fix:** Record `lastError` and `lastAttemptISO` in `pulse-backup-config`. Show a red "Scheduled backup hasn't worked since <date>: <human reason>" in the Backup tab, and fail the checkup item. Show a dashboard/status-bar notice after about two missed intervals.
- **Effort:** M

### X-07 · The default setup leaves people with no copy off this computer, and nothing tells them · High · logic / usability
- **Where:**
  - `backup.ts:366-399` (auto-backup runs only when the app closes and lands in `<data>/backups`)
  - `backup.ts:673-680` (scheduled backups default to that same folder)
  - `useBackupReminder.ts:21-29` (the reminder looks only at auto-backups, and is off by default)
  - `stores/backupStatusStore.ts` (built, but never used)
  - Backup state appears nowhere outside Settings (grep: no backup UI in layout or dashboard)
- **What the user experiences:** A worker who never touches Settings has only copies on the same disk, made only when they close the app, which many never do (the laptop sleeps). The reminder, if turned on, is satisfied by those same-disk copies, so it never warns the people who need it. Factory reset also deletes the default scheduled-backup folder (`ipc-app.ts:137`).
- **Why it matters:** "Laptop stolen or dead" is the most likely disaster, and the defaults don't cover it.
- **Fix:**
  - Count "last backup somewhere else" (manual, Move, or scheduled outside the data folder) as the real backup date.
  - Show a small status-bar or dashboard chip: "Last backup to another place: 12 days ago".
  - Turn the reminder on by default and base it on that date.
  - Also run an auto-backup when the app locks (auto-lock or sleep), not only when it closes.
  - Power users keep the scheduled settings.
- **Effort:** M

### X-08 · Restoring a backup from another computer fails from Settings with a misleading message · Medium · logic / wording
- **Where:** `BackupSection.tsx:124-128` → `BACKUP_VERIFY` → `backup.ts:586` (opens the backup with *this* install's key, ignoring the key envelope inside the backup).
- **What the user experiences:** On a new laptop they set Pulse up, maybe with an example, then go to Settings → Backup → "Restore from file…" and pick the backup from the old laptop. They get "This backup file appears to be invalid or from a different version." Restoring a different install's backup only works from the first-run screen or the "can't unlock" lock screen. Once they've set up, the only way back is Factory reset, and nothing tells them that.
- **Why it matters:** This is the most natural thing to try, and "invalid" makes people fear the backup is corrupt.
- **Fix:** When verify fails but the archive has `key-envelope.json`, offer "This backup is from another Pulse. Enter its password or recovery key to restore it (your current data is kept as a safety copy)". Reuse `RestoreFromBackupForm`. At minimum, word the error accurately.
- **Effort:** M

### X-09 · Restore preview shows the wrong "Created" date and the word "Schema version" · Medium · bug / wording
- **Where:** `src/main/ipc/ipc-export.ts:252-256` (`MIN(created_at) FROM grids`), `BackupSection.tsx:506-513`, `:548-565`.
- **What the user experiences:** Every backup's confirm box says "Created: <the day you made your first list>". That's the same date for all of them, so it can't help them pick the right one. "Schema version 43" means nothing to them. After restoring, "Later" leaves them in a window whose words, features and settings still show the pre-restore state until they restart.
- **Why it matters:** Choosing the right backup matters most when someone is already stressed.
- **Fix:** Read `created` from `backup-meta.json` (or the auto filename's timestamp) and label it "Backup made". Drop "Schema version", or show "Made by Pulse 2.1" from `appVersion`. Make "Restart now" the only choice, or reload all stores on "Later".
- **Effort:** S

### X-10 · Changing scheduled-backup settings then leaving quickly loses the change · Low · bug
- **Where:** `BackupSection.tsx:75-79` (the unmount clears the pending save), `:198-204` (500 ms debounce).
- **What the user experiences:** They tick "Enable scheduled backups" or change Frequency, then click another Settings tab within half a second. The change isn't saved, and coming back shows it off.
- **Fix:** Save checkboxes and selects immediately (no debounce needed), or flush the pending save on unmount.
- **Effort:** S

### X-11 · "Permanently delete" a list doesn't delete it, and Trash points to a restore that doesn't exist · High · logic
- **Where:**
  - `Sidebar.tsx:54-55` ("permanently delete … cannot be undone")
  - `src/main/ipc/ipc-grid.ts:173-183` (only sets `is_active = 0`; rows, cells and notes stay)
  - `TrashView.tsx` blocked-restore dialog ("first restore the list from Settings"; there's no such control and no `GRID_RESTORE` channel)
  - `ipc-export.ts:56` (Settings → Data "Total active records" still counts rows in deleted lists)
- **What the user experiences:** A care coordinator deletes a closed program's list believing the client data is gone. It stays in the database and every backup indefinitely and is never purged. If they deleted the list by mistake, they can't get it back, even though the data is still there.
- **Why it matters:** It's either a privacy problem (the data isn't deleted) or a recovery problem (it can't be restored). Today it's both.
- **Fix:** Pick one model:
  - **Recommended:** deleted lists go to Trash with their records, restorable for 30 days, then purged with the existing row purge. The dialog then says "moves to Trash".
  - Or delete for real and keep the typed confirmation.

  Also fix the record count, and the Trash message.
- **Effort:** M

### X-12 · "Remove sample data" can delete the user's own work · High · logic
- **Where:** `src/main/sample-data.ts:68-80` (hard `DELETE` of every starter-sample row, edited or not), `:165-168` (deleting the sample list cascades to every record in it). `SampleDataBanner.tsx` confirm text: "Anything you created yourself is not affected". `DataSection.tsx:156` (no confirmation at all).
- **What the user experiences:** New users often type over a sample entry or add a note to one, or add a real client to the "sample" list while exploring. "Remove sample data" deletes all of it, with no Trash and no undo. On Settings → Data a single click does it.
- **Why it matters:** The confirm text promises the opposite of what happens.
- **Fix:**
  - Leave sample rows the user has edited or written notes on, and say so ("2 entries you changed were kept").
  - Never cascade-delete records the user added to the sample list. Move them to a new list, or refuse and explain.
  - Use the banner's confirm dialog on the Settings → Data button too.
- **Effort:** M

### X-13 · Deleting a deadline rule takes one click and silently strips it from columns · High · logic
- **Where:** `AlertsSection.tsx:190-203` (trash icon, no confirm), `src/main/ipc/ipc-alerts.ts:95-104` (no usage check). Compare `sample-data.ts:174`, which does check `json_extract(config,'$.alert_rule_id')`. Screens 28/29.
- **What the user experiences:** In Settings → Alerts, a click on the bin next to "Every year" removes it at once. Every column using it ("Annual review", "Lease renewal") quietly stops turning colors and disappears from the dashboard. There's no undo, and the mistake may not be noticed until a deadline is missed.
- **Fix:** Confirm with usage: "3 columns in 2 lists use this rule. Their deadlines will stop showing." Offer "Pick a replacement rule" or block the delete while it's in use. Add it to undo.
- **Effort:** S

### X-14 · Import "Paste from clipboard" never works · High · bug
- **Where:** `ImportWizard.tsx:255-291` (uses `navigator.clipboard.readText()`, which is denied by `src/main/index.ts:325-330`). Also `ImportWizard.tsx:387` (sends `filePath: ''`, never the pasted rows) and `ipc-utils.ts:173` (rejects `''` as a relative path).
- **What the user experiences:** They copy rows from Excel, click "Paste from clipboard" and get "Could not read clipboard. Make sure you have copied some data first." Even if reading worked, the import step would fail, because main never receives the pasted data.
- **Why it matters:** It's the most Excel-like way in, and it's shown as the obvious second option.
- **Fix:** Read the clipboard in main (`clipboard.readText()` via a new IPC), write it to a temporary CSV in the import cache, and import from that path. Until that's done, hide the button.
- **Effort:** M (S to hide)

### X-15 · Dropping a file onto the import box fails · Medium · bug
- **Where:** `ImportWizard.tsx:300-311` uses `(file as File & {path}).path`, which was removed in recent Electron. The preload already exposes `window.api.pathForFile` (`preload/index.ts:25-27`), which `attachmentActions.ts:20` uses.
- **What the user experiences:** "Drop a CSV or Excel file here" → "Could not get the file path. Try using the Browse button instead."
- **Fix:** Use `window.api.pathForFile?.(file)`.
- **Effort:** S

### X-16 · "Skip duplicates by Name + Date of Birth" only compares names · High · logic
- **Where:** `src/main/import.ts:849-868` (`name_and_dob` falls through to name-only), `:906-913`. UI option at `ImportWizard.tsx:850`. Also, `by_column` compares the import's *name* against the chosen column's values, and the existing-row query (`:857-860`) includes rows in Trash (`deleted_at` isn't filtered).
- **What the user experiences:** They import a new referral list with "Name + DOB" chosen, to be safe. A new client who shares a name with an existing one (two "Maria Garcia"s) is skipped without notice, and the summary just says "1 skipped (duplicate detection)". Records sitting in Trash also block re-imports. Duplicates inside the same file aren't caught at all.
- **Why it matters:** Missing a new client on intake is a real-world harm.
- **Fix:**
  - Implement `name_and_dob` properly: find the DOB column by type or name, and compare both values.
  - Exclude Trash rows from the comparison.
  - Add each imported key to the lookup so in-file duplicates are caught.
  - List the skipped names on the results screen.
- **Effort:** M

### X-17 · "Notes", "Comments" and "Remarks" columns are skipped without telling anyone · Medium · usability
- **Where:** `ImportWizard.tsx:341-349`.
- **What the user experiences:** A spreadsheet's most valuable column is often the running notes column. It arrives at the mapping step set to "Skip (do not import)", with no explanation, and is easy to miss among 20 rows.
- **Fix:** Default it to a text column, or offer "Add as a first note on each record" (that's what the code comment intends). Add a one-line note on that row explaining the choice.
- **Effort:** S (M to import as notes)

### X-18 · .xls and .ods files are offered but can't be read · Medium · bug (suspected exact error)
- **Where:** `ImportWizard.tsx:230,529` ("Supports .csv, .xlsx, .xls"), `import.ts:622` (allows xls/ods), `:552-560` (ExcelJS reads only .xlsx).
- **What the user experiences:** An old agency spreadsheet saved as .xls fails with a technical zip/parse error, passed through raw by `humanizeError`.
- **Fix:** Drop .xls and .ods from the picker and the message. When someone picks one, say "This is an older Excel file. Open it in Excel and choose Save As → Excel Workbook (.xlsx), then try again."
- **Effort:** S

### X-19 · No way to undo an import; a failure leaves a partial import and no way back · Low · usability
- **Where:** `import.ts` (chunked commits, "partial import is acceptable"), `ImportWizard.tsx:1023` (no Back button on step 6).
- **What the user experiences:** If they import into the wrong list, they must find and delete 200 records by hand. After an error they must close and redo all the column choices.
- **Fix:** Return `newRowIds` and offer "Undo this import" (move them to Trash) on the results step. Keep a Back button on error.
- **Effort:** M

### X-20 · The "Date Format" setting does nothing · Medium · bug
- **Where:** `AppearanceSection.tsx:235-248` saves `date_format`. Nothing reads it (grep). `GridToolbar.tsx:159` hard-codes `'us'` for list CSV export, and `ipc-export.ts:289` hard-codes `'iso'` for Export All. Screen 37 also says both "How dates appear throughout the app" and "Used when exporting data to CSV and PDF reports".
- **What the user experiences:** A UK user picks DD/MM/YYYY and nothing changes anywhere. Their two CSV exports come out in two different date formats.
- **Fix:** Pass the saved setting to every export, and to on-screen dates if that's the intent. Otherwise remove the control. Use one description.
- **Effort:** S

### X-21 · CSV exports garble accented names in Excel, drop hidden columns, and leave notes out of "Export all" · Medium · logic
- **Where:**
  - `export-csv.ts:29-31` (UTF-8 with no BOM)
  - `export-shared.ts:213` (`loadGridData` takes visible columns only)
  - `ipc-export.ts:266-297` (Export All covers only list rows; two lists with the same name overwrite one file; existing files are overwritten without asking)
  - `export-shared.ts:187` (prefixes `-12.5` with a tab, so negative numbers become text)
- **What the user experiences:** "José Núñez" opens in Excel as "JosÃ© NÃºÃ±ez". "Export All as CSV", the obvious way out, quietly omits columns they hid and every note, task, contact and appointment.
- **Why it matters:** Getting your data out completely is part of trusting an offline app.
- **Fix:**
  - Write a BOM.
  - Export All includes hidden columns, and adds `notes.csv` (also tasks and contacts), or says plainly what's left out and points to Reports → Notes.
  - De-duplicate file names.
  - Only prefix a tab on numbers in text columns.
- **Effort:** S–M

### X-22 · Settings → Data says "import and export" but only points elsewhere, using jargon · Medium · usability
- **Where:** `DataSection.tsx:228-235`, `SettingsView.tsx:114`.
- **What the user experiences:** The tab description says "Import, export, and data management". Inside is a sentence about "the grid toolbar" and "a single grid", and no Import button. Someone looking for "how do I bring my spreadsheet in" ends up here.
- **Fix:** Add "Import a spreadsheet…" (opens the wizard with a list picker) next to "Export everything…". Replace "grid" with the list word.
- **Effort:** S

### X-23 · "Delete all history" runs with no confirmation and wipes the audit trail · Medium · logic / wording
- **Where:** `DataSection.tsx:276-311`.
- **What the user experiences:** Choosing "Delete all history" and clicking "Compact Now" erases every cell's edit history at once, which the audit-trail export and undo history depend on. The result toast says "N records removed", where "records" clashes with the workspace word for the people they track. Phrases like "Compact", "future audit and undo capabilities" and "Database integrity" are developer language.
- **Fix:** Confirm the destructive option, and rename the section to something like "Free up space: forget edits older than…". Say "edits" instead of "records" in the result. Move the integrity check under an "Advanced" disclosure.
- **Effort:** S

### X-24 · Factory reset leaves a broken app running · Medium · usability
- **Where:** `DataSection.tsx:413-417`, `ipc-app.ts:96-139` (closes and deletes the database and never tells the window).
- **What the user experiences:** A toast says "App reset. Please restart Pulse." while their old lists are still on screen. Clicking anything gives errors.
- **Fix:** After reset, relaunch to the setup screen (as `APP_RELAUNCH` does). Also suggest "Make a backup first" with a button before the typed confirmation.
- **Effort:** S

### X-25 · Eleven Settings tabs, two of them read-only duplicates, and an "Alerts" grab-bag · Medium · usability
- **Where:**
  - `SettingsView.tsx:108-120` (11 tabs, each with a two-line description at 12 px)
  - `ShortcutsSection.tsx` (same as the Shift+? sheet)
  - `SnippetsSection.tsx` (read-only copy of the Snippets page)
  - `AlertsSection.tsx:145-150` (Daily summary, desktop Reminders, "Running in the background" tray mode, Requirements, Days off, then rules)
  - `:64` (opens on Appearance, not the first tab)
  - `:62,217` (a `?tab=` deep link to a hidden or unknown tab shows a blank panel)
- **What the user experiences:** Looking for "keep running in the tray" they'd never think of "Alerts". "Requirements" (notes needed per month) is also under Alerts, not Notes. There are three different "reminder" ideas: daily summary, desktop reminders and backup reminders.
- **Fix:** Regroup into about 7 tabs, each with a one-line description:
  - **Workspace** (words, features, examples, share setup, your name for letters)
  - **Appearance**
  - **Security & backup** (checkup at top, password, auto-lock, recovery key, back up now, scheduled, restore, move computer)
  - **Deadlines** (rules, days off)
  - **Reminders** (daily summary, desktop reminders, background)
  - **Notes** (kinds, requirements, time/mileage, numbers, formats)
  - **Data** (import, export, files, sample data, then reset under an "Advanced" disclosure)

  Move Shortcuts and About into Help, with a version line in the Help footer. Keep the Snippets page in the sidebar. Validate `tabParam` and fall back to the first tab.
- **Effort:** M

### X-26 · "Alert rules" in Settings vs "deadline rules" everywhere else · Medium · wording / consistency
- **Where:** `SettingsView.tsx:115` ("Deadline alert rules and notifications"), `AlertsSection.tsx:150-152,176,215` ("Alert Rules", "3 thresholds", "Add Alert Rule"), `AlertRuleEditor.tsx:334`. Help (`faqData.tsx:556,562`) and the Workspace tab say "deadline rule". CLAUDE.md: "Deadlines" not "alerts".
- **What the user experiences:** Help says "choose a deadline rule", but Settings lists "Alert Rules" with "5 thresholds". Is that the same thing?
- **Fix:** Call them "Deadline rules" everywhere. Replace "5 thresholds" with the colour steps as small swatches, or "Warns 30, 14 and 7 days before".
- **Effort:** S

### X-27 · Exporting a saved list template always fails with "Invalid grid ID" · Medium · bug
- **Where:** `TemplateManagerView.tsx:333-340` sends `{ templateId, outputPath }` as the first argument. `ipc-export.ts:513-514` expects `(gridId, destPath)`, so `validId` fails.
- **What the user experiences:** Templates page → a saved list template → Export → "Invalid grid ID".
- **Fix:** Add `SETUP_TEMPLATE_EXPORT_SAVED(templateId, path)` that writes the stored `pulse_json`, or reuse the stored JSON in the renderer path.
- **Effort:** S

### X-28 · Three overlapping ways to share a setup, with two incompatible ".pulse" files · Medium · consistency
- **Where:** `WorkspaceSection.tsx:45-71` ("Add lists from an example", "Save my setup as a template…", "Open a template file…") vs `TemplateManagerView` "List templates: Import .pulse File / Save Current Grid as Template" (screen 39). `starters.ts:87-92` opens both formats. The Templates page path (`ipc-export.ts:524-527` → `validatePulseJson`) accepts only the single-list format, so a workspace file saved from Settings fails there with a schema error (suspected wording).
- **What the user experiences:** A coworker sends `my-pulse-setup.pulse`. Opened from Settings it works; opened from Templates it fails. "Templates" in the sidebar also means checklist templates, while letter templates are a separate sidebar entry.
- **Fix:** One "Templates & examples" place. Route every `.pulse` file through `loadStarter` and `ApplyStarterDialog`. Keep the saved-template library as "My templates" in the same gallery as the 51 examples. Rename the sidebar entry to "Checklists" if that's all that's left there.
- **Effort:** M

### X-29 · The Words editor ignores each list's own words and doesn't say so · Medium · usability
- **Where:** `WordsEditor.tsx:152-163,190-199`, `useVocab.ts:20-29` (list words override workspace words). Screen 26: the editor shows "record/records" while the sidebar and status bar say "customers".
- **What the user experiences:** A tree-service owner changes "What you track" to "client" and saves. "Customers", "Jobs" and "Crew" keep their own words, so nothing they look at changes. The toast says "They now appear everywhere."
- **Fix:** Above the table, say "These are the default words. Lists with their own words keep them: Customers (customer), Jobs (job)…" with an "Edit" link that opens each list's settings. Reword the toast.
- **Effort:** S

### X-30 · Unsaved word changes are lost when switching tabs · Low · usability
- **Where:** `WordsEditor.tsx:199,279-287`, `SettingsView.tsx:142`.
- **Fix:** Ask "Save your word changes?" when leaving the tab while there are unsaved changes, or autosave valid changes.
- **Effort:** S

### X-31 · "Requirements summary…" stays in the Export menu when Requirements is switched off · Medium · consistency
- **Where:** `GridToolbar.tsx:538-544` (not gated; the other report items are gated on their features).
- **What the user experiences:** A landlord who switched off Requirements still sees "Requirements summary…", which leads to an empty or confusing report.
- **Fix:** Wrap it in `useFeature('requirements')`.
- **Effort:** S

### X-32 · Human-services and agency words left in shared screens · Low · wording
- **Where:**
  - `ProfileSection.tsx:37,63-70` (advertises `{{case_manager_name}}`, while the letter reference uses `{{my_name}}`, `PlaceholderReference.tsx:15-23`)
  - `EditTemplateModal.tsx:176` (example "Dear {{client_name}}")
  - `NotesSection.tsx:72,83,107-109` ("each note", "DAP, SOAP, BIRP… your agency uses")
  - `SecurityCheckup.tsx:341,370` ("Most agencies expect", "Security summary for my supervisor")
  - `WordsEditor.tsx:160` (requirement hint "notes … per month", although periods vary)
  - `SampleDataBanner` confirm text ("their notes")
  - `SnippetsView.tsx:117,256` ("scrap note")
- **Fix:** Use `{{my_*}}` in Profile and `{{name}}` in the example. Run the hard-coded words through vocab. Show note formats only under human-services words. Use "Security summary to share" and "Most organizations".
- **Effort:** S

### X-33 · The default auto-lock fails the app's own security checkup · Medium · logic
- **Where:** `settingsStore.ts:49` (30 min default), `SecuritySection.tsx:116-118` ("5 minutes (recommended)", "30 minutes (default)"), `SecurityCheckup.tsx:339-341` (passes at 15 minutes or less). Screen 35.
- **What the user experiences:** A brand-new install scores "1 of 4" and is told that most agencies expect 15 minutes, while the menu recommends 5 and defaults to 30. That's three different answers.
- **Fix:** Default to 15 and label it "(recommended)". Keep 5 to 120 for people who want them.
- **Effort:** S

### X-34 · Saving a snippet with a trigger already in use fails silently · Medium · bug
- **Where:** `SnippetsView.tsx:64-69` (closes the editor right after `onSave`), `:218-232` (no toast on `!res.ok`), `001_initial_schema.ts:229` (`trigger_text UNIQUE`).
- **What the user experiences:** They type a long signature under `/sig`, which already exists, and click Save. The dialog closes and nothing appears. The text is gone.
- **Fix:** Check for duplicates in `validateTrigger` against the loaded list. Keep the editor open and show a toast when saving fails.
- **Effort:** S

### X-35 · The letter editor loses work easily, and letter generation doesn't scale · Medium · usability
- **Where:** `EditTemplateModal.tsx:39-46,80` (Escape or a backdrop click closes with no unsaved check), `:24-29` ("Insert field" offers only the last-opened list's columns). `GenerateLetterModal.tsx:23` (defaults to the first list, whatever the template is for), `:179-195` (plain select of every record, no search).
- **What the user experiences:**
  - They write a two-page letter, press Escape to close a dropdown, and the letter is gone.
  - On the Templates page, the fields offered are for whichever list they had open before.
  - With 200 clients, they scroll a long select to find one person.
- **Fix:**
  - Confirm before discarding changes.
  - Let them pick the list for "Insert field".
  - Remember a template's list, or infer it from its `{{field:…}}` tokens.
  - Use the existing record search or combobox.
- **Effort:** M

### X-36 · Letter templates show raw `{{tags}}` in monospace, and there are two ways to make letters · Low · usability
- **Where:** `LetterTemplateView.tsx:249-256` (screen 40), the Export menu's "Documents and labels…" vs "Generate Letter" on the letters page.
- **What the user experiences:** The template looks like code. "Generate Letter" makes one letter, while "Documents and labels" (from a list) makes many. Nothing connects the two.
- **Fix:** Show a filled preview using a sample record, with tags as chips. Add "Make letters for many…" on the letters page, which opens `BatchDocumentsDialog`.
- **Effort:** M

### X-37 · Batch documents: no count before saving, and problems reported after the fact · Low · usability
- **Where:** `BatchDocumentsDialog.tsx` `make()`.
- **What the user experiences:** They don't know whether "Everyone due between…" means 3 letters or 300 until the PDF is saved. Unknown `{{tags}}` are listed only after the PDF was written, so they redo it.
- **Fix:** Show "This makes 14 letters" live. Check the template's tags before saving.
- **Effort:** S

### X-38 · Trash countdown uses the UTC time as local time · Low · bug
- **Where:** `TrashView.tsx` `daysRemaining()` uses `new Date(deletedAt)` (CLAUDE.md pitfall; the display uses `parseDbTimestamp`). "Empty Trash" makes one IPC call per row.
- **Fix:** Use `parseDbTimestamp`. Add a single `ROW_PURGE_ALL`.
- **Effort:** S

### X-39 · Text under 15 px and small controls across Settings · Low · accessibility
- **Where:**
  - `SettingsView.tsx:155` (tab descriptions `text-xs`)
  - `SecuritySection.tsx:108`, `DataSection.tsx:277,316,379` (`text-xs`)
  - many `AppearanceSection` hints (`text-xs`)
  - many `text-sm` hints across sections
  - `BackupSection.tsx:344,451` (16 px checkboxes), `:307` (36 px Restore buttons)
  - `DataSection.tsx:285,300` (40 px)
  - `ImportWizard.tsx:484` (step labels `text-sm`)
- **Fix:** Use at least 15 px for hints. Use the same 20 px checkbox and 44 px row as the Features section.
- **Effort:** S

### X-40 · Update instructions are Windows-only and shown everywhere · Low · wording
- **Where:** `AboutSection.tsx:91-102` ("PULSE.exe", "PulseData folder").
- **Fix:** Pick the instructions by `APP_GET_INFO.platform`, and by portable vs installed.
- **Effort:** S

### X-41 · Report builder: unsaved changes are lost when leaving through the sidebar · Low · usability
- **Where:** `ReportsView.tsx:83-87`. Only the in-page buttons check for unsaved changes; sidebar and command-palette navigation don't.
- **Fix:** Use React Router's `useBlocker` while there are unsaved changes.
- **Effort:** S

### X-42 · Import may show or apply the wrong sheet after going back (suspected) · Low · bug
- **Where:** `import.ts:513-517` (the cache key ignores the sheet name), `:632-641` (only clears the cache when the sheet isn't the first). `ipc-export.ts:487` re-reads sheet 0 for type and name-flip detection.
- **What the user experiences (traced, not run):** They pick sheet 2, go Back, and pick sheet 1. The preview can show sheet 2's columns while the import reads sheet 1. Name flipping is decided from the wrong sheet's samples.
- **Fix:** Include the sheet name in the cache key. Pass `options.sheetName` to the preview call in `IMPORT_FILE`.
- **Effort:** S

## Things that work well (keep them)

- **Security checkup** (`SecurityCheckup.tsx`): a plain-language "x of y", fix text and jump links, cloud-sync detection, and a supervisor summary. A great pattern; extend it, don't replace it.
- **Move to a new computer wizard**: a recovery-key check, saves, *verifies* the backup opens, and gives clear steps for the new machine. The key envelope inside `.pulse-backup` is the right design.
- **Restore safety:** a typed confirmation, a pre-restore safety copy, rollback if the restored database won't open, and atomic copies. Factory reset needs both a typed phrase and the password, and clears every local copy while keeping external backups.
- **Feature switches:** hide-only (nothing is deleted), clear descriptions with vocab tokens, and the Notes tab toggles stay in sync with Features.
- **Words editor:** live preview, singular/plural, automatic a/an, "use general / human-services words" presets, and input validation.
- **Import wizard core:** header-row detection with manual adjustment, per-column day/month order detection, "Smith, Jane" flipping with a concrete example, matching link columns by name with an "add missing" option, a progress bar, and per-row warnings.
- **Exports** mark files as unencrypted (`noteUnencryptedExport`) and guard against CSV formula injection.
- **Reports home:** cards that answer a question in a sentence, with a glance at the result, and preset starters in the builder. The in-page unsaved-changes guard is good.
- **Sample data** is clearly bannered on every screen.
