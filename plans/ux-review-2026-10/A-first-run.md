# Slice A — first run (password → recovery key → setup → tour → first client → lock)

Reviewed 2026-10-14 at 1366×768 with `e2e/ux-review/A.spec.ts`, `A4.spec.ts`, `A5.spec.ts`
(screenshots in `ux-review-shots/A/`). Three fresh installs, one per setup path, plus two
follow-ups on the example path.

## Summary

- **Time to first client (example path, skipping the tour):** about 17 clicks and 4–5 minutes
  (password 60 s incl. a scroll to find the button · recovery key 45 s, or 15 s to skip · welcome
  + name 30 s · example gallery → layout → review → Add 60–90 s · ready screen 15 s · Add Client +
  type name 15 s). With the 7-step tour: ~24 clicks, 6–7 minutes. Blank path: ~25 clicks, ~6
  minutes. Spreadsheet path: ~22 clicks, ~5 minutes — but see UX-A-01. Linda makes the 5-minute
  cut only if she skips the tour and the recovery key.
- **Worst three:** (1) naming the spreadsheet list "My caseload" renames every client word to
  "caseload" ("Add Caseload", "4 caseload", "Search caseload…"); (2) the first grid shows no
  deadline colours at all — the two colour columns sit off-screen at laptop width, and the tour
  step called "Deadline colors" spotlights a colourless grid; (3) a fresh install opens in dark
  mode whatever the computer's setting, so a password screen with grey-on-navy text is Linda's
  first impression.
- **Works well:** the three-way "How do you want to start?" screen is plain and short; the
  empty-list state ("No clients yet" with three real buttons); Add Client drops a focused row and
  typing just works, with a green "Saved"; the sample-data banner and the "Keep this as a real
  entry?" prompt; the lock screen, hint, wrong-password text and the "Forgot password?" paths are
  honest and calm; the dashboard "Getting started" card ticks itself off.

## Findings

### UX-A-01 · Blocker · S
**Where:** Setup → Bring in a spreadsheet → "What are these rows?" (shot: ux-review-shots/A/48-sheet-rows.png, then 51-grid-after-import.png, 52-dashboard-after-import.png)
**What Linda sees / thinks:** She named the list "My caseload" (the natural name for her). The screen arrives with "Something else" already selected and "caseload / caseload" filled in. She reads "Pulse will use this word everywhere", sees her own word, clicks Continue. The list opens with "Add Caseload", "Search caseload…", "4 caseload · 7 columns", "Right-click a caseload for options", and the dashboard says "Add your first caseload", "Active caseload 4".
**Why it's a problem:** Every button and sentence in the app is now wrong, singular and plural are identical, and nothing told her the pre-filled guess was a guess. She has no idea this came from the list name or how to undo it (Settings → Workspace is named only in passing).
**Fix:** In `wordsFromListName` treat collective names as "what the list holds": add `caseload`, `caseloads`, `roster`, `panel`, `cases`→ client/clients, and return `record/records` (not the name itself) when the name has no plural form. In `guessRows`, never pre-select "Something else" from a bare guess — leave the radios unselected, show the guess as a suggestion chip ("Looks like clients?"), and refuse Continue when one and many are the same word. Source: `src/shared/listWords.ts:8-29`, `src/renderer/views/SetupView.tsx:58-64, 187-193`.
**Constraint check:** no schema change · touches src/shared/listWords.ts, src/renderer/views/SetupView.tsx

### UX-A-02 · Major · S
**Where:** First launch, every screen before Settings (shots: 01-password-empty.png, 41-welcome.png, 70-grid-blank-empty.png; log: `STORED THEME on fresh install: null`, `html.dark: true`)
**What Linda sees / thinks:** A navy screen with grey text, nothing like Excel or Outlook. "Did I install the wrong thing? Is something broken?"
**Why it's a problem:** `useSettingsStore` starts with `theme: 'dark'` (`src/renderer/stores/settingsStore.ts:53`) and `hydrateFromSettings` only overrides it when a theme is stored, so a new install is dark regardless of the computer's light/dark choice. The password and recovery screens have no Settings to fix it from. Dark also hides the chunky gridlines the UI rules ask for.
**Fix:** Default the store to `'system'` (Linda's Windows is light; a dark-mode user still gets dark), or `'light'`. Keep the current theme for existing installs (they have a stored value).
**Constraint check:** no schema change · touches src/renderer/stores/settingsStore.ts

### UX-A-03 · Major · M
**Where:** First grid after the Human services example (shots: 19-grid-after-tour.png, 18-tour-step-03.png; the colours only appear after scrolling: 81-grid-deadline-columns.png)
**What Linda sees / thinks:** Eight sample clients with Name, Date of Birth, Phone, Email, Address, Case Open Date. Every cell is white. The tour's step 3 ("Deadline colors — Never miss a due date again") highlights this white grid. "Where are the colours it keeps talking about?"
**Why it's a problem:** The starter puts Next Review and Annual Assessment at positions 6–7 of 11 (`src/shared/starters/human-services.json`), and at 1366 px only the first six columns fit. The one thing that makes Pulse better than her spreadsheet is off-screen on first sight, and the horizontal scrollbar is a thin bar at the very bottom.
**Fix:** In the human-services layouts (and the other starters with rule columns) place the rule-date columns right after Name (positions 1–2) so colours are on screen; make the tour's deadline step scroll its column into view and spotlight that column rather than the whole grid (`src/renderer/components/shared/tourSteps.tsx:134-143`). Consider a default Name width of 180 and Address hidden by default.
**Constraint check:** no schema change (starter JSON positions + a renderer scroll) · touches src/shared/starters/*.json, src/renderer/components/shared/tourSteps.tsx, TourOverlay.tsx

### UX-A-04 · Major · S
**Where:** Password setup, first screen at 1366×768 (shot: 01-password-empty.png vs 03-password-weak-submit.png)
**What Linda sees / thinks:** The card ends at the blue "Your data is encrypted…" box. There is no button in view. She fills both boxes and looks for "Next". Only a thin scrollbar on the right hints there is more.
**Why it's a problem:** The primary action and "Already use Pulse on another computer? Restore from a backup" are below the fold on the most common laptop size. Pressing Enter works, but Linda uses the mouse.
**Fix:** Make the card fit 768 px: drop the blue encryption box (its sentence is repeated on the next screen), put the hint helper text as the hint box's placeholder ("Shown on the lock screen — don't make it obvious"), and tighten `space-y-5`/`p-8`. Or move the Terms checkbox and button into a sticky card footer.
**Constraint check:** no schema change · touches src/renderer/views/PasswordSetupView.tsx:229-377

### UX-A-05 · Major · S
**Where:** Recovery key shown (shots: 11-recovery-key-shown.png, 11b-recovery-done-disabled-click.png)
**What Linda sees / thinks:** A bright blue "Done" button. She clicks it — nothing happens. No message. She clicks again. Eventually she notices the small checkbox above it.
**Why it's a problem:** `disabled={!saved}` with the ordinary `btn-primary` look: the button is full-strength blue while disabled (`src/renderer/components/shared/RecoveryKeyDisplayModal.tsx:137-145`). Silent disabled buttons are exactly the pattern the password screen already fixed (audit F-25).
**Fix:** Keep Done enabled; on click without the box ticked show "Tick 'I have saved this recovery key' first" under the button and focus the checkbox. Rename "Generate Recovery Key" on the previous screen to "Show my recovery key" ("Generate" is a programmer's word).
**Constraint check:** no schema change · touches RecoveryKeyDisplayModal.tsx, PasswordSetupView.tsx:172-179

### UX-A-06 · Major · M
**Where:** Example review ("Human services" → Next) (shots: 16-example-review.png, 16b-example-review-columns.png, 16c-example-review-bottom.png)
**What Linda sees / thinks:** "Use this example's words everywhere: records → clients, lists → caseloads, notes → case notes, activity logs → case logs, contacts → providers, priority levels → acuity levels, workers → case managers, requirements → contact requirements." Then "Turn on the features it uses: Priority levels, Contact directory, Requirements, Focus mode, Letters and documents, Summary report, Handoff packet." She doesn't know what a record, a requirement, a handoff packet or focus mode is. After she opens "Show its columns" the Add button drops below the fold.
**Why it's a problem:** Both lists are internal vocabulary; on first run both boxes are ticked anyway, so the lists are pure reading load with no decision in them, on the screen that stands between her and the app.
**Fix:** In `mode="setup"` collapse the words table and the feature list into one line each with a "Show details" disclosure ("Uses social-work words: clients, caseloads, case notes…"; "Turns on 7 features you can switch off later"). Make the dialog footer (Cancel / Add) sticky so Add is always visible.
**Constraint check:** no schema change · touches src/renderer/components/starters/ApplyStarterDialog.tsx:258-303

### UX-A-07 · Major · M
**Where:** Import wizard → Match columns, then the list (shots: 45-import-mapping.png, 51-grid-after-import.png, 52-dashboard-after-import.png)
**What Linda sees / thinks:** Her sheet has First Name and Last Name. The wizard maps First Name → Name and makes Last Name a new column. Her list now shows "Alice", "Bob"; the dashboard says "Alice". The profile title is a first name.
**Why it's a problem:** Nearly every caseload spreadsheet splits names. There is a "flip names" option on the Options step, but no "combine First + Last into Name". She would have to fix 80 names by hand or live with first names everywhere.
**Fix:** When both a first-name-like and a last-name-like header are detected, offer on the Match columns step: "Combine 'First Name' + 'Last Name' into Name (Alice Johnson)" ticked by default, with Last Name still importable as its own column.
**Constraint check:** no schema change · touches src/renderer/components/grid/ImportMappingStep.tsx, ImportWizard.tsx (import composition happens in main's import.ts — a renderer-side merged mapping would avoid an IPC change)

### UX-A-08 · Major · S
**Where:** Setup → spreadsheet → "Which of these dates repeat?" (shots: 49-after-rows.png, 49b-dates-select-focused.png)
**What Linda sees / thinks:** "Last Contact — It happened on this date; due again every… [1] [years]" and "Annual Review — … every 1 years". Under each: "Due soon — Turns yellow, then red as 1 year after the date comes near."
**Why it's a problem:** `suggestRepeat` sends anything matching `last|service|review|inspect` to yearly (`src/renderer/views/setup/DateRepeatPicker.tsx:14`), so a monthly contact column silently gets a one-year rule; she will see no colour for eleven months and conclude the reminders don't work. The select's label is cut off mid-sentence, and the explanation sentence doesn't parse.
**Fix:** Suggest `every 1 month` for `contact|visit|call|check-in|touch`, `every 1 year` for `annual|yearly|review|assessment`; shorten the options to "Repeats every…", "Is a due date", "No reminder"; reword the chip line to "Turns yellow 14 days before it's next due (1 year after this date), red on the day."
**Constraint check:** no schema change · touches src/renderer/views/setup/DateRepeatPicker.tsx

### UX-A-09 · Major · S
**Where:** Grid, blue tip bar shown from the first list onwards (shots: 19-grid-after-tour.png, 71-grid-blank-after-add.png; source: src/renderer/components/grid/GridNotices.tsx:14)
**What Linda sees / thinks:** "Tip: Click column headers to sort · Right-click column headers for deadline rules, tracking & more · Right-click a client for options · Press Shift+? for all shortcuts."
**Why it's a problem:** Three of the four tips are right-click or a keyboard chord — things the persona never does — and it is the only on-screen help about deadline rules. It also takes a row from the list on top of the sample banner.
**Fix:** Mouse-first wording: "Tip: the ⋯ on a column header sets its deadline rule · the person icon at the left opens a client's page · click a column name to sort." Drop the shortcuts clause (Help has it). One line.
**Constraint check:** no schema change · touches src/renderer/components/grid/GridNotices.tsx

### UX-A-10 · Major · S
**Where:** Tour, step 3 "Deadline colors" and step 4 "Client profiles" (shots: 18-tour-step-03.png, 18-tour-step-04.png, 18-tour-step-05.png)
**What Linda sees / thinks:** Step 3: "Open the menu (⋯) on a date column's header and pick a rule under 'Deadline rule'" over a grid with no colours (see UX-A-03). Step 4 ends "Let's take a look at what's inside a profile." Next is the Dashboard — the profile never opens.
**Why it's a problem:** The seven-step first-run tour (`FIRST_RUN_TOUR`, tourSteps.tsx:49) leaves out the profile steps, but step 4's text was written for the full tour. A broken promise on step 4 of 7 makes her stop trusting the tour. Step 1's card also sits on top of the sidebar it describes (18-tour-step-01.png).
**Fix:** Step 4: end with "Click it any time to see everything about one client." Step 3: "Dates with a reminder change colour as they come due — green, yellow, orange, red. The sample list has two such columns; scroll right to see them" and scroll them into view. Position step 1's card to the right of the sidebar (`position: 'right'` is set but the card lands at x=235 over the panel; check `computeTooltipPosition` for the sidebar width).
**Constraint check:** no schema change · touches src/renderer/components/shared/tourSteps.tsx:134-143, 224-235, tourPosition.ts

### UX-A-11 · Major · S
**Where:** Grid, what a coloured cell means (shots: 82-deadline-cell-hover-row1.png, 85-deadline-cell-selected.png, 89-dashboard-deadline-colors.png, 94/95)
**What Linda sees / thinks:** Red and yellow cells with a small shape in front of the date. She hovers: nothing for a second (the `title` tooltip is the browser's, slow and plain). She clicks: the cell is selected, no explanation. The only legend is on the Dashboard behind a grey "ⓘ Deadline Colors" toggle, collapsed, below the fold, and its first sentence is about "the stripe on the left of each row".
**Why it's a problem:** "Understand what the colours mean without help" fails on the grid. The words exist (`alertSpoken` sr-only, `alertTooltip` as `title`, SortableRow.tsx:331, 453) but a mouse user never sees them.
**Fix:** A "Colours" button in the grid status bar (next to "8 clients · 11 columns") that opens the same rule colour key the dashboard has; show the dashboard legend expanded until she has dismissed it once; replace the native `title` with the app Tooltip so it appears on hover like the toolbar's.
**Constraint check:** no schema change · touches src/renderer/components/grid/GridStatusBar (or DataGrid.tsx footer), SortableRow.tsx, views/DashboardView.tsx:455-481

### UX-A-12 · Major · S
**Where:** Settings → Security checkup, where the Getting-started card sends her to "Save a recovery key" (shot: 78-settings-security.png)
**What Linda sees / thinks:** "Security checkup: 2 of 4 — ⚠ Recovery key created — Without one, a forgotten password means losing your data. Create it below and store it somewhere safe."
**Why it's a problem:** The line reads as done ("created") with a warning icon; she has to read the sub-sentence to learn it isn't. The recovery-key control itself is further down the page (not in the shot) so "below" is a scroll away.
**Fix:** Label the undone state "No recovery key yet" and make the line itself a link that scrolls to the control; keep "Recovery key created" for the done state only.
**Constraint check:** no schema change · touches src/renderer/components/settings/SecurityCheckup.tsx:48

### UX-A-13 · Minor · S
**Where:** Password setup, weak password submitted (shot: 03-password-weak-submit.png)
**What Linda sees / thinks:** Red text under the meter: "Too short — Use at least 12 characters. A short sentence is easy to remember." and again above the button: "Use at least 12 characters. A short sentence is easy to remember."
**Why it's a problem:** The same message twice looks like two problems.
**Fix:** On submit, keep only the message under the box and move focus there; the `missing` line above the button should carry only what the meter can't (mismatch, terms).
**Constraint check:** no schema change · touches src/renderer/views/PasswordSetupView.tsx:66-72, 355

### UX-A-14 · Minor · S
**Where:** Password setup, hint field (shot: 01-password-empty.png)
**What Linda sees / thinks:** Placeholder "e.g. My cat's name" above "don't make it too obvious".
**Why it's a problem:** The example is exactly the obvious hint the helper text warns against.
**Fix:** Placeholder "e.g. the usual one, with the year" or "Something only you understand".
**Constraint check:** no schema change · touches PasswordSetupView.tsx:306

### UX-A-15 · Minor · S
**Where:** Password setup, Terms line and helper texts (PasswordSetupView.tsx:309, 317, 331)
**What Linda sees / thinks:** The "I agree to the Terms of Use and Privacy Policy" line, the hint helper and the encryption notice are 14 px (`text-sm`).
**Why it's a problem:** The UI rule is 15 px minimum; this is the first screen and the smallest text in the app is the legal line.
**Fix:** `text-base` on all three.
**Constraint check:** no schema change · touches PasswordSetupView.tsx

### UX-A-16 · Minor · S
**Where:** Recovery key prompt (shot: 10-recovery-prompt.png) and the skip confirm (40-recovery-skip-confirm.png)
**What Linda sees / thinks:** "Set up a recovery key?" — "Generate Recovery Key" — "I understand the risk — skip recovery key". Then "Skip recovery key? … Are you sure you want to skip?" with a red "Skip without a recovery key".
**Why it's a problem:** Mostly good. But nothing says how long it takes or what she'll have to do (write down 28 characters), so a hurried user skips; the dashboard later says "(1 minute)", which belongs here.
**Fix:** Subtitle "Takes a minute: we show you a 28-character key to print or write down." Button "Show my recovery key".
**Constraint check:** no schema change · touches PasswordSetupView.tsx:156-187

### UX-A-17 · Minor · S
**Where:** "How do you want to start?" (shot: 13-how-to-start.png) and "Try it with sample data" (62-try-sample-gallery.png)
**What Linda sees / thinks:** "Just looking? Try it with sample data" opens the identical "Start from an example" gallery. "Didn't I just click the other button?"
**Why it's a problem:** Two entries, one screen, no visible difference (the only difference is a pre-ticked box three screens later).
**Fix:** Either drop the "Just looking?" line (the example path already adds samples by default) or make it skip the gallery: apply "Human services → Social Worker Caseload" with samples in one click and say so ("We'll add a made-up caseload you can delete in one click").
**Constraint check:** no schema change · touches SetupView.tsx:293-299

### UX-A-18 · Minor · S
**Where:** Ready screen (shots: 17-ready.png, 69-ready-blank.png)
**What Linda sees / thinks:** "Your workspace is ready" — then a boxed checkbox "Check for new versions when Pulse opens. This reads a version number from GitHub and sends nothing about you or your data…" — then "Would you like a quick tour?"
**Why it's a problem:** The update choice is the first thing under the headline and mentions GitHub before she has seen the app; "workspace" is a word she hasn't met.
**Fix:** Headline "You're all set"; move the update checkbox under the two buttons as the small print it is (same words); keep it ticked.
**Constraint check:** no schema change · touches SetupView.tsx:395-421, setup/UpdateCheckChoice.tsx

### UX-A-19 · Minor · S
**Where:** Blank path, step 3 with no name typed (shot: 65-blank-step3-no-name.png)
**What Linda sees / thinks:** She clicked Continue past "What's your first list called?" without typing (the chips look like examples, not buttons). Step 3 offers "record / records" — "Add a record".
**Why it's a problem:** She chose People one step earlier, so the app knows more than "record". And she doesn't know "record" means a person.
**Fix:** When no name is typed, derive the words from the kind: People → "person / people", Things → "item / items", Jobs → "job / jobs". Say on step 1 "Pick one or type your own" above the chips.
**Constraint check:** no schema change · touches src/renderer/views/setup/GuidedBlankStart.tsx:106, 226-238

### UX-A-20 · Minor · S
**Where:** Blank path, step 5 "Do any of these dates repeat…" (shot: 67-blank-step5-dates.png)
**What Linda sees / thinks:** Only Continue; no Back.
**Why it's a problem:** Every other step has Back. The list already exists at this point (that's why), but she doesn't know that; it feels like a trap.
**Fix:** A Back that returns to step 4 in a "list created — change columns from the list itself later" state, or a one-line note "Your list is made; you can add more columns from the list."
**Constraint check:** no schema change · touches GuidedBlankStart.tsx:334

### UX-A-21 · Minor · S
**Where:** Spreadsheet path, "What are these rows?" wording (shot: 48-sheet-rows.png)
**What Linda sees / thinks:** "What are these rows?" — "rows" is spreadsheet-speak she does know, but "Pulse by BaringaSoft will use this word everywhere" doesn't say where, and "Are they… People / Things / Jobs or tasks" only appears after "Something else".
**Why it's a problem:** Mild; combined with UX-A-01 it's the screen most likely to go wrong.
**Fix:** "Each line of your spreadsheet is one…" with the nine choices; sub-line "Pulse says 'Add client', '3 clients due this week' — you can change the word in Settings."
**Constraint check:** no schema change · touches SetupView.tsx:334-335

### UX-A-22 · Minor · S
**Where:** Import wizard, Preview and Options steps (shots: 44-import-preview.png, 46-import-options.png)
**What Linda sees / thinks:** "Header row: Row 1 ✓ Confident" with two unlabeled ⌃⌄ buttons; "Duplicate detection — None — import all rows"; "Clean data before import — Trims extra spaces, normalizes dates and phone numbers".
**Why it's a problem:** "Confident", "detection", "normalizes" are developer words; the chevrons have no label (they move the header row).
**Fix:** "Column names are on row 1 (looks right)"; chevrons labelled "Use the row above / below as column names"; "Skip rows that are already in the list"; "Tidy the data (extra spaces, date and phone formats)".
**Constraint check:** no schema change · touches ImportPreviewStep.tsx, ImportOptionsStep.tsx

### UX-A-23 · Minor · S
**Where:** Grid, star column (shots: 24-grid-cell-hover-3.png vs 23-grid-name-entered.png)
**What Linda sees / thinks:** An empty column between the person icon and Name; a star appears only when the mouse is over the row.
**Why it's a problem:** Hover-only discovery; she won't know what the blank column is for, and "Starred" in the toolbar doesn't connect to it.
**Fix:** Show a faint outline star on every row (as the first row shows on hover) or a header tooltip "Star a client to pin them to the top".
**Constraint check:** no schema change · touches src/renderer/components/grid/SortableRow.tsx:213-240

### UX-A-24 · Minor · M
**Where:** Grid, scrolled right with the Name column frozen (shots: 81-grid-deadline-columns.png, 93-next-review-widened.png)
**What Linda sees / thinks:** After dragging the scrollbar, the column after Name shows coloured cells with no date and a header with three icons and no name — the frozen Name column covers its left half.
**Why it's a problem:** A coloured cell with nothing in it looks broken; she can't tell which column it is. (The column is fine — 250 px, "10/14/2026", per the A5 log — only hidden.)
**Fix:** Snap horizontal scrolling to column edges, or draw a shadow on the frozen column's right edge so the overlap reads as "behind", and let the hidden column's header name stay visible (sticky inside the cell).
**Constraint check:** no schema change · touches src/renderer/components/grid/DataGrid.tsx (scroll container), GridHeaderRow.tsx

### UX-A-25 · Minor · S
**Where:** After relaunch and unlock without a recovery key (shot: 77-after-relaunch-unlock.png)
**What Linda sees / thinks:** Bottom-right toast for 10 s: "Save a recovery key (1 minute): without it, a forgotten password means losing your data. Settings → Security → Recovery key."
**Why it's a problem:** It names a path instead of offering a button; it disappears while she is reading the list; once snoozed it is gone for a week.
**Fix:** Toast with an action button "Save it now" (navigate to Settings → Security, scroll to the control) and "Later"; leave the Getting-started card as the persistent reminder (it already is).
**Constraint check:** no schema change · touches src/renderer/hooks/useBackupReminder.ts:75-81

### UX-A-26 · Minor · S
**Where:** Dashboard "Getting started" after the spreadsheet import (shot: 52-dashboard-after-import.png)
**What Linda sees / thinks:** "Put in a date that has a reminder, and watch its color" is already ticked — but her list shows no colour anywhere (51-grid-after-import.png), because the yearly rule (UX-A-08) doesn't colour dates due in 2027.
**Why it's a problem:** The card says she has done something she never saw happen; the step's teaching moment is lost.
**Fix:** Tick this step only when some row is actually in a coloured state (any tier), or reword to "See a date change colour" and link "Open your caseload" to the first coloured row.
**Constraint check:** no schema change · touches src/main/ipc/ipc-onboarding.ts (getting-started progress), views/dashboard/GettingStartedCard.tsx:49

### UX-A-27 · Minor · S
**Where:** Example gallery (shots: 14-example-gallery.png, 14b-example-gallery-bottom.png, 15-example-human-services-layouts.png)
**What Linda sees / thinks:** About 25 examples in a scrolling dialog (Human services first, then Housing case manager, Community health worker… down to Caring for a parent); then 11 "layouts" with acronyms (OPWDD, IEP) and "Social Worker Caseload — General social work caseload with standard deadline tracking" pre-selected.
**Why it's a problem:** Manageable because her group is first and a sensible layout is pre-selected, but the sheer length of both lists is the first "there are too many options" moment. "Layouts" is a new word.
**Fix:** In setup mode show only the first group expanded with "More examples (home, business…)" collapsed; call layouts "Which describes your work best?" (already the question) and label the first option "(most common)".
**Constraint check:** no schema change · touches ApplyStarterDialog.tsx:185-204, 208-226

### UX-A-28 · Minor · S
**Where:** Sidebar at 768 px (shots: 19-grid-after-tour.png, 88-profile-first-view.png)
**What Linda sees / thinks:** TOOLS ends with "Letters" cut in half behind Focus Mode / Settings / Help / Lock; a tiny scrollbar inside the sidebar.
**Why it's a problem:** Looks broken; she won't guess the tool list scrolls.
**Fix:** Collapse the TOOLS group to the four she needs on day one (Calendar, Tasks, Contacts, Templates) with "More tools" — or reduce the item height to fit nine at 768 px.
**Constraint check:** no schema change · touches src/renderer/components/layout/Sidebar.tsx

### UX-A-29 · Minor · S
**Where:** Lock after inactivity (observed via Ctrl+L and relaunch: 28-lock-screen.png, 31-after-unlock.png, 75-relaunch-lock.png)
**What Linda sees / thinks:** The lock screen says "Your data is locked", shows her hint, unlocks back to the page she was on. Good. But the auto-lock gives no warning: after 15 idle minutes the screen simply changes while she's reading a case file.
**Why it's a problem:** Mild surprise, nothing lost (edits flush). A one-line explanation on the lock screen would prevent "did it crash?"
**Fix:** When the lock came from the idle timer, show "Locked after 15 minutes without activity. Change this in Settings → Security." under the heading.
**Constraint check:** no schema change · touches src/renderer/views/LockScreenView.tsx (needs the lock reason from settingsStore.lock())

### UX-A-30 · Polish · S
**Where:** Welcome and Your name (shots: 41-welcome.png, 41-your-name.png)
**What Linda sees / thinks:** "Welcome to Pulse by BaringaSoft — Pulse by BaringaSoft keeps track of…" The product name appears twice in two lines; "Your name — Used on letters and reports you create. Everything here is optional."
**Why it's a problem:** None really; the name screen is the best screen in the flow. The double "by BaringaSoft" is noise.
**Fix:** Use the short name in the body sentence ("Pulse keeps track of…").
**Constraint check:** no schema change · touches SetupView.tsx:253-256

### UX-A-31 · Polish · S
**Where:** Recovery key copied toast lingers (shots: 13-how-to-start.png, 14-example-gallery.png, 15-example-human-services-layouts.png)
**What Linda sees / thinks:** "Recovery key copied to clipboard" is still in the corner three screens later.
**Why it's a problem:** Harmless, but it shouldn't follow her into setup.
**Fix:** Dismiss toasts when the setup view mounts, or shorten this one to 3 s.
**Constraint check:** no schema change · touches RecoveryKeyDisplayModal.tsx:26-29

### UX-A-32 · Polish · S
**Where:** Grid footer and dashboard tiles after the import (shots: 51, 52)
**What Linda sees / thinks:** "4 caseload · 7 columns", "Active caseload 4" — the count form of the record word.
**Why it's a problem:** Consequence of UX-A-01, listed so the count paths get checked when it's fixed.
**Fix:** Covered by UX-A-01; add a test that `many !== one` for guessed words.
**Constraint check:** no schema change · touches tests only

### UX-A-33 · Polish · S
**Where:** Import step 1 (shot: 43-import-step1.png)
**What Linda sees / thinks:** The dialog's close ✕ carries the only focus ring on the screen; the drop zone says "Drop a CSV or Excel file here, or click to browse".
**Why it's a problem:** Focus lands on "close" of a dialog she just asked for. "Browse" is Windows-speak she knows, fine.
**Fix:** Focus the drop zone (it is a button) on open.
**Constraint check:** no schema change · touches ImportWizard.tsx

### UX-A-34 · Polish · S
**Where:** "Remove sample data?" (shot: 90-remove-sample-dialog.png) and the result (92-grid-after-remove-samples.png)
**What Linda sees / thinks:** "8 made-up clients will move to the Trash. You can bring them back from there for 30 days." Then an empty list with the three-button empty state and a toast.
**Why it's a problem:** None — this is good. Listed as a "works well" reference for the other confirm dialogs (states what, how many, how to undo).
**Fix:** Keep.
**Constraint check:** —

## Discoverability (persona checklist)
| Task | Clicks from the grid | Would Linda find it? |
|-|-|-|
| Add a client | 1 (Add Client) | Yes |
| Edit a client's information | 2 (double-click a cell) | Yes — single click selects, double-click edits, as in Excel |
| Mark a deadline done | Dashboard → Done (2) | Yes, once she visits the Dashboard; not from the grid |
| Search for a client | 1 (search box) | Yes |
| Sort by deadline date | 1 (click header) | Yes, the tip bar says so |
| Filter overdue | 1 ("Overdue" toolbar button) | Yes |
| Export for a supervisor | Reports ▾ (2) | Probably ("Reports") |
| Back up her data | Getting started → Set up backups (2) | Yes via the card; otherwise Settings → Backup |
| Help | Sidebar Help (1) | Yes |
| Settings | Sidebar Settings (1) | Yes |
| What the colours mean | Dashboard → ⓘ Deadline Colors → scroll (3) | No (UX-A-11) |
| Set a deadline rule on her own date column | header ⋯ → Deadline rule (2) | Only if she reads the tip bar; "right-click" wording hides it (UX-A-09) |
