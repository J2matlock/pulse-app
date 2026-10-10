# First run and getting started — audit (prefix F)

Scope: password setup, terms, recovery key, lock/unlock, forgotten password, restore on a new computer, the setup choice (example / spreadsheet / blank / "just looking"), the example gallery, guided blank start, the spreadsheet first step, the guided tour and mini-tours, sample data and its banner, first-time empty states, and the first 10 minutes.

Evidence: code (file:line below) and `test-results/audit-tour/01–07*.png`. Note: `test-results/ui-tour/current/` does not exist on disk, so none of those screenshots could be used. `03-setup-review.png` and `04-setup-after-add.png` match their names. `05-dashboard-top.png` shows the dashboard but the header says "Customers", which suggests the click that should have opened the dashboard missed or the header is stale.

## Top 5

1. **Make "Remove sample data" safe and honest.** Today it deletes real records that someone added to the sample list, while the confirmation promises "anything you created yourself is not affected" (F-01).
2. **Never leave a new user at a dead end.** The no-lists screen and the empty-list screen need real buttons ("Start from an example", "Bring in a spreadsheet", "Add your first …"). The empty list also shows the wrong shortcut (F-08, F-09, F-11).
3. **Make setup survive an interruption.** Once a list exists, a lock, auto-lock or app close marks setup as done and quietly drops the words, features and date reminders the user hadn't confirmed yet (F-02).
4. **Rebuild the tour as a short, feature-aware tour.** Today it is 24–28 steps, includes a step that points at a theme button that no longer exists, opens the Contacts screen even when Contacts is turned off, uses social-work examples for every workspace, and skips Calendar, Reports and Board (F-03 to F-07).
5. **Give the lock screen and the setup screens inline, persistent feedback.** Explain why "Create password" is greyed out, show wrong-password and lockout messages on the screen instead of only a toast, re-offer the recovery key after it was skipped, and remove the "restore a backup and try again" dead end (F-25, F-27, F-29, F-32).

## Findings

### Sample data

**F-01 · Removing the sample caseload deletes the user's real records and says it won't** · Severity: High · Type: bug / logic
- **Where:** `src/main/sample-data.ts:162-179` (`DELETE FROM grids WHERE id = ?`, which cascades to rows, cells, notes and tasks via `ON DELETE CASCADE`, `001_initial_schema.ts:35`). Promise text in `src/renderer/components/shared/SampleDataBanner.tsx:64`.
- **What the user experiences:** Someone picks "Just looking? Try it with sample data", likes it, and starts adding real clients (and notes and tasks) straight into "Sample Caseload (not real clients)". Later they click "Remove sample data". The confirmation says "Anything you created yourself is not affected." Their real clients, notes and tasks are hard-deleted. They don't go to the trash and there's no undo.
- **Why it matters:** This is silent loss of real data, caused by text that tells the user it is safe. Non-technical users do put real data wherever the screen is open.
- **Fix:** In `removeSampleCaseload`, delete only the 25 sample row ids (store `rowIds` in the `sample_data` record, the same way starter samples already do). Delete the grid only if no other rows remain. Otherwise rename it to "My list", keep it, and say "We kept the N entries you added." At minimum, count non-sample rows first and change the confirmation to "This also deletes N entries you added." Route sample removal through soft delete so it can be undone.
- **Effort:** S–M

**F-13 · Sample entries from an example look exactly like real ones** · Severity: Medium · Type: usability
- **Where:** No per-row marker anywhere (`starterSampleRowIds` is never used in the renderer). Banner text at `SampleDataBanner.tsx:55`. Screenshot `07-grid-customers.png`.
- **What the user experiences:** The grid shows "Robert Dubois, 100 Maple Ave…" with nothing that marks it as made up. The banner says "Remove them before adding your own", so users think they must clear the samples before they can start, and so lose the examples while they're still learning. A user who edits a sample row into a real customer loses it on removal, because rows are deleted by id.
- **Why it matters:** Users can't tell made-up data from real data. That matters for reports and for trust.
- **Fix:** Return sample row ids with the grid load and show a small "Sample" pill on those rows and their profiles. Change the banner to "Entries marked Sample are made up. Add your own any time; remove the samples when you're done exploring." When a user edits a sample row, ask once whether to keep it as a real entry, and drop its id from the sample list if they say yes.
- **Effort:** M

**F-10 · "Just looking?" silently turns any workspace into a social-work caseload** · Severity: Medium · Type: logic / usability
- **Where:** `src/renderer/views/SetupView.tsx:112-122` (`HUMAN_SERVICES_VOCAB` plus `featuresForExistingInstall`, i.e. nearly every feature on). `src/main/sample-data.ts:14` hard-codes "Sample Caseload (not real clients)". Screenshot `01-setup-start.png`.
- **What the user experiences:** A landlord or a tree-service owner clicks "Try it with sample data" and gets 25 social-work clients, "caseload" words and every feature turned on. After they remove the sample, those words and features stay. Picking a real example later from the sidebar uses "add" mode, where the words and features boxes start unticked (`ApplyStarterDialog.tsx:48-49`), so the social-work setup sticks.
- **Why it matters:** A non-social-worker gets a cluttered, mislabeled workspace and doesn't know why.
- **Fix:** Make "Just looking?" open the example gallery with "Add sample data" ticked, so every starter becomes a demo. Or label it honestly ("Try a sample social-work caseload") and set the words on the sample list only, not the workspace. When the last sample list is removed and no other lists exist, offer setup again (see F-09).
- **Effort:** M

**F-14 · Setup gallery adds empty lists by default, and the user can't see what a list looks like before choosing** · Severity: Medium · Type: usability
- **Where:** `ApplyStarterDialog.tsx:50` (`sample` defaults to `false`, even in `mode === 'setup'`). Card text at `:167-169`. Screenshots `02-setup-gallery.png`, `03-setup-review.png`.
- **What the user experiences:** A brand-new user picks "Tree service", sees "Customers · People · 8 columns", clicks Add, and lands on four empty grids and an "All clear!" dashboard. The deadline colors, board and reports, which are the reasons to use Pulse, are invisible until they type data in. Every one of the 51 cards shows the same "Includes sample data" badge, so it tells them nothing.
- **Why it matters:** The first impression is an empty spreadsheet. Removing samples is already one click, so starting with them is cheap.
- **Fix:** In setup mode, tick "Add sample data" by default and say "You can remove it in one click". Drop the badge when every starter has samples. On the review step, let each list expand to show its column names (preview data already has the list; add the names). Optionally show the `plans/website/screenshots/<starter>/01-list.png` thumbnail.
- **Effort:** S

**F-37 · Sample caseload text skips the vocabulary layer** · Severity: Low · Type: consistency
- **Where:** `src/main/sample-data.ts:14, 53-57, 113` ("Client Name", "Sample Caseload (not real clients)", "Client doing well…").
- **What the user experiences:** If the words are changed later, the sample list still says "clients" and "caseload".
- **Fix:** Build the names with `word()` at creation, or accept it as human-services content and only offer this sample under human-services words (see F-10).
- **Effort:** S

### Setup flow

**F-02 · Interrupting setup after the list is created skips the rest of setup for good** · Severity: Medium · Type: logic
- **Where:** `src/main/ipc/ipc-onboarding.ts:21-31` (no flag and any grid present means setup counts as complete) and `:119` (`ONBOARDING_SETUP_GRID` sets `onboarding_complete = 1` in the middle of the flow). `SetupView.tsx:126-135` (`GRID_CREATE` runs before the import). `GuidedBlankStart.tsx:122-175` (words and features are saved only at step 6). Ctrl+L (`useAutoLock.ts:80-89`) and the 30-minute auto-lock are both active during setup.
- **What the user experiences:** In the spreadsheet path, the user names the list and goes to find the file. Or in the blank path, they click "Create list" and then step away. If they press Ctrl+L, the app auto-locks, or they close the window, the next unlock goes straight into the app. They see an empty "My list" (or a list with no reminders), the words are still "records", and the "What are these rows?", "Which dates repeat?" and "quick questions" screens never come back.
- **Why it matters:** The setup questions are what make Pulse fit the user's work. Losing them silently produces a generic-looking app.
- **Fix:** Store a `setup_step` and a pending grid id in `app_meta` instead of inferring completion from "a grid exists". Set `onboarding_complete` only in `ONBOARDING_COMPLETE`. On unlock, if setup is unfinished, resume at the saved step. Save words and features as each guided step is answered, not only at the end.
- **Effort:** M

**F-15 · Problems while adding an example during setup are never shown** · Severity: Medium · Type: bug
- **Where:** `ApplyStarterDialog.tsx:108` (`if (mode === 'setup') { onApplied?.(r.data); return }`). The warnings list is shown only in the `done` step (`:284-288`), which setup never reaches.
- **What the user experiences:** If the sample data fails to load ("The lists were added, but the sample data couldn't be loaded"), or a column type or link isn't supported, the user just sees "Your workspace is ready" and then empty lists. Nothing tells them why the samples they asked for are missing.
- **Why it matters:** It is a silent partial failure on the very first action.
- **Fix:** Pass `result.warnings` to `SetupView` and list them on the "done" card, or toast them.
- **Effort:** S

**F-20 · "Skip" in the guided blank start throws away what the user already chose** · Severity: Medium · Type: usability
- **Where:** `GuidedBlankStart.tsx:211` (step 1 Skip clears the typed name), `:230` (step 2 Skip forces "People"), `:294` (step 4 Skip creates the list with only the first column, dropping the ticked Phone, Email and Status), `:326` (step 6 Skip ignores the ticked answers).
- **What the user experiences:** The user types "Tenants" and clicks Skip, and the name is gone. On "Pick the details", four boxes are already ticked; the user clicks "Skip" expecting the defaults and gets a one-column list.
- **Why it matters:** "Skip" reads as "use the suggestions", but it behaves like "throw everything away". The user notices only later, in the grid.
- **Fix:** Make Skip mean "continue with what's on screen". If a "bare minimum" option is still wanted, label it plainly ("Just the name column").
- **Effort:** S

**F-21 · Guided words don't follow a renamed list** · Severity: Low · Type: logic
- **Where:** `GuidedBlankStart.tsx:116-119` (`toWords` keeps any words already filled in).
- **What the user experiences:** The user names the list "Vehicles" and moves forward. Step 3 fills in "vehicle / vehicles". They go back and rename it "Tenants", and step 3 still says "vehicle".
- **Fix:** Track whether the words were typed or guessed. Re-guess only when they were guessed.
- **Effort:** S

**F-22 · "Which dates repeat?" starts every date on "No reminder" and the options are hard to read** · Severity: Medium · Type: usability
- **Where:** `src/renderer/views/setup/DateRepeatPicker.tsx:24-29`. Initial values at `GuidedBlankStart.tsx:140` and `SetupView.tsx:159`.
- **What the user experiences:** A column literally named "Due date" or "Last service" defaults to "No reminder". "It's the due date" and "Repeats: due again every…" are hard to tell apart for someone new. Most users click Finish and get no colors, and colors are the main point of Pulse.
- **Why it matters:** The best default is known from the column name, and leaving it empty undercuts the first-run payoff.
- **Fix:** Pre-select from the name: names with "due", "expires" or "deadline" become "It's the due date"; names with "last", "service" or "review" become "every 1 year"; birthdays stay "No reminder". Reword the options as "No reminder", "This is when it's due", and "It happened on this date; due again every…". Show a sample colored chip next to each choice.
- **Effort:** S

**F-23 · The spreadsheet path guesses "Clients", has no Back button, and doesn't pin the words to the list** · Severity: Low · Type: consistency
- **Where:** `SetupView.tsx:91` (`choice: 0`, which is "clients"), `:272-319` (no Back), `:152-154` (sets `record_kind` and the workspace words but not the list's own `vocab`). Compare `GuidedBlankStart.tsx:167-168`, which deliberately stores both.
- **What the user experiences:** A landlord who clicks Continue quickly gets "clients" everywhere. Later, applying an example with "use this example's words" renames the imported list's records too, which doesn't happen to a list made with the guided start.
- **Fix:** Guess the default from the list name with `wordsFromListName`, or start with nothing selected. Also store `vocab.record` on the list, as the guided path does.
- **Effort:** S

**F-24 · A first spreadsheet import silently leaves out the "Notes" column** · Severity: Medium · Type: usability (overlaps with the import area)
- **Where:** `src/renderer/components/grid/ImportWizard.tsx:341-349` (headers matching `notes|comments|remarks` are set to "skip").
- **What the user experiences:** A care coordinator brings in the spreadsheet they've kept for years. The "Notes" column, often the most valuable one, is set to "skip" on the mapping screen with no explanation. Unless they notice the dropdown, the notes don't come across.
- **Why it matters:** On the very first step, it feels like Pulse lost their data.
- **Fix:** Default such columns to "create", or offer "bring in as a note on each record". If one is skipped, show a line such as "We left out 'Notes'. Change this if you want it."
- **Effort:** S

**F-19 · The human-services example defaults to "OPWDD Caseload"** · Severity: Low · Type: wording
- **Where:** `src/shared/starters/human-services.json` (first variant). `ApplyStarterDialog.tsx:89` picks `variants[0]`.
- **What the user experiences:** A social worker outside New York sees a state acronym already selected.
- **Fix:** Put "Social Worker Caseload" first, or add an `isDefault` flag. Spell out the acronym in the variant name.
- **Effort:** S

### Example gallery

**F-16 · Gallery search is noisy and misses common words, with no way out when nothing matches** · Severity: Low · Type: usability
- **Where:** `ApplyStarterDialog.tsx:68-74` (substring match over name, description, list names and variant names; no keywords; group not searched). Empty result at `:155`.
- **What the user experiences:** "car" returns 11 examples, including "Caring for a parent" and "Childcare". "daycare", "plumber", "pet", "dog", "rental", "hospice", "medicaid", "teacher" and "dental" return nothing. In each case the result is "No examples match. Try another word." with no way forward.
- **Fix:** Add a `keywords` array to each starter JSON, match on word starts, and include the group name. On no results, show the buttons "Start blank" and "Bring in a spreadsheet".
- **Effort:** S–M

**F-17 · Keyboard focus in the gallery is in the wrong place** · Severity: Low · Type: accessibility
- **Where:** `ApplyStarterDialog.tsx:38` (`useFocusTrap` runs once and focuses the first button, which is Close). Steps change without moving focus.
- **What the user experiences:** The dialog opens with focus on ✕, so Enter closes it. After a card is picked, that card disappears and focus falls to the page body.
- **Fix:** Autofocus the search box. On each step change, move focus to the step's heading or first control.
- **Effort:** S

**F-18 · One stray click outside the gallery throws away the user's choices** · Severity: Low · Type: usability
- **Where:** `ApplyStarterDialog.tsx:130` (the backdrop's `onClick` closes the dialog).
- **What the user experiences:** A mis-click while scrolling the long gallery, or on the review step, closes the dialog. The chosen variant and list ticks are lost.
- **Fix:** In setup mode, don't close on a backdrop click; keep ✕ and Esc. On the review step, keep the state when the dialog is reopened.
- **Effort:** S

### First screens after setup

**F-08 · The empty list shows the wrong shortcut and has no buttons** · Severity: Medium · Type: bug / usability
- **Where:** `src/renderer/components/grid/DataGrid.tsx:780-789` says "press Ctrl+Shift+R". The real shortcut is Ctrl+N (`useGlobalKeyboard.ts:78`, `KeyboardShortcutsModal.tsx:56`). The kbd text is `text-xs` (12px). The tip about right-clicking a record shows while there are none.
- **What the user experiences:** A user who chose an example without samples sees "No customers yet… press Ctrl+Shift+R", and nothing happens when they do. There are no buttons; they have to find "Add Customer" in the toolbar.
- **Fix:** Say Ctrl+N. Add buttons for "Add {record}", "Bring in a spreadsheet" (opens the import wizard on this list) and "Add sample entries". Remove the right-click tip in this state.
- **Effort:** S

**F-09 · With no lists at all, the main screen is a dead end** · Severity: Medium · Type: usability
- **Where:** `src/renderer/views/GridView.tsx:94-110` ("No list selected. Select a list from the sidebar, or create a new one to get started"; no `action`, although `EmptyState` supports one).
- **What the user experiences:** This happens after "Just looking?" followed by "Remove sample data", or after deleting the only list. The user is told to pick from a sidebar that is empty, and setup never comes back.
- **Fix:** When `grids.length === 0`, show the three setup cards (example / spreadsheet / blank) here, reusing `StartCard` and `ApplyStarterDialog`. Change the title to "Let's set up your first {list}".
- **Effort:** S–M

**F-11 · An empty new workspace greets the user with "All clear! You're all caught up"** · Severity: Low · Type: wording / usability
- **Where:** `src/renderer/views/DashboardView.tsx:605-617, 679-684`.
- **What the user experiences:** On day one, with no data, the dashboard congratulates them. It doesn't explain that this page fills up from dates in their lists.
- **Fix:** When there are no records, or no date columns with a rule, show "Your dashboard fills up as you add {record:many} with dates" and a button to the first list.
- **Effort:** S

**F-12 · Nothing tells a new user what to do next** · Severity: Medium · Type: usability
- **Where:** `SetupView.tsx:334-349` (the done card offers only the tour). After that comes the grid with a toolbar of 11 buttons (`07-grid-customers.png`). The morning briefing is suppressed on setup day (`ipc-onboarding.ts:38`).
- **What the user experiences:** After setup there's no "first steps" guidance, such as "add your first customer", "put in a date and watch the color", "check where backups go", or "save your recovery key" (if skipped). Users either face a 24-step tour or are left on their own.
- **Fix:** For new workspaces, add a dismissible "Getting started" card on the dashboard, or a slim panel above the grid, with 4–5 checkable steps that tick themselves off as they happen: first record, first date with a reminder, first note, backup location confirmed, recovery key. Power users dismiss it once.
- **Effort:** M

### Guided tour and mini-tours

**F-03 · A tour step and a help answer point at a theme button that no longer exists** · Severity: Medium · Type: bug
- **Where:** `src/renderer/components/shared/TourOverlay.tsx:368` (target `[data-tour="theme-toggle"]`; no element in `src/renderer` has it). `src/renderer/views/help/faqData.tsx:57-62` ("Click the sun/moon icon in the top-right corner"; "Show me" runs the same step). Theme is now only in Settings → Appearance.
- **What the user experiences:** In the tour, the screen goes dark with nothing highlighted while a card talks about a sun/moon icon. The Help answer describes a button they can't find.
- **Fix:** Point the step and the FAQ at Settings → Appearance (add a `data-tour` there and give the step a `route`). Add a unit test that every `STEPS[].target` exists in some component.
- **Effort:** S

**F-04 · The tour ignores feature switches and opens screens the workspace has hidden** · Severity: Medium · Type: logic
- **Where:** `TourOverlay.tsx:319-365` (Tasks and Contacts steps have no `skipIf`; the route goes to `#/contacts` regardless). The sidebar hides these with `useFeature` (`Sidebar.tsx:283-284`). Contacts is off by default for blank workspaces (`src/shared/features.ts:39`) and off in tree-service.
- **What the user experiences:** A blank-start or tree-service user is taken to a "Contact directory" that appears nowhere in their sidebar, and is told about referrals and "Accepting / Waitlist / Full". Afterwards they can't find it again.
- **Fix:** Add `feature?: FeatureKey` to `TourStep` and filter with `featureNow()`. Do the same in `MiniTour` and for FAQ "Show me" buttons.
- **Effort:** S

**F-05 · The "quick tour" has 24–28 steps and leaves out Calendar, Reports and Board** · Severity: Medium · Type: usability
- **Where:** `TourOverlay.tsx:68-399` (28 main steps when the list has rows, 24 without). The done card calls it "a quick tour" (`SetupView.tsx:340`).
- **What the user experiences:** Most people quit by step 6. The steps cover undo, archived toggle, grouping, export, import and theme, but not the newer core screens (Calendar, Reports, Board/stages) that the 2.2.0 release is about.
- **Fix:** Make the first-run tour about 7 steps: lists, add a record, a deadline color, profile, dashboard, calendar or reports (whichever is turned on), Help. Move the rest to Help "Show me" mini-tours. Power users keep "Retake full tour" in Help.
- **Effort:** M

**F-06 · Tour text uses social-work examples and names a menu item that doesn't exist** · Severity: Low · Type: wording
- **Where:** `TourOverlay.tsx:134` ("Need to find someone fast?"), `:146` (says choose "Deadline Alert"; the menu item is "Alert Rule", `ColumnHeader.tsx:407`), `:190` ("summary report for your supervisor"), `:261` ("paperwork to file, referrals to make"), `:348` ("doctors, agencies, housing resources, legal aid"), `:360` ("Accepting, Waitlist, Full").
- **What the user experiences:** A tree-service or landlord user reads about referrals and supervisors. Everyone is told to look for a "Deadline Alert" item that isn't there.
- **Fix:** Use neutral examples or vocab tokens. Match the real menu label, and rename that label to plain words such as "Reminder colors" (the grid reviewer may own the rename).
- **Effort:** S

**F-07 · Tour controls: any click advances, and the card isn't a proper dialog** · Severity: Low · Type: accessibility / usability
- **Where:** `TourOverlay.tsx:660` (`onClick={next}` on the full-screen layer), `:686-691` (✕ has a `title` but no `aria-label`), no `role="dialog"` and no focus moved to the card. "Step N of M" appears twice (`:676`, `:722`).
- **What the user experiences:** Clicking the highlighted button to try it skips to the next step instead. Screen-reader users hear nothing when the tour starts.
- **Fix:** Make clicks outside the card do nothing (or dim only). Add `role="dialog"`, `aria-modal`, `aria-labelledby` and initial focus on "Next". Remove the duplicate counter.
- **Effort:** S

### Password, recovery and lock screen

**F-25 · "Create password & continue" is greyed out with no reason** · Severity: Medium · Type: usability
- **Where:** `src/renderer/views/PasswordSetupView.tsx:30, 306-312`.
- **What the user experiences:** The user types a good password twice and the button stays grey. Nothing says the terms checkbox (small 14px text further down) is the missing piece.
- **Fix:** Keep the button enabled. On submit, show what's missing inline ("Tick the box to agree to the Terms of Use"), focus that control, and give it a `role="alert"` message.
- **Effort:** S

**F-26 · Agreeing to the terms isn't recorded, and the restore path skips it** · Severity: Low · Type: logic
- **Where:** `PasswordSetupView.tsx:22, 275-304` (state only; nothing in `src/main` mentions terms). The restore path (`:158-178`) never shows the checkbox.
- **What the user experiences:** Nothing visible. If the terms ever matter, there's no record of acceptance, and restored installs never accepted them.
- **Fix:** Store `terms_accepted_at` and the version in electron-store on setup and on restore. Add the same checkbox to the restore form.
- **Effort:** S

**F-27 · Wrong password and lockout appear only as a toast that disappears** · Severity: Medium · Type: usability
- **Where:** `src/renderer/views/LockScreenView.tsx:69-74` (toast, then the field is cleared). Lockout text comes from `src/main/auth.ts:202-208`. The Unlock button stays enabled during a lockout. There's no Caps Lock warning.
- **What the user experiences:** A bottom-right toast says "Incorrect password", easy to miss on a big screen. After 5 tries, "Try again in 30 seconds" shows for 8 seconds; the user keeps clicking and gets the same toast with a new number. Caps Lock is the most common cause and nothing mentions it.
- **Fix:** Show an inline `role="alert"` message under the field. During a lockout, disable Unlock and show a live countdown (`getLoginLockoutRemaining` already exists; expose it over IPC). Show "Caps Lock is on" using `getModifierState('CapsLock')`.
- **Effort:** S–M

**F-28 · Lock screen inputs and buttons are hard to use with a keyboard or screen reader** · Severity: Medium · Type: accessibility
- **Where:** `LockScreenView.tsx:153-161` (password input with no label or `aria-label`), `:221-230` (recovery key input, same). `:204-209` and `:256-261` ("←" buttons with no accessible name). `tabIndex={-1}` on show-password at `:166`, `PasswordSetupView.tsx:220` and `ResetPasswordAfterRecoveryDialog.tsx:93`.
- **What the user experiences:** A screen reader announces "edit text" and "left arrow". Keyboard users can't reveal the password to check a typo.
- **Fix:** Add `aria-label="Password"` and `aria-label="Recovery key"`, `aria-label="Back"` on the arrows, and remove `tabIndex={-1}`.
- **Effort:** S

**F-29 · "Forgot password" without a recovery key suggests a fix that can't work** · Severity: Medium · Type: logic / wording
- **Where:** `LockScreenView.tsx:253-286` ("If you have a backup, you can restore from it and try again", with no button). The backup restore needs the password or recovery key used for that backup (`ipc-auth.ts:124-126`), and it is refused when credentials exist (`ipc-auth.ts:109-111`).
- **What the user experiences:** The user goes looking for a way to restore from the lock screen, and there isn't one. Even if there were, the backup would ask for the same password they forgot.
- **Fix:** Be honest and specific: "Without your password or recovery key, this data can't be opened, by anyone. If you remember an older password, a backup made while you used it can be restored." Show the restore button only in that case. Add "Try your password hint" if a hint exists.
- **Effort:** S

**F-30 · A wrong recovery key clears all 28 characters** · Severity: Low · Type: usability
- **Where:** `LockScreenView.tsx:95`.
- **What the user experiences:** A single typo in a 7-group key means retyping it all.
- **Fix:** Keep the text, select it, and say "That key didn't match. Check each group of 4."
- **Effort:** S

**F-31 · The new password after recovery says "At least 8 characters"; the rule is 12** · Severity: Low · Type: bug (wording)
- **Where:** `src/renderer/components/shared/ResetPasswordAfterRecoveryDialog.tsx:85` vs. `src/shared/passwordPolicy.ts:7`.
- **What the user experiences:** The user types 8–11 characters, and the strength meter says "Too short".
- **Fix:** Use `` `At least ${MIN_PASSWORD_LENGTH} characters` ``.
- **Effort:** S

**F-32 · A skipped recovery key is never offered again outside Settings** · Severity: Medium · Type: usability
- **Where:** `PasswordSetupView.tsx:134-150`. If the app is closed on the recovery step, the step is never shown again (the password already exists). The only places it shows up are `SecuritySection.tsx:222` and the security checkup, both inside Settings → Security.
- **What the user experiences:** An overwhelmed worker skips the key "for now" and is never reminded. The first time it matters is the day they forget the password, and then "a forgotten password means permanent data loss".
- **Fix:** Add a quiet, dismissible reminder ("Save a recovery key: 1 minute") to the getting-started card from F-12 and to the backup reminder. Snooze it for 7 days on dismiss; stop after the key exists.
- **Effort:** S

**F-33 · The background auto-lock can fire in the middle of password setup** · Severity: Low · Type: bug
- **Where:** `src/main/index.ts:104-108, 267-270` (the timer starts at launch and is reset only by renderer pings). `useAutoLock.ts:22` sends no pings until `isPasswordSetup` is true in the store, which happens only after the recovery-key step (`PasswordSetupView.tsx:32-35`). Ctrl+L is also live on these screens (`useAutoLock.ts:80-89`).
- **What the user experiences:** This is rare: the app was opened about 30 minutes earlier and the user finishes the password just before the timer fires. The database then locks while they're on the recovery-key step. "Generate Recovery Key" fails, the clipboard is cleared (`auth.ts:518`), and "Done" lands them in an app whose database is closed.
- **Fix:** Call `resetAutoLockTimer()` in `AUTH_SETUP_PASSWORD` and `AUTH_RESTORE_FROM_BACKUP`. Ping from `PasswordSetupView` while it's mounted. Ignore Ctrl+L while `!isPasswordSetup`.
- **Effort:** S

**F-36 · Some first-launch messages are technical or assume Windows** · Severity: Low · Type: wording
- **Where:** `src/main/auth.ts:121-126` ("OS-level credential encryption… keyring (gnome-keyring, kwallet)"). `LockScreenView.tsx:125` and `auth.ts:160` ("Windows account" on every OS). Cloud warning toast at `PasswordSetupView.tsx:51-55` (10 seconds, no next step).
- **Fix:** Use plain words and say what to do: "Your computer doesn't offer its own password vault, so Pulse's lock is a bit weaker. Your data is still encrypted." Say "computer account" instead of "Windows account". Turn the cloud warning into an inline card with a "How to move it" link to Help.
- **Effort:** S

### Small text and dialog semantics

**F-34 · First-run screens use 14px text in many places** · Severity: Low · Type: accessibility
- **Where:** `text-sm` is 14px (`src/renderer/styles/globals.css:25`). It's used for the terms label (`PasswordSetupView.tsx:282`), "Passwords do not match" (`:244`, `ResetPasswordAfterRecoveryDialog.tsx:117`), the password tip and strength text (`PasswordStrength.tsx:17, 33`), the lock-screen hint (`LockScreenView.tsx:174`), the recovery warning (`RecoveryKeyDisplayModal.tsx:102`), "Step N of 6" (`GuidedBlankStart.tsx:194`), gallery group headings, badges and variant descriptions (`ApplyStarterDialog.tsx:158, 167, 188, 212, 243, 253, 258`), and tour subtitles and tips (`TourOverlay.tsx:676, 700, 711`).
- **Fix:** Switch these to `text-base` (15px). Most are one-word changes.
- **Effort:** S

**F-35 · The recovery-key screen isn't announced as a dialog and its checkbox is small** · Severity: Low · Type: accessibility
- **Where:** `src/renderer/components/shared/RecoveryKeyDisplayModal.tsx:86-87` (no `role="dialog"` or label), `:133` (16px checkbox).
- **Fix:** Add `role="dialog" aria-modal="true" aria-labelledby` and make the checkbox `w-5 h-5`. Consider asking the user to type the last 4 characters instead of ticking "I have saved this".
- **Effort:** S

## Things that work well (keep these)

- **Password policy and feedback.** One shared rule set (`passwordPolicy.ts`) for the renderer and main, a live strength meter in plain words, and the "short sentence" tip.
- **Recovery key design.** The alphabet avoids look-alike characters, the input formats as the user types, there's a printable card, a forced new password after a recovery unlock, and lockout counts are shared across password and key.
- **Restore on a new computer** is offered on both the first screen and the "this computer can't read your sign-in data" screen, with numbered steps and an inline `role="alert"` error (`RestoreFromBackupForm.tsx`).
- **"N wrong attempts since you last unlocked"** warning after unlock (`LockScreenView.tsx:64-67`).
- **Setup choices are clear and few** (`01-setup-start.png`). The gallery's grouping, the variant question and the review step that lists rules, renames and "nothing you already have is changed" all respect the user (`03-setup-review.png`).
- **The guided blank start** is short, every step is optional, it picks column suggestions by kind, and it stores per-list words so later lists don't rename it.
- **Starter sample data** is tracked by row id, comes with a realistic year of history, and is removable in one click; the banner shows whenever sample rows exist.
- **No morning briefing on setup day** (`ipc-onboarding.ts:37-38`), so the first minutes aren't interrupted.
- **Interrupted spreadsheet imports are cleaned up**: cancelling the import deletes the just-created list (`SetupView.tsx:137-142`).
