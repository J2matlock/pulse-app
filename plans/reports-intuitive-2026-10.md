# Making reports intuitive (2026-10-10)

The feedback was: "I still don't understand how to use reports, and with sample data each report doesn't say much."

## 1. Sample data with a past (all starters, no per-starter work)
When sample data is loaded, Pulse also builds about a year of believable history from the starter's own samples:
- **Added dates:** sample records get "added" dates spread over the past year (not all "today"), so "added per month" means something.
- **Notes over time:** each sample record gets notes every few weeks since it was added. They use the starter's everyday note types (note, call/phone, email/text, visit/site visit/meeting) with neutral text ("Called to check in.", "All on track."). Generated notes are always older than 5 weeks, so the hand-written recent ones stay on top. Note types counted by a quota rule (sessions left, visits left) are never used, so authorizations stay as written.
- **Finished work in the past:** for job lists with a stage, the sample records already in a done stage are copied into past months. Each copy gets its done-date (the stage's stamp column) in that month and its money columns varied by ±25%, and keeps the same links. That's about 2 a month for 12 months, so "finished per month" and "total per month" have a shape.
- **Repeatable:** a seeded random generator per starter, so tests are stable.
- **Removable:** all of it is tracked as sample data, so "Remove sample data" removes it.

## 2. Ready-made reports for every starter
When a starter is applied, Pulse saves a few reports for its lists, worked out from the lists themselves:
- **{Records} by {stage}**, plus the total of the first money column, for a list with a stage
- **{Records} finished per month** (count + money, this year), for a job list whose done stage stamps a date
- **{Activities} per month** (this year), for the first list
- **Overdue deadlines** (a list of name, deadline, due date and days late), for the first list with deadline rules

Rules for these:
- A report with the same name on that list isn't duplicated.
- Starters can also list their own (`reports`, naming columns), for trade-specific questions such as tree service's "Estimates still waiting on an answer".

## 3. A chart with grouped reports
A simple horizontal bar chart above the table when a report has one grouping and a number to show:
- built from plain HTML and CSS, so it's theme-aware and readable by screen readers
- stage groups use their stage colors
- shown in the builder and on the pinned dashboard card

## 4. Say what a report does, in a sentence
- Above the preview: "Counting 10 jobs in Jobs, one line per Stage, showing how many and the total Estimate."
- Each saved report card and each starting point says which question it answers.

## 5. Easier to follow overall
- **A Reports home page:** your reports as cards (name, list, its sentence, and its result at a glance), "New report", and a one-line explanation of what reports are for. The builder opens when you pick one.
- **Plainer steps:**
  1. "Which list?" and "What do you want to count?"
  2. "Only some of them? (optional)"
  3. "Split into lines by… (optional)"
  4. "Show these numbers"
- Help text rewritten around questions, not mechanics.

## Order
1. Sample history (with tests)
2. Ready-made reports on apply (with tests)
3. Sentence, chart, home page and wording (with tests)
4. Walkthrough with screenshots on a few starters, help text, then commit
