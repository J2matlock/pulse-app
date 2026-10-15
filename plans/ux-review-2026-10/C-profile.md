# C — the client profile page

Reviewed 2026-10-14 as "Linda" (mouse only, reads everything, no shortcuts). Spec: `e2e/ux-review/C.spec.ts`;
shots in `ux-review-shots/C/` (each `.png` has a `.txt` with the screen text). Two runs: the "Human services
example" workspace as it ships (60–77 with every feature on; 80–84 with the blank-workspace defaults), at
1366×768 and 1280×720 (50–52, 75).

## Summary

**Three worst problems**
1. **The change timeline is effectively hidden.** Column changes ("Program changed to …") live inside the Case log but only
   appear after switching **Show:** from "All case notes" to "Case notes and changes"; the entries are labelled **System**
   with a wrench; the column setting, the Help FAQ and the Extend dialog all call it "the timeline", a word that appears
   nowhere on the page. The owner could not find it; Linda never will (UX-C-01).
2. **The case log is two screens down.** Past notes start ~1,100 px below the top: header, note box, four deadline cards,
   then a 16-field "Client details" block that is mostly "—". "What happened last time?" is the main reason to open a
   client, and it's the last thing shown (UX-C-02).
3. **Duplicate makes an identical twin with no sign which is which**, and the blank-workspace profile gives no hint that
   Files, Appointments, Letters or Linked contacts exist or how to turn them on (UX-C-03, UX-C-04).

**What works well**: the note box (kinds as chips, "When", follow-up date, "/" snippets, the mileage offer after a note
mentions miles); deadline cards with Done/Extend and an Undo toast; every destructive action has a plain-English confirm
and Undo; the Audit trail, Handoff and Print dialogs explain themselves in one sentence; edit history and voiding keep
the record honest; the archived banner with Unarchive; the "not found / in the Trash" pages.

Counts: Blocker 0 · Major 7 · Minor 20 · Polish 14 (41 findings).

---

### UX-C-01 · Major · S
**Where:** Case log → "Show:" filter (shots: ux-review-shots/C/19-notes-log.png, 22-show-notes-and-changes.png, 22b-show-notes-and-changes-more.png, 23-show-changes-only.png)
**What Linda sees / thinks:** She turned on "Log changes in timeline" for the Program column (grid column menu), changed a client's program, opened the client and sees… three notes. Nothing says a change was recorded. The Show dropdown reads "All case notes", so she assumes she is seeing everything. If she ever picks "Case notes and changes" she gets grey cards labelled **System** with a wrench icon ("Program changed to 'Behavioral Health'"), which reads like an error log.
**Why it's a problem:** The feature is advertised as "the Activity Timeline in the profile" (Help FAQ, `src/renderer/views/help/faqData.tsx:224`) and "Log changes in timeline" (`src/renderer/components/grid/ColumnSettingsDialog.tsx:56`), and the Extend dialog says a reason "shows in the timeline and audit trail" (`src/renderer/views/dashboard/ExtendDeadlineDialog.tsx:41`). There is no "timeline" on the page; the only trace is a dropdown option. Default is `show = 'notes'` (`src/renderer/components/profile/CaseLog.tsx:229`), options at 840–843, and system entries render with the generic label from `src/shared/activityTypes.ts:24` ('System', 🔧).
**Fix:** (a) When the record has change entries and the filter hides them, show a line under the Show row: "3 changes to columns are hidden — Show them" (link sets `show = 'everything'`). (b) Rename the entry label from "System" to "Change" with a pencil/arrows icon, and show the column name as the heading ("Program changed"). (c) Use one word everywhere: the column setting becomes "Record changes in the {activityLog}", the FAQ and the Extend dialog say "{activityLog}" instead of "timeline", and the Show options become "{Activity:many} only" / "{Activity:many} and column changes" / "Column changes only". (d) Consider making "and changes" the default when the record has any.
**Constraint check:** no schema change · touches CaseLog.tsx, CaseLogEntry.tsx, activityTypes.ts, ColumnSettingsDialog.tsx, faqData.tsx, ExtendDeadlineDialog.tsx

### UX-C-02 · Major · M
**Where:** Profile main column layout (shots: 01-profile-top.png, 02-profile-scrolled-500.png, 03-profile-scrolled-1100.png)
**What Linda sees / thinks:** Header, "Add a case note…", four deadline cards, then "Client details — Showing 16 of 16 columns" with two columns of mostly "—", and only at ~1,100 px the "Case log (3)". She opened the client to see what she wrote last time and has to scroll past two screens of empty fields.
**Why it's a problem:** The order in `src/renderer/views/ProfileView.tsx:531–551` puts DeadlinePanel and the details block *between* the note box and the list (`between=`); `CollapsibleSection … defaultExpanded` at 542 keeps the 16-field block open, and `GridDataSummary` shows every column including empty ones.
**Fix:** Keep the note box first, then the deadlines, then the **Case log**, and move "Client details" below the log (or collapse it by default and show the count of filled fields in its title: "Client details (4 filled)"). In GridDataSummary, hide empty columns by default with a "Show 12 empty columns" link. The sections are already collapsible per list, so this is an ordering/default change.
**Constraint check:** no schema change · touches ProfileView.tsx, GridDataSummary.tsx

### UX-C-03 · Major · S
**Where:** More → Duplicate (shots: 48-after-duplicate.png, 49-grid-after-duplicate.png)
**What Linda sees / thinks:** A toast "Duplicated 'Maria Garcia'" and the page stays on… one of the two Maria Garcias (the "9 of 48" counter disappears and Prev/Next go grey). The list now has two identical "Maria Garcia" rows with the same tag.
**Why it's a problem:** Nothing marks the copy ("(copy)" suffix, a different name, or opening the copy). Two identical clients in an 80-person caseload means the next note or deadline lands on the wrong one. `ipc-row.ts:447–462` copies every cell including the name; `gridRowSlice.ts:216` only reloads.
**Fix:** Name the copy "<name> (copy)" and open its profile after duplicating (the toast then says "Opened the copy — rename it"). Add one line to the More item: "Duplicate (copies details, not notes)" so she knows what carries over.
**Constraint check:** no schema change · touches src/main/ipc/ipc-row.ts, gridRowSlice.ts, ProfileView.tsx:327

### UX-C-04 · Major · M
**Where:** Blank-workspace profile vs. everything on (shots: 80-defaults-top.png, 82-defaults-bottom.png vs 60-all-on-top.png, 64-all-on-sections-expanded.png; Settings at 77-settings-features.png)
**What Linda sees / thinks:** With the defaults the page ends after the case log. No Files, no Appointments, no Letters, no Linked contacts, no Handoff. She has no idea those exist. The only way to learn is Settings → Workspace ("Words, features and ready-made examples"), scrolling past the words table to a "Features" list.
**Why it's a problem:** `ProfileView.tsx:555–585` simply omits hidden sections; the FeatureOffer pattern (`src/renderer/components/shared/FeatureOffer.tsx`) exists but is only wired for time and mileage. "Workspace" and "feature" are words Linda doesn't have; the README persona says so.
**Fix:** Add a quiet "More you can add to this {record}'s page: Files · Appointments · Letters · Linked {contact:many} — turn on in Settings" line at the bottom of the profile when any of those features is off (dismissable, like FeatureOffer), each name opening Settings → Workspace scrolled to Features. In the More menu add "Add more sections…" pointing at the same place. Rename the Settings tab subtitle to "Words, what's shown, examples".
**Constraint check:** no schema change · touches ProfileView.tsx, FeatureOffer.tsx (or a sibling), SettingsView.tsx:111

### UX-C-05 · Major · S
**Where:** Generate Letter → Fill in letter (shot: 68-letter-filled.png)
**What Linda sees / thinks:** "My name is , and I will be your assigned case manager…" and a signature line that is empty. Nothing says why or where her name comes from.
**Why it's a problem:** `{{case_manager_name}}` resolves to `profile.profile_name ?? ''` (`src/main/placeholders.ts:149`), and `UnknownPlaceholders` (`RecordLetterDialog.tsx:110`) only warns about unknown tokens, not empty ones. She would print a letter with a hole in it, or give up on letters.
**Fix:** When the fill resolves a `case_manager_*` placeholder to an empty string, show a yellow line above the text: "Your name, title and organization are blank — add them in Settings → Profile so letters are signed" with a link. Keep the hole marked in the text ("[your name]") rather than silently empty.
**Constraint check:** no schema change · touches RecordLetterDialog.tsx, src/main/placeholders.ts (return which placeholders were empty)

### UX-C-06 · Major · S
**Where:** Note box → Format select (shots: 71-composer-format.png, 80-defaults-top.png, 81-defaults-scrolled.png)
**What Linda sees / thinks:** She tried "DAP" once out of curiosity. From then on, every client's note box opens with Data / Assessment / Plan boxes instead of a text box, including after a restart. The "Format" dropdown is the only way back and she doesn't connect the two.
**Why it's a problem:** `note_format_last` is saved on every choice and restored on load (`CaseLog.tsx:203–218`). Under the human-services words DAP/SOAP/BIRP/Contact note are built in, so a blank workspace shows them too (shot 80). Three empty textareas plus the "Saved as one case note with these headings" hint push the Add button off-screen.
**Fix:** Don't persist the format across records; default to "Free text" each time (remember per session at most). Or persist but show the headings inline with a visible "Switch to free text" link under the boxes.
**Constraint check:** no schema change · touches CaseLog.tsx:203–218

### UX-C-07 · Major · S
**Where:** Left column, Checklist (shots: 01-profile-top.png, 30-checklist-added.png, 33c-checklist-grouped.png, 50-small-top.png)
**What Linda sees / thinks:** The three header buttons wrap onto two rows ("Add with details…" alone, "Group" and "Templates" under it); item titles break mid-phrase ("Submit monthly / billing"); date chips break inside the date ("In 5 days · Oct / 19", at 1280 even "In 5 days · / Oct 19"); the group name is cut to "Housing paperw…". Each item is three lines tall, so four items fill the screen.
**Why it's a problem:** The column is `w-[28%] min-w-[300px] max-w-[420px]` (`ProfileView.tsx:489`); the toolbar (`ChecklistToolbar.tsx:29–58`) has three buttons; chips are `inline-flex` without `whitespace-nowrap` (`ChecklistItem.tsx:386–395`). It looks broken at the two most common laptop sizes.
**Fix:** Toolbar: keep only "+ Add with details…" and a "⋯" with Group / Templates; or move Templates into the add box ("+ Add an item… or pick a template"). Chips: `whitespace-nowrap` and drop the day-of-week ("Oct 19 · in 5 days" is enough). Give the column `min-w-[340px]` and let the title have the full width (date and priority on one row below).
**Constraint check:** no schema change · touches ProfileView.tsx:489, ChecklistToolbar.tsx, ChecklistItem.tsx

### UX-C-08 · Minor · S
**Where:** Header action row (shots: 01-profile-top.png, 08-audit-trail.png, 69-handoff-dialog.png, 05-more-menu.png)
**What Linda sees / thinks:** Five equal buttons: "+ Case note", "More ▾", "Generate Letter", "Audit trail", "Handoff packet". Three of them make PDFs (Audit trail, Handoff packet, and "Print / PDF…" hidden under More). "Audit trail" and "Handoff packet" mean nothing until clicked; the dialogs explain well, but the row doesn't.
**Why it's a problem:** `ProfileHeader.tsx:689–734` renders them as peers; the one everyday action (Case note) sits next to three once-a-year ones, and the most-used More item (Print) is hidden while rarer ones are promoted.
**Fix:** Row becomes: **+ Case note** · **Generate Letter** · **Print or save ▾** (Print / PDF…, Audit trail PDF…, Handoff packet…) · **More ▾** (Archive, Duplicate, Move, Trash). Keep the tooltips as the first line of each dialog (they already are).
**Constraint check:** no schema change · touches ProfileHeader.tsx, ProfileView.tsx:324–330

### UX-C-09 · Minor · S
**Where:** Scratch notes (shots: 30-checklist-added.png, 44-next-client.png, 36-scratch-pad-typed.png)
**What Linda sees / thinks:** A box titled "Scratch notes" with B/I/U and "Type / for snippets", otherwise blank. "How is this different from a case note? Does anyone see it? Does it print?"
**Why it's a problem:** No placeholder or one-line purpose (`ScratchPad.tsx:296–330`; the editor has no placeholder extension). The Print dialog and Handoff treat it as private ("Scratch notes" unchecked by default), but the page never says so.
**Fix:** Placeholder text in the empty editor: "Private jottings for you — reminders, numbers, things to ask. Not part of the {activityLog} and left out of printouts unless you choose to include them." Rename the header to "My notes about {name}" or "Scratch pad (private)".
**Constraint check:** no schema change · touches ScratchPad.tsx (tiptap Placeholder extension is in @tiptap/extensions)

### UX-C-10 · Minor · S
**Where:** Add contact info form (shot: 07-add-contact-info.png)
**What Linda sees / thinks:** "Type / Label / Value" with a checkbox "Add 'Phone' as a column, so every client has one and it shows in the caseload, search and exports". "Value?" And the checkbox is a big decision she can't evaluate.
**Why it's a problem:** `ProfileHeader.tsx:606–674`: "Value" is developer wording; fields are 36 px tall (below the 44 px rule); the "add as column" choice mixes a one-off entry with a list-wide change.
**Fix:** Labels "Kind / Name (e.g. Work phone) / Number or address". Move the column option out of the form: after saving, a quiet line "Want a Phone column for every client? Add it" (link). Make the inputs 44 px.
**Constraint check:** no schema change · touches ProfileHeader.tsx:606–674

### UX-C-11 · Minor · S
**Where:** Case log entry actions (shots: 20-note-hover-actions.png, 25-note-void-or-delete-ask.png)
**What Linda sees / thinks:** Four tiny grey icons (copy, pin, pencil, bin) at 14 px. The bin on a fresh note shows a red "Delete" button; on an older note the icon changes to a "ban" sign and the inline prompt asks for a "Reason (optional)" with a "Void" button. She doesn't know what voiding is or why she can't delete.
**Why it's a problem:** `CaseLogEntry.tsx:190–286`: icons are `w-3.5 h-3.5`; the void explanation is only in a `title` tooltip (277). The Delete-vs-Void rule (`canDelete`) is invisible.
**Fix:** 16 px icons with labels on hover is fine, but add one line in the void prompt: "Notes older than a day aren't deleted — voiding hides them and keeps them in the record. Say why (optional):". For the fresh-note case, "Delete" is fine. Put "Show voided" only when a voided note exists (see UX-C-26).
**Constraint check:** no schema change · touches CaseLogEntry.tsx

### UX-C-12 · Minor · S
**Where:** Note box when opened from the header button (shot: 13-composer-open.png)
**What Linda sees / thinks:** Clicking "+ Case note" opens the box with the cursor in it, but the "Add" button is below the fold at 768 px; the only save hint is in the placeholder, which disappears as she types. She types, looks for a Save button, scrolls, finds "Add" at the right edge.
**Why it's a problem:** `CaseLog.tsx:586–807`: the kind chips, When/Format row and a 3-row textarea push "Add" ~560 px below the top of the box; the Ctrl+Enter hint lives in the placeholder (695).
**Fix:** Put "Add {activity}" (primary, 44 px) at the top-right of the box next to the chips as well, or keep the box compact (kind chips + text + Add, with When/Format/Follow-up as a "More options" row). Keep the Ctrl+Enter mention as static help text under the box, not in the placeholder.
**Constraint check:** no schema change · touches CaseLog.tsx

### UX-C-13 · Minor · S
**Where:** Client details block (shots: 02-profile-scrolled-500.png, 03-profile-scrolled-1100.png, 43-details-choose-columns.png)
**What Linda sees / thinks:** "Showing 16 of 16 columns" then Name, Date of Birth —, Phone —, Email —, Address —, Case Open Date —, … twelve dashes. A gear icon with no label opens a checkbox list with "Text / Date / Phone" type words.
**Why it's a problem:** `GridDataSummary.tsx:273–346` shows every column; the picker (279–318) is icon-only and shows column *types*, which Linda doesn't need. Two "Phone" rows (header shows one phone, details another) add confusion.
**Fix:** Default to filled columns, with "12 empty — show" inline. Replace the gear with a text button "Choose columns". Drop the type word in the picker. Clicking "—" should start editing (it does for text; make it obvious with "Add…" in place of "—").
**Constraint check:** no schema change · touches GridDataSummary.tsx

### UX-C-14 · Minor · S
**Where:** Deadline cards after "Done" (shots: 38-deadline-panel.png, 40b-deadline-after-done.png)
**What Linda sees / thinks:** She clicks Done on "Last Contact" (first card). The cards reorder: Annual Review jumps to the first slot and Last Contact moves right. Her eye was on the left card; it now shows a different deadline.
**Why it's a problem:** `DeadlinePanel.tsx` sorts by urgency; after Done the completed one drops. Jumping cards right under the mouse is disorienting (the Undo toast helps, but she may think she marked the wrong one).
**Fix:** Keep card order stable for the life of the page (sort on mount / record change only), or animate the move.
**Constraint check:** no schema change · touches DeadlinePanel.tsx (sort memo)

### UX-C-15 · Minor · S
**Where:** Deadline card date editing (shot: 39-deadline-editing.png)
**What Linda sees / thinks:** Clicking "Last done Sep 25, 2026" turns it into a bare date box with Save/Cancel. No label says whether she is editing the "last done" date or the due date; the card title "LAST CONTACT" is the only context.
**Why it's a problem:** `DeadlinePanel.tsx:364–406`: the edit mode drops the "Last done" wording. For repeating rules the stored date is the last-done date, which is the opposite of what "deadline" suggests.
**Fix:** Keep a label in edit mode: "Last done on [date]" (repeating rules) or "Due on [date]" (plain dates). Add "Next due Oct 25 (worked out from this date)" under it.
**Constraint check:** no schema change · touches DeadlinePanel.tsx:364–406

### UX-C-16 · Minor · S
**Where:** Archive confirm (shot: 11-archive-confirm.png)
**What Linda sees / thinks:** "An archived client leaves the caseload and stops showing deadlines. You can bring it back any time (Show archived)." — "Show archived" where? She has never seen that control.
**Why it's a problem:** `ProfileView.tsx:616`; the control lives in the grid's View menu, unnamed here.
**Fix:** "…You can bring it back any time from the {list}: View ▾ → Show archived, then Unarchive." Also consider "Archive (keep, but hide from the list)" as the confirm label so the verb is explained.
**Constraint check:** no schema change · touches ProfileView.tsx:613–626

### UX-C-17 · Minor · S
**Where:** After Archive (shot: 46-after-archive-lands-on-next.png)
**What Linda sees / thinks:** She archives Maria; the page silently becomes James Smith ("10 of 48") with a small toast at the bottom. For a second she thinks the archive renamed the client. The counter still says 48 although one left the list, and the back button now reads just "Back".
**Why it's a problem:** `leaveRecord()` (`ProfileView.tsx:302–306`) jumps to the next record; the list isn't reloaded so `sortedRowIds` keeps the archived one; `backLabel` (289–291) falls back to "Back" when the previous page was a profile.
**Fix:** After Archive/Trash go back to the list (where the row disappears visibly) unless she came from Prev/Next; refresh the counter; keep the list name as the back label when the previous page was another record of the same list.
**Constraint check:** no schema change · touches ProfileView.tsx:283–306

### UX-C-18 · Minor · S
**Where:** Linked Providers section (shots: 04-profile-bottom.png, 64-all-on-sections-expanded.png, 66b-linked-contact.png)
**What Linda sees / thinks:** "Linked Providers (0)" collapsible header, and inside it another "Linked Providers (0)" header with a "Link Provider" button; when linked, each row has "Details" and an unlabeled "×".
**Why it's a problem:** `ProfileView.tsx:581–585` wraps `LinkedProviders`, which draws its own header (`LinkedProviders.tsx:216–235`). The "×" is `aria-label="Unlink …"` (351) but visually it reads as "close/delete".
**Fix:** Drop the inner header and put "+ Link {contact}" in the CollapsibleSection's title row (it already supports a count). Replace "×" with a small "Unlink" text button.
**Constraint check:** no schema change · touches ProfileView.tsx, LinkedProviders.tsx, CollapsibleSection.tsx (optional action slot)

### UX-C-19 · Minor · S
**Where:** Checklist toolbar words (shots: 01-profile-top.png, 33b-checklist-new-group.png, 34-checklist-templates.png)
**What Linda sees / thinks:** "Group" — a group of what? Clicking it instantly creates "New Group" in edit mode. "Templates" opens "Checklist Templates — No templates yet — Create your first template" with "Templates add items to the existing checklist without replacing them." She also sees "Templates" in the sidebar and wonders if it's the same thing.
**Why it's a problem:** Tooltip only (`ChecklistToolbar.tsx:44`); "group" and "template" are both words the persona doesn't have until explained.
**Fix:** "Group" → "Add a heading" (and the inline editor placeholder "Heading, e.g. Housing paperwork"). Templates dialog empty state: "A template is a ready-made set of checklist items (e.g. 'New client intake') you can add to any {record} in one click." Mention that the sidebar's Templates page is the same list.
**Constraint check:** no schema change · touches ChecklistToolbar.tsx, Checklist.tsx:1101–1115

### UX-C-20 · Minor · S
**Where:** Checklist completed section (code: `Checklist.tsx:785–821`, confirm text 887–899; not reached in the run)
**What Linda sees / thinks:** "Completed (1)   Reset cycle   Clear all". "Cycle?" The confirm says "Uncheck all 1 completed item for Maria Garcia? They'll be available to complete again."
**Why it's a problem:** "Reset cycle" is a recurring-checklist concept; most users just want "uncheck all" or "remove done items".
**Fix:** "Reset cycle" → "Uncheck all", "Clear all" → "Remove done items"; confirm copy "Uncheck 1 completed item so it can be done again?".
**Constraint check:** no schema change · touches Checklist.tsx

### UX-C-21 · Minor · S
**Where:** Print / PDF dialog (shots: 09-print-pdf-dialog.png, 74-print-dialog-all-on.png)
**What Linda sees / thinks:** "Recent case notes (last 10)" — she wants all of them for a case review and can't choose. "Other contact info" — other than what?
**Why it's a problem:** `ProfileExportDialog.tsx:42–49` hard-codes "last 10"; "Other contact info" means the manual phone/email entries, which the page itself just calls contact info.
**Fix:** A number field "Last [10] case notes" or a radio "Last 10 / All"; rename to "Extra phone numbers and emails".
**Constraint check:** no schema change (export already takes sections; add a count) · touches ProfileExportDialog.tsx, ProfilePrintLayout.tsx, src/main/export-pdf.ts

### UX-C-22 · Minor · S
**Where:** Missing-record page and top bar (shot: 45-missing-record.png)
**What Linda sees / thinks:** Breadcrumb "Social Worker Caseload › Unknown client" over "We couldn't find this client. It may have been deleted." Fine — but "Unknown client" also flashes in the top bar while a real client loads (shot 47, the archived page).
**Why it's a problem:** `TopBar.tsx:151–153` falls back to "Unknown {record}" while the row isn't in the store yet.
**Fix:** Show "Loading…" (or nothing) until the name is known; keep "Unknown" only for the not-found page.
**Constraint check:** no schema change · touches TopBar.tsx

### UX-C-23 · Minor · S
**Where:** Note "Show:" one-kind filter and empty states (shot: 24-show-one-kind-empty.png)
**What Linda sees / thinks:** Picks "Meeting" and gets "Nothing of this kind yet. Choose 'All case notes' under Show to see the rest." Good — but the count in the header disappears and the Show list mixes three *views* (all / and changes / changes only) with five *kinds* in one flat dropdown.
**Why it's a problem:** `CaseLog.tsx:839–844`; one select for two different questions.
**Fix:** Use `<optgroup>`s: "Show" (All notes · Notes and column changes · Column changes only) and "Only one kind" (Note, Phone, …). Keep the header count.
**Constraint check:** no schema change · touches CaseLog.tsx:839–844

### UX-C-24 · Minor · S
**Where:** Appointment dialog opened from the profile (shot: 65-schedule-appointment.png)
**What Linda sees / thinks:** "When it's done, log it as: Usual: Visit". She doesn't know what "log it as" means or what "Usual" refers to.
**Why it's a problem:** It means "after the appointment, add a case note of this kind"; "Usual" is the list's default kind. (Shared with slice D; reached from here.)
**Fix:** Label "After it happens, add a {activity} of this kind:" with options "Visit (the usual one)", "Phone", … and "Don't add one".
**Constraint check:** no schema change · touches src/renderer/components/calendar/AppointmentDialog.tsx

### UX-C-25 · Minor · S
**Where:** Star in the header (shots: 01-profile-top.png)
**What Linda sees / thinks:** A grey star next to the name. Tooltip "Star this client". What does starring do?
**Why it's a problem:** `ProfileHeader.tsx:396–412`; starred clients get a filter in the list ("Starred"), never explained here.
**Fix:** Tooltip "Star this {record} to find it quickly (the {list} has a Starred filter)"; after the first star, a one-time toast saying the same.
**Constraint check:** no schema change · touches ProfileHeader.tsx:401

### UX-C-26 · Minor · S
**Where:** Case log filter row (shot: 19-notes-log.png)
**What Linda sees / thinks:** "Show voided case notes" checkbox is always there, even on a client with no voided notes. "Voided? Did I void something?"
**Why it's a problem:** `CaseLog.tsx:846–849` renders it unconditionally.
**Fix:** Show it only when the record has at least one voided note ("Show 1 voided note"), otherwise hide.
**Constraint check:** no schema change · touches CaseLog.tsx (needs a voided count from the existing list call or `total` with voided)

### UX-C-27 · Minor · S
**Where:** Tag picker (shots: 06-tag-picker.png, 06b-tag-added.png)
**What Linda sees / thinks:** "TAGS — No tags yet — create one below — [New tag name…] Add". After adding "Housing" the picker stays open with a tick; she has to click elsewhere. Nothing says what tags are for versus the Program/Status columns she already has.
**Why it's a problem:** `ProfileHeader.tsx:438–544`; the popover has no close affordance and no purpose line.
**Fix:** One line at the top: "Tags are quick labels you can filter the {list} by." Add a "Done" button; close after creating a tag.
**Constraint check:** no schema change · touches ProfileHeader.tsx

### UX-C-28 · Polish · S
**Where:** Sub-navigation bar (shot: 01-profile-top.png)
**What Linda sees / thinks:** "‹ Social Worker Caseload | ‹ 9 of 48 › Alt+←/→ to navigate". The shortcut hint is permanent noise for a mouse user, and the back control says the list name instead of "Back to…".
**Why it's a problem:** `ProfileView.tsx:409–469`.
**Fix:** "‹ Back to Social Worker Caseload"; move the Alt hint into the Prev/Next tooltips only (they already have it).
**Constraint check:** no schema change · touches ProfileView.tsx:466–468

### UX-C-29 · Polish · S
**Where:** Scratch pad "/" menu (shot: 37-scratch-pad-slash.png)
**What Linda sees / thinks:** The snippet list is cut off at the right edge of the column and a horizontal scrollbar appears under the pad.
**Why it's a problem:** The menu is `absolute` inside an `overflow-auto` wrapper (`ScratchPad.tsx:322–364`, `max-w-72` wider than the 300 px column).
**Fix:** Render the menu with `position: fixed` and clamp to the viewport (`clampLeft` exists in `utils/domHelpers.ts`), or cap width to the column.
**Constraint check:** no schema change · touches ScratchPad.tsx

### UX-C-30 · Polish · S
**Where:** Dates on one page (shots: 03-profile-scrolled-1100.png vs 38-deadline-panel.png)
**What Linda sees / thinks:** The deadline card says "Last done Sep 25, 2026 · Next due Oct 25, 2026"; the details block says "09/25/2026 · On track"; notes say "Oct 14, 2026 at 8:14 PM"; checklist says "Oct 19".
**Why it's a problem:** `GridDataSummary` uses the list's date format while `DeadlinePanel`/`CaseLogEntry` use `formatDate`.
**Fix:** One format on the profile (the Settings → Date format one) everywhere.
**Constraint check:** no schema change · touches DeadlinePanel.tsx, CaseLogEntry.tsx formatDate

### UX-C-31 · Polish · S
**Where:** Deadline card "Extend…" link (shot: 38-deadline-panel.png)
**What Linda sees / thinks:** A small underlined "Extend…" next to the green "Done" button; it looks secondary and is 14 px.
**Why it's a problem:** `DeadlinePanel.tsx:457–458` uses `text-sm`; the 15 px rule.
**Fix:** `text-base` and the same button style as Done (secondary).
**Constraint check:** no schema change · touches DeadlinePanel.tsx:458

### UX-C-32 · Polish · S
**Where:** Edited note (shot: 27-note-edited.png)
**What Linda sees / thinks:** Italic "edited" in the header and, under the text, "▸ Edited Oct 14, 2026 at 8:14 PM — show earlier versions". Same fact twice.
**Why it's a problem:** `CaseLogEntry.tsx:161–165` plus `CaseLogEditHistory.tsx:30–33`.
**Fix:** Keep only the expandable line.
**Constraint check:** no schema change · touches CaseLogEntry.tsx

### UX-C-33 · Polish · S
**Where:** Format select (shots: 13-composer-open.png, 72-note-formats-dialog.png)
**What Linda sees / thinks:** The dropdown lists Free text, DAP, SOAP, BIRP, Contact note and then "Edit formats…", which opens a dialog instead of selecting. The dialog explains "Built in: DAP (Data, Assessment, Plan); …" which is the first time the abbreviations are expanded.
**Why it's a problem:** An action inside a select is unexpected; abbreviations without expansion in the select.
**Fix:** Show "DAP — Data, Assessment, Plan" in the options; replace the "Edit formats…" option with a small pencil button next to the select.
**Constraint check:** no schema change · touches CaseLog.tsx:657–665

### UX-C-34 · Polish · S
**Where:** Header "+ Case note" button and the "Add a case note…" box (shot: 01-profile-top.png)
**What Linda sees / thinks:** Two ways to do the same thing 40 px apart.
**Why it's a problem:** Redundant; the header button is the only coloured primary on the page and it just focuses the box below.
**Fix:** If UX-C-08 regroups the row, keep one: the header button opens the box; the collapsed box line can go (or vice versa).
**Constraint check:** no schema change · touches ProfileView.tsx:511, CaseLog.tsx:587–593

### UX-C-35 · Polish · S
**Where:** Mileage/time offer (shot: 18-after-add-note.png)
**What Linda sees / thinks:** After saving "drove 12 miles", a blue tip: "This case note mentions miles. Record mileage on case notes for your monthly claim? Turn on / Not now". Nice — but the note that triggered it has no miles, and the tip stays until she answers.
**Fix:** Add "(this note won't have them — add miles when you edit it)" or, on Turn on, open the saved note for editing with the Miles field focused.
**Constraint check:** no schema change · touches CaseLog.tsx:797–804

### UX-C-36 · Polish · S
**Where:** Files section text (shot: 64-all-on-sections-expanded.png)
**What Linda sees / thinks:** "Kept inside Pulse, encrypted like everything else. Drop files here to add them." then "No files yet." then "Files you open are copied outside Pulse while open; close them when you're done." Three lines of explanation for an empty list.
**Fix:** One line: "No files yet. Drop files here or click Add files… They're stored encrypted inside Pulse." Move the "copied outside while open" note to the moment a file is opened (toast).
**Constraint check:** no schema change · touches RecordFiles.tsx:59–64

### UX-C-37 · Polish · S
**Where:** Appointments section (shot: 64-all-on-sections-expanded.png)
**What Linda sees / thinks:** A right-aligned "Schedule…" button floating above "Coming up — Nothing scheduled."
**Fix:** "Nothing scheduled. + Schedule an appointment" on one line, left-aligned.
**Constraint check:** no schema change · touches RecordAppointments.tsx:51–60

### UX-C-38 · Polish · S
**Where:** Handoff dialog (shots: 69-handoff-dialog.png, 69b-handoff-archive-on.png)
**What Linda sees / thinks:** Clear. Minor: "Include pictures from Files as pages" reads oddly; "Notes for the next case manager" fine.
**Fix:** "Add photos from Files as extra pages".
**Constraint check:** no schema change · touches HandoffDialog.tsx:104

### UX-C-39 · Polish · S
**Where:** Trash confirm (shot: 12-trash-confirm.png)
**What Linda sees / thinks:** "It stays in the Trash for 30 days, and you can restore it from there or with Undo." Good. "It" after "Move Maria Garcia to the Trash?" reads as "it" = a person.
**Fix:** "Maria Garcia stays in the Trash for 30 days…" (use the name).
**Constraint check:** no schema change · touches ProfileView.tsx:631

### UX-C-40 · Polish · S
**Where:** "Fill in a form: Intake" row (shot: 60-all-on-top.png)
**What Linda sees / thinks:** A loose label and button between the header and the note box; "Intake" alone doesn't say it's a form that fills this client in.
**Fix:** Move it into the header action row as "Forms ▾" or into Client details ("Fill in from a form: Intake").
**Constraint check:** no schema change · touches ProfileView.tsx:520–529

### UX-C-41 · Polish · S
**Where:** Sidebar under the profile (every shot, e.g. 01-profile-top.png, 50-small-top.png)
**What Linda sees / thinks:** The sidebar's "Letters" (and at 1280×720 "Templates") entry is half hidden under the bottom block (Focus Mode / Settings / Help / Lock). Cross-reference for slice E; it shows on every profile screenshot.
**Fix:** Let the whole sidebar scroll or shrink the bottom block.
**Constraint check:** no schema change · touches src/renderer/components/layout/Sidebar.tsx
