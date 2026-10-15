# Karen Lindqvist-Bell — persona session (2026-10-15)

## 1. Who I am
Karen Lindqvist-Bell, 58. School social worker and team lead for four elementary schools, with 60 students on IEP minutes. Former Army Reserve logistics NCO. I don't trust a tool until I've tested it myself, and I judge a program by its worst error message.

My legal pad for this planning period:
- **MUST:** the words say "students"; backup and restore proven; recovery key works; a monthly report I can hand Dr. Abernathy; I can see the history of a change.
- **WOULD BE NICE:** my two staff can use the same setup.

## 2. Diary (Thursday, 1:10–2:00, door closed)

**1:10 — The password screen.** It says "Your data is encrypted with it" right at the top. Noted. I try to break it first. `karen1966` gives "Too short — Use at least 12 characters. A short sentence is easy to remember." (02a-short-password.png). Then I type two different passwords on purpose and get two messages: "Passwords do not match" under the box and "The two passwords don't match. Type the same password in both boxes." above the button (02b-mismatch.png). Both are clear, if a little repeated. I add a hint only I would understand and agree to the terms. 3 attempts, about 2 minutes.

**1:13 — Recovery key offer.** "Without one, a forgotten password means permanent data loss." (02d-after-password.png). Straight talk. I close the window to check something before I deal with it. When I reopen Pulse, the offer is gone (03a-relaunch.png). Later, a small reminder at the bottom of the screen brings it back ("Save a recovery key (1 minute)…", 09a-after-unlock.png). Acceptable.

**1:14 — Setup.** I enter my name, title and district (04a-your-name.png). "How do you want to start?" gives three choices (04b-how-start.png). I open "Start from an example" and then "More examples". The list is very long: tree service, horse barns, truck drivers (06a-more-examples.png). Under EDUCATION AND YOUTH there's no "school social worker". "Special education" is the closest ("For IEP case managers…"), so I pick it. Before I click Add, it shows me exactly what will change. It lists the columns, the words "records → students, lists → rosters", the features, and sample data (08a-details-expanded.png). It's showing me, not telling me. Good. About 4 minutes.

**1:18 — First look at the roster.** "Search students…", "+ Add Student", "12 students", and a yellow banner saying the samples are made up (09a-after-unlock.png). The words say students. One MUST is half done; I still have to hunt for leftovers.

**1:19 — Recovery key, for real.** The reminder didn't come back on this launch (10-no-toast.png), so I go where the setup screen told me: Settings → Security. There's a "Security checkup: 2 of 4" box that lists exactly what's missing (10b-security.png). I click "Make a recovery key" and type a wrong password on purpose. "That password is incorrect." (11b-wrong-pw.png). Then the right one. The key appears with Copy, "Print a recovery card" and a tick box "I have saved this recovery key somewhere safe" (11c-key-shown.png). I copy it onto my legal pad.

**1:22 — Using the recovery key.** I lock Pulse and click "Forgot password?" (13b-forgot.png). It says "Enter the 28-character recovery key you saved during setup." I didn't save it during setup; I saved it in Settings. Small thing.
- I enter only the first two groups: "That key didn't match. Check each group of 4." (13c-partial-key.png). It isn't wrong, but it should tell me the key is too short.
- I enter a wrong last character: the same message (13d-wrong-key.png).
- I enter the real key in lowercase, with spaces instead of dashes, the way a tired person would. It takes it: "Recovery key accepted." and then "You must set a new password before continuing." (13e-right-key-lowercase.png). I set one and I'm back in my roster (13f-after-new-password.png). **Recovery proven.** 4 tries, about 3 minutes.

One question for the IT office: after I used the key, Settings still says "Recovery key active". Is the used key still good? Nothing tells me to make a new one.

**1:26 — Change my password.** Settings → Security → Change… (14a-change-pw.png). I type my current password wrong on purpose, fill in a strong new one and click "Save new password". **Nothing happens.** No red text, no message, nothing (14c-wrong-current.png). I do it again and watch closely: still nothing, even after 2.5 seconds (15b-wrong-2500.png, 15c-wrong-top.png). When I enter the right current password, I get "Password changed." (14d-changed.png). On a relaunch the new password works and the old one doesn't. Writing the worst message on this one was easy, because there wasn't one. That's not acceptable on the screen that guards the password.

The "Advanced: if someone may know your old password…" option ("Also give my data a new key") is exactly what I'd want after a stolen laptop (15a-advanced.png). It explains what happens to old backups and the recovery key. Good.

**1:29 — Words and features.** Settings → Words & features shows a preview line: "Add a student · 3 students due this week · Student notes · New roster" (17a-words.png). The words are student, roster, note, activity log, and "worker" for my role (18a-more-words.png). I turn on **Requirements** and **Time on notes**, because Dr. Abernathy wants contacts and minutes (19a-features-on.png). The features list has a section heading that still says **"Records"**, though. And Settings → Profile suggests "Community Services Agency" and "jane.smith@agency.org" as examples. Those are a county agency's words, not a school's.

**1:31 — Requirements.** Settings → Deadlines & reminders → Requirements → Set up… (20a-req-setup.png). I add one with no name and a count of 0, and get "Each requirement needs a name (up to 100 characters)" (21a-zero-blank.png). That's fair, though it shows at the bottom, not next to the box, and the 0 doesn't get flagged at all. Then I set the real ones: 4 counseling sessions a month (Meeting and Visit notes) and 1 family contact a month (Phone, Email, Parent contact). It saves as "4 counseling session a month, 1 family contact a month" (21c-saved.png). The grammar is wrong ("session"). Noted.

**1:33 — Backup.** Settings → Backup shows three layers: auto-backups, scheduled backups, and "Back up now…" (22a-backup.png). I save one to my "USB" folder. The message says "Backup saved." and the line above the button updates to "Last backup saved to another place: 10/15/2026, 10:27:52 AM" (23a-backup-now.png). It doesn't say *where* it saved. I'd like to see the folder.

**1:34 — Change data on purpose.** I rename a student to "Robert Dubois CHANGED AFTER BACKUP". Pulse asks "Keep this as a real student?" because I edited a sample (24a-changed-name.png). That's thoughtful; I say no, it's a sample.

Then I test the date column, the one that matters most for IEPs.
- Typing **31/13/2026** (a date that can't exist) into an empty IEP date doesn't give an error. The box quietly fills in **03/11/2026** and saves it (24b-bad-date.png, 25-1b-typed.png).
- Typing **02/30/2026** into a student who already *had* an IEP date (10/30/2025) **erases the date.** The cell goes to "—", the footer says "Saved", and there's no warning (26a-feb30-typed.png, 26b-feb30-after.png). The deadline color disappears with it.

That's the worst thing I found today. A wrong keystroke turns an annual IEP date into nothing, and the program calls it saved. An IEP review that falls off the screen is a compliance finding with my name on it.

**1:38 — "Who changed this, and when?"** I right-click the erased cell. Under "More…" there's "View history of this cell" (27b-more.png). It shows "4 minutes ago — 2025-10-30 → (empty)". So the old value can be recovered, and I'm glad of that, but the history writes the date as 2025-10-30 while the grid writes 10/30/2025 (28a-cell-history.png). On the student's page, "Notes and column changes" shows "IEP date cleared (was Oct 30, 2025)" with "Oct 15, 2026 at 10:31 AM" (29a-activity-change-shown.png). That's an exact time and it's in plain words. **History MUST: met.**

On every student's page, just above "Activity log", there's a line of what looks like a programmer's note: **"// On the page, not in a card (Q8); the line under the heading row ends the section above"** (28b-leaked-comment.png). I wouldn't put a page with that on it in front of the principal.

**1:40 — Restore.** Settings → Backup → "Restore from file…". The confirmation is the best screen I saw today (29b-restore-step1.png):
- It tells me what's in the backup: 1 roster, 12 students, made at 10:27:52 AM.
- It says my current data will be saved as a safety backup first.
- It makes me type RESTORE. Lowercase "restore" doesn't enable the button.

The only odd line is "Made by: Pulse 0.0". Then "Restore complete" shows the full path of the safety copy and a "Restart now" button (30-0-after-restore.png). After the restart:
- Robert Dubois has his real name back.
- The erased IEP date is back to 10/30/2025.
- The made-up date is gone (31b-grid-after-restore.png).

**Backup and restore: proven.** To be thorough I opened the database and the backup file as plain text: no student names in either. A name *does* show up in the PDF export, and Pulse warns about that when it saves one.

**1:43 — Logging sessions.** On a student's page I click "+ Note". There are type buttons, a text box and Minutes (32a-note-box.png). An empty note can't be added; the Add button stays grey. Minutes of -5 gives "Minutes must be a whole number up to 1,440", and my text stays put (33b-negative-minutes.png). That's a good error message. I log 6 sessions and contacts for three students. The requirement line updates right away: "Counseling session 2 of 4 this month · 16 days left", "Family contact 1 of 1 (done)". Each note shows "30 min (2 units)". I don't bill in units, but I can ignore that.

**1:46 — The report for Dr. Abernathy.** Tools → Reports shows saved reports (37a-reports.png). "New report" opens a builder (38a-new-report.png). I start from "Notes by kind", set the range to This month, and add "Total Minutes" (39b-add-value.png). The preview reads: Meeting 4 / 110 min, Parent contact 3 / 15 min, Total 9 / 130 min. Saved as a PDF, it's one clean page (39c-saved-pdf.png). Two issues: the description still says "What kinds of notes you write most **this year**" when I picked this month, and in the PDF the Total row doesn't line up with the numbers above it.

Then I find the roster's More → Reports menu: "Report for my supervisor… / Monthly summary… / Missing information… / Change history (PDF)… / Totals…" (40b-reports-sub.png).
- **Report for my supervisor** fills in my name, title and district. If I put the end date before the start date, it says "Choose an end date after the start date." That's correct, but the message is at the very bottom of the dialog, below the fold (41a-backwards-dates.png, 42a-backwards-bottom.png). The PDF runs 3 pages. It has the roster, the notes this period and the overdue count. The second page is headed **"Roster Roster"**. It shows **no minutes** anywhere, even though the feature list said time totals "show in the summary report".
- **Monthly summary** gives exactly the "who's behind" page: requirements met 0% (0 of 12), each student with what's still needed, and deadlines on time 86% with the three late ones (43b-monthly-summary.png). One page. The top line runs off the right edge of the paper ("…per month (October 2026), 1"), and it says "4 counseling session" again.
- **Totals** shows minutes per student (Priya 1 hr 15 min, and so on; 2 hr 10 min in total), but only as CSV, not PDF (44a-totals.png).

So I can build what Dr. Abernathy wants, but from three printouts, not one. **Monthly report MUST: met, with a workaround.** I'll staple the Monthly summary and my "October contacts and minutes" page together.

**1:52 — The superintendent's question.** Settings → Security → "Security summary to share" (45b-security-summary.png). It says where the data lives (this computer only), that it's encrypted with AES-256, and that "A stolen laptop or a copied file shows nothing without the password." It covers auto-lock, the recovery key, no cloud and no telemetry, open source, and what stays the district's job (disk encryption, where exports go). There's a "Copy for my supervisor" button. **That paragraph is my answer to the stolen-laptop question.** Three things I'd have to explain away, though:
1. It talks about "the agency's responsibility" and a HIPAA business associate agreement. We're a school district; my superintendent will ask about **FERPA**, which isn't mentioned.
2. It says "Backups are encrypted too", then lists "Where backups, exported PDFs/CSVs… are kept (these are not encrypted)." Which is it? I tested it: the backup *is* scrambled. But the sentence contradicts itself, and the superintendent will catch it.
3. The audit trail PDF (Change history) is thorough: every note, with "Times are local" and how voided notes are kept (45a-change-history-dialog.png). It doesn't record that a backup was restored, though. An auditor would want that line.

**1:55 — Breaking the lock.** I lock with Ctrl+L and enter wrong passwords. "Too many tries. You can try again in 30 seconds", and it climbs to 60 (49b-sixth-wrong.png). When I get back in: "11 wrong password attempts since you last unlocked Pulse. If that wasn't you, change your password in Settings → Security." (49c-after-unlock.png). Excellent.

**1:57 — Empty required field.** I click "+ Add Student" and press Escape without typing a name. A nameless student stays in my roster and the count goes to 13 (48c-remove-sample.png, 53a-blank-row.png). "Missing information" says no columns are required yet (53b-missing-info.png). The Name column won't insist on itself.

**1:58 — WOULD BE NICE: sharing with my staff.** Help → search "share" gives "Can I share my setup with a coworker?" with a plain answer (50c-help-share.png, 51a-help-share-open.png). Settings → Words & features → More settings → "Save my whole setup…" saves the file and confirms "Only rosters, columns and rules are in it, no students or notes" (52b-after-save-setup.png). My husband opened the file in a text editor: rosters, columns, my requirements and my words. No student names, no notes, not my name. The description inside still says "No records or notes are included", the old word again. **Would-be-nice: met.**

**2:00 — Bell.** All five MUSTs are tested. Four pass cleanly. The report passes with a workaround.

*(Test-rig note, not counted against Pulse: twice the window went blank during automated navigation, with about 20 other app windows running on the same machine. Re-running the same steps worked both times. I can't attribute it to Pulse.)*

## 3. Praises
- **Restore confirmation** (29b-restore-step1.png, 30-0-after-restore.png): it shows what's in the backup, makes me type RESTORE, keeps a safety copy and tells me where. I proved it undoes a change. That's the proof I came for.
- **Recovery key flow** (11c-key-shown.png, 13e-right-key-lowercase.png): it forgives lowercase and spaces, then makes me set a new password. It works when I'm tired, which is when I'll need it.
- **Security summary to share** (45b-security-summary.png): a ready answer to "what if the laptop is stolen?", with a copy button. It saves me a week of emails with IT.
- **Change history** (29a-activity-change-shown.png, 28a-cell-history.png, Change history PDF): "IEP date cleared (was Oct 30, 2025)" with an exact time. I can answer "who changed this and when".
- **Wrong-password notice** (49c-after-unlock.png): it tells me how many wrong attempts there were since I last unlocked. If someone got into my office, I'd know.
- **The example shows before it adds** (08a-details-expanded.png): columns, words and features are all listed before I commit. No surprises.
- **Monthly summary** (43b-monthly-summary.png): who's behind, on one page, by student. That's what Dr. Abernathy actually reads.
- **Good error messages where they exist**: "Minutes must be a whole number up to 1,440", "Choose an end date after the start date", "Too many tries. You can try again in 30 seconds". Each is plain and specific.
- **Sample-data care** ("Keep this as a real student?", 24a-changed-name.png; the removal dialog, 48c-remove-sample.png): it won't throw away something I touched.
- **Setup sharing** (52b-after-save-setup.png): it does what it promises. I checked the file and found no student data in it.

## 4. Frustrations
1. **An impossible date silently changes or erases an IEP date** (24b-bad-date.png, 25-1b-typed.png, 26a-feb30-typed.png, 26b-feb30-after.png). Severity: **recovered** (only because I was watching, and history kept the old value). Cost: a mistyped IEP date vanishes or turns into a different real date, the deadline color goes with it, and the footer says "Saved". That's a missed annual review and a compliance problem.
2. **A wrong current password on "Change password" gives no message at all** (14c-wrong-current.png, 15c-wrong-top.png). Severity: **recovered**. Cost: I couldn't tell whether my password had changed or not. On a security screen, silence is the worst message.
3. **A programmer's note is printed on every student page**: "// On the page, not in a card (Q8)…" (28b-leaked-comment.png). Severity: **cosmetic**, but it costs credibility. I can't demo this to the principal with that showing.
4. **There's no single monthly report with contacts, minutes and who's behind.** The supervisor report has no minutes, Totals is CSV-only, and the Monthly summary has no minutes (41b-after-save.png, 44a-totals.png, 43b-monthly-summary.png). Severity: **recovered** (three printouts stapled together). Cost: about 15 minutes every month, and it doesn't look like "one clean page".
5. **The security summary says "agency" and HIPAA/BAA instead of school and FERPA, and contradicts itself on whether backups are encrypted** (45b-security-summary.png). Severity: **needed help**. I'll have to hand-edit it before it goes to the superintendent. Cost: the document meant to win trust gives the superintendent questions to ask.
6. **Report polish**: "Roster Roster" heading on the supervisor PDF; the Monthly summary's top line runs off the page; "4 counseling session"; "this year" in the description of a this-month report; the Total row is misaligned (39c-saved-pdf.png, 43b-monthly-summary.png). Severity: **cosmetic**. Cost: Dr. Abernathy notices typos before numbers.
7. **Old words left over after the switch to students**: the features heading "Records", the Profile placeholders "Community Services Agency" and "jane.smith@agency.org", "agency's responsibility" in the security summary, and "No records or notes" inside the setup file (18a-more-words.png, 45b-security-summary.png). Severity: **cosmetic**. Cost: it doesn't feel built for schools.
8. **A nameless student stays behind** after "+ Add Student" then Escape, and is counted (53a-blank-row.png). Severity: **cosmetic/recovered**. Cost: my count of 60 becomes 61 and I have to go find out why.
9. **Small trust gaps**:
   - "Backup saved." doesn't say where (23a-backup-now.png).
   - "Made by Pulse 0.0" on the restore screen (29b-restore-step1.png).
   - The recovery screen says "you saved during setup" (13b-forgot.png).
   - A used recovery key stays "active" with no nudge to make a new one.
   - A too-short key gets "didn't match" (13c-partial-key.png).
   - Cell history dates are written 2025-10-30 while the grid uses 10/30/2025 (28a-cell-history.png).
   - Restoring a backup isn't recorded in the audit trail.

   Severity: **cosmetic**. Cost: each one is a question I'd have to answer for someone else.
10. **Error messages placed away from the field**: the requirement name error sits under the list, and the date-range error is below the fold of the dialog (21a-zero-blank.png, 42a-backwards-bottom.png). Severity: **cosmetic**.

## 5. Suggestions
- "If I type a date that doesn't exist, stop me and say so. Never quietly erase or change a date I already had." → In the date cell editor, refuse invalid or partial input with an inline message ("That's not a real date — check the month and day") and keep the old value. Never save an empty value unless the person clears the cell on purpose.
- "When I get my current password wrong, tell me." → In Change password, show "That's not your current password" under the Current password box, the same as the recovery key dialog already does.
- "Take the programmer's note off the student page." → Remove the stray "// On the page, not in a card (Q8)…" text above Activity log.
- "Give me one page for my principal: contacts, minutes, who's behind." → Add the total minutes (overall and per student) and the requirements table to "Report for my supervisor", or add minutes to the Monthly summary PDF, and offer Totals as a PDF too.
- "Write the security summary for whoever my words say I am. Schools have FERPA, not HIPAA." → Use the workspace's words in the summary (no "agency" for a school), add a FERPA line when the student words are in use, and fix the backups sentence: backups made by Pulse are encrypted; exported PDFs and CSVs are not.
- "Proofread the reports." → Fix "Roster Roster", the overflowing requirements line, plurals ("4 counseling sessions"), the stale "this year" description and the Total row alignment.
- "Finish the word switch." → Rename the features heading "Records" to "Students" (or "People details") and use neutral Profile placeholders ("Your organization", "name@example.org").
- "Don't let an empty row become a student." → When "+ Add Student" is cancelled with no name typed, remove the new row.
- "Tell me where things went." → "Backup saved to <folder>" with an "Open folder" button; show the real version number on the restore screen; after the recovery key is used, offer "Make a new recovery key"; log "Data restored from backup made <date>" in the change history.
- "Put the warning next to the problem." → Show validation messages beside the field they're about and scroll them into view.

## 6. Overall
Would I still be using Pulse in a week? **Yes, on probation.** It passed my backup, restore, recovery, history and encryption tests, and the monthly summary is close to what Dr. Abernathy wants. Before my staff touch it, I'm writing a rule on the whiteboard: *pick IEP dates from the calendar, never type them*. That rule exists only because of frustration 1. If that gets fixed, the probation ends.

| Area | Score | Why |
|-|-|-|
| First impression | 8 | Encryption is stated on the first screen and the password rules are clear; the example list is longer than it needs to be. |
| Ease of setup | 8 | The Special education example set students, rosters and IEP deadlines in one go and showed me everything first. |
| Daily use | 6 | Notes, minutes and requirements work well, but the date editor can silently destroy an IEP date, and the monthly numbers take three printouts. |
| Trust in my data | 7 | Restore, recovery, lockout, history and encryption all held up under testing; the silent date loss and the silent password failure cost three points. |
| Would recommend to a coworker | 7 | Yes, with the date warning, a cleaned-up security summary, and the developer note gone before I demo it. |

## 7. Moments of delight
- Typing RESTORE, restarting, and seeing "Robert Dubois CHANGED AFTER BACKUP" go back to "Robert Dubois". Proof, not a promise.
- The recovery key accepting it in lowercase with spaces, like a tired person types it.
- "11 wrong password attempts since you last unlocked Pulse." That's what a good sentry says.
- "IEP date cleared (was Oct 30, 2025)" in the activity log: the evidence trail was there when I needed it.
- "Copy for my supervisor" on the security summary. Someone thought about the superintendent's email.
