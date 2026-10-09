# Brainstorm Build Plan (overnight run, 2026-10-01)

Source: `plans/functionality-brainstorm.md` (user approved "all of it"). One commit per feature; each passes typecheck, lint, and `npm test` before commit; pushed to `ux-improvements`. Release stays postponed.

## Decisions made for the user (easy to change later)
- **Free tier (D3):** after the 30-day trial, Pulse keeps working for free with up to **15 active clients** (archived and trashed clients don't count). All features stay available; only *adding* clients past 15 is blocked, with an upgrade prompt. The read-only lock at trial end is removed: nobody's data is held hostage. A license removes the limit. Pricing and website copy are up to you.
- **Deadline rules (A3):** a rule can repeat by **days, months, or years**. Month and year math is calendar-correct: Jan 31 + 1 month = Feb 28/29. Existing day-based rules behave exactly as before.
- **Notes update deadlines (A1):** opt-in per date column ("Update this date when I log a … note") with chosen note types; the column gets the note's date.
- **Contact requirements (A2):** per caseload, e.g. "1 face-to-face + 1 phone per calendar month", counted from case-note types.
- **Units (B4) and mileage (B5):** optional fields on case notes (minutes, miles); monthly totals and CSV export. Hidden unless turned on in Settings.
- **Calendar export (C1):** `.ics` file, initials only by default (a setting allows full names).
- **Demo mode (D1):** implemented as a clearly labelled **sample caseload** inside the app (a separate demo database would fight the app's one-data-folder design). One click removes it; it never counts toward the free limit.

## Order (dependencies first, small wins early)
1. D1 Demo mode · 2. E3 Security page in app · 3. A6 Morning briefing · 4. A7 Bulk mark done · 5. D4 Weekly planner · 6. C4 Move-to-new-computer wizard · 7. D2 Role templates · 8. D3 Free tier
9. A3 Calendar rules · 10. A4 Next cycle · 11. A1 Notes update deadlines · 12. A2 Contact requirements · 13. A5 Structured notes
14. B1 Audit report · 15. C3 Handoff packet · 16. B2 Missing info · 17. B3 Compliance summary · 18. B4 Units · 19. B5 Mileage
20. C1 Calendar export · 21. C2 Smarter import
22. E2 macOS build · 23. E1 Windows Hello / Touch ID

## Known limits
- **E2 macOS:** can configure the build, but signing and notarization need an Apple Developer account, and it can't be tested on Linux. It will be prepared, not shipped.
- **E1 Windows Hello / Touch ID:** Touch ID has an Electron API; Windows Hello needs a native module. This is security-sensitive key handling, so it gets a design doc and possibly a macOS-only prototype, not a rushed implementation.

## Progress
| # | Feature | Commit |
|-|-|-|
| D1 | Sample caseload (demo mode) | dfcf758 |
| E3 | Security checkup + supervisor summary | b597fa2 |
| A6 | Morning briefing | 392fb4c |
| A7 | Bulk mark done | 55332be |
| D4 | Weekly planner PDF | 1997cb7 |
| C4 | Move to a new computer wizard | d38ce71 |
| D2 | Six role templates + rules; template rule links fixed | 470e33f |
| D3 | Free version (15 clients) | 71392a5 |
| A3 | Calendar-based deadline rules (months/years, end of month) | ded07af |
| A4 | Mark done starts the next cycle; optional checklist per column | a7bb393 |
| A1 | Case notes update date columns (per-column note types) | fb90276 |
| A2 | Monthly contact requirements per caseload | d5f13fb |
| A5 | Structured note formats (DAP, SOAP, BIRP, contact; custom) | 6cb4b14 |
| B1 | Audit trail PDF (client or caseload, any date range) | 6135c6e |
| C3 | Client handoff packet (cover + profile + audit trail; optional archive) | d38d557 |
| B2 | Required fields + Missing information report (CSV) | 005e64c |
| B3 | Monthly compliance summary (preview + PDF; reports moved to Export menu) | ec12625 |
| B4 | Time / service units on case notes (opt-in) | d658404 |
| B5 | Mileage on case notes + monthly CSV with amounts (opt-in) | d658404 |
| C1 | Calendar (.ics) export, initials by default | ec4af23 |
| C2 | Smarter import: grouped headers, merged cells, Last-First names, many date formats | 2e4636a |
| E2 | macOS build prepared (config, script, menu bar, Cmd shortcuts, guide); needs Apple account to ship | 8ce80da |
| E1 | Touch ID / Windows Hello: design doc (plans/quick-unlock-design.md), not implemented | eae0559 |
