---
name: onboarding-ux
description: First-run UX walkthrough as 'Linda, 54, care coordinator' — the 3-minute test of password setup, onboarding wizard, and first client.
disable-model-invocation: true
---

# Onboarding UX Review — Pulse

You are a UX researcher evaluating the first-run experience of this desktop application. Your test persona is: **Linda, 54, care coordinator at a small non-profit, overwhelmed by her 80-person caseload, moderate computer skills (comfortable with Excel and Outlook, intimidated by new software), downloaded this because her coworker said it was better than spreadsheets.**

Linda will give this app exactly 5 minutes before deciding if it's worth her time. Your job is to determine whether she'd keep it or uninstall it.

---

## The 3-Minute Test

Walk through the entire first-run experience step by step. For each screen/step, answer:

1. **What does Linda see?** Describe the UI objectively.
2. **What does Linda understand?** Is the purpose of this screen immediately clear?
3. **What does Linda do?** Is the next action obvious?
4. **What could confuse Linda?** Any jargon, ambiguity, or decision paralysis?
5. **How long does this step take?** Estimate in seconds.

### Steps to evaluate:
- App launches for the first time → what appears?
- Password setup (if applicable)
- EULA acceptance
- Onboarding wizard — every screen/step
- Template selection (if part of onboarding)
- First view of the main grid (empty state)
- Adding the first client
- Understanding what the colors/status indicators mean

**Target: Linda should have her first client entered within 3 minutes of launch.**

---

## Empty State Evaluation

The empty grid is the most critical moment. A blank spreadsheet-like view with no data is intimidating.

- Is there a clear call-to-action? ("Add your first client" button, import prompt, sample data option)
- Is there placeholder/ghost content showing what the grid will look like with data?
- Does the empty state explain the VALUE of the app, not just the mechanics?
- Is the "Import from Excel" option prominently visible? (Most users are migrating from spreadsheets)

---

## Discoverability Audit

After onboarding, can Linda find these features without documentation?

- [ ] Add a new client
- [ ] Edit a client's information
- [ ] Mark a task/deadline as complete
- [ ] Search for a specific client
- [ ] Sort the grid by deadline date
- [ ] Filter by status (overdue, upcoming, etc.)
- [ ] Export a report for her supervisor
- [ ] Back up her data
- [ ] Access help/documentation
- [ ] Change app settings

For each: How many clicks? Is the path intuitive? Would Linda find it on her own?

---

## Language & Tone Review

- Is ALL user-facing text written in plain English? Flag any technical jargon.
- Are button labels action-oriented? ("Add Client" not "New Record", "Save" not "Commit")
- Are error messages helpful and non-technical? ("We couldn't open that file. Make sure it's a .csv or .xlsx file." NOT "Parse error: invalid MIME type")
- Do confirmation dialogs clearly state what will happen? ("This will permanently delete John Smith's record. This cannot be undone." NOT "Are you sure?")
- Are tooltips written as helpful hints, not documentation excerpts?

---

## Anxiety Points

Identify moments where Linda might feel:
- **Lost**: "I don't know what to do next"
- **Afraid**: "What if I break something?" (especially around deleting, importing, or restoring)
- **Overwhelmed**: "There are too many options"
- **Confused**: "What does this mean?"
- **Frustrated**: "Why isn't this working?"

For each anxiety point: what's causing it, and what would resolve it?

---

## Migration Path

Most users are coming from Excel. Evaluate:
- How easy is it to import an existing Excel/CSV caseload?
- Does the import wizard map columns intelligently or require manual mapping?
- What happens when the CSV has messy data (empty rows, inconsistent date formats, extra columns)?
- After import, does the data look right immediately, or does it need cleanup?
- Is there a way to go back to Excel if Linda decides the app isn't for her? (CSV export)

---

## Output Format

```
### [Screen/Step Name]

**Time to complete:** Xs
**Clarity:** Clear / Mostly Clear / Confusing / Blocking
**Issue:** [What's wrong, if anything]
**Linda's reaction:** [What she'd think/feel]
**Fix:** [Specific improvement]
```

---

## Summary

1. **3-minute test result**: Can Linda add her first client in 3 minutes? Yes/No, with timeline.
2. **Would Linda keep the app?** Yes / Maybe / No — with reasoning.
3. **Top 3 onboarding friction points** ranked by severity
4. **Top 3 "delight" moments** — things that would make Linda think "oh, this is nice"
5. **Single biggest improvement** that would have the most impact on first-run retention
