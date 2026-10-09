# Generalizing Pulse: brainstorm (2026-10-01)

> **Superseded in part:** the user chose a fully flexible app with optional starter templates instead of profession presets or editions. The current plan is `plans/generalization-plan.md` (revision 2).

Question: can Pulse serve any professional who manages a list of people (or things) with deadlines, reminders and private notes, without losing what makes it sell to caseworkers?

Short answer: **yes, as one flexible product sold through many niches**, not as a generic "client manager." The core engine is already general. What's caseworker-specific is mostly words, defaults, and a few features that should become optional.

---

## 1. What Pulse is underneath

Stripped of social-work vocabulary, Pulse is:

| Layer | Today | General form |
|-|-|-|
| Records | Clients in caseloads | People (or things) in lists |
| Fields | Columns, incl. dates, dropdowns, phone | Same |
| Rules | Deadline rules (days/months, end of month) | Obligations: "X is due N after Y" |
| Activity | Case notes (note/phone/meeting/email/visit) | A log of interactions, with types |
| Requirements | Monthly contact requirements | "Do N of these per period" |
| Workflow | Checklists, tasks, mark done → next cycle | Same |
| Proof | Audit trail, compliance summary, handoff packet | "Show I did what I had to" |
| Trust | Offline, encrypted, no cloud | Same, and rare |

The last two rows are the moat. Every niche we target should be one where **proof** and **trust** matter. Otherwise Pulse is just a worse Airtable.

---

## 2. The overhaul, by area

### A. Words (vocabulary packs) — biggest visible change, M
- One setting decides the nouns used everywhere: **Clients / Students / Participants / Patients / Wards / Members / Staff / Residents / Properties / Items**, and for the list: **Caseload / Roster / Class / Portfolio / List**. "Case note" becomes "Note" or "Log entry".
- Set during onboarding ("What do you call the people you work with?"); changeable in Settings; can differ per list (a guardian might have "Wards" and "Providers").
- Implementation: move user-facing nouns into one dictionary (`src/shared/vocab.ts`) with plural/singular/article forms; components call `t('client')`. This is also the groundwork for a **Spanish** version.
- Reports, PDFs and exports use the same words.

### B. Feature presets instead of one big menu, M
Generalizing tends to bury simple users under options. Counter it with **presets**:
- Onboarding asks "What do you do?" and picks a preset: words + template + which features are shown.
- Optional modules, each a switch in Settings → Features: monthly contact requirements, time/units, mileage, acuity, letters, supervisor report, provider directory, handoff packet, focus mode.
- Example: a credential tracker preset shows deadlines, checklists and the compliance summary, and hides visits, mileage, acuity and letters.
- Hidden features keep their data; turning one on brings it back.

### C. Custom activity types, S–M
Note types are a fixed list today (note, phone, meeting, email, visit). Make them user-defined (name, icon, color):
- Guardian: "Court filing", "Facility visit", "Benefits review".
- Tutor: "Session", "Parent update".
- Credential tracker: "Certificate received".
These feed everything already built: date columns that follow note types (A1), monthly requirements (A2), units/mileage, audit trail. Migration: an `activity_types` table; existing types become the defaults.

### D. A stronger rules engine, M–L
Generic deadlines come in more shapes than "N days after a date":
- **Relative to another column**: "45 days after Referral Date", "Annual review 1 year after Plan Start".
- **Fixed calendar cadence with no date column**: "every quarter on Jan/Apr/Jul/Oct 15", "every year by March 31" (fiscal or court reporting years).
- **Business days**: "10 business days after", with a holiday list.
- **Conditional**: only while Status = Active; pause while On Hold.
- **Sequences**: intake → 30-day review → 90-day review → annual.
- **Snooze/extension** with a reason, kept in the audit trail (extensions are a real-world fact of life).
- **Multiple reminder points** per rule (60/30/7 days before), feeding the dashboard and calendar export.

### E. Stages and pipelines, M
Many professions have a lifecycle: Referral → Intake → Active → Transition → Closed.
- A **Status** column marked as "the stage" gets a board view (kanban), plus time-in-stage.
- Entering a stage can add a checklist and start deadlines ("Intake: assessment due in 30 days").
- Gives non-caseworkers the "pipeline" they expect from CRMs, without becoming a CRM.

### F. More ways to see the list, M each
- **Calendar view** (month/week) of everything due, inside the app.
- **Board view** (from E).
- **People cards**, for small lists (tutors, coaches).
- Saved views already exist; each view type can be saved.

### G. Records that aren't people, S (mostly words) to M
Credential tracking, equipment calibration, vehicle inspections, property leases, grants and contracts all use the same engine. With vocabulary packs, a list of "Staff" or "Vehicles" just works. The person-only parts (age from date of birth, guardian, initials in calendar export) should hide when the preset isn't about people.

### H. Links between records, M–L
Generalizes "providers linked to clients":
- Staff ↔ clients (who is assigned), household members, a guardian's ward ↔ facility ↔ court.
- A record's profile shows its links; reports can group by them ("deadlines by assigned worker").
- Keeps Pulse useful as the user's world gets more complex, without full relational design.

### I. Intake forms, M
- Build a form from a list's columns, fill it in for a new record (cleaner than typing into a grid), print a blank version for paper intake.
- A big win for less tech-savvy users in every niche.

### J. Attachments return, L
Documents were removed (migration 031). Generic users will ask for "attach the signed plan." If they return: encrypted inside the database or an encrypted folder, size limits, included in backups and handoff packets. Decide only after demand is proven.

### K. Reminders when Pulse is closed, S–M
- Desktop notifications while Pulse is running (system tray, "3 due today").
- Optional "start with computer, stay in tray" (locked, showing counts only, never names).
- The .ics export (C1) already covers phones via the user's calendar.
- No email reminders: they would break the offline promise.

### L. Sharing without a cloud, L (later)
This is the most common request from generic and agency buyers, and the most dangerous to the product's identity.
- Option 1: a **read-only encrypted snapshot** for a supervisor or covering coworker (opened with a password in Pulse, view-only).
- Option 2: an encrypted database on a **shared network folder** with one-writer-at-a-time locking (small offices).
- Not real-time multi-user sync. Revisit after there are paying users asking.

### M. Spanish (and other languages), M after A
Big markets: bilingual case managers, promotoras, school family liaisons. Vocabulary packs (A) make it far cheaper.

---

## 3. Niches worth considering

Scored 1–5 on how well each matches Pulse's strengths. **Fit** = recurring deadlines + confidential info + solo/no IT + no dominant cheap tool.

| Niche | Fit | Why | What it needs from the list above |
|-|-|-|-|
| Case managers / care coordinators (current) | 5 | The original | Done |
| Guardians, conservators, fiduciaries | 5 | Court report and accounting deadlines, very sensitive, often solo, few tools | D (fixed yearly dates, relative to appointment date), C, H (ward ↔ facility ↔ court) |
| Representative payees | 4 | Annual SSA accounting, benefit reviews | D, C |
| Special education / IEP coordinators | 5 | Legal timelines (30/60-day, annual, triennial), FERPA, district bans cloud tools | D (business/school days), A ("Students") |
| School counselors and social workers | 4 | Check-ins, 504 reviews, privacy | A, F (calendar) |
| Staff credential tracking (home care, group homes, daycares, staffing agencies) | 5 | Expiring licenses, CPR, TB tests; an inspection failure costs money; office managers pay | A ("Staff"), B preset, G, compliance summary as an "inspection-ready" report |
| Volunteer coordinators (CASA, hospice, mentoring) | 4 | Background checks, training renewals, contact logs | A, C, D |
| Probation, pretrial, re-entry | 4 | Already templated; agencies have systems, individuals still use Excel | D (conditional) |
| Foster care and adoption caseworkers | 4 | Already templated | E (stages) |
| Private-practice therapists | 2 | Need scheduling, billing and insurance claims; strong competitors | Only as "outcome measure and authorization tracker"; don't chase |
| Coaches, tutors, trainers | 2 | Low confidentiality need; want scheduling/payments | Skip |
| Legal aid, immigration paralegals | 3 | Hard deadlines, confidentiality, but law-practice software exists | D (business days, relative dates) |
| Tax preparers, bookkeepers | 2 | Seasonal deadlines; cloud tools dominate | Skip |
| Property managers (leases, inspections) | 2 | Mostly cloud tools; not people-sensitive | Skip |
| Equipment, vehicle and calibration logs | 2 | Fine engine fit, weak "trust" story | Free side-effect of G; don't market |

**Best next three:** guardians/fiduciaries, staff credential tracking, special education. Each pays for a real problem, needs privacy, and has no good cheap tool.

---

## 4. Positioning options

1. **Stay vertical (human services) + adjacent niches.** Same brand, more templates and landing pages. Lowest risk, slowest growth.
2. **Umbrella brand with editions (recommended).** "Pulse: private, offline tracker for people you're responsible for." One app; onboarding presets act as editions (Pulse for Guardians, Pulse for Staff Credentials, …), each with its own landing page, screenshots and search keywords. Same price.
3. **Separate branded apps from one codebase** (white-label builds with different names and icons). Best for search and trust in each niche, but multiplies releases, signing, support and websites. Only worth it once one niche clearly takes off.

Naming: "CaseConnect" ties the product to case management. "Pulse by BaringaSoft" with a niche tagline on each landing page travels better.

---

## 5. Risks

- **Configurability vs simplicity.** The audience isn't tech-savvy. Every new option must hide behind a preset with good defaults. Rule of thumb: a new user should never see a setting that doesn't apply to their preset.
- **Testing surface.** Presets × features × vocabulary multiply. Mitigation: a test per preset that loads its sample data and walks the main screens (the screenshot tour can be extended).
- **Diluted message.** The website must lead with one niche per page, never "for everyone."
- **Support load** across unfamiliar professions. Templates and sample data should be validated with one real person in each niche before marketing it.
- **Sharing requests** will pull toward cloud sync, which would undo the security story. Hold the line until paying users justify the local-only options in L.

---

## 6. Suggested roadmap

**Phase 1: make it feel general (about 2 weeks)**
- A. Vocabulary packs (nouns only at first).
- B. Onboarding "What do you do?" + presets + Settings → Features switches.
- C. Custom activity types.
- Three new presets with templates and sample data: Guardians, Staff Credentials, Special Education.
- Landing-page copy for each (in `plans/`; the website is separate).

**Phase 2: deadlines for every profession (2–3 weeks)**
- D. Relative-to-column rules, fixed calendar cadence, business days, conditional rules, extensions.
- F. Calendar view in the app.
- K. Desktop notifications / tray counts.

**Phase 3: structure (3–4 weeks)**
- E. Stages + board view.
- H. Links between records.
- I. Intake forms.
- M. Spanish.

**Later, only with demand:** J. attachments, L. sharing.

---

## 7. Validate before building Phase 2+

- Put up a landing page per niche with a free download, and count downloads and free-version activations per preset. The app can record which preset was chosen *locally only*; ask in a voluntary feedback form rather than adding analytics, which would break the offline promise.
- Talk to one guardian, one agency office manager and one special-ed coordinator: show the sample data, ask what's missing.
- Look for associations and communities: the National Guardianship Association and state guardianship groups, home care agency associations, special-ed coordinator forums, r/socialwork, r/specialed, Facebook groups for guardians and rep payees.

## 8. Other suggestions

- **Template gallery on the website.** Each `.pulse` template is a free download and its own search-friendly page ("Free guardianship deadline tracker"). The template opens in Pulse, which is the funnel.
- **"Your spreadsheet, but safer" import pages.** For each niche, publish the typical Excel layout and show it importing cleanly (C2 makes this credible).
- **Inspection/audit-ready story.** For credential tracking and agencies, the compliance summary plus audit trail *is* the pitch: "print this when the state inspector comes."
- **Agency starter pack.** Even without multi-user, sell a 5-license bundle plus a shared template for all staff, so an office standardizes on one setup.
- **Comparison pages:** Pulse vs Excel, Pulse vs Google Sheets (privacy), Pulse vs your agency's EHR ("for what the EHR doesn't track").
- **Short screen-recorded walkthroughs** per niche from the sample data, 60–90 seconds each.

## Questions for you
1. Which positioning: stay vertical, umbrella with editions (recommended), or separate branded apps?
2. Which three niches first? Recommended: guardians, staff credentials, special education.
3. Do you know anyone in those niches who could look at a template for 15 minutes?
4. OK to rename the product away from "CaseConnect"?
