# R8 — Examples that fit the work, found by the words people use

Phase 3 polish, Wave 1, merge slot 6. Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows #5, #6 (the setup half) and #14 (the example words).

## Goal

Typing your job into the example search finds it and shows **which** layout matched. A home-health nurse gets an example with patients, visit notes, minutes, miles and appointments already on, and a mileage report waiting. A foster-home licensing worker gets homes, licences and inspections, not foster children or beagles. The veterans' example has a place for the VA's 30-day evidence letters. Picking an example never lets keyboard focus wander behind it.

## Personas and findings

- **Joe** (#5): "foster" showed Human services as "11 layouts to choose from", so he read it as a social-work card and skipped it. Then CASA and Animal rescue (`persona-joe/p1-15-search-foster.png`). "license" and "inspection" found credentialing, driving schools, tree service and fire alarms (`p1-16-search-license.png`, `p1-16-search-inspection.png`). "Foster Care Caseworker" was inside Human services (`p1-17-human-services-layouts.png`) and is about kids, not homes. He renamed four columns and fixed a 30-day rule by hand (frustrations 7 and 8).
- **Candy** (#5, #6): "home health", "nurse", "patient", "visit" and "hospice" didn't lead her to Home Health Coordinator, which was eighth inside Human services (`persona-candy/09-search-home-health.png`, `11-human-services-layouts.png`). Its preview said "clients" and "case notes" while its column said "Patient Name" (`13-add-details.png`). Time, Mileage and Appointments were off, found only by scrolling Settings (`26-features-mileage.png`).
- **Bobby**: no column for the VA's "send evidence within 30 days" letters in the Veterans service officer example, so he used a checklist item that the counts and reports then missed (frustration 9).
- **Karen**: no "school social worker"; "Special education" was the closest (`persona-karen/06a-more-examples.png`).
- **Mark** (from R5's list): the ring escaped the example window behind the grey curtain (`persona-mark/29-focus-escaped-dialog.png`); new rows appeared above his ring.

## Current behaviour

- `shared/starters/schema.ts:310-330`: `starterSearchScore` already includes variant names (`:314`), so "foster" matches Human services through "Foster Care Caseworker". `components/starters/ApplyStarterDialog.tsx:163` shows only "11 layouts to choose from", and `pick()` (`:101-107`) opens the variant step on the **first** variant.
- `human-services.json`: one starter with 11 variants, one `vocab` (client / case note) and one `suggestedFeatures` (`timeTracking: false`, `mileage: false`). `variantSchema` (`schema.ts:186-193`) has no `vocab`, `suggestedFeatures` or `keywords` of its own, so a variant can't fix that.
- `veterans-service-officer.json`: "Claim filed" with the rule "Intent to file expires", "Appeal filed" with "Appeal window", "Next appointment", "Intent to file date", "Decision date", and no evidence-deadline column.
- `special-education.json` keywords lack "school social worker".
- `ApplyStarterDialog.tsx:71-75` closes on Escape through a window listener, but has no focus trap (the gallery isn't on the shared `Dialog`, or the trap misses the gallery step; check which).

## The change

### 1. Search shows the layout that matched, and opens it

- `schema.ts`: `matchingVariants(s, query): Array<{ key, name }>`, the variants whose name or list names contain a whole-word match for every term. It's exported for the renderer, and for the search test.
- `ApplyStarterDialog.tsx`: when a query matches variants, the card's third line reads "**Matches: Foster Care Caseworker**" (or "Matches: Home Health Coordinator, …"). Clicking the card, or the matched name (a 44 px link button), goes straight to that variant's review step, skipping the variant list. The count line stays when nothing in particular matched.
- Focus: the gallery, variant and review steps keep focus inside the dialog (`useFocusTrap` on the panel, or move the gallery onto `ui/Dialog`), and after "Show its columns" or a new row appears, focus moves to it.

### 2. Two new starters (JSON only; the schema is unchanged)

- **`home-health-nursing.json`**, "Home health nursing", group Human services or Health (whichever group holds School nurse; check `group` values). Keywords: home health, nurse, nursing, RN, patient, visits, hospice, skilled nursing, recertification, OASIS, mileage.
  - `vocab`: patient / patients, visit note / visit notes, visit log, nurse case manager as the worker, appointment = visit.
  - `suggestedFeatures`: `timeTracking: true`, `mileage: true`, `appointments: true`, `snippets: true`, `checklists: true`, `requirements: false` (the confirmation line lists them).
  - Columns from the Home Health Coordinator variant (Patient Name, Next Visit, Recertification Due, Plan of Care Signed, Physician, Physician Phone, Insurance, Status) plus "Last visit" with "update from notes" on Visit notes (`config.note_updates`), "Every 7 days".
  - Activity types: Visit, Phone, Coordination, Note.
  - A `reports` entry, "Miles and minutes this month", pinned through `dashboardCards`. Use the existing starter-report format (`starter-reports.ts`, `schema.ts:225-231`), config source activities, this_month, sum miles and minutes.
  - A Visit snippet or two in `documentTemplates`, if snippets can be seeded (check; skip otherwise).
  - Sample data copied from the variant, with a couple of visit notes carrying minutes and miles.
- **`foster-home-licensing.json`**, "Foster home licensing", group Human services. Keywords: foster, foster home, licensing, licence, license, renewal, home study, inspection, fire inspection, well water, training hours.
  - `vocab`: home / homes, licensing note, license worker, list = caseload of homes.
  - Columns: Home (name), Parents, License renewal (Every year, "Date is when it was last renewed", or a due date; take the one that reads right), Last inspection (Every 3 months), Fire inspection (Every year), Well water test (Every year), Training hours this year (number), County, Phone, Status (dropdown: Licensed, Pending, On hold, Closing).
  - A quota or measure for 12 training hours a year **only if** the starter format supports it simply (`measures`); otherwise leave Training hours as a number column with a description.
  - Rules use the standard thresholds; a lapsed licence is the first late row in the samples.
- Register both in `shared/starters/index.ts`. The catalog tests (`tests/starter-catalog.test.ts`, `starter-search.test.ts`, `starters.test.ts`, `starter-reports-words.test.ts`, `starter-rule-kinds.test.ts`) must pass, including the vocabulary checks: no "client" in a starter whose words aren't client. Per the Decision Log, built-in snippets and letter templates are seeded only under the human-services words, so check `starters.ts` before adding `documentTemplates` to home health.
- `human-services.json`: the Home Health Coordinator and Foster Care Caseworker variant descriptions gain "(For nurses who log miles, the Home health nursing example has them on.)" and "(For licensing foster homes, see Foster home licensing.)". Only if those still fit the 500-character limit; otherwise leave the variants alone.

### 3. Veterans' evidence letters

`veterans-service-officer.json`: add "Evidence due" (date), placed after "Decision date", with the existing one-off "Due date" rule kind and the description "30 days from the date on the VA's evidence request letter". Add a "VA letter date" column with a `relative` rule ("Evidence due: 30 days after VA letter date") **if** the relative kind can anchor on another column for a one-off date (it can: `anchorColumnId`); then "Evidence due" isn't needed. Pick one; the relative rule is better (Bobby types the letter date, Pulse does the maths, which is the "shows its maths" praise). Add a sample.

### 4. Small word fixes in starters

- `special-education.json` keywords: + "school social worker", "school counselor", "IEP minutes".
- Volunteer starters (`volunteer-manager.json`, `volunteer-safety.json`): the background-check rule's `description` becomes "Every 2 years, for volunteers who need one (or when that isn't filled in yet)", matching R4's engine change. Their `helpTips` "Background checks" body gains the same clause.
- `human-services.json`: nothing else (its client words are right for social work).

## Files owned

- `src/shared/starters/schema.ts` (`matchingVariants` only), `src/shared/starters/index.ts`
- `src/shared/starters/home-health-nursing.json` (new), `src/shared/starters/foster-home-licensing.json` (new), `veterans-service-officer.json`, `special-education.json`, `volunteer-manager.json`, `volunteer-safety.json`, `human-services.json` (two descriptions)
- `src/renderer/components/starters/ApplyStarterDialog.tsx`
- Tests: `tests/starter-search.test.ts` ("foster" → Human services with the Foster Care Caseworker match **and** Foster home licensing first; "home health" → Home health nursing first; "license" → Foster home licensing among results; "school social worker" → Special education), `tests/starter-catalog.test.ts`, `tests/starters.test.ts` (apply the two new starters with and without samples; features on), `tests/starter-reports-words.test.ts`, `tests/renderer/components/starters/ApplyStarterDialog.test.tsx` (the match line, jump to the variant, focus stays inside).

Not touched: `deadlineEngine.ts` (R4), `ReportBuilder.tsx` (R7), any settings section (R9).

## Commit steps

`npm run gate` before every commit.

1. **Search shows the match.** `matchingVariants`, the card line, jump to the variant, the focus trap. Tests above.
2. **Home health nursing.** JSON, registration, tests (features on after apply, the mileage report pinned, words "patient" / "visit note" everywhere in the preview).
3. **Foster home licensing.** JSON, registration, tests.
4. **Veterans' evidence, keywords, volunteer descriptions.** JSON edits and tests.
5. **Screenshots.** No Decision Log row needed (content only); mention the new starters in the progress entry and What's New.

## Acceptance

- **Joe's spec as regression** (`JOE_PHASE=p1`): typing "foster" shows **Foster home licensing** first, and Human services' card reads "Matches: Foster Care Caseworker". Picking Foster home licensing gives Home, Parents, License renewal, Last inspection every 3 months, with no renaming needed (compare `p1-15-search-foster.png`, `p2-08-renamed-three.png`).
- **Candy's spec** (`candy 1`): "home health" shows **Home health nursing** first. After adding it, Settings → Words & features shows Time, Mileage and Appointments on (was off, `26-features-mileage.png`), the note box has Minutes and Miles, and the dashboard has "Miles and minutes this month".
- **Bobby's spec** (`bobby setup (full)`): the VSO example has "VA letter date" (or "Evidence due"), and entering 9/28/2026 shows "Due Oct 28, 2026 (30 days after Sep 28, 2026)".
- **Karen** (`k05`–`k06`): "school social worker" finds Special education.
- **Mark** (`R8.spec.ts`, keyboard): Tab never leaves the example dialog.
- Screenshots (`shotter('R8')`): `R8/search-foster.light.png`, `R8/search-home-health.dark.png`, `R8/home-health-applied.dark.png`, `R8/vso-evidence.light.png`.
- `npm run gate` green. No migration, no network call. Every starter word goes through its `vocab`.

## Risks

- **Two starters overlapping Human services variants.** That's acceptable: the variants serve coordinators, the new ones serve the hands-on roles. The search tests pin which one ranks first.
- **Starter size limits** (`schema.ts` maxes) and the sample-data schema: validate with the existing tests before handcrafting large samples.
- **Seeded text** (snippets, letters) must follow the 2026-10-01 Decision Log row (only under human-services words); health words are close but not identical, so check `starters.ts`'s seeding condition and don't widen it here.
