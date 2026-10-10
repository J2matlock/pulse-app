# Audit: navigation, information architecture, consistency and accessibility (prefix N)

Reviewer scope: the app as a whole. Sidebar, top bar, status bar, back/forward, command palette, shortcuts, Help, What's New, update banner, toasts, cross-screen consistency, wording, accessibility, and how many ideas a new user has to learn.

**About the evidence.** `test-results/ui-tour/current/` doesn't exist on disk, so I had **no light/dark screenshot pairs**. I judged dark mode from the code only, and I mark those points as such. I used `test-results/audit-tour/*.png` (tree service) and `plans/website/screenshots/human-services/*.png`. Two audit-tour files are mislabeled: `09-board-jobs.png` shows the Dashboard, and `17-profile-job.png` shows "Customer not found", which is very likely bug N-02 below and not a missed click.

---

## Top 5

1. **Fix the two navigation bugs that look like lost data.** Pressing Escape anywhere on a profile throws you back to the list, even when you only meant to close a dialog or cancel an edit, and it drops a half-typed note (N-01). Opening a recent record from another list says it "may have been archived or deleted" (N-02).
2. **Only show the "current list" where it applies.** The top bar, the status bar, a second sidebar highlight and several dashboard and palette actions all quietly use the last list you opened, even on Calendar, Reports, Settings and Help (N-03).
3. **Bring accessibility up to the app's own rules.** Give the built-in deadline colors their shapes or words, since today color is the only signal (N-04). Let people select and copy text again (N-05). Make 15px the real minimum (N-16). Add one global 3px focus ring (N-17).
4. **Make the sidebar and the words simpler.** Group the sidebar into "daily work", "your lists" and "setup". Merge Templates, Letters and Snippets into one library. Pick one name each for deadline rules, scratch notes, checklist items and lists (no "grid"). (N-10, N-11, N-12, N-13)
5. **Make every hint the app gives true and complete.** Two advertised shortcuts do nothing. The shortcut list leaves out Undo. The palette can't open a list or the Calendar. What's New can't be opened. The tour points at buttons that don't exist. Help sends people to different places for the same job. (N-07, N-08, N-09, N-20, N-21, N-22)

---

## Findings

### N-01 · **Pressing Escape on a profile leaves the profile, even while you're closing a dialog or typing a note** · Severity: High · Type: bug
- **Where:** `src/renderer/views/ProfileView.tsx:320-337`. A window-level keydown handler calls `goBack()` (→ `/grid`) on any Escape. Its only exceptions are the letter and print modals, and it doesn't check `isEditableElement` or `e.defaultPrevented`. These all handle Escape without stopping the event, so it bubbles up to that handler:
  - `components/profile/CaseLogEntry.tsx:241` (cancel editing a note)
  - `components/profile/CaseLog.tsx:222` (closing the snippet menu only calls `preventDefault`)
  - `components/profile/HandoffDialog.tsx:41` and `components/calendar/AppointmentDialog.tsx:80` (window listeners)
  - `components/shared/GlobalTaskDialog.tsx:101` (Ctrl+Shift+T from a profile)
  - `components/shared/KeyboardShortcutsModal.tsx:89` and `components/shared/CommandPalette.tsx:107`
- **What the user experiences:**
  - They're typing a note, press Escape to close the snippet pop-up, and land back on the list. The note they were typing is gone, because the draft lives in local state (`CaseLog.tsx:104`).
  - Closing the appointment dialog, the handoff dialog, the shortcuts panel or the command palette with Escape also closes the profile.
- **Why it matters:** Escape is the key people press to make something go away safely. Here it throws away work. People will feel the app "loses notes".
- **Fix:**
  - In the ProfileView handler, return early if `e.defaultPrevented`, if the focus is in an editable field, or if any `[aria-modal="true"]` is open.
  - Have the dialogs call `stopPropagation()`. ConfirmDialog already does this; use it as the model.
  - Longer term, give the app one shared Escape stack for overlays.
- **Effort:** S

### N-02 · **Recent records from another list open as "not found — it may have been archived or deleted"** · Severity: High · Type: bug
- **Where:**
  - `components/layout/TopBar.tsx:258-263` (the clock-icon "Recent" menu)
  - `components/shared/CommandPalette.tsx:148-151, 332-336` (palette "Recent records")
  - `views/FocusModeView.tsx:227-230` (deadline, follow-up and task items)
  - `components/contacts/ContactLinkedClients.tsx:92-94`

  All of these navigate to `/profile/:rowId` without `?gridId`. `ProfileView.tsx:213-222` only switches lists when that parameter is there, then looks for the row in the open list (`:239`) and shows the scary message (`:350-361`). Screenshot `audit-tour/17-profile-job.png` shows exactly this: "Customers › Unknown customer … Customer not found".
- **What the user experiences:** They open a client from "Recent" or from Focus Mode and are told the client may have been deleted. The client is fine.
- **Why it matters:** It looks like data loss. A worried user may go hunting through Trash or restore a backup.
- **Fix:** Every profile link should carry `gridId`, since `RecentProfile` already stores it. Better, have ProfileView look up the row's list itself (one IPC call by row id) and switch to it, so no caller can get this wrong. Change the fallback message to "We couldn't open this one. It may be in another list. [Open the list]".
- **Effort:** S

### N-03 · **A hidden "current list" leaks onto screens that cover every list** · Severity: High · Type: usability / logic
- **Where:**
  - `TopBar.tsx:115-122` shows `activeGrid.name` on every screen except a profile.
  - `StatusBar.tsx:20-26, 75-81` shows "Saved · 8 customers · Customers" everywhere.
  - `Sidebar.tsx:495` only turns off the list highlight on the Dashboard.
  - `DashboardView.tsx:47, 446-452`: "Print reminder letters" uses `activeGridId`, and the dialog (`BatchDocumentsDialog.tsx:99-101`) never names the list.
  - `CommandPalette.tsx:160-164, 187`: "Add New Customer" adds to the hidden list from any screen.
  - Screenshots `19-calendar.png`, `22-reports-home.png`, `24-tasks.png` and `41-help.png` show "Customers" in the top bar plus two highlighted sidebar items (Customers and the current page).
- **What the user experiences:**
  - On the Calendar the window is titled "Customers" and two sidebar items are lit, so it isn't clear where they are.
  - The Dashboard says "49 Active Records" while the status bar below says "8 customers".
  - "Print reminder letters" on the Dashboard prints only for whichever list they last opened, without saying which.
- **Why it matters:** The basic question "where am I, and what will this button act on?" gets the wrong answer.
- **Fix:**
  - The top bar shows the page name (Dashboard, Calendar, Reports, Settings…) and only shows the list name on a list or a profile.
  - Highlight a sidebar list only on `/grid` and `/profile`, and add `aria-current="page"` to it.
  - Hide the record count and list name in the status bar outside list views.
  - Dashboard "Print reminder letters" either asks which list (a picker that defaults to the last one) or covers every list.
  - The palette's "Add New …" says which list it adds to ("Add a customer to Customers").
- **Effort:** M

### N-04 · **Grid deadline colors are the only signal for the built-in rules** · Severity: High · Type: accessibility
- **Where:**
  - `components/grid/gridConstants.tsx:50-71`: `alertShapeForThreshold` adds shapes so that "color is never the sole indicator", but only for the class names `alert-red/orange/yellow/pulse`.
  - The built-in rules (`main/builtin-templates.ts:18-20`) and sample rules (`main/sample-data.ts:98-106`) store **hex colors** (`#facc15`, `#fb923c`, `#dc2626`, `#bbf7d0`). `resolveAlertColor` (`utils/alertColors.ts:30-35`) turns those into a background color only, so `SortableRow.tsx:259` gets no shape.
  - Screenshot `human-services/01-list.png`: only the overdue cells have ⚠. "Coming up", "Due soon", "Urgent" and "Due today" differ by tint alone, and "due today" (solid red) vs. "overdue" (pink with ⚠) is easy to misread.
- **What the user experiences:** A color-blind worker, or anyone on a washed-out projector, can't tell green "coming up" from orange "urgent". A screen reader hears only the date. The reason is only in a hover tooltip.
- **Why it matters:** Deadlines are the core of the app. This breaks the spec's own color-plus-shape rule for every workspace created from setup.
- **Fix:** Choose the shape by the threshold's position or label, not its class name. Something like: below 0 = overdue shape, 0 = due-today shape, the next one = urgent, and so on. Or store a `level` next to custom colors. Put the label ("Due soon") in the cell's `aria-label`.
- **Effort:** S

### N-05 · **People can't select or copy text anywhere except inside input boxes** · Severity: High · Type: usability
- **Where:** `styles/globals.css:131` sets `user-select: none` on `body`. Lines `:135-137` turn selection back on only for `input, textarea, [data-selectable]`, and **nothing in `src/renderer` uses `data-selectable`** (I checked with grep). Only the grid cells, checklist titles and task titles add `select-text`.
- **What the user experiences:** They can't highlight a saved case note to paste it into the agency's records system. They can't copy a sentence from Help, a number from a report, an address from the timeline, or the text of a toast. Case-log entries have no Copy button either.
- **Why it matters:** Copying notes into another system is a daily job for social workers. The workaround is to click "edit" on the note, which also risks changing it.
- **Fix:** Reverse the default. Allow selection everywhere and add `select-none` only to chrome: sidebar, toolbars, buttons, grid headers and drag handles. Also add "Copy" to each case-log entry's menu.
- **Effort:** S

### N-06 · **Deleting a list says "permanent" but isn't, and can't be undone or restored** · Severity: High · Type: logic / consistency
- **Where:**
  - `Sidebar.tsx:57-60`: "This will permanently delete … This cannot be undone." plus "type DELETE".
  - `main/ipc/ipc-grid.ts:173-183` only sets `grids.is_active = 0`, so it's a soft delete.
  - `views/TrashView.tsx:219-223` tells people to "first restore the list from Settings", but **Settings has no such feature** (no restore channel, no UI).
- **What the user experiences:**
  - Deleting a list removes it with no undo and no Trash entry.
  - Its records then show up in Trash as "cannot restore", and the help text sends people to a Settings screen that doesn't exist.
  - Meanwhile the "permanently deleted" client data is still in the database, which matters to privacy-minded users.
- **Why it matters:** Records go to Trash with Undo, lists vanish with an untrue warning, and the dead end is the worst part.
- **Fix:** Pick one of these:
  - **(a)** Treat lists like records. Show deleted lists in Trash with Restore and "Delete forever", and offer Undo in a toast. The typed "DELETE" step is then only needed for "Delete forever".
  - **(b)** Really delete the list, and fix the Trash message.

  (a) matches the rest of the app.
- **Effort:** M

### N-07 · **The app advertises shortcuts that don't work** · Severity: Medium · Type: bug / consistency
- **Where:**
  - "Ctrl+Shift+D" appears in the Dashboard tooltip (`Sidebar.tsx:436`) and in the palette (`CommandPalette.tsx:173`).
  - "Ctrl+Shift+R" appears in the empty grid's hint (`components/grid/DataGrid.tsx:785`).
  - Neither has a handler anywhere: `hooks/useGlobalKeyboard.ts:38-100` has none, and I grepped every `isMod`/`ctrlKey` use.
  - The palette shows "Ctrl+Shift+T" next to **"Go to Tasks"** (`CommandPalette.tsx:176`), but that key opens the new-task dialog (`useGlobalKeyboard.ts:50-53`).
  - "Add New Task" in the palette (`:166-169`) goes to `/tasks?action=new`, a different dialog from the Ctrl+Shift+T one.
- **What the user experiences:** They learn a shortcut from the app, try it, and nothing happens. Then they stop trusting the other hints.
- **Fix:** Either add Ctrl+Shift+D (Dashboard) and make the empty-grid hint say Ctrl+N (which works), or remove the labels. Put Ctrl+Shift+T on "Add New Task". Use one new-task dialog everywhere.
- **Effort:** S

### N-08 · **The shortcut list is incomplete and its wording is inconsistent** · Severity: Medium · Type: usability / wording
- **Where:** `components/shared/KeyboardShortcutsModal.tsx:23-73`. This list also feeds Settings → Shortcuts (`components/settings/ShortcutsSection.tsx`). Related: `TopBar.tsx:280-282` and `utils/keys.ts`.
- **What the user experiences:**
  - The list leaves out **Undo (Ctrl+Z) and Redo (Ctrl+Y)**, search (Ctrl+F), Focus Mode (Ctrl+Shift+F), Escape to go back from a profile, Alt+←/→ for the previous/next record, and Ctrl+Enter to save a note.
  - The top bar says "Press **Shift+?**", while Help, the panel and the sidebar tooltip say "?".
  - On a Mac every label says "Ctrl", but Cmd also works (`isMod`).
  - The "Press Shift+? for shortcuts" hint sits in the top bar permanently at 13px.
- **Fix:**
  - Build one shortcut list in `src/shared` and use it for the modal, Settings, Help and the palette labels, with a test that every listed key has a handler.
  - Show "⌘" on a Mac.
  - Say "Press ? for shortcuts", or drop the top-bar hint once the user has opened the panel once.
- **Effort:** S

### N-09 · **The command palette can't open lists or several main screens** · Severity: Medium · Type: usability
- **Where:** `CommandPalette.tsx:172-204`.
- **What the user experiences:**
  - Typing "Jobs", "calendar", "help" or "trash" finds nothing.
  - There are no commands for each list, for Calendar, Help, Trash, New list, Import, Export, Back up now or Settings tabs.
  - "Go to Grid" (`:174`) is jargon, and it's unclear which list it opens.
  - Help topics can't be searched from the palette.
- **Why it matters:** The palette is billed as "the fastest way to navigate Pulse" (`faqData.tsx` tips-palette), but it misses the most common move, switching lists.
- **Fix:** Generate a "Go to {list name}" command for each list (loadGrid then navigate). Add Calendar, Help, Trash and Letters, each hidden when its feature is off. Rename "Go to Grid" to "Go to {current list}". Add a "Help: …" group that searches FAQ questions.
- **Effort:** S

### N-10 · **The sidebar mixes daily work with setup and overflows a laptop screen** · Severity: Medium · Type: usability (IA)
- **Where:** `Sidebar.tsx:414-754`. Screenshots `05-dashboard-top.png` and `human-services/02-dashboard.png`.
- **What the user experiences:**
  - The groups are "Workspace" (Dashboard + lists), "Tools" (Calendar, Reports, Tasks, Contacts, Snippets, Templates, Letters) and "System" (Trash).
  - Daily screens (Calendar, Tasks) sit next to setup screens (Templates, Snippets, Letters).
  - Focus Mode, a way of working, sits at the bottom with Settings and Lock.
  - At 1366×768 with four lists, Letters and Trash have already scrolled out of view (Templates is cut in half). With one human-services caseload, Trash is still hidden.
  - "Workspace" here means something different from Settings → Workspace (words and features).
- **Fix:** Use three groups:
  - **My work:** Dashboard, Calendar, Tasks, Contacts, Focus mode.
  - **{Lists}:** the lists and +.
  - **Set up** (collapsible, closed by default after the first week): Templates & text (see N-11), Reports.

  Put Trash at the bottom next to Settings/Help/Lock, or under Settings → Data, with "Undo" toasts as the main way back. Rename the group label so it doesn't clash with Settings → Workspace. Power users keep everything through the palette and shortcuts.
- **Effort:** M

### N-11 · **"Templates", "Letters", "Snippets" and two kinds of `.pulse` file are spread over five places** · Severity: Medium · Type: consistency / IA
- **Where:**
  - Sidebar Templates (`views/TemplateManagerView.tsx`): **list templates** (`.pulse`, `:104, :144, :299`) plus **checklist templates**. This entry shows even when Checklists are switched off (`Sidebar.tsx:664-688` has no feature check).
  - Settings → Workspace has "Save my setup as a template…" and "Open a template file…" (`components/settings/WorkspaceSection.tsx:52-68`). That's **another `.pulse` file** holding the whole workspace (`main/ipc/ipc-starters.ts:118`).
  - Sidebar Letters holds letter templates.
  - Snippets appear both as a sidebar item and as a Settings tab (`SettingsView.tsx:118`).
  - Examples (starters) appear in setup, in New list and in Settings.
  - Screenshot `39-checklist-templates.png`.
- **What the user experiences:** "Template" means four different things. Sharing a setup works two ways with the same file extension and different results. Snippets have two homes.
- **Fix:**
  - Make one **"Templates & text"** page with tabs: Checklists · Letters & documents · Snippets.
  - Move list and workspace sharing into Settings → Workspace → "Share your setup", with one Save button and one Open button that detects whether the file is one list or a whole workspace.
  - Remove the Snippets tab from Settings.
  - Hide each tab when its feature is off.
- **Effort:** M

### N-12 · **The same thing has different names on different screens** · Severity: Medium · Type: wording
- **Where:**
  - **Deadline rules** go by "Alert Rule" in the column menu (`components/grid/ColumnHeader.tsx:408`), "Alerts / Deadline alert rules" in Settings (`SettingsView.tsx:115`) and "Deadline Alert" in Help (`faqData.tsx` dash-alert-rules). Help's grid-date-colors entry says "Alert Rule", and its dl-kinds entry and New list (`NewListDialog.tsx:155`) say "deadline rule". The rule list says "5 thresholds" (`28-settings-alerts.png`).
  - **Scratch pad:** the UI says "Scrap Notes" (`components/profile/ScratchPad.tsx:235`), but Help and the tour say "scratch pad" (`TourOverlay.tsx:246`, `faqData.tsx` profile-scratch-pad).
  - **Task:** on a profile, "+ Task" (`ProfileHeader.tsx:652`) and Checklist "+ Add Task" (`ChecklistToolbar.tsx:38`) add **checklist items**, not Tasks. The Tasks page has the same "Add Task / Group / Templates" buttons (`24-tasks.png`), so the two look identical but are separate.
  - **Letters:** the sidebar says "Letters", the feature is "Letters and documents", the dialog is "Print documents or labels", and the profile button is "Generate Letter".
  - **Timeline filter chips:** "Manual / System" (`15-profile-customer.png`) are jargon.
- **Fix:** Settle on one name each and update the UI, Help and the tour:
  - "deadline rule" (and "warning levels" in place of thresholds)
  - "Scratch notes"
  - "checklist step" for checklist items
  - "Letters & documents"
  - "Written by you / Automatic" for the chips

  Add a lint word-list check like the vocabulary rule.
- **Effort:** M

### N-13 · **"Grid" still appears on screen in about 20 places** · Severity: Medium · Type: wording
- **Where:**
  - Profile "‹ Grid", "Back to grid (Escape)" and "Return to grid" (`ProfileView.tsx:355-382`)
  - "Go to Grid" (`CommandPalette.tsx:174`)
  - "Save Current Grid as Template" and "No grids to export. Create a grid first." (`TemplateManagerView.tsx:129, 290-299`)
  - "Create New Grid" / "Apply to Grid" (`ImportPreviewModal.tsx:262`, `ApplyTemplateDialog.tsx:158`)
  - "Find in grid…" (`FindReplaceBar.tsx:195`)
  - "Unknown Grid" / "Current Grid" (`ProfilePrintLayout.tsx:45`, `ContactLinkedClients.tsx:67`)
  - "Grid Navigation / Grid Editing" (`KeyboardShortcutsModal.tsx:37, 47`)
  - Several Help answers
  - The TopBar fallback `'Grid'` (`TopBar.tsx:111`)
- **What the user experiences:** The sidebar says "Lists" (or "Caseloads"), but buttons talk about "the grid".
- **Fix:** Use the list's own name, or `t('list')`, everywhere. Extend the vocab eslint rule to flag "grid" in JSX strings.
- **Effort:** S

### N-14 · **"Back" always goes to the list, and page headers don't match** · Severity: Medium · Type: usability / consistency
- **Where:**
  - `ProfileView.tsx:298-300`: `goBack` always goes to `/grid`, no matter where you came from. The same goes for Escape and the "‹ Grid" button.
  - Breadcrumbs ("Home › Tasks/Settings/Contacts") point "Home" to `/grid` (`SettingsView.tsx:129`, `TasksView.tsx:438`, `ContactsView.tsx:188`), yet the Dashboard is the first sidebar item.
  - The profile shows both a breadcrumb in the top bar and its own "‹ Grid | 1 of 8 ›" bar (`15-profile-customer.png`).
  - Dashboard, Reports, Calendar, Templates and Help each have a different header style: icon or none, title size, breadcrumb or none, divider or none.
- **What the user experiences:** They open a client from the Dashboard's overdue list, press back, and land on the list instead of the Dashboard. "Home" means different things on different screens.
- **Fix:**
  - Make back mean `navigate(-1)`, falling back to the list when there's no history. Label the button "‹ Back".
  - Map mouse back/forward buttons and Alt+←/→ to history everywhere except the profile's prev/next. Or move prev/next to Alt+↑/↓.
  - Drop "Home" breadcrumbs, or point them at the Dashboard.
  - Use one `PageHeader` component (title + optional actions) on every top-level page.
- **Effort:** M

### N-15 · **The status bar says "Saved" when nothing was saved, and repeats counts** · Severity: Medium · Type: usability
- **Where:** `StatusBar.tsx:48-52` shows a green "Saved" whenever the open list has rows, on every screen. The grid also has its own footer ("8 customers · 9 columns") right above the status bar's "8 customers" (`07-grid-customers.png`).
- **What the user experiences:**
  - On Settings → Workspace, the Words table has its own "Save words" button while the status bar says "Saved" in green. People may leave without saving.
  - On a profile, "Saved" refers to grid edits, not the note they're typing.
- **Fix:** Show "Saved" for a few seconds after a real save (any store), then fade it out. Show nothing on screens that have explicit Save buttons. Remove the duplicate count from one of the two bars.
- **Effort:** S

### N-16 · **Text under 15px is everywhere** · Severity: Medium · Type: accessibility
- **Where:**
  - `styles/globals.css:23-26` makes `text-xs` = 13px and `text-sm` = 14px.
  - `text-xs` is used 79 times in 37 files, and `text-sm` 635 times in 166 files.
  - `text-[10px]` and `text-[11px]` appear in `AcuityBadge.tsx:71` and help demos.
  - Notable spots:
    - Settings → Appearance helper text, the screen where people change text size (`AppearanceSection.tsx:52-281`, 10 uses)
    - Settings nav descriptions (`SettingsView.tsx:156`)
    - Sidebar group labels and the Tasks badge (`Sidebar.tsx:417, 520, 598, 722`)
    - The top-bar shortcut hint (`TopBar.tsx:280`)
    - Palette shortcut labels
- **What the user experiences:** Secondary text (descriptions, dates, list names under records, timestamps) is 13–14px, often grey on grey. That's hard for older users on agency laptops.
- **Fix:** Set `--text-sm: 15px` and `--text-xs: 14px` (keep 14px for `kbd` only). Then go over the few tight layouts: toolbar chips, the calendar, and the grid header icons. That makes the rule true in one edit, and people who want more can still use Settings → Appearance zoom.
- **Effort:** M (mostly visual checking)

### N-17 · **There is no app-wide 3px focus ring; many controls use the thin browser default or none** · Severity: Medium · Type: accessibility
- **Where:**
  - `globals.css` has no base `:focus-visible` rule. There's one only for `.btn` and `.high-contrast`.
  - 25 controls set `focus:outline-hidden` with no ring. Examples:
    - the column-name button (`ColumnHeader.tsx:186, 214`)
    - group headers (`components/shared/GroupHeader.tsx:109-171`)
    - checklist drag handles (`ChecklistItem.tsx:294`)
    - the Acuity editor inputs (`AcuityConfigPanel.tsx:234-258`)
    - the condition color swatches (`CellConditionalFormatPanel.tsx:478`)
  - Many buttons have no focus styling at all, so they rely on Chromium's thin outline: Help FAQ rows and the tour card (`HelpView.tsx:113-117, 220-227`), and palette items (`CommandPalette.tsx:269-277`, which show only a light grey selected background).
- **Fix:** Add a base rule under `@layer base`: `:focus-visible { outline: 3px solid var(--ring-color); outline-offset: 2px; }`. Remove the 25 bare `outline-hidden` classes, or give each a ring. Give palette rows a visible 3px inset ring.
- **Effort:** S

### N-18 · **Faint text in both themes (judged from code; no dark screenshots)** · Severity: Low · Type: accessibility
- **Where:**
  - Timeline and case-log timestamps use `text-slate-400/70` (`CaseLogEntry.tsx:142`, `ActivityTimeline.tsx:173`). That's about 2:1 on white, and it's visible in `15-profile-customer.png`.
  - `text-slate-300` used for words (`LinkedProviders.tsx:298`).
  - Out-of-month calendar days use `text-slate-400` on `slate-50` (`CalendarView.tsx:260`).
  - `dark:text-slate-500` on slate-800 panels (about 3.4:1) in `Checklist.tsx:536-538, 1045, 1236` and `ChecklistItem.tsx:503`.
- **Fix:** Text should be no lighter than slate-500 in light mode and slate-400 in dark mode. Keep slate-300 for decorative dashes only. Re-run the ui-tour to produce the missing light/dark pairs and check contrast.
- **Effort:** S

### N-19 · **Several dialogs aren't announced as dialogs, and some keyboard paths are missing** · Severity: Medium · Type: accessibility
- **Where:**
  - These dialogs have a focus trap but no `role="dialog"` or `aria-modal`:
    - `views/tasks/TaskFormDialog.tsx`
    - `components/shared/GlobalTaskDialog.tsx`
    - `views/tasks/SnoozeDialog.tsx`
    - `components/shared/RecoveryKeyDisplayModal.tsx`
    - `components/profile/ChecklistAddDialog.tsx`
    - `views/letter-template/DeleteConfirmModal.tsx`
    - `views/letter-template/EditTemplateModal.tsx`
  - The Settings, Dashboard and ContactDetail `role="tablist"` elements don't support arrow keys.
  - Sidebar list buttons don't set `aria-current` (`Sidebar.tsx:176-193`).
  - List reordering is mouse-only: the handle has `tabIndex={-1}` (`:145-156`) and there's no KeyboardSensor.
- **Fix:** Add `role="dialog" aria-modal aria-labelledby` to each, ideally through one shared `<Modal>` wrapper. Add arrow-key handling to tablists, or drop the tab roles and use plain buttons with `aria-current`. Add `aria-current="page"` to the active list. Add "Move up / Move down" to the list ⋯ menu.
- **Effort:** M

### N-20 · **What's New can never be opened** · Severity: Medium · Type: bug
- **Where:** `App.tsx:294` renders `WhatsNewModal`, and `hooks/useModalManager.ts:23` holds its state, but nothing ever calls `setWhatsNewOpen(true)` (I checked with grep). The changelog in `components/shared/WhatsNewModal.tsx:20-45` is up to date (2.2.0) and nobody can see it.
- **What the user experiences:** After a manual update, nothing explains the new Reports home, examples or other changes.
- **Fix:** Show it once on first unlock after the version changes (store `last_seen_version`). Add "What's new" to Help and to Settings → About.
- **Effort:** S

### N-21 · **The guided tour is out of date** · Severity: Medium · Type: consistency
- **Where:** `components/shared/TourOverlay.tsx`.
  - It targets `[data-tour="theme-toggle"]` (`:369`) and `[data-tour="archived-toggle"]` (`:164`), and **neither exists** in the app.
  - The Tasks and Contacts steps (`:319-360`) have no `skipIf` for switched-off features, so a tree-service user is walked to a hidden Contacts page.
  - It doesn't mention Calendar, Reports, Board/Stages, Linked lists or Dashboard cards.
  - Help's Focus Mode answer (`faqData.tsx` tips-focus-mode) says it "hides the sidebar… so you can concentrate on your grid". Focus Mode is really a full-screen "what needs attention today" overlay (`FocusModeView.tsx:1-5`).
- **Fix:** Skip steps whose feature is off, and skip any step whose target is missing. Swap the dead steps for Calendar and Reports. Fix the Focus Mode text. Add a test that every tour `target` selector exists in the source.
- **Effort:** S

### N-22 · **Help isn't organized by task and contradicts itself** · Severity: Medium · Type: usability / wording
- **Where:** `views/help/types.ts` and `views/help/faqData.tsx`.
  - There are no categories for Calendar, Reports, Boards, Links, Forms or Files. Reports sit under "Import & Export", Calendar and appointments under "Dashboard & Deadlines", and Forms under "List grid".
  - "How do I set up deadline alerts" appears twice with different steps and names (grid-date-colors vs. dash-alert-rules).
  - Sharing a setup is described two ways (ie-pulse-file vs. gs-workspace-share).
  - The supervisor report says "Export → Summary report" while the app also has a Reports page.
  - No screen links to its own help. Help isn't in the palette. Screenshot `41-help.png` shows 11 category chips before the first question.
- **Fix:**
  - Regroup Help by job: "Set up my lists", "Track deadlines", "Write notes", "Schedule", "See reports", "Print & share", "Keep data safe".
  - Merge the duplicate entries.
  - Add a small "?" link in each page header that opens Help filtered to that page.
  - Let the palette search Help (N-09).
- **Effort:** M

### N-23 · **Tasks shows two "No tasks yet" messages, one above the other** · Severity: Low · Type: bug (polish)
- **Where:** `views/TasksView.tsx:505-524`. Two blocks with the same condition both render. Screenshot `24-tasks.png`.
- **Fix:** Delete the first block.
- **Effort:** S

### N-24 · **The sidebar's Tasks count only appears after visiting Tasks** · Severity: Low · Type: logic
- **Where:** `Sidebar.tsx:293-300` counts tasks only if `taskStore` is already loaded, and only `TasksView` loads it (`TasksView.tsx:110`).
- **What the user experiences:** At launch there's no badge. After opening Tasks once, a badge appears. It looks random.
- **Fix:** Load a cheap "due today" count at startup (the Dashboard already fetches `tasksDue`), or remove the badge.
- **Effort:** S

### N-25 · **The update banner talks about replacing PULSE.exe on every computer** · Severity: Low · Type: wording
- **Where:** `components/shared/UpdateBanner.tsx:25-27`.
- **Fix:** Word it per platform (`window.api.platform`): "Download the new version and open it; your data stays where it is." Keep the .exe detail for Windows portable builds only.
- **Effort:** S

### N-26 · **Too many overlapping places for "what's due" and "reports"** · Severity: Medium · Type: usability (mental model)
- **Where:**
  - **"What's due" appears in four places:**
    - Morning Briefing (`components/shared/MorningBriefing.tsx`)
    - the Dashboard Priority List, which has both an **Overdue tab and an Overdue sub-tab** (`human-services/02-dashboard.png`)
    - Focus Mode
    - the Calendar
  - **"Reports" appears in five places:**
    - the Reports page
    - "Summary report…" in the grid Export menu (`GridToolbar.tsx:535`)
    - Dashboard "Monthly summary" and "Print this week" (`DashboardView.tsx:434-441`)
    - the Handoff packet
    - Dashboard "Add to calendar" (an export, not the in-app Calendar)
- **What the user experiences:** A supervisor asks for "the monthly report", and the worker has to guess which of five buttons makes it. "Add to calendar" next to a Calendar page suggests it adds something inside Pulse.
- **Fix:**
  - Make the Reports page the one home for printouts, with a "Ready-made printouts" row: This week, Monthly summary, Summary report, Handoff packet.
  - Keep the Dashboard buttons as shortcuts into it.
  - Rename "Add to calendar" to "Send to Outlook/Google…".
  - Let Focus Mode be a button on the Dashboard ("Work through today one at a time") instead of a sidebar item.
- **Effort:** M

### N-27 · **New users meet too many ideas at once; feature switches are buried** · Severity: Medium · Type: usability (progressive disclosure)
- **Where:**
  - `src/shared/features.ts` has 20 switches, but Calendar, Reports and Templates are always on, and Snippets, Checklists and Tasks are on for a blank workspace.
  - The switches are below a 12-row Words table in Settings → Workspace (`26/27-settings-workspace*.png`).
  - The grid toolbar has 11 buttons and wraps at 1366px (`07-grid-customers.png`), including "Saved" vs. "Views" and a bare ☆.
- **What the user experiences:** By counting labels on screen, a first-day user faces about 25 ideas: list, record, column, deadline/alert rule, threshold, conditional format, view, saved filter, group, archive, trash, profile, scrap notes, activity log, timeline, checklist, checklist template, task, snippet, letter, list template, workspace template, example, report, summary report, focus mode, morning briefing.
- **Fix:**
  - Keep the first-run core to five ideas: **lists, records, columns, deadlines, notes.**
  - Turn Snippets off by default in a blank workspace, and offer it in context (FeatureOffer) the first time someone types repeated text.
  - Hide the Templates nav when Checklists and Letters are off.
  - Give **Features** its own Settings tab.
  - Merge "Saved" (filters) and "Views" into one "Views" menu.
  - Power users still turn everything on in Settings → Features and reach it all from the palette.
- **Effort:** M

### N-28 · **Some error toasts show raw system messages** · Severity: Low · Type: wording
- **Where:** About 54 places call `toast.error(res.error)` or similar. Examples:
  - `views/dashboard/completeDeadline.ts:73, 81`
  - `views/dashboard/extendDeadline.ts:10, 29`
  - `views/SetupView.tsx:175`
  - `components/shared/TrashFiles.tsx:27`

  Validation failures come back as "Invalid ID", "Row not found" or "Invalid request" (`main/ipc/*`). Transport errors come back as Electron's raw text (`utils/safeInvoke.ts:40`).
- **Fix:** Add a `friendlyError(res.error, fallback)` helper that passes through messages already written for people and maps everything else to the fallback ("We couldn't save that. Try again."). Lint for `toast.error(res.error)`.
- **Effort:** S

### N-29 · **The first visit to Calendar, Reports or Help blanks the whole window (suspected)** · Severity: Low · Type: polish
- **Where:** `App.tsx:26-28, 176`. These views are lazy-loaded, and the `<Suspense>` boundary wraps all `<Routes>`, sidebar and top bar included. The fallback is a full-screen "Loading…".
- **What the user experiences (suspected, not seen in screenshots):** The sidebar disappears for a moment the first time those pages open.
- **Fix:** Put a `<Suspense>` inside `MainLayout`, around `{children}` only, or load these views eagerly like the others.
- **Effort:** S

### N-30 · **Shortcut side effects** · Severity: Low · Type: usability
- **Where:**
  - On non-list screens, Ctrl+F is swallowed (`TopBar.tsx:65-75` calls `preventDefault` with no search box to focus), so nothing happens.
  - Ctrl+L locks immediately, even while typing a note (`hooks/useAutoLock.ts:76-86`), which drops unsaved note drafts.
  - Zoom shortcuts don't work while focus is in a text field (`useZoom.ts:16-17`).
- **Fix:**
  - On screens without search, let Ctrl+F open the palette.
  - Before locking, save or keep note drafts (or ask, "You have an unsaved note").
  - Allow zoom from anywhere.
- **Effort:** S

### N-31 · **When the sidebar is collapsed, every list looks the same** · Severity: Low · Type: usability
- **Where:** `Sidebar.tsx:189` uses the same `Grid3X3` icon for every list, with the name only in a tooltip.
- **Fix:** Show the list's initials, or its color label, in the collapsed icon.
- **Effort:** S

---

## Things that work well (don't break them)

- **The vocabulary layer is applied thoroughly.** A grep for hard-coded "client", "caseload", "provider" and "acuity" in JSX found only internal identifiers. The sidebar, palette, Help, shortcuts and status bar all use `t()` or `f()`.
- **Dialog button order is consistent:** Cancel on the left, the main action on the right (ListSettings, NewList, Batch documents, Handoff, Meter reading). `ConfirmDialog` handles Escape and Enter correctly and stops propagation; it's the model for N-01.
- **Sidebar and top-bar basics:** every item is at least 44px tall, has a 3px focus ring and labels for screen readers, there's a skip-to-content link, and undo/redo show what they'll undo. Undo history is one click away.
- **Feature switches hide things cleanly.** Help moves topics for switched-off features into "More features you can turn on" and gives each a "Turn on" button. That's a good model for N-27.
- **Profile links from the Dashboard, Calendar, Reports and Board carry `gridId`.** Only the four paths in N-02 miss it.
- **Reduced motion is respected**, including pulsing overdue cells (`globals.css:293-295`), and there's an app-level high-contrast mode.
- **The setup start screen** (`01-setup-start.png`) is a clear three-way choice with "Try it with sample data". The sample-data banner says plainly what's fake and how to remove it.
- **The Reports home page** (`22-reports-home.png`) explains in one sentence what a report is, which is the plain-language standard the rest of the app should match.
