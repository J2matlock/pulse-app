# Slice E — settings, help and the tool views

Reviewed 2026-10-14 as "Linda" on the seeded Human-services caseload at 1366×768 and 1280×720
(`e2e/ux-review/E.spec.ts`, `E2.spec.ts`; shots in `ux-review-shots/E/`). 43 findings:
2 Blocker, 13 Major, 19 Minor, 9 Polish.

## Summary

**Three worst problems**
1. **Security checkup says "Recovery key created" next to a warning triangle** when there is no key (UX-E-01). Linda reads the words, not the icon, and believes she is covered; a forgotten password then loses everything.
2. **A feature that is switched off is invisible everywhere Linda would look for it** (UX-E-02, -10, -21). "Contacts per month" lives in Settings → Deadlines & reminders → "Contact requirements", but only while the Requirements switch is on. With it off the tab says nothing, the tab's own description omits it, Help search for "contacts per month" finds nothing, and the one FAQ that mentions requirements points at menus that don't exist. The only route is a 20-item checkbox list at the bottom of the Workspace tab.
3. **Settings and Help don't fit a laptop screen** (UX-E-03, -04, -34). At 1366×768 the Settings tab list is cut after "Deadlines &"; "Case notes" and "About" are below the fold with no cue. The sidebar hides "Letters" (and "Templates" at 720) the same way. Help opens with three promo cards and the first question is at the bottom edge.

**What works well:** the deadline rule editor's plain-language kind cards, live preview and "Only when…"; typed confirmations (RESTORE, EMPTY, RESET EVERYTHING) with clear consequences; the lock screen's wrong-password and "No recovery key" copy; the "Move to a new computer" wizard; the Requirements dialog's one-click presets; Help's "More features you can turn on" section with a Turn-on button; the Trash's Restore/Delete-forever split; the generated-letter and "Make letters for many" flows.

## Findings

### UX-E-01 · Blocker · S
**Where:** Settings → Security → Security checkup (shot: ux-review-shots/E/02-tab-security-1.png)
**What Linda sees / thinks:** A card "Security checkup: 2 of 4" whose first line reads **"Recovery key created"** with a small amber triangle. Two lines below, "Auto-lock after 15 minutes" has a green tick. She reads "Recovery key created" and moves on.
**Why it's a problem:** The label is the name of the check, not its state. Linda reads words; the icon is 20 px of colour. She leaves believing she has a recovery key. The red box further down ("No recovery key set") contradicts the card, but only if she scrolls.
**Fix:** Phrase every check as its current state: "No recovery key yet" / "Recovery key saved", "Scheduled backups are off" (already right), "Data folder is not in a cloud folder". Make the failing line a link that scrolls to the fix ("Create one below").
**Constraint check:** no schema change · touches src/renderer/components/settings/SecurityCheckup.tsx (`checks[0].label`)

### UX-E-02 · Blocker · M
**Where:** Settings → Deadlines & reminders with the Requirements switch off; Settings → Workspace → Features (shots: 02-tab-alerts-1.png, 02-tab-workspace-4.png, 42-help-search-0-contacts-per-month.png)
**What Linda sees / thinks:** She wants "each client needs one contact a month". The tab is called "Deadlines & reminders — Deadline rules, reminders, days off". With the feature off the tab shows Reminders (one checkbox), Days off and Deadline rules. Nothing says "requirements" or "contacts per month". Help search for "contacts per month" says "No questions match". She gives up or starts making a 30-day deadline rule instead (which is what the owner reported).
**Why it's a problem:** Off features leave no trace. The switch is on the Workspace tab, in the 8th of 20 checkboxes, under a 9-row word table; its label is "Contact requirements — Set how many case notes of a kind each client needs per period", which is right, but nobody browses a switch list to find a feature they don't know exists. In the Human-services example the switch is on, so the owner's own install is the blank-workspace case (`blankDefault: false` in src/shared/features.ts:46).
**Fix:** (a) Put a `FeatureOffer` row on the Deadlines & reminders tab where the section would be: "Need a minimum number of visits or calls per month? Turn on Contact requirements." (`src/renderer/components/shared/FeatureOffer.tsx` exists; only AddColumnPanel and CaseLog use it). (b) Same offer at the bottom of the Reminders section for desktop reminders. (c) Change the tab description to "Deadline rules, requirements, reminders, days off". (d) In the Features list, add a "Shows in: Settings → Deadlines & reminders, caseload menu" line under each switch so Linda knows where a feature lives once on. (e) Add an FAQ "How do I set how many contacts each client needs a month?" tagged `feature: 'requirements'` so it appears under "More features you can turn on" with the Turn on button (see UX-E-10).
**Constraint check:** no schema change · touches src/renderer/components/settings/AlertsSection.tsx, FeaturesSection.tsx, src/renderer/views/SettingsView.tsx:117, src/shared/features.ts (description text), src/renderer/views/help/faqData.tsx

### UX-E-03 · Major · S
**Where:** Settings, every tab, at 1366×768 and 1280×720 (shots: 01-settings-landing.png, 13-appearance-1280.png)
**What Linda sees / thinks:** The left tab list ends with "Deadlines &" cut in half at the bottom edge. "Case notes" and "About" exist only after scrolling the narrow column, whose scrollbar is a 6 px strip. Linda doesn't know two more tabs exist.
**Why it's a problem:** Each tab carries a two-line description, so 9 tabs need ~950 px. Linda's 768 px screen (and 720 at 1280) shows 7. The feature she's looking for (note kinds, update check) may be in the hidden two.
**Fix:** Drop the descriptions from the tab list (keep them as the panel's subtitle) so nine 44-px rows fit in 400 px; or keep descriptions on one line. Keep the list non-scrolling at 720.
**Constraint check:** no schema change · touches src/renderer/views/SettingsView.tsx:136-162

### UX-E-04 · Major · S
**Where:** Sidebar on every tool page at 1366×768; at 1280×720 (shots: 02-tab-workspace-1.png — "Letters" cut; 65-templates-1280.png — "Templates" cut)
**What Linda sees / thinks:** Under TOOLS the last item is half-visible behind a fade ("Letters" at 768, "Templates" at 720). Trash under SYSTEM is never visible without scrolling the sidebar.
**Why it's a problem:** Letters and Trash are reachable only by scrolling a list that doesn't look scrollable (the fade helps, the cut-off word hurts). Linda never scrolls a navigation panel.
**Fix:** Tighten the sidebar: 40-px rows for TOOLS, remove the blank row between groups, or collapse SYSTEM into a "More…" row. Make sure all items fit at 720 with the default font.
**Constraint check:** no schema change · touches src/renderer/components/layout/Sidebar.tsx:498-840 (slice B may own this; listed here because it hides this slice's pages)

### UX-E-05 · Major · S
**Where:** Help → pick a category chip, then type in Search (shots: B6-help-search-mileage-2.png, B6-help-search-requirement-2.png)
**What Linda sees / thinks:** With "Letters and templates" selected she types "mileage": "No questions match your search. Try different keywords, or browse the categories above." The chip is still blue, far from the search box; she concludes Help has nothing on mileage.
**Why it's a problem:** Search and category filter combine silently (`HelpView.tsx:77-89`). The empty state doesn't say a category is limiting the search.
**Fix:** Typing in Search resets the chip to "All" (and clearing the search restores it), or the empty state says "No matches in Letters and templates — search all topics" with a button.
**Constraint check:** no schema change · touches src/renderer/views/HelpView.tsx:77-89, 283-289

### UX-E-06 · Major · M
**Where:** Help search (shots: 42-help-search-0-contacts-per-month.png, 42-help-search-3-print.png)
**What Linda sees / thinks:** "contacts per month" → nothing. "print" → the first hit is "Can I change the words Pulse uses?" (because its answer contains "PDFs you print"). "password" → "What happens to my data?" first, "How do I change my password?" fourth.
**Why it's a problem:** Search is a plain substring over question + answer with no ranking and no synonyms, so natural phrasings fail and answers that merely contain the word outrank questions about it.
**Fix:** Add an optional `keywords` list per FAQ ("contacts per month", "minimum visits", "required calls") and search it; rank question matches above answer matches; match each word separately ("contacts" AND "month").
**Constraint check:** no schema change · touches src/renderer/views/help/types.ts, HelpView.tsx:77-89, faqData.tsx

### UX-E-07 · Major · S
**Where:** Settings → Deadlines & reminders → Add deadline rule → Create Rule (shot: 27-alerts-after-create-3.png)
**What Linda sees / thinks:** A new card "The date entered is the deadline · Used by: no columns yet". She made a rule; nothing in the caseload changed. What now?
**Why it's a problem:** Rules only do something once a date column uses them, and that happens from the column's ⋯ menu in the caseload, which Settings never mentions. Linda will think the feature is broken.
**Fix:** After creating a rule from Settings, show an inline next step on its card: "Not used yet. To use it, open a date column's ⋯ menu in your caseload and choose Deadline rule." Better: a "Use on a column…" button that opens a column picker (the ChooseListDialog/ColumnSelectDialog components exist).
**Constraint check:** no schema change · touches src/renderer/components/settings/AlertsSection.tsx:78, src/renderer/components/alerts/AlertRuleEditor.tsx (close callback)

### UX-E-08 · Major · S
**Where:** Letters → Generate Letter → pick a client → Generate (shot: B9c-letter-generated.png)
**What Linda sees / thinks:** "My name is , and I will be your assigned case manager" — her name is blank. No message. She may print it.
**Why it's a problem:** `{{my_name}}` comes from Settings → Profile, which a new user hasn't filled in. The modal only reports *unknown* placeholders (`UnknownPlaceholders`), not *empty* ones.
**Fix:** When the template uses `{{my_*}}` and Profile is empty, show a yellow line above the letter: "Your name isn't set. Fill in Settings → Profile" with a link. Same on the "Make letters for many" dialog and the profile's Generate Letter.
**Constraint check:** no schema change · touches src/renderer/views/letter-template/GenerateLetterModal.tsx, src/renderer/components/shared/UnknownPlaceholders.tsx

### UX-E-09 · Major · M
**Where:** Help → FAQ answers (spot-checked 10 against the screens; file: src/renderer/views/help/faqData.tsx)
**What Linda sees / thinks:** Instructions that name buttons and screens that aren't there:
- `sec-restore` (l.484): "click 'Restore from Backup.' You'll see a list of available backups with dates" — the tab has one "Restore" beside the latest auto-backup and "Restore from file…"; no list (shot 02-tab-backup-1.png).
- `dash-overview` (l.332): tabs "Priority List, This Week, This Month, Completions" — real tabs are Priority List, Overdue, This Week, This Month (shot A7b-after-tasks-off.png).
- `dl-days-off` (l.556): "tick 'Count working days only'" — the editor has a radio group "If it lands on a weekend or day off" (shot 21-rule-interval-2.png).
- `st-letter-template` (l.457): "click 'New Template.' Use the rich text editor… {{worker_name}}" — button is "New", the editor is a plain text box, and the placeholder is `{{my_name}}` (shots 64e-letter-new.png, B9-letter-placeholders-2.png).
- `sec-change-password` (l.498): "click 'Change Password.' … Your recovery key remains valid" — button is "Change…", and with "Also re-encrypt my data" the key stops working (SecuritySection.tsx:241).
- `sec-recovery-key` (l.491): "generated when you first set up Pulse" — only if not skipped; never says where to make one (Settings → Security).
- `contacts-import-export` (l.399): "use the import/export button" (there are two) and "email {record:many}" renders "email clients" by accident of the human-services words; with general words it's "email records".
- `ie-pulse-file` (l.435): "Import Template File" — button is "Import .pulse File".
Accurate: `gs-change-password`, `grid-trash-purge` ("Empty Trash", type EMPTY), `contacts-link-client`, `tips-undo`, `dl-reminders`, `gs-dark-mode`.
**Why it's a problem:** Linda follows words exactly; a button that isn't there ends the attempt.
**Fix:** Correct the eight answers above; replace "email {record:many}" with "email programs". Add a source-scanning test that every quoted button name in faqData.tsx appears in src/renderer (like tests/renderer/vocabStaticText.test.tsx does for words).
**Constraint check:** no schema change · touches src/renderer/views/help/faqData.tsx

### UX-E-10 · Major · S
**Where:** Help → "Can a requirement be per week, quarter or year instead of per month?" (faqData.tsx:295-299)
**What Linda sees / thinks:** With Requirements off, the entry still shows under "Write case notes and keep details" and tells her to "Open a list's requirements (in List settings or the sidebar menu)". Neither exists while the switch is off.
**Why it's a problem:** Entries about optional features carry `feature:` tags so Help can offer "Turn on …" (HelpView.tsx:140-144); this one, and `dl-extend` (mentions the requirements summary), don't. And there is no entry at all for *setting up* requirements — the question Linda actually has.
**Fix:** Tag the entry `feature: 'requirements'`; add "How do I set how many contacts each client needs a month?" (Settings → Deadlines & reminders → Contact requirements → Set up…, or the caseload's menu) with the same tag and keywords "contacts per month, minimum visits".
**Constraint check:** no schema change · touches src/renderer/views/help/faqData.tsx

### UX-E-11 · Major · S
**Where:** Settings → Backup → Enable scheduled backups (shot: A5b-backup-scheduled-on-2.png)
**What Linda sees / thinks:** She ticks the box. Destination folder is pre-filled with `…/PulseData/backups` (the data folder). "Never run · Run now". Done, she thinks.
**Why it's a problem:** The Security checkup then reports "Scheduled backups go to the same folder as your data" (SecurityCheckup.tsx:41, 60). The default defeats the purpose, and Linda won't know to click "Change…".
**Fix:** When the switch is turned on with the default folder, open the folder picker straight away ("Where should the copies go? Pick a different drive or a network folder."); show the same amber note under the folder until it's changed.
**Constraint check:** no schema change · touches src/renderer/components/settings/BackupSection.tsx:378-430

### UX-E-12 · Major · S
**Where:** Contacts → Categories → Manage Categories (shots: 76-categories.png, 76b-categories-edit.png)
**What Linda sees / thinks:** A list of coloured names and an "Add" box. The pencil and trash icons appear only on the row under the mouse. Custom fields per category (the feature the Help entry `contacts-categories` advertises) are inside the pencil.
**Why it's a problem:** Hover-only controls (`opacity-0 group-hover:opacity-100`, CategoryManager.tsx:174) are invisible to someone who reads the screen before moving the mouse. Nothing says custom fields exist.
**Fix:** Show "Edit" / "Delete" text buttons on every row, and a "Fields: 0" caption under each category name so the custom-field feature has a visible handle.
**Constraint check:** no schema change · touches src/renderer/components/contacts/CategoryManager.tsx

### UX-E-13 · Major · S
**Where:** Help → "?" button in the top bar (Help for this page) from Settings (TopBar.tsx:22-31)
**What Linda sees / thinks:** On Settings → Deadlines & reminders she clicks "?" and lands on Help with "Keep my data safe" selected.
**Why it's a problem:** `helpCategoryFor('settings')` always returns `security-backups`; six of the nine tabs are about something else. The page-aware help is wrong on most of the page it's most needed.
**Fix:** Map the `?tab=` value: workspace → getting-started, alerts → dashboard-deadlines, notes → client-profiles, data → import-export, security/backup → security-backups, about/appearance → tips-shortcuts.
**Constraint check:** no schema change · touches src/renderer/components/layout/TopBar.tsx:22-36

### UX-E-14 · Major · S
**Where:** Contacts → provider detail → trash icon → confirm (shot: C5-contact-delete.png)
**What Linda sees / thinks:** "This deletes the provider for good … It doesn't go to the Trash. You can undo it right away with Ctrl+Z."
**Why it's a problem:** Providers skip the Trash that every client gets, and the only way back is a keyboard shortcut Linda never uses. The top-bar Undo button would work too, but the dialog doesn't say so.
**Fix:** Say "You can undo it right away with the Undo button at the top of the window", and show the standard Undo toast after deleting. (Moving providers into the Trash would be the real fix but needs a migration; out of scope.)
**Constraint check:** no schema change · touches src/renderer/components/contacts/ContactDetail.tsx (delete confirm text)

### UX-E-15 · Major · S
**Where:** Settings → Deadlines & reminders, tab order (shots: 02-tab-alerts-1.png … -3.png)
**What Linda sees / thinks:** The tab is named for deadline rules; the rules are the fourth section, two screens down, after Reminders, Contact requirements and Days off. At 768 she sees only "Reminders" and the top of "Contact requirements" and thinks she's on the wrong tab.
**Why it's a problem:** The section Linda is sent to by every "Deadline rule" menu and FAQ is the one she can't see.
**Fix:** Order: Deadline rules, Contact requirements, Reminders, Days off. Or split the tab into "Deadlines" (rules, requirements, days off) and "Reminders".
**Constraint check:** no schema change · touches src/renderer/components/settings/AlertsSection.tsx:40-50

### UX-E-16 · Minor · S
**Where:** New deadline rule, first field (shot: 20-rule-new-default.png)
**What Linda sees / thinks:** "Columns from which caseload?" with a dropdown holding her only caseload, before the question she came for.
**Why it's a problem:** With one caseload the question has no answer to give; it exists for the preview and the "from another date" column list. Linda wonders whether a rule belongs to a caseload.
**Fix:** Hide the dropdown when there is one caseload (`ruleList.choices.length > 1`); when shown, label it "Preview and columns from" and move it beside the Preview box.
**Constraint check:** no schema change · touches src/renderer/components/alerts/AlertRuleEditor.tsx:397-406

### UX-E-17 · Minor · S
**Where:** Help landing (shots: 40-help-landing.png, 50-help-1280.png)
**What Linda sees / thinks:** Title, search, a green "Need your supervisor's or IT's OK?" card, a "What's new" button, a big blue "Retake the full tour" card, ten chips — and the first question is the last line on screen (off screen at 720).
**Why it's a problem:** At the moment of confusion she wants a question that looks like hers, within the first screen.
**Fix:** Put the chips and the first category directly under the search; move the three promo cards into a slim row of three small buttons or to the bottom.
**Constraint check:** no schema change · touches src/renderer/views/HelpView.tsx:214-251

### UX-E-18 · Minor · S
**Where:** Settings → About, after "Check for updates" (shot: 09-about-after-check-2.png)
**What Linda sees / thinks:** "You have the latest version." Right below: "How to update Pulse — 1. Click Download update above." There is no Download button.
**Why it's a problem:** Instructions for a button that isn't there; Linda looks for it.
**Fix:** Show "How to update Pulse" only when an update is available (or under a collapsed "When an update is available…" heading), and start step 1 with "When a newer version shows here, click Download update."
**Constraint check:** no schema change · touches src/renderer/components/settings/AboutSection.tsx, src/renderer/utils/platformText.ts:47-86

### UX-E-19 · Minor · S
**Where:** Settings opens on Appearance; Workspace is first in the list (shot: 01-settings-landing.png; SettingsView.tsx:66)
**What Linda sees / thinks:** The third item is highlighted; the first two aren't. Is this a different page?
**Why it's a problem:** A list whose first item isn't the default reads as a mistake. "Workspace" also means nothing to Linda ("Words, features and ready-made examples" is the useful part).
**Fix:** Open on the first tab, and rename it "Words & features".
**Constraint check:** no schema change · touches src/renderer/views/SettingsView.tsx:66, 111

### UX-E-20 · Minor · S
**Where:** Settings → Deadlines & reminders → Reminders with the Reminders switch off (shot: 02-tab-alerts-1.png vs 11-alerts-with-requirements-1.png)
**What Linda sees / thinks:** A section titled "Reminders" with one checkbox ("Summary when I first unlock Pulse"). She wanted a morning notification; nothing here.
**Why it's a problem:** The desktop reminder, event reminders and background mode appear only after the Reminders switch, which lives on another tab, is on. Same pattern as UX-E-02.
**Fix:** A `FeatureOffer` row under the checkbox: "Want a desktop notification each morning? Turn on Reminders."
**Constraint check:** no schema change · touches src/renderer/components/settings/AlertsSection.tsx:42-47

### UX-E-21 · Minor · S
**Where:** Settings → Case notes → Kinds of case notes (shots: A6c-note-kind-delete.png, A6d-note-kind-archive.png)
**What Linda sees / thinks:** Every kind has "Archive" and "Delete". Delete on "Note" → red toast "This type is used by 14 case notes. Archive it instead." Archive → the row vanishes at once, no confirm, no undo toast.
**Why it's a problem:** An enabled button that always fails, and a one-click action that removes a choice from every note box with no "Undo". (Archived kinds do have an "Archived (n)" section further down with Restore — ActivityTypesEditor.tsx:149 — but Linda doesn't know that yet.)
**Fix:** Disable Delete with the caption "Used by 14 case notes — archive instead"; after Archive show "Phone archived. Restore" inline.
**Constraint check:** no schema change · touches src/renderer/components/settings/ActivityTypesEditor.tsx:60-90

### UX-E-22 · Minor · S
**Where:** Contacts → provider cards and detail header (shot: 72-contact-detail.png)
**What Linda sees / thinks:** A grey pill "Unknown" under every provider's name. Unknown what?
**Why it's a problem:** It's the availability status ("Accepting / Waitlist / Not Accepting / Unknown") with no label; the one value every new provider has is the one that explains nothing.
**Fix:** Hide the pill when availability is unknown, or render it "Availability: not checked" and make it the button that opens the status picker.
**Constraint check:** no schema change · touches src/renderer/components/contacts/AvailabilityBadge.tsx, ContactCard.tsx

### UX-E-23 · Minor · S
**Where:** Contacts → provider detail → "Mark as Checked Today" (shot: 72-contact-detail.png; ContactDetail.tsx:300)
**What Linda sees / thinks:** A button under the phone number. Checked for what? She may think it logs a contact.
**Why it's a problem:** It records that the availability status was confirmed today; nothing on screen connects it to availability.
**Fix:** Put it in an "Availability" block: "Availability: Unknown — last checked never — [I checked today]".
**Constraint check:** no schema change · touches src/renderer/components/contacts/ContactDetail.tsx:280-305

### UX-E-24 · Minor · S
**Where:** Contacts → provider detail header (shot: 72-contact-detail.png)
**What Linda sees / thinks:** Five icon-only buttons (star, printer, down-arrow, pencil, red trash). She hovers each to learn what it is.
**Why it's a problem:** Edit and Delete are the two actions she needs; both are 16-px glyphs.
**Fix:** Text buttons "Edit" and "Delete"; keep star/print/vCard as icons under a "More" menu.
**Constraint check:** no schema change · touches src/renderer/components/contacts/ContactDetail.tsx:183-220

### UX-E-25 · Minor · S
**Where:** Contacts page naming (shots: 70-contacts.png, 02-tab-workspace-4.png)
**What Linda sees / thinks:** Sidebar "Contacts"; page title "Contacts · 3 providers"; buttons "Add Provider", "Search providers…", "Import Providers (vCard)"; feature switch "Provider directory"; Help category "Contacts"; client profiles say "Linked Providers".
**Why it's a problem:** Two words for one thing on one screen. The vocabulary layer has separate keys for the page ("contacts") and the people ("provider"), which is right, but the page title should carry the people word too.
**Fix:** Title the page with the page word and subtitle with the people word consistently ("Contacts — your provider directory"), and name the feature switch after the page word ("Contacts page").
**Constraint check:** no schema change · touches src/renderer/views/ContactsView.tsx:200, src/shared/features.ts:44

### UX-E-26 · Minor · S
**Where:** Letters → Edit / New template (shots: 64b-letter-edit.png, 64e-letter-new.png)
**What Linda sees / thinks:** A monospace box full of `{{client_name}}` and `{{case_manager_name}}`; the preview on the page behind shows friendly chips ("client name"). "Insert a detail" adds more braces.
**Why it's a problem:** The editor shows the code form of what the preview shows in words. Linda can't tell what `{{field:Status}}` will print.
**Fix:** Keep the text box but show a live preview pane beside it (the chip renderer from the read view), and make "Insert a detail" the primary way in: a dropdown of plain names ("Client's name", "Today's date", "Your name").
**Constraint check:** no schema change · touches src/renderer/views/letter-template/EditTemplateModal.tsx

### UX-E-27 · Minor · S
**Where:** Letters → Placeholder Reference (shot: B9-letter-placeholders-2.png; PlaceholderReference.tsx:9, 12, 74)
**What Linda sees / thinks:** "{{name}} — Name of the {record}" and "A column of a linked {record}".
**Why it's a problem:** The `{record}` token is never filled: `f()` is applied to `group.label` but not to `item.desc`.
**Fix:** `{f(item.desc)}`.
**Constraint check:** no schema change · touches src/renderer/views/letter-template/PlaceholderReference.tsx:74 (add to tests/renderer/vocabStaticText.test.tsx)

### UX-E-28 · Minor · M
**Where:** Templates page vs Settings → Workspace → Share your setup vs Letters (shots: 62-templates.png, 02-tab-workspace-6.png)
**What Linda sees / thinks:** "Templates" has "Caseload templates (.pulse files)" and "Checklist Templates"; Settings has "Save my setup as a template…" (another file); the sidebar has "Letters" which are "Letter Templates". Four templates, two file kinds.
**Why it's a problem:** Linda can't predict which "template" does what; ".pulse file" is a file extension, not a thing she knows.
**Fix:** Rename on screen: "Caseload layouts" (Templates page), "Checklists", "Letters", and in Settings "Share my whole setup". Call the file "a layout file" and mention ".pulse" once in parentheses.
**Constraint check:** no schema change · touches src/renderer/views/TemplateManagerView.tsx:250-300, src/renderer/components/settings/WorkspaceSection.tsx:56-72

### UX-E-29 · Minor · S
**Where:** Snippets list (shots: 61-snippets.png vs B8b-snippet-delete-inline.png)
**What Linda sees / thinks:** Rows of "/att Attempted to contact…" with no buttons. Edit and Delete appear only on hover.
**Why it's a problem:** Hover-only controls; she doesn't know a snippet can be changed.
**Fix:** Always show "Edit" and "Delete" on each row (text, right-aligned).
**Constraint check:** no schema change · touches src/renderer/views/SnippetsView.tsx:340-385

### UX-E-30 · Minor · S
**Where:** New deadline rule → kind cards (shot: 20-rule-new-default.png; rule_kind_meter text: "This caseload has no number columns yet. Add one first, then come back.")
**What Linda sees / thinks:** Six cards; "By usage — Every 5,000 miles or 6 months" and "A limited number of visits — 12 sessions until the authorization ends". Picking "By usage" says she needs number columns.
**Why it's a problem:** Two of six choices can't apply to her caseload, and the examples are from other trades.
**Fix:** Grey out kinds whose required columns don't exist ("needs two number columns"); pick examples by the workspace's words (human services: "12 visits until the authorization ends", "every 6 months of service").
**Constraint check:** no schema change · touches src/renderer/components/alerts/RuleKindFields.tsx:15-49

### UX-E-31 · Minor · S
**Where:** Settings → Security → Change… → "Also re-encrypt my data" (shot: A1-security-change-password-2.png)
**What Linda sees / thinks:** Under the password boxes, a checkbox with a five-line paragraph about keys, old backups and recovery keys.
**Why it's a problem:** The option is for a specific situation (a password or key she thinks is compromised). Presented as a peer of "new password", it reads as something she should tick.
**Fix:** Collapse it under "Advanced: if someone may know your old password…" with the paragraph inside; keep the default off.
**Constraint check:** no schema change · touches src/renderer/components/settings/SecuritySection.tsx:230-244

### UX-E-32 · Minor · S
**Where:** Settings → Data → Cell history (shot: A4-data-integrity-2.png; DataSection.tsx:222-257)
**What Linda sees / thinks:** A dropdown "Keep 12 months" whose last option is "Delete all history", next to "Compact Now".
**Why it's a problem:** A destructive choice hidden in a retention dropdown; the section text ("audit and undo capabilities") is jargon.
**Fix:** Keep the dropdown to periods; put "Delete all history…" as a separate secondary button with a confirm; reword: "Pulse keeps a record of every cell change so you can see what a value used to be. Keep: 6 / 12 / 24 months."
**Constraint check:** no schema change · touches src/renderer/components/settings/DataSection.tsx:222-257

### UX-E-33 · Minor · S
**Where:** Top bar: "?" circle (Help for this page) next to "Press ? for shortcuts" (shot: 47-palette-open.png top right)
**What Linda sees / thinks:** Two question marks side by side meaning different things; the grid's tip bar says "Press Shift+? for all shortcuts", the overlay says "Press ? anywhere".
**Why it's a problem:** Mixed signals about one key; the help button is unlabelled.
**Fix:** Label the button "Help" with the icon; drop the "Press ? for shortcuts" hint from the top bar (it's in the Help page and the overlay); use one spelling of the key everywhere.
**Constraint check:** no schema change · touches src/renderer/components/layout/TopBar.tsx:350-362, grid tip bar

### UX-E-34 · Minor · S
**Where:** Settings → Deadlines & reminders → Contact requirements section text (shot: 11-alerts-with-requirements-1.png; ContactRequirementsSettings.tsx:29)
**What Linda sees / thinks:** "How many case notes each client needs per calendar month" — but the Set up… dialog offers "a week / a month / a quarter / a year".
**Why it's a problem:** The section promises monthly only; the FAQ says per week/quarter/year.
**Fix:** "…needs in a period (a week, month, quarter or year), counted from the case notes you log."
**Constraint check:** no schema change · touches src/renderer/components/contact-req/ContactRequirementsSettings.tsx:28-30, ContactRequirementsDialog.tsx:83

### UX-E-35 · Polish · S
**Where:** Settings → Deadlines & reminders → rule list (shot: 27-alerts-after-create-3.png)
**What Linda sees / thinks:** "Due date / The date entered is the deadline / The date entered is the deadline" and a new rule titled "The date entered is the deadline" with the same line under it.
**Why it's a problem:** The description and the summary repeat the name.
**Fix:** Skip the summary line when it equals the name or the description; when a new rule is identical to an existing one, offer "Use 'Due date' instead?".
**Constraint check:** no schema change · touches src/renderer/components/settings/AlertsSection.tsx:67-78

### UX-E-36 · Polish · S
**Where:** Keyboard shortcuts overlay (shot: 48-shortcuts-overlay.png; src/shared/shortcuts.ts:31)
**What Linda sees / thinks:** "Redo (or Mod+Shift+Z)".
**Why it's a problem:** "Mod" is the code name for Ctrl/Cmd; the keys beside it already say Ctrl.
**Fix:** Run the description through `modHelp` or write "or Ctrl+Shift+Z".
**Constraint check:** no schema change · touches src/shared/shortcuts.ts:31, src/renderer/components/shared/KeyboardShortcutsModal.tsx

### UX-E-37 · Polish · S
**Where:** Command palette, search "Maria" (shot: 47c-palette-maria.png)
**What Linda sees / thinks:** Four "Maria Garcia · Social Worker Caseload" under CLIENTS — SOCIAL WORKER CASELOAD, then the same four again under ALL CASELOADS.
**Why it's a problem:** With one caseload the two groups are the same list.
**Fix:** Hide the "All caseloads" group when there is one caseload, or exclude the open caseload's hits from it.
**Constraint check:** no schema change · touches src/renderer/components/shared/CommandPalette.tsx:249-300

### UX-E-38 · Polish · S
**Where:** Settings → Data → File association (shot: A4-data-integrity-2.png; DataSection.tsx:313)
**What Linda sees / thinks:** "On Linux, .pulse file association is handled automatically for .deb installs. For AppImage, use AppImageLauncher…"
**Why it's a problem:** There is no .deb any more (Decision Log 2026-10-11); AppImageLauncher is a third-party tool Linda won't have.
**Fix:** "On Linux, double-clicking a .pulse file isn't set up automatically. Open the file from Templates → Import .pulse File instead."
**Constraint check:** no schema change · touches src/renderer/components/settings/DataSection.tsx:311-315

### UX-E-39 · Polish · S
**Where:** Settings → Workspace → Words table (shot: 02-tab-workspace-2.png)
**What Linda sees / thinks:** The Requirements row's boxes read "contact requireme" and "contact requireme".
**Why it's a problem:** The inputs are narrower than the default values; she thinks the word is misspelt.
**Fix:** Let the two inputs wrap below the label on narrow panels, or widen the panel (`max-w-xl` → `max-w-2xl`).
**Constraint check:** no schema change · touches src/renderer/components/settings/WordsEditor.tsx:172, src/renderer/views/SettingsView.tsx:172

### UX-E-40 · Polish · S
**Where:** Settings → Appearance (shot: 01-settings-landing.png)
**What Linda sees / thinks:** "UI Scale — Adjust the overall interface size", a number box, a slider 50%–200%, "Ctrl+= / Ctrl+- to zoom".
**Why it's a problem:** "UI" is jargon; the thing she wants is "make the text bigger".
**Fix:** "Text and button size" with three presets (Normal / Larger / Largest) above the slider.
**Constraint check:** no schema change · touches src/renderer/components/settings/AppearanceSection.tsx

### UX-E-41 · Polish · S
**Where:** Settings → Profile (text: "This information is used to fill in letter template placeholders like {{my_name}}")
**What Linda sees / thinks:** Braces again; she's never seen a placeholder.
**Why it's a problem:** The sentence explains the tab with the one concept Linda doesn't have. It also omits that reports and the handoff packet print this.
**Fix:** "Your name and title go on letters, reports and handoff packets you print."
**Constraint check:** no schema change · touches src/renderer/components/settings/ProfileSection.tsx

### UX-E-42 · Polish · S
**Where:** Settings → Case notes → Edit note formats… (shot: A6-note-formats.png)
**What Linda sees / thinks:** A dialog listing DAP/SOAP/BIRP acronyms, "Your own formats: one section name per line", and a "New format" button. Nothing shows what a format does to a note.
**Why it's a problem:** Abstract; she'd close it.
**Fix:** Show one example format expanded ("Who / What happened / Next steps" as three boxes) and say "Each line becomes a box in the note".
**Constraint check:** no schema change · touches src/renderer/components/settings/NotesSection.tsx (formats dialog)

### UX-E-43 · Polish · S
**Where:** Help → "Retake the full tour" card (shot: 43-help-expanded.png — the tour started from a stray click)
**What Linda sees / thinks:** A large blue card; one click leaves Help and starts a 28-step tour.
**Why it's a problem:** It's the biggest target on the page and it navigates away without asking.
**Fix:** Make it a normal secondary button with a one-line confirm ("Start the 28-step tour? You can stop any time.").
**Constraint check:** no schema change · touches src/renderer/views/HelpView.tsx:231-251

## Checked and fine (no finding)
- 1280×720: the rule editor, Help, Contacts (toolbar wraps to two rows), Letters, Templates and the lock screen all fit; only the two navigation columns (UX-E-03, -04) are cut.
- Lock screen: wrong-password text, Caps Lock warning, show-password eye, "Forgot password?" → honest "No recovery key" page, and the post-unlock "1 wrong password attempt" notice.
- Trash: Restore / Delete (typed EMPTY, "Delete forever" with consequences), empty state.
- Backup: "Restore" asks for RESTORE and names what's replaced; "Move to a new computer" wizard; Danger zone needs the phrase and the password.
- Requirements "Set up…" dialog: three one-click presets, period per requirement.
- Undo history panel: plain "Action History", "No actions to undo".
- Update banner: not reachable (the launch check returns "latest" in the test build); copy reviewed in platformText.ts only.
