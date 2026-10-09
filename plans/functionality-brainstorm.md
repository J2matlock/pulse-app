# Functionality Brainstorm

**Status:** DRAFT for discussion (2026-10-01)
**Lens:** Pulse is sold online to individual care workers. A good feature does at least one of these:
- **Saves time daily**, enough that a worker would pay $60 rather than keep their spreadsheet.
- **Makes the supervisor's "yes" easier** (compliance, audit, safety).
- **Helps sell itself**: makes a great screenshot, demo, or "you have to try this" moment.

**Effort:** S = about a day · M = a few days · L = a week or more
**Already built (not repeated here):** grid with deadline colors, dashboard, client profiles (checklist, case notes, timeline, deadlines, linked providers), tasks with recurrence, contacts, snippets, caseload/checklist/letter templates, supervisor report, import/export, focus mode, undo, saved views and filters, acuity, onboarding and tours.

---

## A. Less typing, fewer misses (daily value)

| # | Idea | Why it matters | Effort |
|-|-|-|-|
| A1 | **Case notes update deadlines automatically.** Logging a phone call or visit sets the client's "Last Contact" (or "Last Face-to-Face") date, and the deadline color resets. | Today the worker writes the note *and* edits the date. Double entry is the #1 spreadsheet complaint. | M |
| A2 | **Contact requirements per month.** Rules like "1 face-to-face + 1 phone contact per month", tracked from case notes, with a red flag when a client is short. | This is how many programs define compliance (e.g. monthly or quarterly contact rules), not "one date + N days". | M |
| A3 | **Calendar-based deadline rules**: "every 6 months", "annually on the anniversary", "end of the month", "within 30 days of intake". Today rules are day counts only. | Real regulations are written in months and anniversaries; 365 days drifts. | M |
| A4 | **Completing a deadline starts the next cycle.** Marking "Annual Review" done sets the next due date and (optionally) adds that review's checklist to the client. | Turns Pulse from a reminder into a workflow; a strong demo moment. | M |
| A5 | **Structured note formats** (DAP / SOAP / "Contact type · Who · Purpose · Outcome · Next steps") as note templates with fields, still saved as one note. | Faster, more consistent documentation; supervisors like it. | S–M |
| A6 | **Morning briefing on unlock**: "3 overdue, 5 due this week, 2 follow-ups today", one click to Focus Mode. | Daily habit hook; it's the first thing users see. | S |
| A7 | **Bulk "mark done"** for several deadlines or follow-ups at once. | End-of-day cleanup speed. | S |

## B. Compliance and supervisor-facing

| # | Idea | Why it matters | Effort |
|-|-|-|-|
| B1 | **One-click audit report** for a client or date range: field changes, notes (including voided ones and earlier versions), completions, as a PDF. *(From the security review.)* | Answers "show me the record" in an audit or a handoff. | M |
| B2 | **"Missing information" report**: required fields per caseload (e.g. Medicaid ID, guardian) and a list of clients missing any. | Clean data before audits; supervisors ask for this. | S–M |
| B3 | **Monthly compliance summary**: % of clients with contacts done and reviews on time, with the exceptions listed. Extends the supervisor report. | The number supervisors actually track. | M |
| B4 | **Service units / time tracking on notes** (minutes or 15-minute units, totals per client per month, CSV export). | Many case-management roles bill or report units. High value *if* your buyers need it. | M |
| B5 | **Mileage log** from visit notes (miles per trip, monthly reimbursement export). | Field workers file mileage every month. | S–M |

## C. Getting data in and out (offline)

| # | Idea | Why it matters | Effort |
|-|-|-|-|
| C1 | **Calendar export (.ics)** of deadlines and follow-ups into Outlook or Google Calendar, using initials only by default (no full names leave Pulse). | Workers live in Outlook; they get reminders without Pulse being open. | S–M |
| C2 | **Smarter Excel import** for messy agency spreadsheets: merged headers, "Last, First" names, mixed date formats. | The first five minutes of a trial; a bad import loses the sale. | M |
| C3 | **Client handoff packet**: one client's full record plus audit trail, for a transfer or discharge. | Common real-world task; builds on B1. | S (after B1) |
| C4 | **"Move to a new computer" wizard**: makes a backup, checks the recovery key, gives step-by-step instructions. | Turns a scary moment into a guided one; supports the "safe" message. | S |

## D. Selling itself (adoption and marketing)

| # | Idea | Why it matters | Effort |
|-|-|-|-|
| D1 | **Demo mode with a sample caseload.** Try everything with realistic fake clients before entering real data; one click to wipe it and start fresh. *(The screenshot tour already has the seeding code.)* | Lets people evaluate without putting client data in an unapproved tool, which removes the main trial blocker. Also produces screenshots and videos for the website. | S |
| D2 | **More role templates**, each with sensible deadline rules: service coordinator / care manager, school counselor, foster care caseworker, home health, re-entry case manager, waiver coordinator. | Each one is a landing page and search keyword ("caseload tracker for school counselors"). | S each |
| D3 | **Free tier** (e.g. up to 10–15 clients, forever) instead of only a 30-day trial. | Word of mouth in small offices; lower risk for a first try. A pricing decision, not just code. | S |
| D4 | **Printable weekly planner**: one page of this week's deadlines, visits, and follow-ups. | Field workers love paper; it's a shareable artifact. | S |

## E. Platform and trust

| # | Idea | Why it matters | Effort |
|-|-|-|-|
| E1 | **Windows Hello / Touch ID unlock** as an optional second factor or a quick unlock. | Convenience *and* fits the coming MFA requirement. | L |
| E2 | **macOS build** (the dmg config exists but isn't shipped). | Some independent practitioners use Macs; needs signing and notarization. | M |
| E3 | **In-app "Security & privacy" page** showing the at-a-glance text, plus "Copy for my supervisor". | Puts the approval packet one click away inside the trial. | S |

---

## My suggested first five
1. **D1 Demo mode** (S): unblocks trials and marketing at the same time.
2. **A1 Notes update deadlines** (M): the biggest daily time-saver, and easy to show.
3. **A3 + A4 Calendar rules and the next cycle** (M): makes the deadline engine match real regulations.
4. **B1 Audit report** (M): already promised by the security review; also enables C3.
5. **E3 Security page in the app** (S): uses work that's already written.

## Questions
1. **Who's your clearest buyer?** Pulse ships an OPWDD template, and there's an `opwdd` folder in your projects. If NY OPWDD care managers are the core audience, A2 (monthly contact rules) and B3 (compliance %) should move to the top, with OPWDD-specific defaults.
2. **Do your buyers bill or report time/units?** If yes, B4 jumps up.
3. **Free tier (D3):** open to it, or keep trial-only?
