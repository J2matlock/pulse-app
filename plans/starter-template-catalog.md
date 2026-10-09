# Starter template catalog

Companion to `plans/generalization-plan.md` (W12). This is a long list of every profession or use Pulse's general features could serve, as starter templates (data files, see W1.3). It's a menu to pick from, not a commitment: each template is cheap to add once the features it needs exist.

## How to read this

**Needs** is the earliest phase whose features the template requires:
| Code | Means the template needs |
|-|-|
| P1 | One list, repeating date rules, notes with custom activity types, checklists, missing info, requirements per period |
| P2 | Deadline engine v2: rules relative to another date, fixed calendar dates, business days, mileage/hours meters, quotas (e.g. authorized sessions), step sequences, extensions |
| P3 | Linked lists, stages with a board, batch letters, totals/number charts |
| P4 | Appointments and calendar, forms |
| P5 | Attachments |

**Fit** is how well Pulse's strengths (privacy, offline, proof of work, recurring deadlines, no IT needed) match the need:
- ★★★ strong; a good first-wave candidate and landing page.
- ★★ good.
- ★ works, but competitors or the user's needs (scheduling, billing, sync) make it a weaker sell.

Templates marked **(exists)** are already in the app today as list templates.

## Shipped

Built-in starters in `src/shared/starters/` (each checked by `tests/starter-catalog.test.ts`):
| Starter | id | Shipped |
|-|-|-|
| Human services (11 role variants, sample data per variant) | `human-services` | W01 / W12 |
| Housing case manager | `housing-case-manager` | W12 wave 1 |
| Community health worker | `community-health-worker` | W12 wave 1 |
| Peer recovery specialist | `peer-recovery` | W12 wave 1 (milestones as a sequence rule) |
| Refugee resettlement | `refugee-resettlement` | W12 wave 2 (sequence from arrival) |
| Vocational rehabilitation | `vocational-rehab` | W12 wave 2 (relative) |
| Staff credentials | `staff-credentials` | W12 wave 1 |
| Business licenses and permits | `business-licenses` | W12 wave 1 |
| Workplace safety training | `workplace-safety` | W12 wave 1 |
| Property manager | `property-manager` | W12 wave 3 (units ← tenants, units ← work orders, board) |
| Animal rescue | `animal-rescue` | W12 wave 3 (animals → fosters, adoption board) |
| Food service compliance (staff + equipment) | `food-service` | W12 wave 1 |
| School nurse | `school-nurse` | W12 wave 1 |
| Special education | `special-education` | W12 wave 2 (sequence, school days) |
| Early intervention | `early-intervention` | W12 wave 2 (sequence, relative to birth) |
| International student advisor | `international-students` | W12 wave 2 (relative window) |
| CASA / guardian ad litem | `casa-advocate` | W12 wave 2 (business days before a hearing) |
| Veterans service officer | `veterans-service-officer` | W12 wave 2 (relative) |
| HR generalist | `hr-generalist` | W12 wave 2 (relative, hire anniversary) |
| Grant manager | `grant-manager` | W12 wave 2 (calendar quarters, relative closeout) |
| Sales & follow-ups | `sales-follow-ups` | W12 wave 3 (pipeline board) |
| Therapy & counseling | `therapy-practice` | W12 wave 4 (weekly sessions, sessions quota, PHQ-9/GAD-7 history, intake form) |
| Prior authorization tracker | `prior-authorization` | W12 wave 2 (quota) |
| Representative payee | `representative-payee` | W12 wave 2 (anniversary, monthly requirement) |
| Pastoral care | `pastoral-care` | W12 wave 2 (birthdays, bereavement sequence) |
| Mentoring program | `mentoring-program` | W12 wave 3 (one-to-one matches, board) |
| Guardianship & fiduciary | `guardianship` | W12 wave 3 (wards → facilities, court cases → wards) |
| Fire & alarm inspection | `fire-alarm-inspection` | W12 wave 3 (customers ← sites ← devices); wave 4 certificates in Files |
| Behavior analyst (ABA) | `behavior-analyst` | W12 wave 3 (learners → technicians, sessions quota) |
| Childcare director | `childcare-center` | W12 wave 3 (children and staff, two lists) |
| Provider credentialing | `provider-credentialing` | W12 wave 1 |
| Youth volunteer safety | `volunteer-safety` | W12 wave 1 |
| Truck driver qualification files | `driver-files` | W12 wave 1 |
| Fleet manager | `fleet-manager` | W12 wave 2 (meter with odometer history) |
| Auto & equipment service | `auto-service` | W12 wave 3 (customers ← vehicles ← jobs, job board) |
| Personal documents | `personal-documents` | W12 wave 1 |
| Personal vehicles | `personal-vehicles` | W12 wave 2 (meter) |
| Caring for a parent | `caring-for-a-parent` | W12 wave 4 (appointments, care team links, papers in Files) |

---

## 1. Human services and social care

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| OPWDD care coordination (exists) | Caseload | Annual assessment, quarterly/monthly contacts, plan of care review | P1 | ★★★ |
| Social worker caseload (exists) | Caseload | Next review, annual assessment, contact log | P1 | ★★★ |
| Care manager / service coordinator (exists) | Caseload | Monthly face-to-face and phone, care plan every 6 months, annual reassessment | P1 | ★★★ |
| Waiver coordinator (exists) | Caseload | Monthly contacts, quarterly visits, level-of-care review, Medicaid recert | P1 | ★★★ |
| Foster care caseworker (exists) | Children, Placements, Caregivers | Monthly home visits, court hearings, case plan reviews, medical exams | P1 (P3 for links) | ★★★ |
| Re-entry case manager (exists) | Caseload | Post-release contacts, benefits applications, housing status | P1 | ★★★ |
| Home health coordinator (exists) | Patients | Visits, recertification every 60 days, plan of care signatures | P1 | ★★ |
| Probation officer (exists) | Caseload | Check-ins, drug tests, court dates, supervision end | P1 | ★★ |
| Pretrial services officer | Defendants | Court dates, check-ins, monitoring conditions, release review | P2 | ★★ |
| Child protective services investigator | Cases | Response within 24h/72h, investigation due in 30/45 days (relative to report date), safety plan reviews | P2 | ★★ |
| Adult protective services | Cases | Initial visit deadline from report, investigation window, follow-ups | P2 | ★★ |
| Housing case manager / homeless outreach | Participants | Monthly contacts, housing plan reviews, lease renewals, recertification | P1 | ★★★ |
| Refugee resettlement caseworker | Families, Members | 30/90/180-day service timelines from arrival (sequence), benefits enrollment, school enrollment | P2 (P3 for families) | ★★★ |
| Community health worker | Clients | Monthly outreach requirement, screenings due, referrals follow-up | P1 | ★★★ |
| Peer recovery specialist | Participants | Weekly contacts, recovery plan review every 90 days, milestone dates | P1 | ★★★ |
| Substance use counselor | Clients | Treatment plan review every 30/90 days, drug screens, sessions quota, discharge planning | P2 | ★★ |
| Victim advocate | Clients | Court dates, protective order expiration (relative), safety plan check-ins, compensation filings | P2 | ★★★ |
| Veterans service officer | Veterans | Intent-to-file expiry (1 year), claim stages, appeal deadlines (relative), C&P exams | P2 (P3 for stages) | ★★★ |
| Vocational rehabilitation counselor | Clients | Plan due 90 days from eligibility (relative), annual review, job placement 90-day follow-up | P2 | ★★★ |
| Early intervention service coordinator | Children | 45-day referral to IFSP timeline (sequence), 6-month review, annual IFSP, transition at 33 months (relative to birth date) | P2 | ★★★ |
| Home visiting nurse / parent educator | Families | Visit schedule by program phase, developmental screenings by child age (relative to birth date) | P2 | ★★★ |
| Geriatric care manager / aging services | Clients | Quarterly reassessments, medication reviews, insurance renewals, family updates | P1 | ★★★ |
| Hospice volunteer coordinator | Volunteers, Patients | Volunteer training/TB renewals, visit logs, bereavement follow-ups at 1/3/6/13 months (sequence) | P2 (P3 for links) | ★★★ |
| Benefits navigator / SNAP-Medicaid assister | Clients | Recertification dates, application status stages, document follow-ups | P1 (P3 for stages) | ★★★ |
| Representative payee | Beneficiaries | Annual SSA accounting (calendar), benefit reviews, monthly budget check-ins | P2 | ★★★ |
| Guardianship and fiduciary | Wards, Facilities, Court cases | Annual report/accounting on appointment anniversary, monthly visits, court filings | P3 (P5 for court orders) | ★★★ |
| CASA / guardian ad litem volunteer | Children | Monthly visits requirement, court report due 10 business days before hearing | P2 | ★★★ |
| Mentoring program coordinator | Mentors, Mentees, Matches | Match check-ins monthly, background check renewals, match anniversaries | P3 | ★★★ |

## 2. Health and therapy practices

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Therapist caseload (exists) | Clients | Auth expiration, next appointment, annual assessment | P1 | ★★ |
| Therapy and counseling practice | Clients | Weekly appointments, SOAP/DAP notes, authorized-sessions quota, 90-day treatment plan review, PHQ-9/GAD-7 history, units | P4 | ★★ |
| Behavior analyst (ABA / BCBA) | Clients, Technicians | Authorization units quota and expiry, treatment plan update every 6 months, supervision hours requirement for techs | P3 | ★★★ |
| Speech, occupational or physical therapy | Patients | Plan of care recertification (every 90 days), progress report every 10 visits (quota), authorization visits | P2 | ★★ |
| School-based therapist | Students | IEP minutes per week (requirement with measures), progress reports per term, annual IEP | P2 | ★★★ |
| Dietitian / nutrition counselor | Clients | Follow-up visits, weight and lab value history, package sessions quota | P3 | ★★ |
| Midwife / doula | Clients | Prenatal visit schedule relative to due date (sequence), postpartum visits, birth date | P2 | ★★ |
| Lactation consultant | Clients | Follow-ups at 3 days / 2 weeks / 6 weeks after birth (sequence) | P2 | ★★ |
| School nurse | Students | Immunization compliance, medication authorization renewals (yearly), health plans, screenings by grade | P1 | ★★★ |
| Occupational health nurse | Employees | Annual physicals, respirator fit test, hearing tests, TB, return-to-work follow-ups | P1 | ★★★ |
| Dental or eye care recall | Patients | 6-month recall, annual exam, letter/postcard batches | P3 | ★ |
| Clinical research coordinator | Participants | Visit windows relative to enrollment (Day 0, Week 4 ± 3 days), adverse event follow-ups | P2 | ★★ (not a 21 CFR Part 11 system; say so) |
| Care transitions / discharge nurse | Patients | Follow-up call within 2 business days of discharge, 30-day readmission window | P2 | ★★ |
| Referral coordinator (medical office) | Referrals | Referral stages, 30-day follow-up, authorization expiry | P3 | ★★ |
| Prior authorization tracker | Authorizations | Units/visits quota, expiry, renewal 14 days before end | P2 | ★★★ |
| Provider credentialing (medical office) | Providers | License, DEA, board certification, CAQH re-attestation every 120 days, payer re-credentialing every 3 years | P1 | ★★★ |
| Personal trainer / coach | Clients | Session packages (quota), progress measurements history, check-ins | P3 | ★ |
| Massage therapist / bodywork | Clients | Yearly intake form renewal, package sessions, rebooking reminders | P2 | ★ |

## 3. Education and youth

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| IEP coordinator (exists) | Students | Annual review, triennial evaluation, next meeting | P1 | ★★★ |
| School counselor (exists) | Students | Check-ins, 504/IEP review, parent contacts | P1 | ★★★ |
| Special education coordinator | Students | Referral → evaluation in 60 school days → eligibility → IEP in 30 days → annual → triennial (sequence, school-day calendar) | P2 | ★★★ |
| 504 coordinator | Students | Annual 504 review, re-evaluation every 3 years, accommodation check-ins | P1 | ★★★ |
| Tutoring center | Students | Session packages (quota), progress reports monthly, parent updates | P3 | ★★ |
| Private music, art or dance teacher | Students | Lessons weekly, recital and exam dates, book/level progress | P4 | ★ |
| College admissions counselor | Students, Applications | Application deadlines per school, stages (drafting → submitted → decision), recommendation requests | P3 | ★★ |
| Academic advisor | Advisees | Check-ins per term (requirement), degree audit dates, probation follow-ups | P1 | ★★ |
| International student advisor | Students | Visa/I-20 expiry, OPT application windows (relative to program end), reporting deadlines | P2 | ★★★ |
| Driving school | Students | Permit date, required practice hours (quota with measures), road test date | P2 | ★★ |
| Athletic trainer / coach | Athletes | Physicals yearly, concussion return-to-play steps (sequence), eligibility | P2 | ★★ |
| Childcare / daycare director | Children, Staff | Immunizations by age, staff credentials and background checks, licensing inspection items | P3 | ★★★ |
| Head Start / pre-K family advocate | Families | Home visits requirement, screenings within 45 days of enrollment, family goals review | P2 | ★★★ |
| Scout / youth program leader | Youth, Adult volunteers | Youth protection training renewals, health forms yearly, rank requirements | P3 | ★★ |
| Homeschool / learning portfolio | Students | Quarterly reports, annual assessments, subject hours (measures) | P2 | ★ |

## 4. Legal, justice and government

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Legal aid / immigration paralegal | Clients, Matters | Filing deadlines, biometrics, response windows (e.g. 87 days), status stages, business days | P3 | ★★ (not a court-rules docketing system; say so) |
| Court-appointed attorney (solo) | Clients | Hearing dates, motion deadlines relative to hearing, client contact requirement | P2 | ★★ |
| Bail bond agent | Defendants | Court dates, check-in requirement weekly, bond expiry | P2 | ★★ |
| Process server | Jobs | Attempts quota, due-by date, affidavit stage | P3 | ★ |
| Notary / commissioned officials | Commissions | Commission renewal, bond and insurance renewals | P1 | ★ |
| Code enforcement officer | Cases (properties) | Notice → compliance deadline (relative) → re-inspection, stages | P3 | ★★ |
| Building inspector | Permits | Inspection stages, permit expiry, re-inspection windows | P3 | ★★ |
| Grant manager (government or nonprofit) | Grants | Quarterly reports (calendar), drawdown dates, closeout relative to end date | P2 | ★★★ |
| Election / board clerk | Officials, Filings | Filing deadlines (calendar), training certifications | P2 | ★ |

## 5. Business and professional services

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Staff credentials (agency HR) | Staff | License, CPR (2 years), TB (yearly), background check, inspection-ready summary, renewal letters | P1 | ★★★ |
| HR generalist (small business) | Employees | Probation end 90 days after hire (relative), annual review on hire anniversary, I-9 reverification, benefits enrollment | P2 | ★★★ |
| Recruiter / staffing agency | Candidates, Placements | Pipeline stages, credential expiry for placed workers, 30/60/90-day check-ins after placement (sequence) | P3 | ★★ |
| Bookkeeper / tax preparer | Clients | Quarterly estimates (Apr/Jun/Sep/Jan 15), filing and extension deadlines (calendar), document checklist per season | P2 | ★★ |
| Insurance agent | Clients, Policies | Policy renewals (60 days before), annual reviews, claim follow-ups | P3 | ★★ |
| Financial advisor | Clients | Annual review, RMD start relative to date of birth, beneficiary review | P2 | ★★ |
| Mortgage loan officer | Loans | Stages (application → closing), rate lock expiry, document conditions | P3 | ★ |
| Real estate agent (transactions) | Transactions, Clients | Contingency deadlines relative to contract date (inspection 10 days, financing 30 days), closing date, post-closing follow-ups (sequence) | P3 | ★★ |
| Business licenses and permits tracker | Licenses | License and permit renewals, insurance certificates, annual filings (calendar) | P1 | ★★★ |
| Nonprofit donor relations | Donors | Thank-you within 2 business days, annual renewal ask, pledge payment dates | P2 | ★★ |
| Event planner | Events | Countdown tasks relative to event date (sequence: 6 months, 3 months, 1 month, 1 week) | P2 | ★★ |
| Wedding planner | Couples | Sequence relative to wedding date, vendor deposits, final counts | P3 | ★★ |
| Freelancer / consultant | Clients, Projects | Deliverables, invoices to follow up (relative), contract renewals | P3 | ★ |
| Photographer | Clients, Sessions | Gallery delivery 30 days after session (relative), contract and deposit dates | P3 | ★ |
| Talent or literary agent | Clients, Contracts | Contract renewal and option dates, royalty statement dates | P3 | ★ |
| Sales follow-ups (light CRM) | Leads | Stages, relative follow-ups, activity types (call, email, meeting) | P3 | ★ |

## 6. Trades, field service and repair

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Auto repair shop | Customers, Vehicles, Jobs | Oil change every 5,000 miles or 6 months (meter), inspection yearly by month, job board, follow-up call after pickup, labor hours and parts cost, reminder postcards | P3 | ★★ |
| Fleet manager | Vehicles, Drivers | Mileage-based service, DOT annual inspection, registration, driver license and medical card expiry | P3 | ★★★ |
| Trucking compliance (driver files) | Drivers | Medical card (up to 2 years), annual MVR review, drug test program dates | P1 | ★★★ |
| HVAC service company | Customers, Sites, Equipment | Maintenance agreement visits twice a year, filter changes (meter: runtime hours), warranty expiry | P3 | ★★ |
| Pest control | Customers | Quarterly service (calendar), treatment logs with products used (measures) | P2 | ★★ |
| Pool service | Customers | Weekly route, chemical readings history (number charts), equipment warranty | P3 | ★ |
| Lawn care / landscaping | Customers | Seasonal treatment schedule (calendar), irrigation winterization | P2 | ★ |
| Plumber / electrician | Customers, Jobs | Permits and inspections stages, warranty expiry, annual maintenance | P3 | ★ |
| Fire extinguisher / alarm / sprinkler inspection | Customers, Sites, Devices | Annual inspections, 6-year and 12-year service (relative to manufacture date), certificates | P3 (P5 for certificates) | ★★★ |
| Backflow testing | Sites | Annual test due by calendar month, report to water authority | P2 | ★★ |
| Elevator / boiler inspection | Sites, Units | Annual and semiannual inspections, certificate expiry | P3 | ★★ |
| Small engine, bike or marine repair | Customers, Machines, Jobs | Service by hours or season, winterization | P3 | ★ |
| Aviation maintenance (small operator) | Aircraft | 100-hour and annual inspections (meter: flight hours), AD compliance dates | P2 | ★★ (not an FAA-approved records system; say so) |
| Appliance repair | Customers, Jobs | Parts on order stage, warranty, follow-up | P3 | ★ |
| Chimney sweep | Customers | Annual inspection reminders (batch postcards) | P3 | ★ |

## 7. Property, facilities and safety

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Property manager | Units, Tenants, Work orders | Lease end with notice 60 days before (relative), inspections every 6 months, work order board | P3 | ★★ |
| Small landlord | Units | Lease renewals, smoke and CO detector checks yearly, rent increase notice windows | P2 | ★★ |
| HOA / condo manager | Units, Owners | Annual meeting, insurance renewals, architectural requests stages | P3 | ★ |
| Facility maintenance (preventive) | Assets | PM schedules by days or runtime hours, inspections, vendor contracts | P2 | ★★ |
| School or church facilities | Buildings, Assets | Fire drills monthly per building (requirement), inspections, permits | P1 | ★★★ |
| Workplace safety / OSHA training | Employees | Forklift certification (3 years), first aid/CPR, hazard training yearly | P1 | ★★★ |
| Food service compliance | Staff, Equipment | Food handler cards, health inspection, hood cleaning twice a year, thermometer calibration | P1 | ★★★ |
| Construction site safety | Sites, Workers | Site inspections weekly (requirement), worker certifications, equipment inspections | P3 | ★★ |
| Lifeguard / aquatic program | Staff | Certifications, in-service hours monthly (quota with measures), audits | P2 | ★★ |
| IT asset management | Devices, Licenses | Warranty expiry, software license renewals, laptop refresh every 3 years | P1 | ★★ |
| Web agency renewals | Clients, Domains | Domain and SSL renewals, hosting contracts, maintenance check-ins | P3 | ★ |
| Lab equipment calibration | Instruments | Calibration intervals, certificates, out-of-service stage | P2 (P5 for certificates) | ★★ |
| Medical device maintenance (clinic) | Devices | Preventive maintenance, electrical safety checks, recall notices | P2 | ★★ |
| Equipment rental | Items, Rentals | Return dates (relative), service after N rentals (meter), inspections | P3 | ★ |

## 8. Animals and agriculture

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Veterinary reminders (small clinic) | Clients, Pets | Vaccines (rabies 1 or 3 years), dental, heartworm, reminder postcards | P3 | ★ |
| Dog groomer | Clients, Dogs | Rebook every 6 weeks, vaccine records on file | P3 | ★★ |
| Dog trainer | Clients, Dogs | Session packages (quota), homework follow-ups | P3 | ★ |
| Kennel / boarding | Pets | Required vaccines current, stays | P3 | ★ |
| Animal rescue / foster coordinator | Animals, Fosters | Vet care schedule by intake date (sequence), adoption stages, foster check-ins | P3 | ★★★ |
| Horse barn manager | Horses | Farrier every 6–8 weeks, vaccines, Coggins yearly, deworming, dental | P1 | ★★ |
| Livestock breeding | Animals | Due date 283 days after breeding (relative), weaning, vaccinations | P2 | ★★ |
| Beekeeper | Hives | Inspections every 7–10 days, treatment logs, queen age | P1 | ★ |

## 9. Faith, community and membership

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Pastoral care | Members | Hospital and home visits, birthdays and anniversaries (calendar from dates), bereavement follow-ups (sequence) | P2 | ★★★ |
| Church volunteer safety | Volunteers | Background checks every 2–3 years, child safety training yearly | P1 | ★★★ |
| Volunteer manager (any nonprofit) | Volunteers | Orientation, training renewals, hours logged (measures), check-ins | P1 | ★★ |
| Club or association membership | Members | Renewal dates, dues reminders (batch letters), committee terms | P3 | ★ |
| Youth sports league | Players, Coaches | Physicals, coach certifications and background checks, registration stages | P3 | ★★ |
| Alumni / class reunion | Alumni | Contact updates, event milestones | P2 | ★ |

## 10. Personal and family (good for the free version)

| Template | Lists | Key columns, rules and features | Needs | Fit |
|-|-|-|-|-|
| Family health | Family members | Checkups yearly, dentist every 6 months, vaccines by age (relative to birth date), prescriptions refills | P2 | ★★ (privacy matters to families too) |
| Caring for a parent | Parent(s), Providers | Appointments, medication reviews, insurance and benefits renewals, power-of-attorney documents | P4 (P5 for documents) | ★★★ |
| Household maintenance | Home items | Furnace filter every 3 months, smoke detector batteries yearly, gutters twice a year | P1 | ★ |
| Personal documents | Documents | Passport, driver's license, insurance policies, warranties expiry | P1 | ★★ |
| Personal vehicles | Vehicles | Oil every 5,000 miles or 6 months (meter), registration, inspection | P2 | ★ |
| Pets at home | Pets | Vaccines, flea/tick monthly, vet checkups | P1 | ★ |

---

## Counts
135 templates across 10 groups. 11 exist today. By the earliest phase that makes them possible:
| Phase | Templates |
|-|-|
| P1 | 36 (incl. the 11 existing) |
| P2 | 50 |
| P3 | 46 |
| P4 | 3 |

## Suggested waves
1. **With P1:** Staff credentials, Business licenses and permits, Workplace safety/OSHA, Food service compliance, School nurse, Provider credentialing, Church volunteer safety, Housing case manager, Community health worker, Peer recovery specialist, Trucking compliance (driver files), Personal documents. They're all single-list, ★★–★★★ fit, and cheap to write.
2. **With P2:** Special education, Early intervention, Vocational rehabilitation, Refugee resettlement, Representative payee, CASA volunteer, Veterans service officer, HR generalist, Grant manager, Prior authorization tracker, Pastoral care, International student advisor.
3. **With P3:** Guardianship, Fleet manager, Fire/alarm inspection, Auto repair shop, Behavior analyst, Animal rescue, Childcare director, Mentoring program, Property manager.
4. **With P4/P5:** Therapy practice, Caring for a parent, and certificate-heavy inspection templates.

## Notes for sensitive fields
Some templates touch regulated record-keeping. Their description and help text must say plainly that Pulse is a tracking aid, not the system of record:
- **Legal:** not a court-rules docketing system.
- **Clinical research:** not a 21 CFR Part 11 system.
- **Aviation:** not an FAA-approved maintenance records system.
- **Medical:** not an EHR.
