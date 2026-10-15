# F — Wording (code-level audit)

Audited 2026-10-14 by reading source only (no app launch): every JSX text, button label,
`title=`/`aria-label=`/`placeholder=` in `src/renderer`, every `toast.error`/`setError`
literal, every `ConfirmDialog` usage, every `fail('…')` and `new …Error('…')` in `src/main`,
PDF text in `src/main/export-*.ts`, plus `faqData.tsx` and `tourSteps.tsx`.

## Summary

1. The vocabulary layer works: record/list/note/contact/priority words are almost never hard-coded in screens; the eslint rule holds. Leaks are confined to one sample-list name, a few table headers and comments.
2. The biggest wording problem is **help that describes an app that no longer exists**: 14 FAQ answers and 2 tour steps name buttons, tabs and toggles that were moved or renamed ("Archived" toggle, "{Priority}" toolbar button, "Completions" tab, "Conditional Format", "View History", "Export PDF", "Change Password", "Restore from Backup", "Add Level" …). Linda follows the help, can't find the thing, and decides the app is broken.
3. Second: **one concept, several names**. Cell colouring is "Color rules…", "highlight rules", "Conditional Format" (help), "formatting" (toasts) and "Highlight" in one flow; the toolbar has a "View" button next to a "Views" button; "Priority List" sits next to "{Priority}" (= acuity) and task "Priority"; "scratch notes"/"scratch pad"; "case log"/"timeline"/"entry"; PDFs are "Export PDF", "Export as PDF", "Print / PDF…", "Save as PDF…".
4. Third: **90 icon-only buttons** whose meaning lives in a tooltip Linda never sees (task row Snooze/Edit/Delete, checklist Delete, acuity Move up/down/Delete level/Change color, column drag handle, sidebar list "⋯", Previous/Next record, contact star/edit/delete).
5. Error voice is mixed across six templates ("Could not X — please try again", "We couldn't X", "Failed to X.", "X failed. Please try again.", "An unexpected error occurred…", "Something went wrong…"). 9 strings are "Something went wrong" with no cause; the main-process fallback swallows ~200 validation messages, a few of which carried the only useful fact (file size limit, text limit).
6. Capitalisation is split: ~60 Title Case labels ("Add Task", "Generate Letter", "New Template", "Row Striping") against a sentence-case majority; the same screen has "+ Add Task" and "Add task".
7. Confirm dialogs are mostly good (title as a question, verb on the button, undo stated). Exceptions: a second confirm component for letter templates ("Are you sure you want to delete…?" / "Deleting..."), an inline "Are you sure?" with an icon-only confirm, "Change Type", and seven ways of saying "can't be undone".
8. Empty states: the big screens (grid, Tasks, Snippets, Contacts, Templates, Letters, Trash) say what the thing is for and offer the first action; 17 smaller panels say only "No X yet." / "Nothing found." with no hint.
9. Jargon is rare in flows but dense in Settings → Data and Appearance ("Database location", "Database integrity", "Compact Now", "Run Integrity Check", "Reduced Motion", "Row Striping", "100% is default", "YYYY-MM-DD (ISO)") and in Contacts ("Custom Fields", "Field name" where the grid says "column").
10. 26 strings still use three dots "..." where the rest of the app uses "…"; "&" and "and" are mixed in headings ("Deadlines & reminders" vs "Bring in and send out").

Totals: 36 ConfirmDialog usages · 220 `toast.error` · 57 `setError` literals · 314 `fail()` · ~60 `new …Error()` · 146 placeholders · 90 icon-only buttons · 65 `toast.success`.

---

## (a) Proposed Pulse wording style guide (one page)

### Naming table (one name per concept, everywhere: screen, help, tour, PDF)
| Concept | Use | Don't use |
|-|-|-|
| The things tracked | `{record}` / `{list}` from the vocabulary layer | record, row, item, entry, grid, sheet |
| The main table screen | "the {list}" (the page), "the table" only when contrasting with "the board" | grid, sheet, view |
| A column | column | field (also in Contacts: "Extra details", not "Custom Fields") |
| A {record}'s own page | "{record}'s page" | profile, profile page, record page, detail page |
| Notes on a {record} | `{activity}` / `{activityLog}` | entry, timeline (use "{activityLog}" for the list, "history" for recorded changes) |
| Free-form notes box | scratch notes | scratch pad, scratchpad |
| Date colouring and dashboard items | deadline; the setting is a "deadline rule" | alert, alert rule, reminder (reminder = the morning desktop notification only) |
| Cell colouring by condition | highlight rule ("Highlight cells…", "Edit highlight rules…") | color rules, conditional format, formatting |
| Saved sort/filter/group set | saved view ("Saved views" button) | view, preset (filters are "saved filters") |
| The toolbar "View" menu | "Show" (Show archived, Show as board, Show the Tags column) | View |
| Hiding a {record} | archive / unarchive | hide, remove |
| Deleting to the Trash | "Move to the Trash" | delete, remove |
| Deleting for good | "Delete forever" | purge, permanently delete, remove for good (in messages: "removed for good" is fine) |
| Unsaved work | "Discard changes" | cancel changes, leave |
| Settings | Settings; a section is "Settings → Backup" | preferences, options, config, configuration |
| Reusable patterns | template (checklist template, letter template, {list} template, document template) | form (a form is for filling in), .pulse file (say "{list} template file") |
| Making a PDF | "Save as PDF…" everywhere; "Print…" only for the print dialog | Export PDF, Export as PDF, Print / PDF, Generate |
| Letters | "Make a letter…" | Generate Letter |
| Turning a feature on/off | turn on / turn off | enable / disable, toggle |
| Dashboard tabs | "What's due", "Overdue", "This week", "This month" | Priority List (collides with {priority} and task priority) |
| The sidebar | sidebar | navigation panel |
| Key sequence | "Ctrl+Z" in a `<kbd>`; "?" not "Shift+?" | |

### Capitalisation
Sentence case for everything: buttons, menu items, headings, tabs, dialog titles, placeholders ("Add task", "Save as template", "Letter templates", "Recovery key"). Capitals only for proper nouns (Pulse, Excel, PDF, CSV, Trash, Dashboard as a screen name) and vocabulary words at sentence start via `{ cap: true }`. Table headers also sentence case ("Days remaining").

### Buttons and menu items
- Start with a verb that names the outcome: "Add column", "Save as PDF…", "Move to the Trash". Nouns only for navigation targets ("Dashboard", "Trash").
- Trailing "…" (U+2026) on anything that opens a dialog or asks another question; never "...".
- An icon-only button is allowed only when (a) it sits in a repeated row and (b) the same action is also reachable with a text label nearby (row menu, right-click, or the item's page). It always has `aria-label`; the `title` is the same text (no "(Esc)" suffixes in aria-label).
- "More" menus are labelled by content: "Columns, import and export" or at least "More…" with a tooltip-free caption.

### Confirm-dialog template
```
Title:   <Verb> <the thing>?            e.g. Delete "Intake checklist" forever?
Message: <What happens, in one sentence.> <Whether it can be undone, exactly one of:>
         "You can undo this." | "It stays in the Trash for 30 days." | "This can't be undone."
Buttons: [Cancel]  [<same verb as title>]   never OK / Yes / Confirm / Continue
Typed variant: the phrase to type is the thing's own name; the message ends "Type its name to confirm."
```
One component (`ConfirmDialog`) for every confirmation; no inline "Are you sure?".

### Error-message template
```
<What didn't happen> — <what to do next>.
```
- "We couldn't save that {activity} — check the date and try again."
- Use "We couldn't…" everywhere (not "Could not", "Failed to", "X failed", "An unexpected error occurred", "Something went wrong").
- Always a next step: try again / check X / free up space / open Settings → Y. If the cause is unknown, say "Your other changes are safe. Try again; if it keeps happening, restart Pulse."
- Main-process messages that a person will read: write them for the person (friendlyError passes them through); developer checks that can only fail from code stay technical and are swallowed. Never let a user-fixable limit ("up to 10 MB", "up to 500,000 characters") be swallowed — include the limit in plain words.
- Success toasts: short, past tense, no exclamation mark, period only when there's a second sentence ("Saved." vs "Saved a copy. It isn't encrypted…"). Use "Password changed." not "updated successfully".

### Empty-state template
```
Heading:  No <things> yet                     (sentence case, no period)
Body:     One sentence: what <things> are for in this place.
Action:   A primary button with the first step ("Add your first <thing>", "Add a column").
```
Filter/search empties: "Nothing matches "<query>"" + a "Clear search/filters" button.

---

## (b) Findings

### UX-F-01 · Major · M
**Where:** Help Center FAQ (`src/renderer/views/help/faqData.tsx`) and tour (`src/renderer/components/shared/tourSteps.tsx`), cross-checked against the screens they describe.
**What Linda sees / thinks:** She reads "click the "Archived" toggle in the toolbar", looks at the toolbar, and there is no such toggle. She concludes the help is for a different program, or that her copy is broken.
**Why it's a problem:** 14 of the 15 answers I cross-checked that name a control name one that doesn't exist (moved, renamed, or removed). Help is Linda's only recovery path (she won't right-click or hover).

Stale answers (exact text → what the screen actually has):
| FAQ id (line) | Says | Screen has |
|-|-|-|
| `grid-archive` (162) | `clicking the "Archived" toggle in the toolbar` | "View" menu → "Show archived {record:many}" (`GridToolbar.tsx:237`) |
| `grid-acuity-enable` (237) | `Click the "{Priority}" button in the {list} toolbar (it has a gauge icon). In the panel that opens, flip the toggle to enable {priority} scoring.` | "View" menu → "Turn on {priority:many}…" (`GridToolbar.tsx:245`); no toggle |
| `grid-acuity-customize` (249) | `Click the "{Priority}" button in the toolbar to open the configuration panel … "+ Add Level"` | same menu item; button reads "Add Level" (`AcuityConfigPanel.tsx:135`) |
| `grid-acuity-total` (255) | `as a badge on the "{Priority}" toolbar button` | badge is inside the View menu item (`GridToolbar.tsx:246`) |
| `grid-conditional-format` (213) | `Right-click any cell and choose "Conditional Format"` | "Color rules…" / "Edit color rules…" (`GridContextMenu.tsx:225`) |
| `grid-cell-history` (219) | `click "View History."` | "View history" (`GridContextMenu.tsx:170`) — capitalisation only, but Linda matches words |
| `dash-overview` (332), tour `dashboard-tabs` (305) | `Priority List, This Week, This Month, Completions, and Recently Archived` | tabs are Priority List, Overdue, This Week, This Month (`DashboardView.tsx:383-386`); "Recently archived" is a link (`:511`); there is no Completions tab |
| `profile-letter` (310), `st-generate` (469) | `"Generate Letter" button in the profile header` | button exists (`ProfileHeader.tsx:709`) but "the template variables (like {{client_name}}…)" is the old placeholder set; `st-variables` (463) already says {{name}}/{{field:…}} |
| `ie-export-profile` (429) | `click the "Export PDF" button in the profile header` | More menu → "Print / PDF…" (`ProfileView.tsx:325`) |
| `sec-change-password` (498) | `click "Change Password."` | "Change…" (`SecuritySection.tsx`, next to "Password") — tour step `settings-change-password` (418) has it right |
| `sec-restore` (484) | `click "Restore from Backup." You'll see a list of available backups with dates.` | the list is "Auto-backups" / "Scheduled backups" with a restore per row (`BackupSection.tsx:328,378`); confirm title is "Restore from backup?" |
| `tasks-create` (356) | `click "Add Task" … and click "Add Task."` | first button is "+ Add Task" (`TasksView.tsx:542`), dialog button is "Add task" (`TaskFormDialog.tsx:282`) |
| `grid-trash-purge` (181) | `click the "Delete" button … click the "Empty Trash" button … type EMPTY` | per-row button title "Delete forever", header "Empty the Trash" (`TrashView.tsx:326`); EMPTY is right |
| `ie-pulse-file` (435) | `on the Templates page ("Save this {list} as a template" / "Import Template File")` | "Import Template File" is only the OS dialog title (`TemplateManagerView.tsx:104`); the button reads "Save as Template" (`:509`) |
| `contacts-import-export` (399) | `use the import/export button` | two separate controls: "Choose a vCard file to import" and "Export all {contacts}" (`ContactImportExport.tsx:236,420`); "email {record:many}" at the end is a vocab-token slip — it should be "email programs" |
| `grid-saved-views` (207) | `Click "Views" in the toolbar to save the current configuration` | button is "Views" (ok) but "configuration" is jargon |
| `gs-customize-columns` (22) | `right click a column header and select rename` | "Rename" exists (`ColumnHeader.tsx:371`); fine, but the FAQ's own `grid-add-remove-columns` says `select hide column` while the item is "Hide column" — keep quotes and exact labels |
| tour `right-click-rows` (147) | `Right-click for more options / Hidden power at your fingertips` | Linda never right-clicks; the step should say the same actions are on the {record}'s page under "More" |

**Fix:** Rewrite each answer to quote the exact current label (in quotes, same capitalisation), and add a source-scanning test that every quoted label in `faqData.tsx` / `tourSteps.tsx` occurs in `src/renderer` (same idea as `tests/shortcuts.test.ts`). Fix the two token slips (`contacts-import-export`: "email programs"; `profile-letter`: use the current placeholders). Change tour step `dashboard-tabs` to "Priority List, Overdue, This Week and This Month; "Recently archived" is a link below them".
**Constraint check:** no schema change · touches `faqData.tsx`, `tourSteps.tsx`, one new test.

### UX-F-02 · Major · M
**Where:** Across grid, profile, dashboard, help.
**What Linda sees / thinks:** The same thing has a different name on every screen, so she can't tell whether "Color rules", "highlight rules" and "formatting" are three features or one.
**Why it's a problem:** Reading every word, she builds a mental map from the words; four names for one thing means four things to learn.

| Concept | Names found | Where | Recommended |
|-|-|-|-|
| Cell colouring by condition | "Color rules…" / "Edit color rules…" · "Highlight rule 1", "No highlight rules yet", "Add a new highlight rule" · "Conditional Format" · "Formatting copied/pasted/applied", "Column highlight rules saved", "Could not apply formatting" · "Highlight" | `GridContextMenu.tsx:225` · `CellFormatRuleCard.tsx:120`, `CellConditionalFormatPanel.tsx:182,204` · `faqData.tsx:213` · `GridContextMenu.tsx:239,256,260`, `gridFormatSlice.ts:54,108` · `ContextMenuColorRules.tsx:198` | **highlight rule(s)** everywhere: "Highlight cells…", "Edit highlight rules…", "Highlight copied/pasted", FAQ "How do I colour cells by their value?" |
| The toolbar menu with archive/board/tags | "View" button + `aria-label="View (changed)"` | `GridToolbar.tsx:198,205` | **"Show"** (menu items already start "Show …") — see UX-F-03 |
| Saved sort/filter sets | "Views", "Saved Views" heading, "View name", "Delete view", "Could not save view" · filters: "presets", "Save this filter combination for quick reuse", "No saved presets yet" | `SavedViewsDropdown.tsx:70,130,229,180`, `gridFilterSlice.ts:205` · `FilterBar.tsx:135,351`, `FilterControls.tsx:318` | **saved view** / **saved filter**; "No saved filters yet" |
| Deadline colouring setting | "Deadline rule" (menu) · "Alert rule not found", `alertStore` "Could not save rule" · Settings tab "Deadlines & reminders" · tour "Deadline colors" · dashboard "Deadline Colors" / "Deadline Color Guide" | `ColumnHeader.tsx:458` · `ipc-alerts.ts:90`, `alertStore.ts:93` · `SettingsView.tsx:117` · `tourSteps.tsx:136` · `DashboardView.tsx:463,467` | **deadline rule**; the dashboard button "Show the color key" |
| Priority (three meanings) | Dashboard tab "Priority List" · feature/vocab `{priority}` = "acuity level"/"priority level" · Tasks sort "Priority", task priority Low/Normal/High/Urgent · checklist item "Urgent" | `DashboardView.tsx:383` · `features.ts:39`, `vocab.ts:39` · `TasksView.tsx:550`, `faqData.tsx:369` | Rename the tab **"What's due"**; keep "priority" for tasks only; the vocab default stays |
| Free-form notes | "Scratch notes" (19) · "scratch pad" (2, `WhatsNewModal.tsx:37`, TasksView comment) · ids "scratchpad" | | **scratch notes** |
| Notes list | `{activityLog}` ("Case log") · "Log changes in timeline" · "(shows in the timeline and audit trail)" · "Activity timeline" · "entry"/"entries" ("Made-up entries", "Keep this as a real entry?") | `ColumnSettingsDialog.tsx:56`, `ExtendDeadlineDialog.tsx:41`, `DemoActivityTimeline.tsx:26`, `ApplyStarterDialog.tsx:290`, `SampleDataBanner.tsx:61` | "Record changes in the {activityLog}"; "shows in the {activityLog} and the audit trail"; "sample {activity:many}", "Keep this as a real {activity}?" |
| A {record}'s page | "profile" (`GridHeaderRow.tsx:206` aria "Profile", `RecentlyArchivedTab.tsx:103` "View profile", tour "{Record} profiles", FAQ "profile icon") · "{record}'s page" (FAQ 277, 303) · "record page" (code comments) | | **"{record}'s page"** in text; the icon's aria-label "Open {record}'s page" |
| Making a PDF | "Export PDF" (ContactDetail tooltip) · "Export as PDF" (More menu) · "Print / PDF…" (profile More) · "Save as PDF…" (RecordLetterDialog:129) · "Print directory as PDF" (ContactsView:224) · "Generate Letter" | | **"Save as PDF…"**; letters: "Make a letter…" |
| Templates | sidebar "Templates" (checklist + {list} templates) · "Letters" (letter templates, "New Template") · ".pulse file" / "{list} template" · "document template" (batch docs) · Forms | `Sidebar.tsx:790,817`, `faqData.tsx:435` | Sidebar "Checklists & list templates" → better: "Templates" holds all three with tabs; or rename "Letters" to "Letter templates" |
| Contact's interaction list | "Log" tab · "Search interactions..." · FAQ "interaction log" | `ContactDetail.tsx:240`, `ContactInteractionLog.tsx:283` | **"Contact history"** (or `{activityLog}`) |
| Removing things | "Delete" (tasks, forms, rules, templates — permanent) · "Move to the Trash" (records, columns) · "Delete forever" · "Remove" (links, extension, follow-up, files, sample data) · "Discard" (changes/answers) · "Clear" (filters, history, selection) · "Erase"/"RESET EVERYTHING" | see UX-F-06 | Keep: Trash → "Move to the Trash"; permanent → "Delete … forever" only when something else is also deletable to Trash, else "Delete"; detachments → "Remove"; unsaved → "Discard" |
| Column vs field | "column" (grid) · "Custom Fields (max 10)", "Field name", "Add field", "Remove field", "Category Fields", "Date range field", "Fields on the form", "in text fields for snippets" | `CategoryManager.tsx:160,195,219,175`, `ContactDetail.tsx:278`, `ContactForm.tsx:304`, `ReportBuilder.tsx:357`, `FormBuilder.tsx:125`, `KeyboardShortcutsModal.tsx:104` | Contacts: **"Extra details"** / "Detail name"; forms: "Questions on the form"; "in text boxes" |

**Fix:** Adopt the naming table above; sweep the files listed. Biggest wins first: highlight rules (5 files), View→Show (1 file + tour), Priority List → What's due (1 file + 3 FAQ answers), PDF verbs (5 files).
**Constraint check:** no schema change · renderer strings, `faqData.tsx`, `tourSteps.tsx`.

### UX-F-03 · Major · S
**Where:** Grid toolbar: `src/renderer/components/grid/GridToolbar.tsx:198-205` (`title="View"`, `<span>View</span>`) immediately after `SavedViewsDropdown.tsx:62-70` (`title="Views"`, `Views`).
**What Linda sees / thinks:** Two neighbouring buttons, "Views" and "View". She can't guess which one hides archived clients and which one saves a filter; she opens the wrong one and gives up.
**Why it's a problem:** Singular/plural of the same noun as two different features, both without a verb.
**Fix:** Rename the "View" menu to **"Show"** (its items are "Show as", "Show the Tags column", "Show archived…", "Turn on {priority}…"); aria-label "Show (changed)" → "Show options (some turned on)". Rename "Views" to **"Saved views"**. Update tour step `archived-toggle` ("Open "Show"…") and FAQ `grid-archive`, `grid-saved-views`.
**Constraint check:** no schema change · `GridToolbar.tsx`, `SavedViewsDropdown.tsx`, `tourSteps.tsx`, `faqData.tsx`.

### UX-F-04 · Major · M
**Where:** 90 icon-only buttons (visible content is only an icon; script over `src/renderer/**/*.tsx`). 47 are dialog "Close" ×s (fine). The 43 that carry an action:

| File:line | Only label | In Linda's daily path? |
|-|-|-|
| `components/tasks/TaskItem.tsx:363` | `title="Snooze"` (no aria-label) | yes |
| `components/tasks/TaskItem.tsx:373` | `title="Edit (full dialog)"` (no aria-label) | yes |
| `components/tasks/TaskItem.tsx:382` | `title="Delete"` (no aria-label) | yes |
| `components/tasks/TaskItem.tsx:355` | `title="Wake up (remove snooze)"` | yes |
| `components/tasks/TaskItem.tsx:436` | `aria-label="Delete item"` (no title) | yes |
| `components/profile/ChecklistItem.tsx:463, 527` | "Delete item" | yes |
| `components/profile/CaseLogEntry.tsx:215` | "Edit" | yes |
| `views/ProfileView.tsx:432, 452` | "Previous/Next {record} (Alt+←/→)" | yes |
| `components/layout/Sidebar.tsx:210` (⋯) | "{List} options" | yes |
| `components/layout/Sidebar.tsx:153` | "Drag to reorder" | — |
| `components/grid/ColumnHeader.tsx:228` | "Drag to reorder column" (no title) | yes |
| `components/grid/GridHeaderRow.tsx:256` | "Hide the Tags column" | — |
| `components/grid/AcuityConfigPanel.tsx:205,275,283,293` | "Change color", "Move up", "Move down", "Delete level" | setup |
| `components/grid/ColumnRulePicker.tsx:68,76` | "Edit rule", "Delete rule" | setup |
| `components/grid/CellFormatRuleCard.tsx:142` | "Delete this rule" | setup |
| `components/grid/FindReplaceBar.tsx:253,265,209` | "Previous match (Shift+Enter)", "Next match (Enter)", "Close (Esc)" | — |
| `components/contacts/ContactDetail.tsx:46,185,209` + tooltip 214 | "Copy …", star, "Edit {contact}", "Delete {contact}" | yes |
| `components/contacts/CategoryManager.tsx:123,175,219` | "Save name", "Remove field", "Add field" (title only) | setup |
| `components/contacts/ContactForm.tsx:371,427` | `title="Add language"`, `title="Add tag"` (no aria-label) | — |
| `components/shared/GroupHeader.tsx:122,172,199` | expr, `title="Rename group"` (no aria-label), "Delete group (items become ungrouped)" | yes |
| `components/shared/UndoHistoryPanel.tsx:68` | `title={…}` only | — |
| `components/profile/RecordFiles.tsx:76`, `components/calendar/AppointmentActions.tsx:82`, `components/forms/FormBuilder.tsx:134-135` | arrows / cancel with no label text | — |
| `components/shared/MiniTour.tsx:186` | `title="Close (Esc)"` only | — |

**What Linda sees / thinks:** A bell, a pencil, a bin. She never hovers, so she doesn't learn that the bell is "Snooze"; she clicks the bin by mistake on a task.
**Why it's a problem:** Icon meaning is only in `title`; six buttons have no `aria-label` at all (TaskItem ×4, ContactForm ×2, GroupHeader:172, MiniTour:186), so even a screen reader gets only the title.
**Fix:** (1) Give every icon button an `aria-label` equal to a plain verb phrase (drop "(Esc)"/"(full dialog)" suffixes from aria, keep them in title). (2) In the task row and checklist row, show the text next to the icon at normal width ("Snooze", "Edit", "Delete") and collapse to icon-only below ~700px, like the toolbar already does with `TOOLBAR_LABEL`. (3) Acuity panel: replace the four icon buttons per level with a "⋯" menu that reads "Move up / Move down / Change color / Delete level". (4) Sidebar list "⋯": `aria-label="{List} options for {name}"` is good; add the same items to the {list}'s settings dialog so the ⋯ is not the only path.
**Constraint check:** no schema change · the files above.

### UX-F-05 · Major · M
**Where:** `src/main/ipc/*.ts` `fail('…')` (314) filtered by `src/renderer/utils/friendlyError.ts`; `PASSING_ERRORS.generic` in `src/shared/constants.ts:27`.
**What Linda sees / thinks:** "Something went wrong and the change wasn't saved. Please try again." She tries again, it fails again the same way, and she has no idea what to change.
**Why it's a problem:** ~200 of the 314 `fail()` strings are developer text ("Invalid ID", "Row not found", "No valid fields to update", "is_completed must be 0 or 1") and are correctly swallowed. But the filter also swallows messages that carried the only actionable fact, because they match `\d(px|KB|MB)` / `too (large|long)` / `not found` / `\binvalid\b`:
- `ipc-contacts.ts:211` `'vCard file too large (max 10 MB)'` → generic (the 10 MB limit is lost)
- `ipc-export.ts:566` `'Text too large (max 500,000 characters)'`, `ipc-export.ts:537` `'That text is too long'` (the second passes, the first doesn't)
- `ipc-grid.ts:292` `'Column width exceeds maximum (2000px)'`
- `ipc-alerts.ts:65,84,135` `'Thresholds too large'`
- `ipc-tasks.ts:222`, `ipc-checklists.ts:207` `'Title missing or too long'` (a person can fix this)
- `ipc-export.ts:338` `'Backup file not found'` (should say "That backup file isn't there any more. Choose another.")
- `ipc-auth.ts:138` `'Invalid recovery key'` and `ipc-auth.ts:86,115,169,194,195,232,238,257` `'Invalid password'` — if any of these is reached by a *wrong* (not malformed) value, Linda sees "Something went wrong" instead of "That recovery key doesn't match". Verify; the lock screen has its own `keyError`, but Settings → Security's change-password path uses toasts.
- `ipc-acuity.ts:34` `'Points must be a non-negative number'` → generic; the form lets you type a negative number.
Messages that pass the filter but are still jargon: `ipc-auth.ts:85` `'Password is already configured'`; `ipc-file-assoc.ts:43` `'Not supported on this platform'`; `ipc-export.ts:357` `'Could not decrypt backup'`; `ipc-saved-views.ts:29` `'Maximum of 20 saved views reached'`; `ipc-checklists.ts:400-401` `'Template is missing a name'`, `'Template has no items'`; `ipc-alerts.ts:115` `"Built-in deadline rules can't…"`; `ipc-grid.ts:428` `'Choose the options first.'`; `checklist-apply.ts:14,18` `new ChecklistApplyError('Template not found')`, `'Invalid template items format'` (an app error class — the vocab rule's "Invalid/Expected" exemption hides it, and friendlyError swallows it).
Renderer strings with the same vagueness: `App.tsx:59` `'Something went wrong — your recent action may not have been saved.'`; `MoveToGridModal.tsx:142,336`, `ApplyTemplateDialog.tsx:63` `'Something went wrong. Please try again.'`; `ImportWizard.tsx:125,307`, `ImportPreviewModal.tsx:105`, `GenerateLetterModal.tsx:107`, `TemplateManagerView.tsx:122` `'Something went wrong while …. Please try again.'`; `ContactImportExport.tsx:101,144,167` `'An unexpected error occurred …'`; `FocusModeView.tsx:390` `Something went wrong` (heading); `DataSection.tsx:274` `'Database integrity check FAILED. Consider restoring from backup.'` (shouting + jargon); `CellHistoryPopover.tsx:87` `'Failed to load history'`.
**Fix:** (1) Rewrite the dozen user-fixable `fail()` strings as person sentences with the limit in words: "That contacts file is bigger than 10 MB. Split it into smaller files and try again."; "Give the task a title (up to 500 characters)."; "Points can't be below 0."; "Column width can't be more than 2000." (2) Make the generic fallback say what's safe and what to do: "Pulse couldn't make that change. Your other work is saved. Try again, and if it keeps happening, restart Pulse." (3) Replace the 9 "Something went wrong" and 3 "An unexpected error occurred" renderer strings with the "We couldn't <do X> — <next step>" form. (4) Extend `tests/renderer/friendlyError.test.ts` with a list of `fail()` strings that *must* pass through, so a future regex change can't swallow them.
**Constraint check:** no schema change · `src/main/ipc/*.ts`, `src/shared/constants.ts`, the renderer files named.

### UX-F-06 · Minor · S
**Where:** Confirm dialogs — 36 `ConfirmDialog` usages plus two home-grown confirms.
**What Linda sees / thinks:** Mostly a clear question with a matching button. But in Letters she gets a different-looking box saying "Are you sure you want to delete Intake letter? This cannot be undone." with a "Deleting..." state; in Templates a red "Are you sure?" appears inline with an unlabeled check icon to confirm.
**Why it's a problem:** Two extra confirm patterns, "Are you sure" wording (asks about her feelings, not the outcome), and seven variants of the undo sentence.
Items:
- `views/letter-template/DeleteConfirmModal.tsx:44-69` — own component: title "Delete Template", body `Are you sure you want to delete <strong>…</strong>? This cannot be undone.`, busy label `'Deleting...'`. → Use `ConfirmDialog` (title `Delete "…" forever?`, message "This can't be undone.", button "Delete forever").
- `views/template-manager/ChecklistTemplateRow.tsx:78-80` — inline `Are you sure?` + icon button `title="Confirm delete"`. → `ConfirmDialog`.
- `views/GridView.tsx:192-198` — title "Change column type?", button **"Change Type"** (Title Case, and the message `"Text" becomes "Date". The values stay as they are.` doesn't say what she'll notice: dates won't be recognised until retyped, colours won't apply…). → "Change to Date" + one sentence on the visible effect.
- `views/PasswordSetupView.tsx:190-192` — "Without a recovery key, a forgotten password means permanent data loss. **Are you sure you want to skip?**" → drop the question; button already says "Skip without a recovery key"; add "You can make one later in Settings → Security."
- `components/contacts/ContactForm.tsx:453-455` — title "Unsaved changes", message "You have unsaved changes. Discard them?" vs `EditTemplateModal.tsx:239` "Discard your changes?" / `ReportsView.tsx:151` "Leave without saving?" / `FillFormDialog.tsx:294` "Discard your answers?". → one title: "Discard your changes?".
- `views/TasksView.tsx:906-908` — title "Delete group", message `Delete group "…"? Items will become ungrouped.` — no undo statement, title isn't a question; `Checklist.tsx:908-910` has the same dialog *with* "This can be undone." → align: title `Delete the group "…"?`, message "Its tasks stay, ungrouped. You can undo this."
- `components/shared/UndoHistoryPanel.tsx:286` title "Undo multiple actions" (noun phrase) → "Undo these N actions?"; `:303` "Clear history" / "This will clear all undo and redo history for this session." → "Forget the undo history?" — and note the message says "You won't be able to undo recent actions" which is the real consequence; lead with it.
- `components/settings/BackupSection.tsx:529-532` — message ends `This cannot be undone without the safety backup.\n\nType RESTORE to confirm.` Two ideas fight ("cannot be undone" / "safety backup first"). → "Your current data is saved as a safety backup first, so you can go back. Type RESTORE to confirm."
- `views/DashboardView.tsx:731` `ChooseListDialog … confirmLabel="Continue"` → "Choose this {list}".
- Undo/permanence sentence variants in one app: "This can't be undone." (TrashView), "This can’t be undone." (curly, ReportBuilder:501), "This cannot be undone." (TrashFiles:61, Checklist:1367, DeleteConfirmModal), "Permanent deletion cannot be undone." (FAQ), "removed for good" (TrashView), "You can undo this." (×6), "This can be undone." (Checklist:888,909), "You can undo it right away with Ctrl+Z." (ContactDetail:384), "Undo brings it back" (FAQ). → exactly two sentences per the style guide.
Good examples to copy: `GridDialogs.tsx:126-128`, `ProfileView.tsx:630-632`, `DeleteRuleConfirm.tsx:26-28`, `TrashView.tsx:280-282`.
**Fix:** As listed; add a lint-style test that `ConfirmDialog` is never rendered without `confirmLabel` (the default `'Confirm'` in `ConfirmDialog.tsx:36` should go).
**Constraint check:** no schema change · the files above.

### UX-F-07 · Minor · M
**Where:** Capitalisation. ~60 Title Case labels against a sentence-case majority (the toolbar, menus, Settings tabs, dialogs are all sentence case).
**What Linda sees / thinks:** Nothing conscious; but "+ Add Task" at the top of Tasks and "Add task" in the dialog that opens (`TasksView.tsx:542` vs `TaskFormDialog.tsx:111,282`) look like two different things.
Full list (file:line → replacement):
- Buttons: `TasksView.tsx:542` "+ Add Task" → "Add task"; `LetterTemplateView.tsx:271`, `ProfileHeader.tsx:709` "Generate Letter" → "Make a letter…"; `LetterTemplateView.tsx` title "New Template", `Checklist.tsx:1337` "New Template" → "New template"; `TemplateManagerView.tsx:387` "New Checklist" → "New checklist template", `:509` "Save as Template" → "Save as template"; `SecuritySection.tsx:321`, `PasswordSetupView.tsx:178` "Generate Recovery Key" → "Make a recovery key"; `SnippetsView.tsx:287` "New Snippet" → "New snippet"; `FocusModeView.tsx:374` "Exit Focus Mode" → "Leave focus mode"; `DataSection.tsx:257` "Compact Now" → "Tidy up now"; `:279` "Run Integrity Check" → "Check the data file"; `:340` "RESET EVERYTHING" (button) → "Erase everything"; `FindReplaceBar.tsx:332` "Replace All" → "Replace all"; `RecoveryKeyDisplayModal.tsx:112` "Copy to Clipboard" → "Copy", `:121` "Print Recovery Card" → "Print a recovery card"; `ContactImportExport.tsx:240` "Choose File" → "Choose a file…"; `MorningBriefing.tsx:133` "Start Focus Mode" → "Start focus mode"; `ColumnSelectDialog.tsx:133,140` "Select All"/"Select None" → "Select all"/"Select none"; `BulkActionBar.tsx:162` "Bulk Edit" → "Edit all selected…"; `FilterControls.tsx:292`, `FilterBar.tsx:315` "Add Filter" → "Add filter"; `AcuityConfigPanel.tsx:135` "Add Level" → "Add level"; `GridGroupHeader.tsx:130,137,145` "Collapse All"/"Expand All"/"Remove Grouping" → sentence case; `MiniTour.tsx:255` "Back to Help" → "Back to help"; `ImportPreviewModal.tsx:128` "Import Template" → "Import template"; `ChecklistTemplateEditor.tsx:467`, `Checklist.tsx:1316` "Add Item" → "Add item"; `ChecklistItem.tsx:189` "Save Changes" → "Save changes"; `CommandPalette.tsx:139-163` "Go to Dashboard", "Open Settings", "Enter Focus Mode", "Add New Task", "Lock App" → "Go to the dashboard", "Open settings", "Start focus mode", "Add a task", "Lock Pulse".
- Headings/labels: `LetterTemplateView.tsx:130` "Letter Templates"; `TemplateManagerView.tsx:360` "Checklist Templates"; `SecuritySection.tsx:276` "Recovery Key"; `ProfileSection.tsx:37` "Your Profile", `:28` "Full Name"; `AppearanceSection.tsx:200,236,265,288,314,345,354` "Row Striping", "Sidebar Width", "Date Format", "Clock Format", "Week Starts On", "Reduced Motion", "High Contrast"; `ChecklistItem.tsx:126`, `ChecklistAddDialog.tsx:105` "Due Date"; `ContactForm.tsx:272,304,324,402,409` "Basic Info", "Category Fields", "Contact Information", "Availability Notes", "Referral Process"; `ContactDetail.tsx:278,321` same; `CategoryManager.tsx:85,160` "Manage Categories", "Custom Fields (max 10)"; `DashboardView.tsx:463,467` "Deadline Colors", "Deadline Color Guide"; `UndoHistoryPanel.tsx:178` "Action History" (aria-label at `:173` is "Action history"); `FindReplaceBar.tsx:206` "Find & Replace"; `PlaceholderReference.tsx:48` "Placeholder Reference"; `RecoveryKeyDisplayModal.tsx:86` "Your Recovery Key"; `CommandPalette.tsx:339` "Quick Actions"; `SupervisorReportDialog.tsx:246,289` "Date Range", "Columns to Include"; `SavedViewsDropdown.tsx:130` "Saved Views"; `ImportMappingStep.tsx:30,33` "Import Column", "Map To" → "Your spreadsheet column", "Goes into"; `TrashView.tsx` "Days Remaining" → "Days left"; `KeyboardShortcutsModal.tsx:100` "Getting Started"; `FocusModeView.tsx:364`, `Sidebar.tsx:872` "Focus Mode" → "Focus mode" (the features list already says "Focus mode", `features.ts:56`).
- OS dialog titles: `saveBackupArchive.ts:12` "Save Backup Archive"; `TemplateManagerView.tsx:104,145,209,224,337` "Import Template File", "Save Template As", "Export Checklist Template", "Import Checklist Template", "Export Template"; `DataSection.tsx:185` "Choose Export Destination Folder"; `BackupSection.tsx:185,198` "Select Backup File", "Choose Backup Destination Folder"; `GridToolbar.tsx:560` "Select Columns for CSV Export"/"…PDF Export" → "Choose columns for the CSV"/"…for the PDF".
- Option labels: `AlertRuleEditor.tsx:254,256`, `plainRule.ts:12,14` "Due Soon"/"Due Today"; `SupervisorReportDialog.tsx:60,61` "Last Month"/"This Quarter"; `ContactFilterBar.tsx:15-17,24` "Recently Added/Updated/Contacted", "Not Accepting"; `ContactDetail.tsx:157` "After Hours". (Dashboard tabs "This Week"/"This Month"/"Priority List" are proper-noun-like tab names; acceptable if kept consistently, but "This week"/"This month" would match the rest.)
**Fix:** Sentence case throughout, in one sweep; add a source-scanning test for `>\s*[A-Z][a-z]+ [A-Z][a-z]+` in button text with an allow-list of proper nouns.
**Constraint check:** no schema change · ~35 renderer files.

### UX-F-08 · Minor · S
**Where:** Jargon in Settings and a few dialogs (words Linda doesn't know; see persona).
- Settings → Data (`DataSection.tsx`): `:135` "Database location", `:140` "Database size", `:263-264` "Database integrity" / "Verify your database isn't corrupted", `:257` "Compact Now", `:279` "Run Integrity Check", `:222-223` "Cell history" / "Clean up old cell edit history to save space", `:326-327` "Danger zone" / "Erase all data and start fresh — this cannot be undone", `:340` "RESET EVERYTHING"; toasts `:274` "Database integrity check FAILED. Consider restoring from backup.", `:275` "Integrity check failed. Please try again.", `:300` "Could not update file association.", success "Database integrity check passed." → "Where your data is kept", "Size of your data", "Check your data file" / "Looks for damage in the file that holds your data", "Make the file smaller", "Keep a record of old cell values for", "Start over", "Your data file has a problem. Restore a backup from Settings → Backup.", "Pulse couldn't make itself open .pulse files. You can still open them from Settings → Workspace."
- `SettingsView.tsx:111-119` tab blurbs: "Automatic and manual backup configuration", "Password and encryption settings", "Import, export, and data management", "Version info and credits", "Theme, font size, and display options" → "When Pulse saves copies of your data", "Your password and lock", "Bring data in, send it out, clean up", "Which version you have".
- `AppearanceSection.tsx:116` "Adjust the overall interface size (100% is default)" → "Make everything bigger or smaller (100% is normal)"; `:161` "Smaller sizes may reduce readability"; `:200-201` "Row Striping / Alternate row colors for easier reading" → "Shade every other line"; `:236-237` "Sidebar Width / Width of the navigation sidebar"; `:280` "YYYY-MM-DD (ISO)" → "2026-10-14 (year first)"; `:279,281` likewise show an example date; `:345-346` "Reduced Motion / Disable animations and transitions" → "Less movement / Turn off animations"; `:354-355` "High Contrast / Increase border and text contrast" → "Stronger contrast / Darker lines and text"; `BackupSection.tsx:516` "7 days (default)" → "7 days (usual)".
- `FilesStorageSection.tsx:54` "Files are kept inside the encrypted database, so they're part of every backup." → "…inside your Pulse data, so…"; `AboutSection.tsx:178` "No cloud sync, no telemetry, no account required." → "Nothing goes to the internet, nothing is reported back, no account needed."
- `TaskItem.tsx:373` `title="Edit (full dialog)"` → "Edit all details"; `ConfirmDialog.tsx:116` `title="Close dialog"` → "Close"; `DashboardView.tsx:457-458` "Toggle deadline color guide" → "Show or hide the color key"; `AcuityConfigPanel.tsx:252` "Abbreviation (1-4 chars)" → "Short form (1–4 letters)"; `GridToolbar.tsx:355,383` "N hidden" badge is fine; `PlaceholderReference.tsx:48` "Placeholder Reference" → "Details you can insert"; `ColumnSettingsDialog.tsx:69` "Required column" → "Must be filled in"; `ImportWizard.tsx:206` "Could not get the file path. Try using the Browse button instead."; `SecuritySection.tsx:239,348` "Also re-encrypt my data" → "Also give my data a new key (slower, safer)"; `:255` "Your data has a new key. Save a new backup now." is good; `FindReplaceBar.tsx:306` "Replace current match (Enter in replace field)".
- Contacts: `CategoryManager.tsx:160` "Custom Fields (max 10)", `:195` "Field name", `:219` "Add field", `:175` "Remove field"; `ContactDetail.tsx:278`, `ContactForm.tsx:304` "Category Fields" → "Extra details for this category"; `ContactForm.tsx:272` "Basic Info" → "Name and organization"; `ContactFilterBar.tsx:145,154` "Card view"/"List view" → "Show as cards"/"Show as a list".
- Vocabulary-adjacent jargon: `GridView.tsx:160` "No {list} selected" → "Choose a {list} on the left"; `SetupView.tsx:334` "What are these rows?" (spreadsheet context — acceptable, but "What is each line of your spreadsheet?" is plainer).
**Fix:** As listed.
**Constraint check:** no schema change · settings and contacts components.

### UX-F-09 · Minor · S
**Where:** Error and success voice; six templates in use.
- "Could not X — please try again" ×24 in stores (`gridColumnSlice.ts:82,123,167,234,247`, `gridFormatSlice.ts:54,108`, `gridFilterSlice.ts:148,157,205,269`, `alertStore.ts:93,110,120`, `gridRowSlice.ts`, `gridAcuitySlice.ts`, `gridStore.ts`) — these also say "view", "rule", "filter", "column" in a bare way ("Could not delete view").
- "We couldn't X" ×~70 (the house style; good).
- "Failed to X." ×5: `PasswordSetupView.tsx:114,117` "Failed to generate recovery key.", `SettingsView.tsx:100,101` "Failed to save setting.", `CellHistoryPopover.tsx:87` "Failed to load history", `Checklist.tsx:1034` "Failed to save template. Please try again."
- "X failed. Please try again." ×7: `DataSection.tsx:204,207` "Export failed.", `BackupSection.tsx:177` "Restore failed.", `PasswordSetupView.tsx:88,100` "Password setup failed." / "Setup failed.", `ResetPasswordAfterRecoveryDialog.tsx:50` "Password reset failed.", `DataSection.tsx:275` "Integrity check failed."
- "An unexpected error occurred…" ×3 (`ContactImportExport.tsx:101,144,167`); "Something went wrong…" ×9 (UX-F-05); `RecoveryKeyDisplayModal.tsx:43` "Unable to print — try copying the key instead." (good next step, odd opener).
- Form validation mixes "X is required." (`Checklist.tsx:1006`, `EditTemplateModal.tsx:78` "Template name is required.", `:79` "Template content cannot be empty."), "Please enter/select…" (`SupervisorReportDialog.tsx:140`, `GenerateLetterModal.tsx:86,89`), "Start date must be before end date." (`SupervisorReportDialog.tsx:141`) vs the plainer "Give the {list} a name." / "Fill in both words." / "Add at least one choice." (`NewListDialog.tsx:58-59`, `EditOptionsDialog.tsx:58`) — the latter voice is better.
- Success toasts: "Password updated successfully." vs "Password changed successfully." vs "Password changed and your data re-encrypted." (three wordings for one action); "Saved" / "Saved." / "Backup saved." / "Template saved." / "Saved the PDF" (period inconsistent); "Recovery key copied to clipboard" → "Recovery key copied"; "Formatting copied" → "Highlight copied"; "Weekly planner saved." (what is the weekly planner? name the thing on screen); "Everything was erased. Pulse is restarting."
**Fix:** One template (style guide): "We couldn't <verb> <thing> — try again." for failures; past-tense noun-free successes; validation as imperatives ("Give the template a name.", "Choose an end date after the start date."). Replace the vocabulary-adjacent nouns ("view", "rule", "filter") with the on-screen names ("saved view", "deadline rule", "saved filter").
**Constraint check:** no schema change · stores and the files listed; `tests/renderer/friendlyError.test.ts` scans these literals, so it will need its allow-list updated.

### UX-F-10 · Minor · M
**Where:** Empty states.
Good (say what it's for + first action): grid (`GridNotices.tsx` "No {records} yet / Add your first {record} or bring them in from a spreadsheet" + three buttons), `TasksView.tsx:609-611`, `SnippetsView.tsx:318-320`, `ContactsView.tsx:262-264`, `LetterTemplateView.tsx:152-154`, `TemplateManagerView.tsx:324-325,415-417`, `TrashView.tsx:195-196`, `FormsDialog.tsx:64`, `RecordLetterDialog.tsx:94`, `BatchDocumentsDialog.tsx:216`, `DoneChecklistPicker.tsx:47`, `GridLoadingState.tsx:54-55`.
Weak (no "what for", no "how to add"):
- `RecordFiles.tsx:64` "No files yet." → "No files yet. Drop a file here or click Add files… to keep PDFs, pictures and documents with this {record}."
- `LinkedRecords.tsx:117` "None linked yet." / `LinkedProviders.tsx:315` "No {contacts} linked." → "No {contacts} linked yet. Link one to see their phone and availability here."
- `LinkPicker.tsx:151` "Nothing found." → "No {record} with that name. Type a new name to add one."
- `ReportTable.tsx:17` "Nothing matches yet." → "Nothing to count yet. Add {records}, or widen the filter above."
- `AlertRuleEditor.tsx:525` "No colors yet." → "No colors yet. Add one to say how many days before the date the cell turns, say, yellow."
- `Checklist.tsx:1108` "No templates yet." → "No checklist templates yet. Make one under Templates in the sidebar."
- `FilterControls.tsx:318`, `FilterBar.tsx:351` "No saved presets yet." → "No saved filters yet. Set up a filter, then click Save to keep it."
- `AlertsSection.tsx:57` "No deadline rules yet." → "No deadline rules yet. A rule says when a date column changes color. Make one from a date column's menu, or here."
- `DaysOffSection.tsx:103` "No days off added yet." → add "Add a day, a break, or this year's US holidays."
- `DeadlineColumnsMenu.tsx:71` "No columns have deadline rules yet." → add how.
- `DashboardView.tsx:477` "No deadline rules are in use yet." / `:543` "Nothing here yet" (no period, no hint) → "Nothing due. Deadlines appear here once a date column has a deadline rule."
- `CalendarView.tsx:367` "Nothing in the next N days." fine; add "Add an event with New…".
- `ContactsView.tsx:255` "Try adjusting your filters or search terms" → "Nothing matches. Clear the filters or try another name." with a Clear button.
- `LetterTemplateView.tsx:196` "Select a template to view it" → "Choose a template on the left to read or change it."
- `SnippetsView.tsx:313` "No snippets match your search." fine.
- `GridView.tsx:160` "No {list} selected" → "Choose a {list} in the sidebar, or make a new one with +."
**Fix:** Apply the empty-state template; reuse `EmptyState` where a panel is tall enough.
**Constraint check:** no schema change · files above.

### UX-F-11 · Minor · S
**Where:** Keyboard hints as the only affordance, or odd key names.
- `GridNotices.tsx:14` tip: "Right-click column headers for deadline rules, tracking & more · Right-click {a record} for options · Press **Shift+?** for all shortcuts" — the key is shown as Shift+? (the sidebar says "(?)", FAQ says "Press ?"); three of the four tips are right-click/keyboard, which Linda won't do. → "Click a column header to sort. The ⋯ on a header has deadline rules and more. Open a {record} for everything about it. Help is in the sidebar."
- `TasksView.tsx:705,784,823` placeholders "+ Add task... (press Enter)" (two with "...", one with "…") and `Checklist` "+ Add an item… (press Enter)" ×3: there is a visible "+ Add Task" button at the top, so acceptable, but each inline box should get an "Add" button on focus for mouse users.
- Snippets: `CaseLog.tsx:742` "Type / to insert a snippet" and `:737`/`ScratchPad.tsx:361` "Tab inserts · ↑↓ then Enter to pick another · Esc closes" — there is a Snippets button (`CaseLog.tsx:713` aria "Snippets"), good; the popover hint can stay but "↑↓" should read "Up/Down".
- Command palette: the only routes are Ctrl+K and Ctrl+F (`TopBar.tsx:118-121`); FAQ `grid-search` and `tips-palette` are keyboard-only. The TopBar search box exists for records; make sure the palette's "Go to…" actions are reachable from a visible control (a "Search everything" entry in the sidebar's search box).
- Profile `ProfileView.tsx:438,458` titles "Previous {record} (Alt+←)" — buttons exist; fine. `UndoHistoryPanel.tsx:204,217` fine.
- FAQ `tips-focus-mode` (543) "Press Ctrl+Shift+F to open focus mode" — the sidebar has "Focus Mode" (`Sidebar.tsx:872`); say that first.
**Fix:** As listed; keep shortcuts as the second sentence, never the first.
**Constraint check:** no schema change.

### UX-F-12 · Minor · S
**Where:** Buttons/menus without a verb or with an unclear outcome (Linda reads the label, not the tooltip).
- `GridToolbar.tsx:353` **"More"** — holds Add a column, Show or hide columns, Import, Export, Documents. The tour and FAQ send her to "More" five times. → "Columns & data" or split: "Columns" / "Import & export". At minimum "More…".
- `GridToolbar.tsx:506-515` gear icon with `aria-label="{List} settings"`, tooltip "name, words, how names show" → show the text "{List} settings" at full width.
- `ProfileHeader.tsx:709,718,728` "Generate Letter", "Audit trail", "Handoff packet"/"{Record} packet" — the last two are nouns whose meaning is only in tooltips ("Every change and {activity} for this {record}, as a PDF", "Transfer or discharge: profile and audit trail in one PDF"). → "Make a letter…", "Save the change history as PDF…", "Save a handoff PDF…".
- `ProfileView.tsx:325-329` More menu: "Print / PDF…" (two verbs, a slash) → "Save as PDF…"; others fine.
- `CalendarView.tsx:290` "New…" → "Add…" (it opens a chooser of deadline/event/appointment: "Add to this day…"); `:289` "Add to my calendar…" is good.
- `SecuritySection.tsx:268` "Later" (after rekey, next to "Save a new backup now") → "Remind me later".
- `ColumnHeader.tsx:403,409` "Width" / "Fit" (+ "Narrower"/"Wider" icons) → "Column width: Narrower · Fit to text · Wider".
- `ColumnHeader.tsx:428` "Keep columns up to here in view" / "Stop keeping these columns in view" — good plain words for freezing; keep.
- `GridContextMenu.tsx:162` section heading "Cell" → "This cell".
- `TrashView.tsx:212` table header "Actions" → leave blank or "" (headers for button columns needn't be named).
- `WordsEditor.tsx:191-192` "Use general words" / "Use human-services words" — good.
- `SavedViewsDropdown.tsx:70` "Views" → "Saved views" (UX-F-03).
- `DashboardView.tsx:463` "Deadline Colors" (a disclosure button that looks like a heading) → "Show the color key".
- `BackupSection.tsx:287` three labels for one control state ("Auto-backup" / "Scheduled backup" / "Back up now") — verify which shows when; "Back up now" is the verb form to keep.
**Fix:** As listed.
**Constraint check:** no schema change.

### UX-F-13 · Minor · S
**Where:** Vocabulary leaks and near-leaks the eslint rule allows.
- `src/main/sample-data.ts:18` `SAMPLE_GRID_NAME = 'Sample Caseload (not real clients)'` — hard-coded human-services words in a list name every workspace may get (the rename on "keep" at `:171` uses `word()`, the creation at `:203` doesn't). → build from `word('list', …)` / `word('record', { many: true })`: "Sample {list} (not real {records})".
- `TrashView.tsx` column headers "Deleted", "Days Remaining"; `ContactDetail.tsx:240` tab "Log"; `ApplyStarterDialog.tsx:290` "Made-up entries to try things out."; `SampleDataBanner.tsx:61` "Keep this as a real entry?" → use `{activity}` / `{record}` tokens.
- `faqData.tsx:399` "most contact management apps and email {record:many}" — a token where a plain word was meant ("email programs").
- `faqData.tsx:146,205` "{list} reviews", `tourSteps.tsx:205` "assigned worker" — fine (the `worker` key exists; use `{worker}`).
- `features.ts:38` "People details" and `SetupView.tsx:72` "People / clients, students, staff" — examples, fine.
- `templates.ts:767,783,801` built-in letter descriptions ("…from case manager to client") — seeded only under human-services words per the decision log; fine, but they should use `word()` so a later word change updates them.
- Dashboard tab "Priority List" vs `{priority}` (UX-F-02): under generic words the Features page says "Priority levels" (acuity) while the dashboard's "Priority List" is about deadlines.
**Fix:** As listed; extend `tests/vocab-leak-main.test.ts` to cover `sample-data.ts` constants.
**Constraint check:** no schema change · `sample-data.ts`, `TrashView.tsx`, `ContactDetail.tsx`, `ApplyStarterDialog.tsx`, `SampleDataBanner.tsx`, `faqData.tsx`.

### UX-F-14 · Minor · S
**Where:** FAQ questions phrased in app terms rather than Linda's goals (`faqData.tsx`).
- 114 "What are {list} settings?" → "How do I rename my {list} or change what it's called?"
- 434 "What is a .pulse file?" → "How do I share my {list}'s columns and checklists with a coworker?"
- 520 "What is the command palette?" → "Is there one place to search everything?"
- 224 "What does "Log changes in timeline" do on a column?" → "Can Pulse record when a status or date changed?"
- 230/236 "What is {priority} scoring?" / "How do I enable {priority} scoring?" → "How do I show which {records} need the most attention?" / "How do I turn that on?"
- 212 "How do I set up conditional formatting on cells?" → "How do I color a cell when its value changes?"
- 206 "How do I save and load custom views?" → "Can I save a filter or sort I use often?"
- 542 "What is focus mode?" → "Is there a way to go through today's work one item at a time?"
- 534 "How do I use right-click menus in {a list}?" → "What else can I do with {a record} from the {list}?"
- 384 "What does the availability status mean?" fine; 568 "Can Pulse remind me each morning?" good model.
Also answer-level jargon: 207 "save the current configuration", 225 "complete audit trail", "preserved when you save {a list} as a .pulse template", 237 "flip the toggle to enable", 249 "configuration panel", 310/457 "template variables", 29 "map your spreadsheet columns", 414 "The wizard", 521 "quick-search popup", 162 "stay in your database indefinitely".
**Fix:** Rephrase questions as goals; keep the app term inside the answer in quotes once.
**Constraint check:** no schema change · `faqData.tsx`.

### UX-F-15 · Polish · S
**Where:** Punctuation.
- Three-dot "..." (26) vs "…" (house style): `HelpView.tsx:206` "Search help...", `ContactInteractionLog.tsx:283` "Search interactions...", `TaskFormDialog.tsx:143,191` "Additional details...", "e.g. Admin, Reporting...", `ChecklistAddDialog.tsx:81`, `ChecklistItem.tsx:102` "Additional details...", `SnoozeDialog.tsx:24` "Snooze until...", `FindReplaceBar.tsx:286` "Replace with...", `BulkEditDialog.tsx:395` "Enter value...", `TasksView.tsx:705,823` "+ Add task... (press Enter)" (while `:784` has "…"); busy labels `TemplateManagerView.tsx:287` "Opening...", `ContactImportExport.tsx:343,423` "Importing..."/"Exporting...", `DeleteConfirmModal.tsx:69` "Deleting...", `GenerateLetterModal.tsx:292` "Generating...", `ContactForm.tsx:264`, `EditTemplateModal.tsx:233`, `ChecklistTemplateEditor.tsx:502` "Saving...", `LinkedProviders.tsx:263,309` "Searching..."/"Loading...", `BulkEditDialog.tsx:220,253` "Updating..."/"Applying...", `ImportWizard.tsx:446` "Reading file...".
- "&" vs "and": "Deadlines & reminders" (Settings tab), "Help & keyboard shortcuts (?)", "Find & Replace", "Date & Time", "Import & export data" vs "Bring in and send out", "Documents and labels…", "Letters and documents", "Stages and board". → "and" everywhere except where width forces "&".
- "e.g." in 53 places (`SetupView.tsx`, `ContactForm.tsx`, placeholders "e.g. Jane Smith", "e.g. J-" …) → "like …" or "for example …" ("Name, like “Due soon”" at one placeholder already does this).
- Mixed apostrophes: "can't" / "can’t" / "cannot" in the same dialog family (UX-F-06); `ReportBuilder.tsx:501` uses U+2019.
- Em dash with spaces " — " (most) vs "–" en dash in a placeholder (`"e.g. {Year} {Make} {Model} – {Plate}"`) — fine as a literal; keep " — " for asides.
- Toast periods: "Saved" vs "Saved." (UX-F-09).
- Table/column headers mixing Title Case ("Days Remaining") and sentence case ("Backup made", "Made by") in the same app.
**Fix:** Mechanical sweep; a test that no JSX/placeholder literal contains "..." (allow code samples).
**Constraint check:** no schema change.

### UX-F-16 · Polish · S
**Where:** Tour copy (`tourSteps.tsx`).
- 67-71 "Your navigation panel / Everything starts here / This sidebar is home base" — "navigation panel" and "sidebar" for the same thing in one step; "home base" is idiom. → "The sidebar / Your way around Pulse".
- 91 "Like a spreadsheet, but smarter" — fine. 94 tip "Press Enter or F2 to start editing" — F2 is Excel-speak Linda may know; keep as tip.
- 128 "the full search palette, which can also navigate to other views" → "search box that can also open any page".
- 147-150 "Right-click for more options / Hidden power at your fingertips" → "The same actions are on each {record}'s page under More" and drop "hidden power".
- 158-161 step id `archived-toggle` says 'Open "View"' — update with UX-F-03.
- 302-305 lists tabs that don't exist (UX-F-01).
- 227-231 "{Record} profiles … dedicated profile page … linked {contacts}, and activity history" → "{record}'s page"; "activity history" vs "{activityLog}" in the next step (264).
- 379 "Settings & help" step title but the step's target is Settings only; 382 "Visit the Help Center anytime" — the next step is Help; merge or retitle "Settings".
- 406 "set inactivity timeouts" → "choose how soon Pulse locks itself"; 430 "configure backup reminders" → "choose when to be reminded to back up".
**Fix:** As listed.
**Constraint check:** no schema change · `tourSteps.tsx`.

### UX-F-17 · Polish · S
**Where:** PDF and main-process text.
- `export-pdf.ts:602` `sectionTitle('Custom Fields')` → "Extra details"; `ipc-starters.ts:98,123` OS dialog titles "Open a template file", "Share my setup as a template" (good, sentence case — the renderer OS-dialog titles in UX-F-07 should match this style).
- `compliance.ts:221` stat label "Missing information" good.
- Main error classes are largely in person voice already (`forms.ts`, `links.ts`, `list-trash.ts`, `starters.ts`, `activity-types.ts`); exceptions: `checklist-apply.ts:14,18,22` ("Template not found", "Invalid template items format") and `ipc-checklists.ts:400-405` ("Template is missing a name", "Template has no items", "Each item must have a title") → "That checklist file has no name / no items / an item without a title."
**Fix:** As listed.
**Constraint check:** no schema change.

---

### Counts by category
| Category | Count |
|-|-|
| Technical jargon strings in screens/tooltips (UX-F-08) | 66 hits, ~45 distinct |
| Concepts with 2+ names (UX-F-02) | 12 concepts, 40+ strings |
| Icon-only buttons (UX-F-04) | 90 (47 Close ×, 43 actions; 6 without aria-label) |
| Confirm dialogs (UX-F-06) | 36 ConfirmDialog + 2 home-grown; 9 need wording changes |
| Error strings (UX-F-05, UX-F-09) | 220 toast.error, 57 setError, 314 fail(); 9 "Something went wrong", ~12 user-fixable messages swallowed |
| Empty states (UX-F-10) | 30 found; 13 good, 17 weak |
| Keyboard-only hints (UX-F-11) | 8 |
| Title Case labels (UX-F-07) | ~60 |
| "..." vs "…" (UX-F-15) | 26 |
| Vocabulary leaks (UX-F-13) | 6 |
| Stale or app-termed FAQ answers (UX-F-01, UX-F-14) | 16 stale, 10 app-termed questions |
