# W12. Starter template content

Size: M overall, spread across phases (about half a day per simple template, 1–2 days for multi-list ones with sample data). The full idea list (135) is in `plans/starter-template-catalog.md`; this spec covers **how to author them** and **the first waves in detail**.

## 1. Authoring guide

### 1.1 Files
- `src/shared/starters/<id>.json`: one file per starter, the W01 §4.1 format (`pulse_template: '2.0'`, `type: 'workspace'`).
- `src/shared/starters/index.ts`: the static import list + `group` for the gallery.
- `tests/starters/<id>.test.ts` (generated from a shared helper):
  - validates the file;
  - applies it to an empty DB;
  - loads sample data;
  - runs every report;
  - checks the expected lists, columns and rules exist;
  - checks no human-services words leak (except in the human-services starter).

### 1.2 Rules for good starters
1. **Small and real.** 6–14 columns per list. Every column earns its place with a deadline, a filter or a report. Users add more.
2. **One deadline story.** Each list shows off at least one rule that matters in that job (a credential expiring, a 45-day timeline, an oil change).
3. **Plain names.** "Last home visit", not "LHV". "Due" columns say what's due.
4. **Sample data is clearly fake:**
   - names from a fixed fake list;
   - phones `555-01xx`, addresses on fictional streets;
   - dates spread so the dashboard shows overdue, due this week and later items;
   - notes that read like real but generic work.
5. **Words fit the trade:** `record` (and `list`/`activity` where natural), e.g. Students / Class roster / Note.
6. **Features:** suggest only what the starter uses.
7. **Regulated trades:** the description ends with the disclaimer line from the catalog ("Pulse is a tracking aid, not your official record system").
8. **Requires:** each starter declares `minPhase` (P1–P5). The gallery hides starters whose features aren't built yet (zod rejects unknown keys anyway).

### 1.3 SampleDataSpec
```ts
interface SampleDataSpec {
  records: Record<string /* list key */, Array<Record<string /* column name */, string | number | null | { daysFromToday: number }>>>
  links?: Array<{ type: string /* "Vehicles>Owner" */, from: string /* record ref "Vehicles#0" */, to: string /* "Customers#2" */ }>
  activities?: Array<{ record: string; type: string; daysAgo: number; text: string; measures?: Record<string, number> }>
  appointments?: Array<{ record: string; title: string; dayOffset: number; time?: string /* "HH:MM"; none = all day */; minutes?: number; type?: string; location?: string; repeatWeekly?: number /* weekly series of this many */; status?: 'scheduled' | 'done' | 'cancelled' | 'no_show' }>
  history?: Array<{ record: string; column: string; values: Array<{ value: string; daysAgo: number }> }>
  stepsDone?: Array<{ record: string; column: string; steps: number }>
}
```
As built: `stageHistory` became the general `history`; past sample appointments are marked done unless `status` says otherwise.
`{ daysFromToday: n }` keeps sample dates relative, so the demo always looks current. Loading uses the D1 mechanism (tracked in `app_meta 'sample_data'`, never counted, removed in one click).

## 2. Wave 1: ships with P1 (single list, interval rules, activity types, measures, requirements)

### 2.1 Human services (converted from today's templates)
- **Words:** client/clients, caseload, case note, case log, providers.
- **Variants:** the 11 existing role layouts (OPWDD, Social worker, IEP coordinator, Probation, Therapist caseload, Care manager, School counselor, Foster care, Home health, Re-entry, Waiver), copied exactly from `templates.ts` `syncBuiltInSetupTemplates` and `builtin-templates.ts` `ROLE_TEMPLATES_V2`, with the same rules (`STANDARD_RULES`), A1 note links and B2 required fields.
- **Activity types:** today's five.
- **Features:** requirements, letters, contacts directory, handoff, summary report, time tracking (off), mileage (off).
- **Requirements** (care manager variant): 1 visit + 1 phone per month.
- **Note formats:** DAP, SOAP, BIRP, Contact note (already built in).
- **Sample data:** today's D1 sample caseload, moved into the spec format.
- **Acceptance:** applying it on a blank install produces exactly what today's onboarding + D1 produce (snapshot test).

### 2.2 Staff credentials
- **Words:** staff member / staff, Staff roster, note.
- **Kind:** person.
- **Columns:**
  - Name (required), Role (dropdown: Aide, Nurse, Driver, Teacher, Office, Other), Hire date, Phone, Email;
  - CPR/First aid expires, TB test date, Background check date, License number, License expires;
  - Orientation done (checkbox), Status (Active, On leave, Former).
- **Rules:**
  - CPR expires: due date (interval 0, thresholds 60/30/14 days);
  - TB test: every 12 months;
  - Background check: every 24 months;
  - License expires: due date.
- **Required:** Name, Hire date, Role.
- **Activity types:** Note, Reminder sent, Document received.
- **Documents:** "Renewal reminder" letter (`{{name}}`, `{{deadline:CPR/First aid expires}}`).
- **Dashboard:** summary, missingInfo, priority list.
- **Sample:** 14 staff with a spread of expiring items.

### 2.3 Business licenses and permits
- **Words:** license / licenses, Licenses & permits.
- **Kind:** thing.
- **Columns:** License or permit, Issued by (agency), Number, Location/site, Issued on, Expires on, Renewal fee (currency), Renewal steps (notes), Status.
- **Rules:** Expires on, a due date with 90/60/30/7-day thresholds.
- **Activity types:** Note, Application sent, Payment made, Inspection.
- **Checklist on done:** "Renewal steps" (fill form, pay fee, file copy, update expiry).
- **Sample:** 10 items (business license, food permit, fire inspection certificate, sales tax registration, alarm permit…).

### 2.4 Workplace safety training (OSHA-style)
- **Words:** employee / employees, Safety roster.
- **Kind:** person.
- **Columns:** Name, Department, Hire date, Forklift cert date, First aid/CPR expires, Hazard communication (last), Fall protection (last), Respirator fit test (last), Hearing test (last), Status.
- **Rules:**
  - Forklift every 36 months;
  - First aid: due date;
  - Hazard communication every 12 months;
  - Fall protection every 12 months;
  - Respirator fit every 12 months;
  - Hearing test every 12 months.
- **Requirement:** none.
- **Reports:** Requirements summary as the "training status" printout.
- **Disclaimer:** included.

### 2.5 Food service compliance
- **Lists:** Staff (person) and Equipment (thing), as two lists without links (P1).
- **Staff:** Name, Role, Food handler card expires, Manager certification expires, Allergen training date (12-month rule).
- **Equipment:** Item, Location, Last hood cleaning (6-month rule), Last thermometer calibration (1-month rule), Last fire suppression inspection (6-month rule), Last pest service (1-month rule), Last health inspection (12-month rule).
- **Activity types:** Note, Inspection, Service visit.

### 2.6 School nurse
- **Words:** student / students, Health roster.
- **Columns:**
  - Name, Grade, Date of birth, Guardian, Guardian phone, Allergies, Conditions (tags);
  - Immunizations complete (checkbox), Medication authorization expires, Health plan review date, Vision screening (last), Hearing screening (last).
- **Rules:**
  - Medication authorization: due date;
  - Health plan review: every 12 months;
  - Screenings: every 12 months.
- **Required:** Name, Guardian phone, Date of birth.
- **Activity types:** Office visit, Medication given, Parent call, Note.
- **Measures:** none.
- **Sample:** 15 students.

### 2.7 Provider credentialing (medical office)
- **Words:** provider / providers, Credentialing.
- **Columns:** Name, Credentials (MD, NP, LCSW…), NPI, State license expires, DEA expires, Board certification expires, CAQH re-attestation (last), Malpractice insurance expires, Payer re-credentialing (last), Hospital privileges expire.
- **Rules:**
  - expiries are due dates;
  - CAQH every 120 days (interval days);
  - payer re-credentialing every 36 months.
- **Activity types:** Note, Application sent, Approved.
- **Disclaimer:** included.

### 2.8 Church / youth volunteer safety
- **Words:** volunteer / volunteers, Volunteers.
- **Columns:** Name, Ministry/program, Phone, Email, Background check (last), Child safety training (last), Reference check done, Start date, Status.
- **Rules:** background check every 36 months; training every 12 months.
- **Required:** Name, Phone.
- **Requirement:** none.
- **Activity types:** Note, Training, Check-in.

### 2.9 Housing case manager
Human-services words. A variant-like standalone starter for the catalog page:
- **Columns:** monthly contact, housing plan review (6 months), lease end (due date), income recertification (12 months), landlord contact.
- **Requirement:** 1 contact per month.

### 2.10 Community health worker
Human-services words.
- **Columns:** screenings due (due date), outreach contacts.
- **Requirement:** 2 contacts per month.
- **Activity types:** Home visit, Phone, Text, Referral made.
- **Note format:** Contact note.

### 2.11 Peer recovery specialist
Human-services words.
- **Columns:** recovery plan review every 90 days, weekly contact requirement, milestone dates (30/60/90 days clean as due dates).
- **Activity types:** Meeting, Phone, Group, Crisis contact.

### 2.12 Truck driver qualification files
- **Words:** driver / drivers, Driver files.
- **Columns:** Name, CDL class, CDL expires, Medical card expires, Last MVR review, Last road test, Drug test enrollment date, Annual review (last), Hire date.
- **Rules:** CDL and medical card are due dates; MVR every 12 months; annual review every 12 months.
- **Disclaimer:** included.

### 2.13 Personal documents (free-version friendly)
- **Words:** item / items, My documents.
- **Kind:** thing.
- **Columns:** Item (Passport, Driver's license, Car insurance, Home insurance, Warranty…), Belongs to, Number (last 4 only, with help text), Expires, Where it's kept, Notes.
- **Rules:** Expires, a due date with 90/30/7-day thresholds.
- **Sample:** 8 items.

## 3. Wave 2: ships with P2 (relative, calendar, business days, meter, quota, sequence)
Brief specs (full column lists are drafted when P2 starts):
| Starter | Signature rules |
|-|-|
| Special education | Sequence from referral: consent → evaluation (60 school days, business days with a school calendar) → eligibility → IEP (30 days) → annual → triennial |
| Early intervention | Sequence from referral: IFSP in 45 days → 6-month review → annual; transition at 33 months (relative to date of birth) |
| Vocational rehabilitation | Plan 90 days after eligibility (relative); 90-day placement follow-up (relative to job start) |
| Refugee resettlement | Sequence from arrival: 30/90/180-day services |
| Representative payee | Calendar: annual SSA accounting; monthly budget requirement |
| CASA / guardian ad litem | Relative: court report 10 business days before the hearing; monthly visit requirement |
| Veterans service officer | Relative: intent-to-file expires 1 year after filing; appeal windows |
| HR generalist | Relative: probation ends 90 days after hire; calendar: review on the hire anniversary |
| Grant manager | Calendar: quarterly reports; relative: closeout 90 days after the end date |
| Prior authorization tracker | Quota: visits authorized vs used; expiry |
| Pastoral care | Calendar: birthdays and anniversaries from dates; bereavement sequence 1/3/6/13 months |
| International student advisor | Relative: OPT window 90 days before to 60 days after program end |
| Fleet manager | Meter: service every N miles or months; registration calendar month |
| Personal vehicles | Meter: oil every 5,000 miles or 6 months |

## 4. Wave 3: P3 (links, stages, batch documents)
| Starter | Lists and links | Board |
|-|-|-|
| Auto & equipment service | Customers ← Vehicles (Owner) ← Jobs (Vehicle) | Jobs: Estimate → Approved → Waiting on parts → In progress → Ready → Picked up (on enter Picked up: stamp "Picked up date" → relative rule "follow-up call 3 days after") |
| Guardianship & fiduciary | Wards → Facilities (Lives at), Wards → Court cases | — |
| Fire/alarm inspection | Customers ← Sites ← Devices | — |
| Animal rescue | Animals → Fosters (Placed with) | Animals: Intake → Medical → Ready → Adoption pending → Adopted |
| Behavior analyst | Clients → Technicians (Assigned) | — (quota rules for authorizations) |
| Childcare director | Children, Staff (two lists, no link needed) | — |
| Mentoring program | Mentors ↔ Mentees (Matched, one_to_one) | Mentees: Referred → Matching → Matched → Closed |
| Property manager | Units ← Tenants (Lives in) ← Work orders (Unit) | Work orders: New → Scheduled → In progress → Done |
| Sales & follow-ups | Leads | New → Contacted → Proposal → Won / Lost |

Auto service sample data includes odometer histories (5–8 readings per vehicle over 18 months) so meter forecasts show "about Mar 3".

## 5. Wave 4: P4/P5 (appointments, forms, attachments)
| Starter | Signature features |
|-|-|
| Therapy & counseling | Weekly appointment series, activity types Session/Phone/No-show/Cancellation, quota (authorization), 90-day plan review, PHQ-9 & GAD-7 number columns with history, SOAP default, intake form, units |
| Caring for a parent | Appointments, Providers list linked, medication review every 3 months, insurance/benefits renewals, attachments (POA, insurance cards) |
| Fire/alarm inspection (update) | Attachments for certificates |

## 6. Commits
- **P1:** starter test helper; Human services (with variants + D1 sample migrated); then the other wave-1 starters, two or three per commit.
- **P2/P3/P4:** each wave's starters with their phase, one commit per starter for the multi-list ones.
- **Each commit:** the starter JSON + its test + a gallery entry + a catalog status update (mark it "shipped" in `plans/starter-template-catalog.md`).
