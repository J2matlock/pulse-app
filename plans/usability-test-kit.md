# Watching real people use Pulse — a kit

For the owner. This isn't agent work: it's for you to run with two coworkers, in person, over a cup of coffee. Each section below fits on one printed page. Print pages 5, 6 and 8 for the session itself.

---

## Page 1 — What this is, and why it's worth an hour

Everything Pulse knows about being easy to use comes from people who built it, or from simulations of people. Neither is the same as watching a real care coordinator sit down with it cold.

The plan: two coworkers, one at a time, 15 minutes each, on a fresh copy of Pulse with nothing in it. You give them a few everyday jobs, in their words, and then you **watch and say nothing**. Every place they stop, frown, click the wrong thing or ask "where is…?" is something the app can fix.

What it costs you: about an hour of your time on the day, plus 30 minutes setting up the laptop beforehand and 30 minutes writing up afterwards.

What you get: a short list of real problems, ranked by how badly they stopped a real person. Two people sounds like very few, but the worst problems tend to trip up almost everyone, so even two people find many of them. More people find more, with diminishing returns; a second round after the fixes (page 9) is worth more than a bigger first one.

**The one rule:** you're testing Pulse, not them. If they get stuck, that's Pulse's fault, and it's exactly what you came to find.

---

## Page 2 — Finding two people

**Who to ask**
- Two coworkers who do the job Pulse is for: care coordinators, case managers, social workers.
- Ideally 50 or older, and not "the computer person" in the office. Someone who uses Excel and Outlook every day but wouldn't call themselves techy.
- People who have **never seen Pulse**. If they've watched you use it, or heard you talk about it a lot, ask someone else.
- Better not someone you supervise. People try harder to please their boss, and they won't say "this is confusing" to the person who made it.

**How to ask** (in your own words, something like):

> "I'm trying out a program for keeping track of clients and I'd like to see how it works for someone who's never seen it. It takes 15 minutes. You can't do it wrong. I'm checking the program, not you. Coffee's on me."

**Practical bits**
- Book 25 minutes each: 15 for the tasks, a few to settle in, a few to chat at the end.
- Same day, back to back, if you can. Reset the laptop between them (page 3).
- A thank-you: coffee, lunch, a gift card. Their time matters.
- Tell them up front: no real client information is used. Everything in it is made up.

**If you'd like to record the screen**, ask first and accept a "no" happily. Windows: Win+Alt+R records the active window (Xbox Game Bar). Fedora/GNOME: Ctrl+Shift+Alt+R. A recording lets you check exact timings later, but your notes on paper are what matter.

---

## Page 3 — Getting the laptop ready (and putting it back)

**The laptop**
- A normal work laptop is best, the kind they'd really use. Leave the display scaling as it came (often 125% on Windows laptops). Don't make text bigger or smaller for the test.
- If they normally use a mouse, plug one in. If they normally use the touchpad, don't.
- Close everything else. Turn off notifications (Windows: Focus assist / Do not disturb).
- Pulse version: write it down on the notes sheet (Settings → About).

**Quit your own Pulse first, completely.** If Pulse is still running, even hidden in the system tray by the clock, starting a second copy just brings **your own window, with your own data**, to the front. Right-click the tray icon → Quit, or check Task Manager for "Pulse".

**A fresh, empty Pulse without touching your real data**

*Windows (the portable .exe):* Pulse keeps everything in a folder called `PulseData` **next to the .exe file**. So:
1. Make a new folder on the desktop, e.g. `Pulse test 1`.
2. Copy the Pulse .exe into it and double-click it from there.
3. That copy starts completely empty. Your own copy, wherever it lives, is untouched.
4. Afterwards: quit Pulse, then delete the `Pulse test 1` folder. For the second person, make `Pulse test 2` and do the same.

*Linux (the AppImage):* Pulse normally keeps its data in `~/.config/baringasoft-pulse`. Start the test copy from a terminal with its own folder instead:
```
PULSE_DATA_DIR=$HOME/pulse-test-1 ./BaringaSoftPulse-2.6.0.AppImage
```
Afterwards: quit Pulse and delete `~/pulse-test-1`. (Or, without a terminal: rename `~/.config/baringasoft-pulse` to `baringasoft-pulse.mine` before the test and rename it back after. Don't open your copy in between.)

**Before they sit down**
- Start the fresh copy once yourself to check it opens on the "Welcome" screen, then quit it, delete the folder and make a new empty one. They should be the first person to see that screen.
- Put the practice spreadsheet (page 4) on the desktop as **My clients.xlsx**.
- Put a card next to the laptop: *"Password for today: Blue kettle morning 42"*, plus a blank line underneath: *"If Pulse gives you anything to keep, write it here: ________"*.
- If an update banner shows up during the session, leave it alone and note whether they noticed it.

---

## Page 4 — The practice spreadsheet

Make this in Excel the day before and save it as **My clients.xlsx**. The names and numbers are made up. Write real dates by counting back from the day of the test (e.g. "5 weeks ago" on 15 October is 10 September). One blank cell is on purpose: real spreadsheets have them.

| First name | Last name | Date of birth | Phone | Last visit | Annual review |
|-|-|-|-|-|-|
| Maria | Lopez | 03/12/1951 | 555-0101 | 5 weeks ago | 4 months ago |
| James | Carter | 07/30/1948 | 555-0102 | 2 weeks ago | 1 year and 3 days ago |
| Helen | Brooks | 11/02/1955 | 555-0103 | 1 week ago | 6 months ago |
| Robert | Nguyen | 01/19/1960 | 555-0104 | 6 weeks ago | 10 months ago |
| Patricia | Owens | 05/25/1949 | 555-0105 | 3 days ago | 2 months ago |
| William | Hart | 09/14/1952 | 555-0106 | 3 weeks ago | 11 months ago |
| Barbara | Kim | 02/08/1958 | 555-0107 | 26 days ago | 5 months ago |
| George | Silva | 12/01/1947 | 555-0108 | 10 days ago | 8 months ago |
| Nancy | Reed | 06/17/1963 | 555-0109 | 2 months ago | 1 year and 2 weeks ago |
| Thomas | Bell | 04/04/1950 | 555-0110 | 12 days ago | 3 months ago |
| Carol | Diaz | 08/21/1956 | 555-0111 | 4 days ago | 7 months ago |
| Frank | Moore | 10/29/1945 | 555-0112 | 18 days ago | (leave blank) |

What this sets up: Maria, Robert and Nancy are overdue for a visit; Barbara is nearly due; James and Nancy are past their annual review. If Pulse works the way it should, those people stand out without anyone being told to look for them.

---

## Page 5 — What to say (print this)

**At the start** (read it, or say it in your own words):

> "Thanks for doing this. This is a program called Pulse. It's meant to replace the spreadsheets people like us use to keep track of clients and their deadlines.
>
> I'm going to give you a few everyday things to do, one at a time. There are no wrong answers. If something is confusing, that's the program's fault, not yours, and it's exactly what I want to find out.
>
> While you work, please **think out loud**: say what you're looking for, what you expect to happen, what surprises you. Like you're talking a friend through it on the phone.
>
> I'm going to be quiet and take notes. That's not me being rude. If I help, I won't learn anything. If you'd normally give up on something, say so and we'll move on. That's useful too.
>
> Everything in here is made up. Ready?"

Then hand them task 1 (page 6), on its own slip of paper if you can, and start the clock.

**While they work: say only these**
- "What are you looking for?"
- "What did you expect that to do?"
- "What are you thinking right now?" (when they've gone quiet for a while)
- "Keep talking, you're doing great."
- "What would you do if I weren't here?" (when they ask you a question)
- "Let's move on to the next one." (when they've been stuck 3 minutes, or say they'd give up)

**Don't say**
- The name of any button, menu or screen. Not "Try the Dashboard", not "it's under More", not "click Done".
- "Almost!", "You're close", "No, not that one". Even a hint in your voice counts. Keep your face neutral too.
- "Most people find that easy." Never.
- Anything that explains how Pulse works, until the very end.

**If they ask you a question**, turn it around: "What do you think?" or "What would you try?" Only if they're truly stuck for 3 minutes on task 1, help just enough to get them through, and write down exactly what you said, marked *needed help*. Task 1 has to be finished for the rest to make sense.

**At the end** (3 minutes, now you can talk):
- "What was the hardest part?"
- "Was there anything you liked?"
- "If your office switched to this, what would worry you?"
- "Anything you expected to find and didn't?"
- Then thank them properly, and answer any questions they had along the way.

---

## Page 6 — The tasks (print, cut into slips)

Hand them over one at a time. Each one is a goal, in the words of the job. None of them names anything on the screen. If task 1 runs past 6 minutes, help them finish it (note it), so the others can still happen. Stop at 15 minutes wherever you are; skipping the last ones is fine.

1. **"Your office is trying out Pulse. It's open on this laptop for the first time. Get it ready so you could use it with your clients tomorrow. Your clients are in the spreadsheet called 'My clients' on the desktop."**
   *Watch:* the password and anything it gives them to keep; whether they bring in the spreadsheet or start some other way; whether first and last names end up together; whether the dates "make sense" to them afterwards.

2. **"Looking at your list now: who needs you most this week? Tell me how you can tell."**
   *Watch:* do they see the overdue people without hunting? Do they understand what the colours mean? Do they find the screen that lists what's due, or stay on the list?

3. **"You saw Maria Lopez last Tuesday. Make sure Pulse knows."**
   *Watch:* how they find Maria; whether they write a note, change the date, or both; whether they get the day right (last Tuesday, not today); whether Maria stops looking overdue and they notice.

4. **"While you were there, Maria said she needs a ride to her eye doctor on the 28th. Put that in Pulse so you won't forget to set it up."** *(Change "the 28th" to a date about 10 days after the test.)*
   *Watch:* note, task, reminder, follow-up, appointment: which one they reach for, and whether they trust that it will remind them.

5. **"You finished James Carter's annual review this morning. Let Pulse know it's done."**
   *Watch:* whether they find "done", and whether they understand that the next review is now a year away.

6. **"A new client called this morning: Dorothy Hayes, phone 555-0142. Add her."**
   *Watch:* how long until they find where to add; whether they're sure it saved.

7. **"Robert Nguyen moved out of your area. He's not your client anymore, but you have to keep his records."**
   *Watch:* do they delete him (and are they worried), or find a way to put him aside? Can they say where he went?

8. **"You're going to lunch and leaving the laptop on your desk. Make sure nobody walking by can see your clients."** Then: **"You're back. Carry on where you were."**
   *Watch:* whether they find a way to lock it, and whether they can get back in with the password card.

*Spare, if there's time:* **"Your supervisor wants Maria's information on paper for a case review on Monday. Get it ready."**
*Watch:* do they find print or PDF? Do they pick which parts go on paper, and do the choices make sense to them?

---

## Page 7 — What to watch for

You're looking for the moments where Pulse made them work. Write each one down the moment it happens, with the time and **their exact words**.

**Signs of trouble**
- **A pause longer than 5 seconds** with the mouse still. Count it in your head. Something on the screen didn't tell them what to do.
- **A wrong click**: they click something, it isn't what they wanted, they back out. Note what they clicked and what they were expecting.
- **"Where is…?"**, **"How do I…?"**, **"I'd expect…"**: write the whole sentence down. Those are the words Pulse should be using.
- **Words read aloud with a frown**, or read twice: a label or message that doesn't mean what Pulse thinks it means.
- **"Did that save?"** or going back to check. The app didn't confirm clearly enough.
- **Hunting**: scrolling up and down, opening menus one after another, hovering and waiting for a tooltip.
- **Right-clicking or double-clicking** to get something done. Fine if it works; note it if it doesn't.
- **Reading Help.** Note what they typed into the search and whether it found anything.
- **Giving up**, or "I'd call someone at this point."
- **Apologising** ("Sorry, I'm not good with computers"). That's a sign the app made them feel slow. Note what came just before it.

**Signs it's working** (just as useful: these are the things not to break)
- Doing something right the first time without pausing.
- "Oh, that's handy," a smile, a nod.
- Noticing on their own that something changed (a colour going away, a count going down).

**How bad was it?** Mark every snag with one of these four. They're the same four the team uses everywhere, so issues line up:

| Mark | Means |
|-|-|
| **Gave up** | They couldn't do it, or would have stopped here in real life |
| **Needed help** | They only got through because you said something |
| **Recovered** | They got there on their own, after a wrong turn or a long pause |
| **Cosmetic** | It slowed nobody down, but they commented on it (a confusing word, an ugly spot) |

---

## Page 8 — Notes sheet (print one per person)

**Person:** Tester A / Tester B (no real names on this sheet) · **Date:** ______ · **Pulse version:** ______ · **Mouse or touchpad:** ______ · **Screen scaling:** ______

**Snags, as they happen**

| Time | Task | What they did or said (their words) | What they expected | Mark |
|-|-|-|-|-|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

**Each task**

| Task | Done? (yes / with help / no) | About how long | The biggest snag |
|-|-|-|-|
| 1 Get it ready | | | |
| 2 Who needs you | | | |
| 3 Saw Maria | | | |
| 4 Maria's ride | | | |
| 5 James done | | | |
| 6 Add Dorothy | | | |
| 7 Robert moved | | | |
| 8 Lunch lock | | | |
| Spare: printout | | | |

**At the end, in their words**
- Hardest part: ________________________________________________
- Something they liked: _________________________________________
- What would worry them: _______________________________________
- Expected but didn't find: _____________________________________

---

## Page 9 — Turning notes into fixes

Do this **the same day**, within an hour if you can, while you still remember what their face did.

1. **Put both sheets side by side.** For each snag, check whether the other person hit the same thing. Something both people hit goes to the top, whatever its mark.
2. **One issue per snag.** Not "the import was confusing", but "Didn't know the spreadsheet's First and Last name would be joined; looked for the name for a minute".
3. **Title it in their words, not Pulse's.** "Couldn't find how to say Maria was seen last Tuesday" is better than "Done on… date picker hard to discover". Their words are a clue to the fix.
4. **Each issue gets:**
   - what they were trying to do (the task number);
   - what they did, and what they said, quoted;
   - what they expected to happen;
   - the mark (gave up / needed help / recovered / cosmetic), and "1 of 2" or "2 of 2";
   - the screen it happened on (a screenshot from the recording, if you have one).
5. **Rank them:** 2 of 2 before 1 of 2; then gave up → needed help → recovered → cosmetic.
6. **Where they go:** GitHub issues on the Pulse repo with a `usability` label, or one file in `plans/` named for the date (e.g. `plans/usability-2026-11-03.md`), which you can then hand to Claude as "plan fixes for these".
7. **Privacy:** the repo is public. Never put a coworker's name, or anything that could identify them, in an issue. "Tester A" is enough. Keep the paper sheets yourself.

**What not to do**
- Don't fix things in the room or explain mid-session. You'll lose the rest of the session.
- Don't argue with a snag ("but the button is right there"). If they didn't see it, it isn't there for them.
- Don't treat something only you think is a problem as a finding. Only what they did counts.
- Don't throw away the praise. Things that worked go in a short "keep these" list at the top of the write-up, so a later change doesn't break them.

**After the fixes ship**, run the same tasks with **two different people**. The same two people already know the answers.

---

## Page 10 — Five-minute check after every release

Before telling anyone about a new version, run through this on a **fresh copy** (page 3: new folder on Windows, or `PULSE_DATA_DIR` on Linux) at the laptop's normal scaling. Go fast; you're checking that nothing basic broke, not testing everything. Tick each one.

- [ ] It opens on the Welcome screen, and the colours follow the computer (light or dark).
- [ ] Setting a password works, and whatever it asks you to keep is clear.
- [ ] "Start from an example" opens a list where something overdue is plainly red without scrolling sideways.
- [ ] You can tell what the colours mean without asking anyone.
- [ ] Open one person's page; add a note for **yesterday**; it shows with yesterday's date.
- [ ] Mark one deadline done; the colour changes; Undo puts it back.
- [ ] Add a new person; they're there after you go to another screen and come back.
- [ ] Lock it (or wait for the lock), then unlock with the password: you're back where you were.
- [ ] Print or save one person's page as a PDF; it opens and has their name on it.
- [ ] Type "contacts per month" into Help search; it finds something useful.
- [ ] Make the window small (about half a laptop screen): nothing important is cut off.
- [ ] The update banner (if one shows) doesn't cover anything.

Anything that fails: don't announce the release until it's fixed or you've decided, on purpose, that it can wait. Then quit the test copy and delete its folder.
