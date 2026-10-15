# Joe Kowalczyk: persona session, 2026-10-15

Screenshots: `ux-review-shots/persona-joe/`. Session script: `e2e/ux-review/persona-joe.spec.ts`, run in phases on one data folder, with a relaunch and unlock between phases. Every relaunch is me checking that things saved.

## 1. Who I am

Joe Kowalczyk, 61. I do foster-home licensing for three rural counties in northern Michigan: 40 homes, each needing a yearly renewal and quarterly inspections. It's Friday, 3:15, I'm parked outside a Dollar General on a hotspot, and I want my homes in, the late ones in front of me, and to be home by 6.

## 2. Diary

**3:15, password screen** (`p1-01-first-screen`). Fine. I type "Silverado240k", hit Tab, type it again and press Enter. Turns out Tab put me on the little eye button. My second typing went nowhere and Enter flipped the eye, so now my password is sitting on the screen in plain letters (`p1-02-enter-without-terms`). I double-click the "I agree" box. It ticks and unticks, so it's still empty (`p1-03-dblclick-terms`). I click it once more and double-click Create. It tells me "The two passwords don't match" (`p1-04-after-create`). Well, no, the second box is *empty*. I click into it and type it again. About 2 minutes and 8 clicks so far.

**3:17, recovery key.** Enter does nothing. "Without one, a forgotten password means permanent data loss": that sentence I read. I double-click "Show my recovery key" (`p1-07-recovery-key`) and copy it onto the back of a Culver's receipt. I double-click Done without ticking the box, and it says "Tick … first" in red. Fair. Esc doesn't throw the key away (`p1-09-esc-on-key`). Good, because I wasn't done writing.

**3:19, "Your name".** I type my name and hit Enter. Nothing happens; I have to click Continue (`p1-12-after-name-enter`). Double-clicking Continue didn't skip a screen, so that's good.

**3:20, picking a start.** I take "Start from an example" and type "foster" in the search. I get **Animal rescue** and CASA (`p1-15-search-foster`). Oh, come *on*. I license homes for kids, not beagles. "license" gets me medical credentialing and driving schools; "inspection" gets me tree service and fire alarms (`p1-16-search-license`, `p1-16-search-inspection`). I almost close it. Then I open "Human services", and in there is "Foster Care Caseworker" (`p1-17-human-services-layouts`). Why didn't "foster" find *that*? It's for caseworkers with kids, not homes, but it's the closest thing. I double-click it, then Next, then double-click Add. I only got one list, not two (`p1-18-after-next`, `p1-19-after-add`). About 6 minutes in.

**3:24, the grid** (`p1-20-first-look`). A bubble pops up about Frank Rivera's home visit. Esc. "Remove sample data", double-click, then Enter. Gone, and it says they went to the Trash. Good.

**3:25, my first home.** I double-click "Add Client" and get **two** empty rows (`p2-04-dblclick-add-client`). I'm already in the bottom one, so I type "Peterson home" and press Enter. It says "Saved" down in the corner (`p2-05-typed-peterson-enter`). I like that word. But what's that empty row up top?

**3:26, fixing the columns.** "Child Name"? These are homes. I double-click the header. A menu opens *and* the name goes into edit mode at the same time (`p2-06-dblclick-header`). I type "Home" and press Enter (`p2-07-renamed-home`). Okay, that's actually pretty slick. Same for "Last Home Visit" to "Last Inspection", "Next Court Hearing" to "License Renewal", and "Caregiver" to "Parents" (`p2-08-renamed-three`). About a minute for all four.

**3:28, dates.** I double-click Last Inspection for the Petersons and type 7/15/26 the way I write it on every form. The box shows **07/15/0026** (`p2-10-date-typed`). I press Enter and the cell is **blank** (`p2-11-date-entered`). No message, nothing. "What the heck did that just do." I try again with the full year, 07152026, and it takes (`p2-13-date-entered-full`). Now it's red: "62 days late". I was out there in July!

**3:30, relaunch.** I close it and open it again, because I always check. Everything is there (`p3-01-relaunch-check`). I breathe out.

**3:31, the 30-day problem.** The inspection column is set to every 30 days; mine are every 3 months. I double-click the "⋯" on the header. The menu opens and closes so fast I barely see it (`p4-01-inspection-menu`). I click once, hard, and it stays (`p4-02-inspection-menu-single`). "Deadline rule… Every 30…" opens a clear little box (`p4-03-column-settings`). New rule → "90 days after" → double-click Create rule (`p4-04-new-rule`). Now Peterson says due Oct 13, 2 days late (`p4-06-after-create-rule`). That's honest; I *am* behind. And double-clicking didn't make two rules (`p5-01-rule-dialog-again`). About 4 minutes, mostly figuring out where the setting lived.

**3:36, getting rolling.** I put the Hendricks place in that empty top row. Tab moves me to the next cell and I just keep typing dates (`p5-03-hendricks`). That's fast; this is what I wanted. Then Bergstrom, Nowak, Lindquist and Olson, double-clicking "Add Client" each time. **Every** double-click leaves another empty row behind. Four ghosts, "10 clients" when I have six homes (`p6-02-four-more`). Son of a biscuit.

**3:40, cleanup, and my accident.** I double-click the checkbox on a ghost row. It ticks and unticks, nothing to show for it (`p7-01-dblclick-checkbox`). So I click once on each ghost, going fast, and catch Bergstrom's box on the way (`p7-02-five-selected`). The ticked row is only a faint blue; I didn't notice. I double-click "Move 5 to the Trash". There's no "are you sure"; they're just gone, with an Undo box in the corner (`p7-03-after-trash-dblclick`). I press Enter to make the box go away, and it goes away. So does my chance at Undo.

**3:42, "Where's Bergstrom?"** Bergstrom's license is up Tuesday. I search "berg" and get "No clients found" (`p8-01-search-berg`). My stomach drops; Culver's parking lot all over again. Then I remember the Trash from the samples. Bergstrom is there with "30 days left" (`p8-02-trash`). I double-click Restore, and only Bergstrom comes back, not the ghost under it. All the dates are intact (`p8-04-back-on-grid`). About 2 minutes of panic, 2 clicks to fix.

**3:45, what's late: the Dashboard** (`p9-01-dashboard`). This is the screen I'd open every morning. Red rows, "58 days overdue", Done buttons right there. A hint bubble covers the top two homes, and Esc won't move it (`p9-02-esc-hint`). I double-click Done on Peterson's inspection: "next due Jan 13, 2027" (`p9-03-after-done-dblclick`). One row, not two, and the second click didn't land on the row that slid up. That's the whole job in one button.

**3:47, the renewal that won't take.** Lindquist's renewal came through last week. I double-click Done and **nothing happens** (`p9-04-lindquist-renewal-dblclick-nothing`). Double-click again, nothing. I give it one slow, angry click, and a box opens asking for the new date (`p9-05-lindquist-renewal-dialog`). So it *was* opening, and my second click was shutting it. I type 10/09/2027 and press Enter: "now due Oct 9, 2027". "Done on…" for Bergstrom's Oct 1 inspection works the same way: double-click does nothing, one click works, I type the date, Enter (`p9-09-done-on-after-enter`).

**3:50, the parents.** I double-click Bergstrom's Parents cell, type "Karl & Jean Bergstrom" and press Esc to close the box. It's **gone**, and the Undo arrow says "No actions to undo" (`p10-01-typed-parents`, `p10-03-after-undo`). I type it again and use Enter this time. (Earlier I'd also put the Petersons' names in the phone column by mistake. It took them without a peep.)

**3:52, a note on Bergstrom.** The home's page opens (`p10-04-bergstrom-page`). Further down there's a line of what looks like programmer talk: "// On the page, not in a card (Q8)…" (`p10-05-leaked-comment`). Somebody left that in. In the case note I type my inspection notes, press Esc, and the text stays (`p10-08-case-note-after-esc`). Good. Enter just makes a new line, so I double-click Add. The box empties and the note isn't anywhere I can see (`p10-09-after-add-dblclick`). It turns out it went into the log further down. Only one copy, at least.

**3:55, accident number two.** The Olsons are closing their license at year end, and I think "Archive" means "file it". I double-click "⋯" on their row, and it opens and shuts (`p11-01-row-menu-dblclick`). I click once (`p11-02-row-menu`), then double-click "Archive client". The row vanishes, with an Undo box and "Add a reason…" (`p11-03-after-archive`). I hit Enter, and the box goes away.

**3:56, "Where'd the Olsons go?"** Not in the Trash (`p12-01-trash-no-olson`). Search says "No clients found matching 'olson'" (`p12-02-search-olson`). I click around and finally find "Recently archived" at the bottom of the Dashboard (`p12-03-recently-archived`). One double-click on Reactivate and they're back (`p12-04-reactivated`). About 2 minutes.

**3:58, backups.** The Dashboard says "Set up backups", and I want that more than anything on this screen. It already keeps auto-backups every time I close it; I can see five of them with times (`p12-05-backups`). I double-click "Back up now…" to my stick, and I get one file, not two (`p12-06-back-up-now`).

**Next morning, relaunch.** All six homes, the new due dates, both sets of parents, Olson back, and my Bergstrom note in the log (`p13-01-next-morning-grid`, `p13-02-bergstrom-note`). Nothing lost.

Total: about 45 minutes for 6 homes, including two panics and a lot of renaming. The next 34 homes would go much faster now that the columns are right.

## 3. Praises

- **Dashboard "What's due" with Done / Done on…** (`p9-03-after-done-dblclick`, `p9-09-done-on-after-enter`). One click marks the inspection, and it tells me when the next one is due. Double-clicking Done didn't mark the next row by mistake. It gives me a to-do list I don't have to build.
- **Nothing I saved was ever lost.** Four relaunches, and every date, name and note was there (`p3-01-relaunch-check`, `p13-01-next-morning-grid`). The "Saved" word in the corner, the visible auto-backups and the one-file "Back up now" let me sleep.
- **The Trash and "Recently archived" really bring things back whole** (`p8-04-back-on-grid`, `p12-04-reactivated`). Bergstrom came back with every date. Double-clicking Restore didn't restore the row below it.
- **Renaming a column by double-clicking its header** (`p2-07-renamed-home`). I made the foster-kid layout into a homes layout in a minute.
- **Tab from cell to cell while typing** (`p5-03-hendricks`). I can type a home across the row without touching the mouse.
- **Double-submit protection where it mattered most**: Add list, Create rule, Restore, Add case note, Back up now and Done each did their thing once.

## 4. Frustrations

| # | What | Screens | Severity | What it costs me |
|-|-|-|-|-|
| 1 | Double-clicking **Add Client** makes two records every time. I had 4 empty ghosts after 5 adds, and cleaning them up is how I trashed Bergstrom. | `p2-04-dblclick-add-client`, `p6-02-four-more`, `p7-02-five-selected` | recovered | Junk rows, a wrong count, and an accidental delete during cleanup |
| 2 | Double-clicking a button that opens a box or menu (renewal **Done**, **Done on…**, column **⋯**, row **⋯**) opens it and instantly shuts it. It looks dead. | `p9-04-lindquist-renewal-dblclick-nothing`, `p4-01-inspection-menu`, `p11-01-row-menu-dblclick` | recovered (after a slow single click) | I think the program is broken and nearly give up on renewals, the deadline that matters most |
| 3 | Typing **7/15/26** in a date cell gives year 0026, and Enter quietly leaves the cell **blank**. No warning. | `p2-10-date-typed`, `p2-11-date-entered` | recovered | I'd have walked away thinking the inspection was entered |
| 4 | **Esc in a grid cell throws away what I typed**, and Undo has nothing. | `p10-01-typed-parents`, `p10-03-after-undo` | recovered (retyped) | Exactly the thing I'm afraid of: typing lost |
| 5 | Search says "No clients found" for a home that's in the Trash or archived, with no "1 in the Trash / 1 archived" pointer. | `p8-01-search-berg`, `p12-02-search-olson` | recovered | Panic; I had to hunt three places for the Olsons |
| 6 | Trash had no "are you sure", the selected row's highlight is faint, and the Undo box goes away when I press Enter. | `p7-02-five-selected`, `p7-03-after-trash-dblclick` | recovered | I deleted a real home without knowing it |
| 7 | No foster-home **licensing** example. "foster" finds Animal rescue; "Foster Care Caseworker" is hidden inside Human services, and search doesn't find it. | `p1-15-search-foster`, `p1-17-human-services-layouts` | recovered | 5 minutes and almost quitting at minute 6 |
| 8 | The example came with a 30-day rule on "Last Home Visit". Changing it to quarterly took the header ⋯ menu, then Deadline rule, then New rule. | `p4-02-inspection-menu-single`, `p4-04-new-rule` | recovered | Every home shows red until I dig it out |
| 9 | Programmer note showing on the home's page: "// On the page, not in a card (Q8)…" | `p10-05-leaked-comment` | cosmetic | Makes me trust it a little less |
| 10 | Leftover template columns (Case #, Date of Birth) show red "Missing", and the Dashboard says "6 clients are missing required information" | `p13-01-next-morning-grid`, `p9-01-dashboard` | cosmetic | Nags I can't do anything about |
| 11 | On the password screen, Tab goes to the eye button and Enter shows my password in plain text; the "don't match" message blamed me for an empty box. | `p1-02-enter-without-terms`, `p1-04-after-create` | recovered | First 2 minutes feel clumsy, and my password shows in a parking lot |
| 12 | Hint bubbles ignore Esc and cover the top rows of the Dashboard. | `p9-02-esc-hint` | cosmetic | Have to find "Got it" |
| 13 | A phone column took "Dale & Sue Peterson" without a word | `p13-01-next-morning-grid` (scrolled right) | cosmetic | Wrong data sits there quietly |

Not a Pulse finding: during the session the app window crashed now and then on every persona's machine at once (renderer crashes, "Disk quota exceeded" in /tmp). I re-ran those steps and counted nothing against Pulse.

## 5. Suggestions

- "If I click Add twice, give me one home." → Ignore a second Add Client click within about a second, or don't create a new empty row while the last one is still empty and being edited.
- "If a button opens a box, the second click shouldn't close it." → Ignore backdrop and outside clicks for about 300 ms after a dialog or menu opens.
- "26 means 2026. Everybody knows that." → In date cells, treat a two-digit year as 20xx. If a date can't be used, keep the editor open with a message instead of saving blank.
- "Esc shouldn't eat my typing." → In a grid cell, Esc with changed text should save, or ask, or at least land in Undo history.
- "Tell me it's in the Trash." → When search finds nothing, add "1 match in the Trash / 1 archived. Show it."
- "Give me a foster home licensing setup." → Add a "Foster home licensing" example (license renewal yearly, inspections quarterly, training hours, fire and well inspections), and make example search match layout names inside groups.
- "Make it obvious what's ticked before I trash it." → Use a stronger selected-row color, and name the records in the bulk bar ("Bergstrom home + 4 empty").
- "Lapsed license is worse than a late inspection." → Let a rule be marked "critical" so it sorts first and drives the top banner.
- "Get the programmer notes off my screen." → Remove the stray `// On the page, not in a card (Q8)…` text from the client page.

## 6. Overall

Would I still be using Pulse in a week? **Yes**, mostly because of the Dashboard and because nothing I saved disappeared. But I'd be swearing at the double-click stuff every day until I trained myself out of it, and I resent a program that makes me retrain my hands.

| Score | 1–10 | Why |
|-|-|-|
| First impression | 6 | It looks clean and big enough to read, but "foster" found an animal shelter and the password screen tripped me twice. |
| Ease of setup | 5 | I had to rename four columns, fix a wrong 30-day rule in a buried menu, and learn that 26 isn't a year. |
| Daily use | 7 | Dashboard Done and Tab-entry are great; ghost rows and dialogs that blink shut are not. |
| Trust in my data | 8 | Four relaunches, two accidents, and everything came back. Points off for Esc eating my typing and the silent blank date. |
| Would recommend to a coworker | 7 | I'd tell Darlene to use it, and to single-click and press Enter instead of Esc. |

## 7. Moments of delight

- "Marked 'Last Inspection' done for Peterson home; next due Jan 13, 2027." It did my math for me.
- Bergstrom in the Trash with "30 days left". There you are, you little stinker.
- The little green "Saved" in the corner, every time.
- Five auto-backups with times on them that I never asked for.
- Double-clicking a column name and just typing "Home". Slick.
