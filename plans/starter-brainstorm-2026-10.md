# Starter brainstorm, round 2 (2026-10-09)

39 starters are shipped (`plans/starter-template-catalog.md` lists them, plus a long idea list). This round picks what to build next now that Pulse is **free and open source**. That changes who we're writing for: solo workers, small businesses and households who would never have paid for software, and who find Pulse by word of mouth.

## How the ideas were judged
1. **A real deadline story.** Something that hurts when it's missed, on clocks a spreadsheet can't follow (relative, calendar, meter, quota, sequence, stage-conditional).
2. **Fits Pulse's shape.** Single user, offline, encrypted, people or things with recurring dates. Not a team dispatch system, billing system, or regulated record system.
3. **Privacy is a selling point.** Fields where the data is sensitive (victims, taxes, immigration, health) and cloud tools are a worry.
4. **Spreads.** Trades and personal uses where people tell each other ("what do you use for…").
5. **Fills a thin group.** Animals has 1 starter, Faith and community 3, Personal 4, Property and safety 3.
6. **Effort.** S = mostly content on existing features (about half a day, like tree service), M = a day or a variant pack.

## Recommended next wave (top 12)

| # | Starter | Group | Lists | Signature deadline | Engine features shown | Effort |
|-|-|-|-|-|-|-|
| 1 | **Home services** (variants: lawn & landscaping, pest control, HVAC, pool, chimney / gutters / windows) | Trades and service | Customers ← Properties ← Visits (board) | Service plans: pest control quarterly, HVAC spring AC + fall furnace tune-up, pool opening/closing, fertilizer rounds; follow-up visit 14 days after a treatment | variants, calendar, relative, appointments (weekly routes), board, meter (mower hours) | M |
| 2 | **Bookkeeper & tax preparer** | Business | Clients ← Returns / Filings (board) | Quarterly estimated taxes (Jan/Apr/Jun/Sep 15), 1099s by Jan 31, extension deadline Oct 15, engagement letter yearly, "documents still missing" checklist | calendar rules, board, checklists, letters (document request) | S |
| 3 | **Real estate transactions** | Business | Clients ← Transactions (board) | From the contract date: inspection 10 days, appraisal, financing contingency 21 days, closing 30–45 days; post-closing check-in yearly on the anniversary | relative chain (several rules on one anchor), board, calendar from column (anniversary) | S |
| 4 | **Speech, OT and PT practice** | Health | Patients | Plan of care recert every 90 days, progress note every 10 visits, authorized visits quota, signed physician order within 30 days | quota, relative, interval, appointments (2×/week series), forms | M |
| 5 | **Victim advocate** | Human services | Clients ← Court dates | Protective order expiry with a 30-day warning, hearings, safety-plan check-ins, compensation claim deadline from incident date | relative, appointments, files (orders), privacy | S |
| 6 | **Subcontractor compliance (insurance certificates)** | Business | Subcontractors ← Jobs | General liability / workers' comp certificate expiry, license expiry, W-9 on file, "can't start work until current" | expiry rules, missing info, files (COIs), letters (request a new certificate) | S |
| 7 | **Horse barn / small herd** | Animals | Animals → Owners (boarders) | Farrier every 6–8 weeks, deworming, Coggins yearly, spring/fall vaccines, dentist yearly; breeding date → pregnancy check 14–16 days → foaling (about 340 days) | interval, calendar (spring/fall), relative chain from breeding date, links | M |
| 8 | **Job search** | Personal | Applications (board) ← Companies | Follow up 7 days after applying, only while Applied (same condition pattern as tree service); thank-you note the day after an interview | relative + stage condition, board, appointments (interviews), letters | S |
| 9 | **Home maintenance** | Personal | Home items (furnace, smoke detectors, water heater, gutters, roof, appliances) | Filter every 90 days, smoke detector batteries yearly, gutters spring and fall, water heater flush yearly, warranty end dates | interval, calendar, files (manuals, receipts) | S |
| 10 | **Family health** | Personal | Family members | Kids' well visits by age (a sequence from birth), dental every 6 months, eye exams, prescription refills | sequence from date of birth, interval, appointments | M |
| 11 | **Driving school** | Education and youth | Students ← Instructors | Permit date → road test eligible after 6 months (relative), 50 practice hours including 10 at night (requirement with measures), permit expiry | measures + requirement, relative, appointments (lesson series), links | M |
| 12 | **Volunteer manager (any nonprofit)** | Faith and community | Volunteers | Orientation, background check every 2 years, yearly training, hours logged on notes, thank-you at 100 / 250 / 500 hours | measures, interval, letters (thank-you), requirements | S |

### Why these twelve
- **#1 Home services** is the biggest win per hour. One starter with a "What kind of service do you run?" question (variants already exist; human services uses them) covers five trades that all share customers → properties → recurring visits. It's the natural sibling of tree service.
- **#2, #3, #6** are where people really run their business out of Excel, and the deadlines have consequences (penalties, a blown contingency, an uninsured sub on site).
- **#5 Victim advocate** is the strongest "offline and encrypted" story we have after human services. It's privacy-critical, and advocates rarely get good tools.
- **#8–#10** are the personal starters. They help Pulse spread now that it's free: anyone can try it on their own life, then bring it to work.
- **#7, #11, #12** each show off an engine feature no current starter leans on as hard: relative chains from a breeding date, practice-hour quotas, and volunteer hour milestones.

## Good later (second tier)

| Starter | Group | Signature deadline | Note |
|-|-|-|-|
| Immigration / legal aid paralegal | Legal and government | Visa / work permit expiry with 180-day warning, response deadlines from notice date, biometrics appointments | Disclaimer: not a docketing system |
| Head Start family advocate | Education and youth | Health and developmental screenings within 45 / 90 days of enrollment, 2 home visits a year, family partnership goals | Human-services words |
| Home health / hospice coordinator | Health | Recert every 60 days; hospice benefit periods 90 / 90 / 60 / 60… as a sequence; team meetings every 15 days | Disclaimer |
| Occupational health nurse | Health | Hepatitis B series (0 / 1 / 6 months), yearly hearing tests and respirator fit tests, TB | Sequence |
| Athletic trainer | Education and youth | Yearly physicals, concussion baseline every 2 years, return-to-play steps (sequence, a day each) | Sequence |
| IT assets & renewals | Business | Domain and SSL renewals, warranty ends, software seats (quota), device assigned to staff (links) | Small offices, churches, schools |
| Event & wedding planner | Business | Countdown before the event date: venue 12 months, invitations 2 months, final count 2 weeks (relative "before") | Shows "before" rules |
| Dog groomer | Animals | Groom every 6 weeks from the last visit, rabies certificate expiry, weekly appointment series | Pets → owners links |
| Small landlord | Property and safety | Lease end with rent-change notice 60 days before, smoke detector checks, furnace service | Could be a variant of property manager |
| Backflow / elevator / boiler testing | Property and safety | Yearly test per device, report due to the water authority N days after the test | Variants of fire & alarm inspection |
| Food pantry / emergency assistance | Human services | Eligibility recert yearly, visits limited to once a month (requirement) | Human-services words |
| Freelancer / consultant | Business | Invoice due net 30, contract renewals, retainer hours (quota) | Money stays plain columns (A2) |
| Insurance agent | Business | Policy renewals 60 days ahead, yearly review | Light CRM |
| Beekeeper | Animals | Hive inspections every 7–10 days in season, mite treatments, queen age | Needs "only in season" (see gaps) |
| Youth sports league | Faith and community | Player registrations, coach background checks and concussion training, field permits | |

## Skip (and why)
- **Clinical research, aviation maintenance, lab calibration, medical devices:** regulated record systems (21 CFR Part 11, FAA). Even with a disclaimer, it invites misuse.
- **Vet clinic, dental recall, mortgage officer, CPS investigator:** people in these jobs already have mandated practice or agency software. Pulse would only be a shadow copy.
- **Notary, election clerk, alumni reunion, massage, personal trainer:** too few deadlines to show off what Pulse does.

## Gaps these ideas surfaced (engine, not content)
1. **Seasonal windows:** "only April–September" (beekeeping inspections, mowing, pool chemistry). A month condition on rules, or a calendar rule with a range, would cover them. The interim workaround is rule conditions on a "Season" dropdown.
2. **Countdown task lists before a date** (weddings, closings): several relative "before" rules on one anchor work today but get crowded. A "sequence before" (steps counted back from the event) would be cleaner.
3. **Route day for recurring visits** (lawn, pool, pest): appointments do weekly series. A "this customer is on the Tuesday route" grouping on the calendar would help field trades. Small, and stays offline.
4. **Hour milestones** (volunteers 100 / 250 / 500): measures total today, but nothing fires at a threshold. A quota-style "reached" rule would fit.

None of these block the top 12. All twelve can be built with what ships in 2.0.1.

## Suggested order
1. Home services pack (#1)
2. Bookkeeper & tax preparer, real estate transactions, subcontractor compliance (#2, #3, #6)
3. Personal: job search, home maintenance, family health (#8–#10)
4. Victim advocate, Speech/OT/PT practice (#5, #4)
5. Horse barn, driving school, volunteer manager (#7, #11, #12)

Each follows the tree service recipe: JSON plus the generator script pattern, the catalog test entry, a website blurb, generated copy, a screenshot tour and a look at the calendar and dashboard shots.
