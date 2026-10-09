# Pulse generalization overhaul: detailed plan

Created 2026-10-01. Companion to `plans/generalization-brainstorm.md` (the why). This document is the how.

**Goal (from the user):** turn Pulse into a flexible tool for anyone who manages a list of people or things with deadlines, reminders and records. That ranges from human-services workers to therapists to the manager of a mechanic shop. Everything that works today must keep working, and new capability is added where it helps the general case.

**Status:** plan only. Nothing here is implemented. Each workstream below is sized to be built and committed on its own.

**Detailed specs:** `plans/generalization/` has one spec per workstream (user stories, screens, exact tables and types, IPC channels, files touched, edge cases, tests and a commit-by-commit breakdown). Where a spec and this overview differ, the spec wins.

**Revision 2 (2026-10-01):** professions are no longer "presets" that shape the app. Pulse is one fully flexible workspace; professions exist only as optional **starter templates**: plain data the user can apply, edit or ignore. There are no profession-specific code paths or modes. Setup offers three equal starts: from an example, from a spreadsheet, or blank (with a guided first list).

---

## 0. Guiding principles

1. **Nothing breaks for current users.** An existing install opens with exactly today's words, features and data (saved as its workspace settings by migration 036). Every change is additive or behind a migration that preserves data.
2. **Fully flexible, never a blank wall.** Users can set up any lists, words, columns, rules and features they want, and change everything later. To avoid a blank-page stall, setup offers examples (starter templates), spreadsheet import, or a guided blank start. Features nobody needs stay out of sight until turned on.
3. **The engine stays general; content is data.** Code knows about *records, lists, activities, rules, stages, appointments*. Starter templates (files, not code) supply *clients, vehicles, sessions, oil changes*. After setup there is no "mode": a workspace is just its lists and settings, and lists from different examples can be mixed.
4. **Offline, encrypted, single-user stays the identity.** No feature may add network calls beyond the update check and license activation, or store data outside the encrypted database.
5. **Proof is the differentiator.** Every new workflow feature (stages, appointments, extensions, links) records into the audit trail, so "show me what happened" keeps working across professions.
6. **One concept, one implementation.** Today's special cases become instances of general ones: contact requirements become recurring requirements, minutes and miles become measures, note types become activity types. Each conversion is done with backward-compatible data.

---

## 1. Decisions

### Made
| Decision | Choice |
|-|-|
| Positioning | One fully flexible app. Professions are optional starter templates (data only), never modes. Marketing can still use one landing page per starter template. |
| Setup | Three equal starts: an example (starter template), import a spreadsheet, or blank with a guided first list. |
| Rename | Yes, rename the product (see section 2). Keep internal identifiers stable. |
| Users and sharing | Still one user per license, offline. Sharing stays out of scope (section 11). |
| Existing users | Their workspace is saved with today's words (client, caseload, case note) and today's features switched on, so nothing visibly changes. |

### Assumed (change any of these before starting the affected workstream)
| # | Assumption | Affects |
|-|-|-|
| A1 | Free tier counts active records in "main" lists only (people and things), not jobs or appointments. The limit stays 15. | W13 |
| A2 | Money stays as plain number and currency columns plus totals. No invoicing, payments or accounting. | W10, section 11 |
| A3 | Appointments are local only. No online booking and no texts or emails to clients. | W7 |
| A4 | Attachments come back stored *inside* the encrypted database, with size limits. | W9 |
| A5 | Spanish is the first second language, after the vocabulary layer is done. | W15 |
| A6 | The new name will be chosen separately; the plan uses `{{ProductName}}` where it matters. | W14 |

---

## 2. Renaming the product, and Windows signing

**Short answer: renaming does not affect a Windows code-signing certificate.**

- **Certificates belong to the publisher, not the product.** That holds for OV, EV or Microsoft's Trusted Signing. They are issued to the legal publisher (you, or BaringaSoft if it's a registered business). The signature shows the publisher name, and any number of products can be signed with one certificate.
- **SmartScreen reputation** builds on the certificate and on file hashes. A renamed exe signed with the same certificate keeps the certificate's reputation. Every new version's file hash starts fresh anyway, so a rename costs nothing extra there.
- **Current state:** the Windows build is a portable exe with `signAndEditExecutable: false`, i.e. not signed yet. Signing is a separate pre-release task whether or not the name changes.
- **LemonSqueezy:** licenses are checked by product **ID** (868791), not name (`src/main/licensing.ts`). The product can be renamed in the LemonSqueezy dashboard and every existing key keeps working.

### What a rename *does* touch (must be handled)
| Item | Risk | Plan |
|-|-|-|
| Data folder on macOS and Linux | `app.getPath('userData')` is derived from the app name, which at runtime is package.json's `name` (`baringasoft-pulse`), not the display `productName` (verified: electron-builder doesn't copy `productName` into the packaged package.json, and `~/.config/baringasoft-pulse` is the live folder). If it changed, Pulse would look in a new, empty folder. | **Done in P0:** `src/main/app-identity.ts` (first import of `index.ts`) pins `app.setName(INTERNAL_APP_NAME)` and `userData` to `<appData>/baringasoft-pulse`. Tests guard the value, the import order and package.json's `name`. |
| Data folder on Windows (portable) | None. The `PulseData` folder name is hard-coded in `src/main/data-dir.ts`. | Keep it. Optionally rename to `{{ProductName}}Data` later, with move-on-first-launch logic. Not needed. |
| OS key store (`safeStorage`) | macOS Keychain and Linux libsecret entries are keyed by app name. A changed name could make the OS layer unable to decrypt the wrapped keys, which looks like "wrong password". Windows DPAPI is per user and unaffected. | Keep the internal app name constant (same `app.setName` as above); never change package.json's `name`. **Gate:** before release, test "upgrade old build → renamed build → unlock" on Windows and Linux, and on macOS once it ships. |
| `appId` (`com.baringasoft.pulse`) | Changing it changes the macOS bundle ID and Windows identity. | **Never change.** Only display names change. |
| File association label | Cosmetic (`src/main/file-association.ts`: "Pulse by BaringaSoft Template"). | Update the label; keep the `.pulse` extension and the `PulseTemplate` ProgID. |
| Visible name | `productName`, window title, PDF footers ("Pulse by BaringaSoft — CONFIDENTIAL"), help text, About, onboarding, security summary text, Mac menu. | Replace via one constant, `PRODUCT_NAME` in `src/shared/constants.ts`, and grep for the old strings. |
| Update check | Uses the `J2matlock/pulse-releases` repository URL. | Keep it. Renaming the repo later is fine (GitHub redirects), but unnecessary. |
| Website, LemonSqueezy store, docs | Marketing. | Rename after the app ships with the new name. |

**Name criteria (for A6):** generic enough for a social worker and a shop owner, suggests "keeping on top of things", passes a USPTO trademark search in software (class 9/42), and has a domain available. Keeping "Pulse" plus a word preserves the little brand equity that exists. Bare "Pulse" alone collides with many trademarks.

---

## 3. Target scenarios (these define "done")

Each scenario must be doable end to end in two ways: (a) from its starter template with sample data, and (b) **from a blank start**, using only general features. That keeps the engine honest: nothing may depend on a starter template. The scenarios double as manual and e2e test scripts.

### S1. Human services caseworker (existing, must not regress)
Caseload of clients; deadline rules; case notes in DAP format; monthly contact requirement (1 visit + 1 phone); audit trail; compliance summary; handoff packet; time and mileage. **Everything exactly as today.**

### S2. Therapist in private practice
- Clients list.
- Weekly recurring **appointments** shown in a calendar.
- Session notes in SOAP format.
- **Activity types:** Session, Phone, No-show, Cancellation.
- **Quota rule:** "insurance authorized 12 sessions through Jun 30", with a warning at 2 left or 14 days before expiry.
- Treatment plan review every 90 days.
- PHQ-9 score as a number column, with a **history chart** on the profile.
- Units from session minutes.
- No billing (out of scope); a CSV of sessions and units for the billing tool.

### S3. Mechanic shop manager
- Lists: **Customers** (people), **Vehicles** (things, **linked** to a customer), **Jobs** (with a **stage board**: Estimate → Approved → Waiting on parts → In progress → Ready → Picked up).
- Vehicle columns: VIN, plate, year/make/model, current odometer, last oil change (date + mileage).
- **Meter rule:** "oil change every 5,000 miles or 6 months, whichever comes first". Pulse estimates the due date from the odometer history.
- **Calendar rule:** state inspection due every year on the registration month.
- **Relative rule:** "follow-up call 3 days after the job reaches Picked up".
- **Measures** on job activities: labor hours, parts cost.
- **Batch letters:** "your vehicle is due for service" postcards for every vehicle due next month.
- Appointments for drop-offs.
- Dashboard: jobs by stage, vehicles due for service, today's drop-offs.

### S4. Guardian or conservator
- **Wards** linked to **Facilities** and **Court cases**.
- **Calendar rule:** annual report due on the anniversary of the appointment date.
- Monthly visit requirement.
- Attachments: signed care plans, court orders.
- Audit trail as evidence for the court.

### S5. Agency office manager tracking staff credentials
- **Staff** list (people); one date column per credential (CPR every 2 years, TB test yearly, license on its own date).
- Missing information report.
- "Inspection-ready" requirements summary.
- Batch letters reminding staff to renew.

### S6. Property or equipment manager (records that aren't people)
- **Units/Equipment** list (things); lease end with a **relative rule** "notice due 60 days before lease end".
- Inspections every 6 months.
- Calibration with a **meter rule** (hours used).
- No person-only features shown: no age, guardian, or initials logic.

---

## 4. Concept model: today → general

| Today (code / UI) | General concept | UI word comes from | Storage change |
|-|-|-|-|
| Grid / "Caseload" | **List** | Vocabulary (`list`) | `grids` gains `record_kind`, `vocab` (W2) |
| Row / "Client" | **Record** | Vocabulary (`record`), per list | none |
| Column | Column | — | new types: `link`, `meter` helpers (W4, W5) |
| Case log / case note, `log_type` | **Activity** with an **activity type** | Vocabulary (`activity`) + type labels | `activity_types` table; `log_type` keeps its keys (W3) |
| `minutes`, `miles` on notes | **Measures** (built-in + custom) | Measure labels | `case_log.extra_measures` JSON (W3) |
| Alert rule / "deadline rule" | **Rule** (interval, relative, calendar, meter, quota, sequence) | "Deadline rule" stays, as it's generic | `alert_rules` new columns + 2 tables (W5) |
| Contact requirements | **Recurring requirements** (per week/month/quarter) | "Requirements" | `contact_requirements.period` (W3) |
| Status column | **Stage** column (optional board) | — | column config `stage` (W6) |
| Follow-up date on a note, tasks | unchanged, plus **Appointments** | "Appointments" (vocab-able: Sessions, Drop-offs) | `appointments` table (W7) |
| Providers ↔ clients links | unchanged, plus **record links** between lists | Link labels | `link_types`, `record_links` (W4) |
| Acuity | **Priority level** | Vocabulary (`priority`) | none |
| Supervisor report | **Summary report** | — | none |
| Compliance summary | **Requirements summary** | — | none |
| Letter templates | **Document templates** + batch generation | — | placeholder aliases (W10) |
| Onboarding role + role templates | **Starter template** (optional, data only) | — | none; applying one just creates lists and settings (W1, W12) |

---

## 5. Workstreams

Each workstream lists: purpose, design, schema, main process, IPC, renderer, effect on existing features, tests, acceptance and size. Sizes: **S** ≤ 2 days, **M** 3–5 days, **L** 6–10 days.

---

### W1. Workspace foundation: words, feature switches, starter templates, setup v2 — L

**Purpose:** make every user-facing word and every optional feature a user setting, so any profession can shape Pulse without code forks. Then offer starter templates and a guided blank start so flexibility never means a blank wall.

#### W1.1 Vocabulary layer
- **`src/shared/vocab.ts`**
  - `type VocabKey = 'record' | 'list' | 'activity' | 'activityLog' | 'contactDirectory' | 'contact' | 'priority' | 'archive' | 'worker' | 'requirement' | 'appointment' | 'stage'`
  - Each term: `{ one: 'client', many: 'clients', article: 'a' }`, plus helpers:
    - `t(vocab, key, { count?, capital?, article? })`
    - `cap()` for sentence starts.
  - Two built-in word sets:
    - `GENERIC_VOCAB` (record/records, list, note, notes, activity log, contacts, priority…) for new blank workspaces.
    - `HUMAN_SERVICES_VOCAB` (client/clients, caseload, case note, case log, providers, acuity…) for existing users and the human-services starter template.
- **Two levels:**
  - Workspace words: settings key `workspace_vocab`, JSON.
  - Per-list overrides: `grids.vocab` JSON, e.g. a list of "Vehicles" in a workspace whose main word is "Customers".
  - Resolution order: list → workspace → `GENERIC_VOCAB`.
- **Renderer:**
  - `useVocab(gridId?)` hook backed by a small zustand store, `vocabStore`. It loads at unlock and refreshes on `'workspace:changed'`.
  - `<V k="record" many />` component for JSX text.
- **Main process:** `vocabFor(gridId?)` in `src/main/vocab.ts`, for PDFs, CSV headers, warnings and toasts produced in main. Examples:
  - The free-version limit message.
  - Import warnings.
  - Audit, compliance, handoff and supervisor PDF titles.
- **Rollout:**
  - About 83 renderer files and 33 main files contain client, caseload or case note (counted 2026-10-01: ~380 occurrences of client(s), ~190 of caseload(s), ~50 of case log/notes).
  - Convert by directory in order: layout and dashboard → grid → profile → settings → dialogs and reports → main-process text.
  - Internal identifiers (`gridId`, `rowId`, `case_log`, IPC names) **do not change**.
- **Regression guard:** an ESLint `no-restricted-syntax` rule that flags `JSXText` and JSX string attributes (`placeholder`, `title`, `aria-label`, `label`) matching `/\b(clients?|caseloads?|case (notes?|log))\b/i` outside `src/shared/vocab.ts` and starter template files. It runs in `npm run lint` and the post-edit hook.
- **Grammar edge cases:** "an" vs "a" (an equipment item, an hour), irregular plurals (person/people, child/children) and capitalization are all in the term object; no runtime pluralization guessing.

#### W1.2 Feature switches
- **`src/shared/features.ts`:**
  - `type FeatureKey = 'requirements' | 'timeTracking' | 'mileage' | 'priority' | 'letters' | 'summaryReport' | 'contactsDirectory' | 'handoff' | 'focusMode' | 'appointments' | 'stages' | 'links' | 'attachments' | 'forms' | 'measures' | 'checklists' | 'tasks' | 'snippets' | 'personFields'`
  - With `{ label, description, defaultOn }`.
- Stored in settings key `workspace_features` (JSON map), always user-controlled. Starter templates may *suggest* switches when applied; the user sees and can change them in the same step.
- **Defaults for a blank workspace:** core features on (lists, deadlines, notes, checklists, tasks, reports, backups); specialist ones off (requirements, time, mileage, priority, letters, handoff, appointments, stages, links, forms, attachments). The UI offers to turn on a feature at the moment it's relevant. Examples:
  - "Link this list to another list?" when creating a second list.
  - "Turn on appointments" on the empty calendar.
- **Renderer:** `useFeature(key)`; components and menu items render only when on. The sidebar, Export menu, profile sections, settings tabs and setup steps all check it.
- **Main:** features are **not** enforced in main (hiding, not disabling). Data stays and IPC still works, so turning a feature back on shows everything.
- Migrates today's switches:
  - `track_time` → `timeTracking`
  - `track_mileage` → `mileage`
  - `acuity_enabled` (per grid) stays per list but only shows when `priority` is on.
- **Settings → Features:** a list of switches with a one-line description each, grouped as "Records", "Notes & activity", "Planning", "Reports".

#### W1.3 Starter templates (data, not modes)
- **Format:** an extension of the `.pulse` file, `type: 'workspace'`, format v2.0, validated by zod. One file can carry:
  - lists (columns, links, stages, rules, requirements, forms)
  - suggested words and suggested feature switches
  - activity types and measures
  - note formats and document templates
  - suggested dashboard cards
  - optional sample data
  - help tips
  ```ts
  interface StarterTemplate {        // src/shared/starters/schema.ts
    id: string; name: string; description: string; icon: string
    vocab?: Partial<Vocab>
    suggestedFeatures?: Partial<Record<FeatureKey, boolean>>
    activityTypes?: ActivityTypeSeed[]       // W3
    measures?: MeasureSeed[]                 // W3
    lists: PulseListSeed[]                   // existing .pulse setup format + links/stages/forms
    rules?: RuleSeed[]                       // W5 (columns referenced by name)
    requirements?: RequirementSeed[]
    documentTemplates?: DocTemplateSeed[]
    noteFormats?: NoteFormat[]
    dashboardCards?: DashboardCardKey[]
    sampleData?: SampleDataSpec              // W12
    helpTips?: HelpTip[]
  }
  ```
- **Built-in starters** live as JSON files in `src/shared/starters/*.json`, bundled into the app (no network). Adding a new one is a content change: a JSON file plus its test fixture, no code.
- **Applying a starter is a one-time import.**
  - It creates lists, types, rules, etc.
  - It *merges* words and features after showing a short "This will…" summary with checkboxes.
  - Nothing remembers which starter was used. Afterwards the workspace is just ordinary lists and settings, fully editable.
- **Mixing:** "Add lists from an example…" (sidebar "+ New list" menu and Settings → Workspace) applies only the chosen lists from any starter. For example, a therapist adds the Equipment list from the equipment starter. Name collisions get " 2"; existing words are kept unless the user ticks "use this example's words".
- **Sharing setups:** "Export my setup as a template" saves the current workspace (structure only, never records) as a workspace `.pulse` file, so agencies and communities can share setups. Opening a workspace `.pulse` shows the same apply dialog. This generalizes today's single-list template export.
- **Settings → Workspace:**
  - Words editor (with live preview of a few sentences).
  - Feature switches.
  - "Add lists from an example".
  - "Export my setup as a template".

#### W1.4 Setup v2 (onboarding)
Today's steps are welcome → role → profile → path → (customize | import | template) → done (`src/renderer/views/OnboardingView.tsx`, `onboarding/onboardingData.ts`, roles limited to human-services jobs).

New flow:
1. Welcome.
2. Your name (profile).
3. **"How do you want to start?"**, three equal cards:
   - **Start from an example:** a gallery of starter templates (human services, therapy & counseling, auto & equipment service, staff credentials, and more as they're added), each with a one-line description and a preview of its lists. The next screen confirms its words (editable) and asks "Add sample data so you can try things?"
   - **Import my spreadsheet:** today's import wizard. Afterwards it asks what to call the rows ("What are these? Clients / Customers / Students / Vehicles / … / type your own") and offers to turn on deadline rules for detected date columns.
   - **Start blank:** a guided first list (below).
4. Done, with a short tour of the features that are switched on.

**Guided blank start** (about 1 minute, every step skippable):
1. Name your first list ("My customers", "Caseload", "Fleet").
2. "What does it hold?" People / Things / Jobs or tasks (W2).
3. "What do you call one?" (word + plural, prefilled from common choices).
4. Pick columns from suggestions matched to the kind (people: phone, email, date of birth, address; things: ID/serial, location, status; jobs: due date, status, assigned to), or add your own.
5. "Do any of these dates repeat?" For each date column picked: none / every N days, months or years / custom later. This creates interval rules.
6. Optional feature switches, shown as plain questions: "Do you log visits, calls or sessions?" (activity types), "Do you track time or mileage?", "Do you book appointments?"

The existing human-services roles (care coordinator, social worker…) become variants inside the human-services starter template.

#### Schema
- **Migration 036, `workspace`:**
  - `grids.record_kind TEXT NOT NULL DEFAULT 'person'` (W2) and `grids.vocab TEXT DEFAULT NULL`, each guarded with `pragma_table_info`.
  - **Existing databases** (any grids present): write `workspace_vocab = HUMAN_SERVICES_VOCAB` and `workspace_features` with every feature that exists today switched on, so nothing visibly changes.
  - New installs get their words and switches from setup.

#### IPC
- `WORKSPACE_GET` returns `{ vocab, features }`.
- `WORKSPACE_UPDATE(patch)`.
- `STARTER_LIST()`.
- `STARTER_PREVIEW(idOrFilePath)`.
- `STARTER_APPLY(idOrFilePath, { lists: string[], applyWords: boolean, applyFeatures: boolean, sampleData: boolean })`.
- `WORKSPACE_EXPORT_TEMPLATE()`.
- Push event `WORKSPACE_CHANGED`.
- Settings keys `workspace_vocab` and `workspace_features` are written only through `WORKSPACE_UPDATE` (validated with zod).

#### Tests
- Vocab resolution order, grammar helpers, irregular plurals.
- Lint rule fixtures.
- Migration 036 on an existing DB → human-services words and every current feature on.
- Every bundled starter validates and applies to an empty DB.
- Applying a subset of lists works; applying twice handles name collisions.
- Exporting the setup and re-importing it gives the same structure with no records.
- Renderer: a component under two vocabularies shows the right words.
- e2e: setup through each of the three paths, including the guided blank start.

#### Acceptance
- An existing database opens with identical text and features.
- Applying the auto-service starter shows "Customers / Vehicles / Jobs" everywhere, including PDFs and toasts.
- The mechanic-shop scenario (S3) can also be built from a blank start using only general features.
- No hard-coded "client" or "caseload" text is left, per the lint rule.

---

### W2. List kinds and record identity — S–M

**Purpose:** let a list hold people, things or jobs, and hide person-only features when they don't apply.

- `grids.record_kind`: `'person' | 'thing' | 'job'` (migration 036).
  - **person:** today's behavior. Age from DOB, guardian fields in templates, initials in calendar export and file names.
  - **thing:** no person features. Display name from the name column ("2017 Honda Civic – ABC123"). Calendar export uses the full name; it isn't personal data.
  - **job:** like thing, plus an optional stage board (W6) and an auto-numbered ID (`J-0001`) via a new **`auto_number`** column type (prefix + next number in column config, assigned on row create).
- **Free tier (W13):** counts person and thing records only.
- **Name display:**
  - Generalize `display_name`. The triggers already compute it from the name column (+ last name).
  - Add an optional **display format** per list in `grids.vocab.displayFormat`, e.g. `{Year} {Make} {Model} – {Plate}`. It's computed in main by a new `recomputeDisplayNames(gridId)` and on cell update for referenced columns. It stays stored in `rows.display_name`, so every report keeps working.
- **Renderer:** the list create dialog asks "What does this list hold? People / Things / Jobs or tasks". The kind is shown in list settings.
- **Existing features:**
  - `age_from_dob` and the person-only template fields stay available but hidden from column-type pickers for non-person lists.
  - Calendar export (C1) initials logic applies only to person lists.
  - The audit trail and handoff packet work unchanged; the handoff packet is called "Record packet" for things.
- **Tests:** display-format recompute, auto-number concurrency (in a transaction), kind-based hiding, calendar export naming per kind.

---

### W3. Activity types, measures and recurring requirements — M

**Purpose:** generalize case notes into an activity log whose types, numbers and requirements are user-defined.

#### Activity types
- **Migration 037:**
  ```sql
  CREATE TABLE activity_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,          -- stored in case_log.log_type
    label TEXT NOT NULL, icon TEXT, color TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
  - Seed the five current user types (note, phone, meeting, email, visit) with today's labels and emoji.
  - System types (`system`, `manual`, `import`, `followup`) stay hard-coded and are never shown in the editor.
- **`ipc-caselog.ts`:** `VALID_CASE_LOG_TYPES` becomes system types ∪ non-archived `activity_types.key`, cached and invalidated on change.
- **Everywhere that uses type lists reads the table via `useActivityTypes()`:**
  - `CaseLog.tsx` (`LOG_TYPES`)
  - `CaseLogEntry.tsx` (`TYPE_CONFIG`)
  - `NoteUpdatePicker`
  - `ContactRequirementsDialog`
  - `note-date-updates.ts` (`NOTE_UPDATE_TYPES`)
  - `contact-requirements.ts` validation
  - Audit trail labels (`NOTE_TYPE_LABEL`)
  - Time and mileage report
- **IPC:**
  - `ACTIVITY_TYPE_GET_ALL`, `ACTIVITY_TYPE_SAVE` (create or rename; key generated from the label, immutable after creation), `ACTIVITY_TYPE_ARCHIVE`.
  - Archiving keeps history readable and the type can't be deleted while used.
- **Settings → Notes & activity:** type editor (label, icon from a curated lucide set, color, order, archive).

#### Measures
- Built-in: `minutes` (with units) and `miles` (with rate) keep their columns from migration 035.
- **Custom measures:**
  - Settings key `workspace_measures`, JSON `[{ key, label, unit, kind: 'number' | 'currency' | 'hours', decimals }]`. Examples: labor hours, parts cost, PHQ-9 score.
  - Values in a new `case_log.extra_measures TEXT` (JSON object), added in migration 037 behind a guard.
  - Validation in `validMeasures()` against the defined list (finite, range per kind, max 10 keys).
  - Composer and entry editor render inputs for enabled measures (generalizing the B4/B5 inputs).
- **Reports:** "Time and mileage" becomes **"Totals"**: per record and per list for every measure, monthly, with CSV. Units and mileage-amount logic is unchanged for the built-ins.

#### Recurring requirements
- Migration 037 adds `contact_requirements.period TEXT NOT NULL DEFAULT 'month'` (`week | month | quarter | year`).
- `getContactStatus` → `getRequirementStatus(periodStart)` computes per period. The dashboard card is titled from vocab ("Monthly contacts" for human services; "Weekly check-ins" etc.).
- The compliance summary uses the requirement's period ("Q3 2026").

#### Tests
- Migration seeds and log_type compatibility: old notes keep their types.
- Validation with custom types.
- Archived types render in history.
- Measures validation and totals.
- Requirement periods (week boundaries follow the user's week-start setting; quarter math).

---

### W4. Linked records — L

**Purpose:** connect records across lists (customer ↔ vehicle ↔ job; ward ↔ facility; staff ↔ clients), which mechanic shops and guardians need.

- **Migration 038:**
  ```sql
  CREATE TABLE link_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    to_grid_id   INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    label_forward TEXT NOT NULL,     -- "Owner" (vehicle → customer)
    label_backward TEXT NOT NULL,    -- "Vehicles" (customer → vehicles)
    cardinality TEXT NOT NULL DEFAULT 'many_to_one',  -- one_to_one | many_to_one | many_to_many
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE record_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_type_id INTEGER NOT NULL REFERENCES link_types(id) ON DELETE CASCADE,
    from_row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    to_row_id   INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(link_type_id, from_row_id, to_row_id)
  );
  CREATE INDEX idx_record_links_from ON record_links(from_row_id);
  CREATE INDEX idx_record_links_to ON record_links(to_row_id);
  ```
- **New column type `link`:**
  - Config `{ link_type_id, direction: 'forward' | 'backward' }`.
  - The grid cell shows the linked records' display names as chips; editing opens a searchable picker over the target list.
  - The cell value is **not** stored in `cells`. The pivot grid query adds one `GROUP_CONCAT` subquery per link column, so it's still a single query and never N+1 (performance-test with 500 rows × 3 link columns).
- **Cardinality** is enforced in main (many_to_one: replacing a link removes the previous one).
- **Profile:** a "Linked" section per link type (both directions) with add/remove; clicking opens that record.
- **Cross-list features:**
  - Rules can use a linked record's column, e.g. a job's "Promised date" shows on the customer's profile. Read-only rollups through links: "Vehicles due for service" on a customer's profile.
  - Filters: "Jobs whose vehicle is due".
  - Reports group by a linked record.
- **Archive and delete:** soft-deleting a record hides its links; purging deletes them through the cascade. The audit trail logs link added/removed (system entry on both records, if the list has log changes on).
- **Templates and starter templates:** the `.pulse` format v1.1 adds `link_types` by list name (format 1.0 files still import). Applying a multi-list template creates all lists, then link types, then link columns.
- **Duplicate and merge:** duplicating a record copies forward links. Merging duplicates is out of scope.
- **Existing provider ↔ client links:** unchanged and separate (contacts are a different entity). A later option could migrate them into a "Contacts" list, but that isn't planned.
- **IPC:** `LINK_TYPE_GET_ALL`, `LINK_TYPE_SAVE`, `LINK_TYPE_DELETE`, `RECORD_LINKS_GET(rowId)`, `RECORD_LINK_ADD`, `RECORD_LINK_REMOVE`, `RECORD_LINK_SEARCH(gridId, query)`.
- **Tests:**
  - Cardinality.
  - Cascade on purge.
  - The pivot query includes link names, with a perf test.
  - Template round trip with links.
  - Backup/restore keeps links.
  - Audit entries.

---

### W5. Deadline engine v2 — L

**Purpose:** cover the deadline shapes every profession has, in one shared engine.

#### Engine
- **New `src/shared/deadlineEngine.ts`:** pure TypeScript, used by both main and renderer, replacing the SQL-only `effectiveDateSql` path.
  - Input: rule + the record's relevant values (anchor date, other columns, meter history, activity counts, extensions, progress).
  - Output: `{ due: 'YYYY-MM-DD' | null, state: 'ok' | 'soon' | 'due' | 'overdue' | 'paused' | 'done', estimate?: boolean, detail: string }`.
- **Main:** `src/main/deadlines.ts` loads candidates in a few set-based queries (cells for rule-linked columns, plus extensions and progress), computes in JS, sorts, and limits. This replaces the duplicated SQL in:
  - dashboard
  - briefing
  - planner
  - .ics export
  - compliance summary
  - supervisor report

  `effectiveDateSql` stays only for the simple interval prefilter, or is retired once parity tests pass.
- **Renderer** grid coloring (`SortableRow`, `DeadlinePanel`, `GridDataSummary`, `FocusModeView`, `DashboardView`) calls the same engine via `deadlineCalc.ts`.

#### Rule kinds (`alert_rules.kind`)
| Kind | Example | Config (new columns / JSON `rule_config`) |
|-|-|-|
| `interval` (today) | every 30 days / 6 months after the date entered | `interval_days`, `interval_months`, `end_of_month` (as built) |
| `relative` | 45 days after **Referral Date**; 60 days **before** Lease End | `anchor: 'self' \| columnId`, `offset` (signed days/months), `business_days` |
| `calendar` | every year on Mar 31; quarterly on the 15th of Jan/Apr/Jul/Oct; yearly in the registration month | `months: number[]`, `day`, `anchor_month_from_column?` |
| `meter` | every 5,000 miles **or** 6 months, whichever first | `meter_column_id` (current reading), `last_service_reading_column_id`, `meter_interval`, `time_fallback` (interval) |
| `quota` | 12 sessions authorized through Jun 30 | `count_activity_types: string[]`, `limit_column_id` or fixed `limit`, `start_column_id`, `end_column_id`, `warn_remaining` |
| `sequence` | intake → 30-day → 90-day → annual | `steps: [{ label, offset }]` from one anchor |

**Common options for every kind:**
- `condition` (only when column X is/isn't value Y; pause while On Hold)
- `business_days`
- multiple reminder thresholds (the existing `thresholds` JSON already supports this)

**Business days:** settings key `workspace_holidays` (list of dates; Settings offers US federal holidays as a starting list the user can edit). Weekends are Sat/Sun, configurable.

**Meter estimates:**
- Usage rate comes from the meter column's `cell_history` (readings over time). Linear fit over the last 6 months; fallback to a typical rate the user can set on the rule (default 12,000 mi/yr), with UI text "estimated".
- Due = min(time due, date when the reading is projected to reach last service + interval).

**Quota:** remaining = limit − count of non-voided activities of the listed types between start and end. Warn at `warn_remaining`, and also before the end date. This is shown on the profile as "9 of 12 used, through Jun 30".

#### Extensions and progress
- **Migration 039:**
  ```sql
  ALTER TABLE alert_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'interval';   -- guarded
  ALTER TABLE alert_rules ADD COLUMN rule_config TEXT DEFAULT NULL;           -- guarded, JSON
  CREATE TABLE deadline_extensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    step INTEGER, original_due TEXT NOT NULL, new_due TEXT NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );
  CREATE TABLE deadline_progress (            -- sequences: which step is done
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    step INTEGER NOT NULL, done_at TEXT NOT NULL,
    PRIMARY KEY (row_id, column_id, step)
  );
  ```
- **"Extend" action** on a deadline (dashboard row, profile deadline panel): pick a new date and a reason. It's logged as a system activity and appears in the audit trail and compliance summary ("extended, reason: …"). It applies until the anchor date changes.
- **Mark done (A4) per kind:**
  - interval: next cycle (today).
  - relative / calendar: record done for this period.
  - sequence: completes the current step.
  - meter: asks for the current reading, then sets "last service" date and reading.
  - quota: not applicable.

#### Rule editor UI
`AlertRuleEditor` gets a first question, "How is this deadline worked out?", with one card per kind and plain-English examples. Below it come kind-specific fields and a **live preview** using a sample record ("For Jane Smith this would be due Mar 3, 2027").

#### Compatibility
- Existing rules become `kind = 'interval'` with no behavior change. Months and end-of-month (A3) keep working.
- The `.pulse` v1.1 carries `kind` + `rule_config` with column references **by name** (as done for `alert_rule_name`).

#### Tests
- The engine is unit-tested per kind, including business days across holidays, quota counting with voided notes, meter regression with sparse history, sequences, conditions and extensions.
- **Parity tests:** for interval rules the new engine equals the current results (migrate the A3 parity tests).
- Dashboard, planner, ics, compliance and supervisor outputs match before and after for interval-only data (snapshot tests).
- Performance: 2,000 records × 5 rule columns computed in under 200 ms in main.

---

### W6. Stages and board view — M

**Purpose:** pipelines (jobs, referrals → intake → active → closed, leads) with a visual board.

- **Stage column:** any `status`/`dropdown` column can be marked "This is the stage" (one per list) in the column menu.
  - Config: `stage: { options: [{ value, color, done: boolean, on_enter?: { checklist_template_id?, start_rule_column_id?, activity_type_key? } }] }`.
- **Board view:**
  - A new view mode beside Grid: `GridView` gets a toggle "Table / Board", saved per list in saved views.
  - Columns = stages, cards = records (display name, 2–3 chosen fields, deadline color chip, linked record chips).
  - Drag a card between stages with @dnd-kit (already installed) → `CELL_UPDATE` + undo.
  - Keyboard: arrow keys move focus; Ctrl+Shift+←/→ moves a card's stage.
  - Board columns scroll horizontally on narrow screens; cards meet the 44px and 15px rules.
- **On entering a stage:**
  - Add the stage's checklist.
  - Stamp a date column ("Picked up date"), which can anchor a relative rule ("follow-up 3 days after").
  - Log an activity of the chosen type.
  - All of these are undoable together.
- **Time in stage:** computed from `cell_history` of the stage column, shown on cards ("4 days") and available in reports (average days per stage).
- **Dashboard card:** counts per stage for lists with a stage column.
- **Schema:** none beyond column config. History already exists via `cell_history` (requires log changes or always-record for stage columns; set `log_changes: true` automatically when marking a stage column).
- **Tests:**
  - Stage change side effects and undo.
  - Time-in-stage from history.
  - Board renders 300 records smoothly (virtualize card lists when there are more than 50 per column).
  - Keyboard moves.

---

### W7. Appointments and the calendar view — L

**Purpose:** therapists, shops and field workers live by appointments. Pulse has follow-ups and tasks, but no scheduled events.

- **Migration 040:**
  ```sql
  CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,   -- NULL = not tied to a record
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,          -- local 'YYYY-MM-DDTHH:MM' (no time zone: one user, one place)
    end_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    activity_type_key TEXT,          -- what it becomes when marked done
    status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | done | cancelled | no_show
    series_id INTEGER,               -- recurring series
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE appointment_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule TEXT NOT NULL,              -- JSON: { freq: 'weekly'|'biweekly'|'monthly', byDay?, until?, count? }
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_appointments_start ON appointments(start_at);
  CREATE INDEX idx_appointments_row ON appointments(row_id);
  ```
- **Recurring series:**
  - Materialized occurrences for the next 6 months, extended on unlock; this keeps queries simple.
  - Edit "this one / this and following / all".
- **Marking done** creates an activity of the appointment's type, linked by `source_action_id` (already exists). It counts toward requirements, quotas (W5) and note-driven dates (A1), opening the composer prefilled with the note format.
- **No-show and cancellation** are logged as activities of those types when the workspace has those activity types (the therapy starter adds them).
- **Calendar view** (`/calendar`, sidebar item when `appointments` or `deadlines` features are on):
  - Month / week / day / agenda.
  - Layers with toggles: appointments, deadlines (W5 engine), follow-ups, tasks, checklist items.
  - Click an empty slot → new appointment; drag to move (undoable).
  - Filter by list.
  - Week start setting respected.
  - Large text, 44px targets, full keyboard navigation (arrow keys between days, Enter opens).
- **Profile:** an "Appointments" section with upcoming and past items and "Schedule".
- **Dashboard:** a "Today" card (appointments in time order). The morning briefing adds "4 appointments today".
- **Exports:**
  - The .ics export (C1) includes appointments with times. Initials-only for person lists stays the default.
  - The weekly planner PDF adds appointments.
  - An appointment-reminder letter template (printed or copied text; no sending).
- **Conflicts:** overlapping appointments show a warning but are allowed.
- **IPC:** `APPT_LIST(range, filters)`, `APPT_CREATE`, `APPT_UPDATE(id, patch, scope)`, `APPT_DELETE(id, scope)`, `APPT_SET_STATUS(id, status)`.
- **Tests:**
  - Series materialization across DST changes (local times, no UTC drift).
  - Edit scopes.
  - Done → activity side effects and undo.
  - Calendar layers.
  - ics output with times.

---

### W8. Forms (intake and data entry) — M

**Purpose:** structured, friendly entry (new customer, intake, inspection checklist with values) for non-technical users, plus printable blanks.

- **Migration 041:**
  ```sql
  CREATE TABLE forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fields TEXT NOT NULL,        -- JSON: [{ column_id, label?, help?, required? , section? }]
    creates_activity_type TEXT,  -- optional: also log an activity with the answers
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
- **Form builder:** pick columns, reorder, sections, required fields (reusing B2's required flag), help text.
- **Filling:** "New {record} with form…" from the list toolbar, or "Fill form" on a profile to update. Fields use the same editors as grid cells; link fields use the W4 picker.
- **Print a blank form** as a PDF with lines and checkboxes, for paper intake.
- Starter templates can include forms (intake, vehicle check-in, staff onboarding).
- **Tests:** validation (required, types), create versus update, the blank PDF renders, and the form survives column deletion (the field is dropped with a warning).

---

### W9. Attachments — M–L

**Purpose:** "attach the signed plan / court order / estimate photo." It's expected in nearly every profession.

- **Decision A4:** store files **inside** the encrypted database so they inherit encryption, backups and the move wizard.
- **Migration 042:**
  ```sql
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,
    case_log_id INTEGER REFERENCES case_log(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT
  );
  CREATE TABLE attachment_blobs (
    attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    data BLOB NOT NULL
  );
  ```
- **Limits:** 15 MB per file and 1 GB total (shown in Settings → Data with usage). Allowed types: PDF, images, Office documents, text. Executables are rejected.
- **Adding:** a main-process file picker or drag and drop, through `assertSafePath`. Files are read in main, never by the renderer.
- **Opening:** decrypt to a temp file in an app-private temp folder, open with the OS viewer, and delete temp files on lock, quit and startup. Warn that the opened copy is outside Pulse while open.
- **Previews:** images and PDFs in-app via `data:` URLs, CSP-allowed for images only.
- **Backups:** the size impact is shown; incremental backups are unchanged in design but bigger. The move wizard shows the backup size.
- **Audit trail:** "Attachment added/removed: file name".
- **Handoff packet:** lists attachments, with an option to include PDFs and images as appended pages.
- **Security review:** update `plans/security-review/*` (where data lives, temp-file handling).
- **Tests:** size/type limits, the hash check, temp cleanup, backup/restore round trip with blobs, and a performance check that a 500 MB database still opens quickly (blobs live in a separate table, so they aren't read during grid loads).

---

### W10. Reports, documents and dashboard generalization — M–L

1. **Rename and retitle** existing reports through vocab:
   - Supervisor report → **Summary report**.
   - Compliance summary → **Requirements summary**.
   - Time and mileage → **Totals** (W3).
   - Audit trail, Missing information and Handoff/Record packet keep their names.
2. **Report builder (light):**
   - Pick a list → filters (reuse FilterBar logic) → optional group by (column, stage, linked record, month of a date) → values (count, sum/avg of number/currency columns or measures) → table preview → PDF or CSV.
   - Save a report (migration 043: `report_definitions (id, name, grid_id, config JSON, created_at)`).
   - Examples: "Jobs completed per month with parts cost", "Clients by program", "Vehicles due next month".
3. **Document templates** (today's letters):
   - Placeholders become generic: `{{name}}`, `{{field:Column Name}}`, `{{linked:Owner.Phone}}`, `{{my_name}}`, `{{today}}`.
   - The old ones (`{{client_name}}`, `{{case_manager_name}}`, `{{dob}}`) stay as aliases forever.
   - **Batch generation:** select records (or a saved filter, like "vehicles due next month") → one PDF with one letter per page, plus address labels (Avery 5160) from an address column.
4. **Dashboard cards:**
   - The dashboard becomes a set of cards the user picks and rearranges (settings key `dashboard_layout`). Starters suggest a layout; cards for features that are off are hidden. New cards are offered when their feature is turned on.
   - Cards: summary counts (existing), priority list (existing), Today's appointments (W7), Stage counts (W6), Requirements (A2 card), Missing info (B2), Due for service (meter rules), Quotas running low (W5), recent activity.
   - The existing tabs and "Print this week / Add to calendar / Monthly summary" stay.
5. **Number history chart:** on a profile, any number column with history shows a small line chart from `cell_history` (PHQ-9, odometer, weight). Simple SVG, no new library.
6. **Tests:** the report builder query generator (parameterized SQL only, injection tests), saved report round trip, placeholder aliases, the batch PDF page count, and the label layout.

---

### W11. Reminders while Pulse is closed or in the background — S–M

- **Desktop notifications** (Electron `Notification`) when Pulse is running:
  - At a chosen time each day: "3 due today, 2 appointments".
  - 15 minutes before appointments (setting).
  - The text never includes record names unless the user turns it on; the default is counts only.
- **Optional tray mode:**
  - "Keep Pulse running in the background (locked)". Closing the window hides to the tray and the database **locks**.
  - Notifications show counts computed at the last unlock (cached counts only, no names). Clicking opens the lock screen.
  - This conflicts with E2's "closing the window quits", so it's off by default; when on, closing locks instead of quitting and the on-close backup runs at lock.
- **Start with the computer:** an option via `app.setLoginItemSettings`, off by default.
- **Tests:** scheduling logic (pure), the names-hidden default, and that the lock-on-hide path zeroes the key.

---

### W12. Starter template content — M (content, spread over phases)

Starter templates are JSON files (W1.3), not code. Each one may include:
- lists (columns, links, stages, rules, requirements, forms)
- suggested words and feature switches
- activity types and measures
- document templates and note formats
- suggested dashboard cards
- sample data (12–20 clearly fake records per list)
- help tips

They are examples to start from, so ship a few good ones first and add more over time without touching code.

| Starter | Lists | Shows off | When |
|-|-|-|-|
| Human services (today's 11 role templates become its variants) | Caseload | Everything built today | P1 (convert existing templates) |
| Staff credentials | Staff | Interval rules per credential, Missing info, Requirements summary as an "inspection report", batch renewal letters | P1 |
| Auto & equipment service | Customers, Vehicles, Jobs | Links, job board, meter rules (oil, tires, brakes), calendar rule (inspection), relative follow-up, labor hours and parts cost, batch reminder postcards | P3 (needs W4–W6) |
| Therapy & counseling | Clients | Appointments (weekly series), SOAP/DAP/BIRP, quota (authorizations), 90-day plan review, PHQ-9/GAD-7 number history, units | P4 (needs W7) |
| Many more, as plain files | 135 candidates across 10 groups in `plans/starter-template-catalog.md`, with the phase each needs and suggested waves | Each reuses general features only | Waves alongside P1–P5 |

- **Sample data:** `src/main/sample-data.ts` (D1) generalizes to take the `SampleDataSpec` inside a starter (lists, linked records, activities, appointments over the past and next 60 days, extensions, stage history) so every dashboard card has something to show. It stays clearly labeled and removable in one click, and never counts toward the free limit.
- **Validation:** a test per bundled starter that applies it to an empty database, loads sample data, runs every report without error, and checks that no human-services words leak (string scan of rendered pages in the e2e tour).
- **Blank parity:** for each starter, one e2e scenario rebuilds its main list from a blank start using only the UI. This guarantees starters never rely on hidden capabilities.

---

### W13. Licensing and free tier for general use — S

- **Free limit (A1):** 15 active records across lists whose kind is `person` or `thing`; `job` lists don't count, and appointments are never records. Update `countBillableClients` → `countBillableRecords`, `FREE_LIMIT_MESSAGE` via vocab, the TrialBanner text and tests.
- Sample data still never counts.
- No other licensing changes; product ID checks remain.
- **Pricing** is the same for everyone (a marketing decision; none needed in code).

---

### W14. Brand rename — S (after the name is chosen)

- `PRODUCT_NAME` constant in `src/shared/constants.ts` and use it everywhere.
- **Internal-name pinning** and its tests (section 2).
- `package.json` `productName`, `artifactName` (`{{ProductName}}-${version}`), `dmg.title`, the file association label, icons if the logo changes, About/Help, security docs, `SECURITY_SUMMARY_TEXT`, PDF footers, and the window title.
- Upgrade test matrix (old build data → new build, unlock) per OS.

---

### W15. Spanish — M (after W1)

- The vocab layer grows into full i18n: `src/shared/i18n/en.ts`, `es.ts` (all UI strings, not just nouns), and `t()` with interpolation.
- This is a separate pass after W1 because W1 only extracts nouns.
- Language setting in Settings → Appearance; dates via `Intl` with the chosen locale; PDFs and reports in the chosen language.
- Starter content (sample data, templates, help) translated, human-services starter first.

---

### W16. Help, docs and website — S–M (alongside each phase)

- Help view sections become feature-aware (only enabled features) and use vocab.
- New help topics: linked records, rule kinds, board, calendar, appointments, forms, attachments, report builder.
- `plans/security-review/*`: data-flow updates (attachments, notifications, tray), still offline.
- Website copy per starter template (in `plans/website/`): problem, screenshots from sample data, "your spreadsheet, but safer".

---

## 6. Existing features: how each one survives

| Feature | After the overhaul |
|-|-|
| Grid, columns, inline editing, virtual scrolling | Unchanged; new column types `link`, `auto_number`; board view is an alternate view |
| Deadline rules (days, months, end of month) | `kind = 'interval'` in engine v2, identical results (parity tests) |
| Mark done → next cycle (A4), checklist on done | Per-kind behavior; interval unchanged |
| Notes update dates (A1) | Uses activity types (W3); stored keys unchanged |
| Monthly contact requirements (A2) | Recurring requirements with period, default month |
| Note formats DAP/SOAP/BIRP/custom (A5) | Unchanged; starters can add their own |
| Morning briefing, bulk mark done, weekly planner, .ics | Use the W5 engine; add appointments |
| Audit trail, handoff packet, missing info, compliance summary | Unchanged data; titles via vocab; extensions, links and attachments appear in the trail |
| Time and mileage (B4/B5) | Built-in measures inside "Totals" |
| Smarter import (C2) | Unchanged; adds mapping into link columns by matching display names |
| Free version (D3) | Counts person/thing lists (W13) |
| Sample caseload (D1) | Generalized: any starter can carry sample data; human-services sample unchanged |
| Role templates (D2) | Variants inside the human-services starter template |
| Security checkup, move wizard, backups, recovery key, auto-lock | Unchanged (attachments make backups larger; shown in the UI) |
| Contacts directory, vCard | Unchanged; label via vocab ("Providers", "Suppliers", "Referral sources") |
| Acuity | "Priority level" via vocab, feature-switchable |
| Focus mode, command palette, undo/redo, saved views, filters, grouping, trash | Unchanged; command palette gains actions for switched-on features (new appointment, open board) |
| Letters | Document templates with alias placeholders and batch mode |
| Snippets, checklists, tasks | Unchanged |
| macOS prep (E2), quick-unlock design (E1) | Unchanged; tray mode (W11) must respect E1 when built |

---

## 7. Migrations (planned numbering)

| # | Name | Workstream |
|-|-|-|
| 036 | `workspace` (grids.record_kind, grids.vocab, grids.display_format, today's words and features saved for existing DBs) | W1, W2 |
| 037 | `activity_types` (+ case_log.extra_measures, contact_requirements.period) | W3 |

New column types along the way (no migration; config only): `auto_number` (W2), `link` (W4), `deadline` (W5).
| 038 | `record_links` (link_types, record_links, record_link_history) | W4 |
| 039 | `deadline_engine_v2` (alert_rules.kind, rule_config, rule_condition, business_days, deadline_extensions, deadline_progress) | W5 |
| 040 | `appointments` (appointments, appointment_series) | W7 |
| 041 | `forms` | W8 |
| 042 | `attachments` (attachments, attachment_blobs) | W9 |
| 043 | `report_definitions` | W10 |

Every migration:
- writes `schema_version`
- guards `ALTER TABLE ADD COLUMN` with `pragma_table_info`
- is registered in `database.ts` and `tests/helpers.ts` (`allMigrations`, `LATEST_SCHEMA_VERSION`)
- has a test that runs it on a database populated by the previous version's fixtures

Backups made before a migration must restore into the new version (existing restore path + migration run).

---

## 8. Phases and order

Dependencies: W1 → everything. W3 before W5 (quota counts activity types) and W7 (appointment types). W4 before the multi-list starters in W12. W5 before W6's relative-rule triggers and W7's calendar deadline layer.

| Phase | Workstreams | Size | Shippable result |
|-|-|-|-|
| **P0: safety rails** | Rename groundwork from W14 (internal name pinning, `PRODUCT_NAME` constant), lint rule (W1.1), feature switch scaffolding (W1.2) | S | No visible change; protects data on rename |
| **P1: fully flexible** | W1 (words, feature switches, starter template format, Settings → Workspace, setup v2 with guided blank start), W2, W3, W13; starters: Human services, Staff credentials | L + M + M + S ≈ 4 weeks | Anyone can set up a single-list workspace their way |
| **P2: deadlines for everyone** | W5, W11 (notifications only) | L + S ≈ 3 weeks | Any deadline shape; reminders |
| **P3: structure** | W4, W6, W10 (rename, document batch, dashboard cards, number chart); starter: Auto & equipment service | L + M + M ≈ 4 weeks | Multi-list businesses (shop, property) |
| **P4: scheduling** | W7, W8; starter: Therapy & counseling | L + M ≈ 3 weeks | Appointment-based practices |
| **P5: completeness** | W9, W10 (report builder), W11 (tray mode), W14 (final rename), W16 | M–L + M + S ≈ 3 weeks | Release candidate under the new name |
| **P6: reach** | W15 Spanish | M ≈ 2 weeks | Pulse in Spanish |

Each phase ends with:
- full `npm test`, typecheck and lint at zero
- an e2e tour per starter plus the blank path (screenshots for the website)
- updated `plans/progress.md`
- commit and push

A phase can ship as a release on its own; P1 alone already widens the market.

---

## 9. Testing strategy

1. **Parity first.** Before refactoring deadlines, reports or note types, snapshot today's outputs (dashboard list, planner rows, ics, compliance summary, audit trail) on the human-services sample data. Each refactor must reproduce them byte for byte (dates, counts, ordering).
2. **Migration fixtures.** A database created at schema 35 with every feature used (sample data + A1–C2 features). Each new migration runs on it, and a restore of an old backup is tested.
3. **Per-starter and blank-path suites.**
   - Unit: starter schema validation, application to an empty DB (whole and partial), sample data load, every report runs, setup export round trip.
   - e2e (Playwright): setup through each path (example, import, blank), main screens, and a scan that human-services words don't leak.
   - Blank parity: each starter's main list rebuilt from a blank start through the UI.
4. **Engine property tests:** randomized dates and rules checked against simple reference implementations (interval, relative, business days).
5. **Performance budgets:**
   - grid load 500 records × 25 columns + 3 link columns under 300 ms
   - deadline engine 2,000 × 5 under 200 ms
   - calendar month render under 100 ms
   - a database with 1 GB of attachments opens in under 2 s
6. **Accessibility:** the board, calendar and form builder get keyboard and screen-reader passes (`/accessibility-audit` skill).
7. **Security:** `/security-audit` after W4 (new IPC), W9 (files) and W11 (tray/notifications); the report builder SQL must be fully parameterized.

---

## 10. UX rules for a general app

- **Starters suggest; everything stays editable.** Setup asks only: your name, how you want to start, and (for blank or import) what you call what you track. Every choice made by a starter is an ordinary setting afterwards.
- **Offer features in context.** Rather than a long settings page up front, suggest a feature when it becomes relevant (a second list → links; an empty calendar → appointments).
- **Every new view honors** the 15px text, 44px targets, 3px focus rings, dark mode and plain-language rules from CLAUDE.md.
- **Words are the user's.** Any new text that names records, lists or activities must use vocab; the lint rule enforces it.
- **One way to do each thing.** Boards, calendars and forms are alternate views of the same records, never separate data.
- **Hidden features mean hidden, not deleted.** Turning a feature off never removes data; turning it on restores it.

---

## 11. Out of scope (and why)

| Not doing | Why | Instead |
|-|-|-|
| Invoicing, payments, accounting, inventory | Huge, regulated, and well served by QuickBooks and shop software | Number/currency columns, measures, totals, CSV export |
| Online booking, texting or emailing clients | Needs servers and network; breaks the offline promise | Printed/copied reminder letters, .ics for the user's own calendar |
| Insurance claims, superbills, e-prescribing (therapy) | Regulated, specialized | Units/sessions CSV for the billing tool |
| Multi-user real-time sync, mobile app | Changes the product's identity and security story | Revisit only with paying demand: read-only encrypted snapshot, then shared-folder locking |
| A full relational database builder (Airtable clone) | Complexity explosion for non-technical users | Lists + links + starter templates cover the scenarios |
| AI features | Would require sending data out (or large local models) | Revisit later with local-only options |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|-|-|
| Regressions for current users | Parity snapshots, migration fixtures, today's words and features saved for existing users, phase-by-phase release |
| Flexibility overwhelms non-technical users (blank-page problem) | Three setup paths with examples first, guided blank start, specialist features off until relevant, in-context suggestions, a short tour of switched-on features |
| Vocabulary rollout misses strings | Lint rule, e2e word-leak scan, main-process `vocabFor` for generated text |
| Engine v2 performance or correctness | Shared pure engine, property tests, performance budgets, keep the SQL prefilter |
| Database growth from attachments | Limits, usage display, blobs in a separate table, backup size warnings |
| Rename locks users out (OS key store) | Internal-name pinning, upgrade test matrix before release |
| Scope creep toward CRM/ERP | Section 11 is the boundary; new requests are checked against "does it need network, money handling or multiple users?" |
| Support across many professions | Feature-based help (not profession-based), starter sample data doubling as demos, generic docs |

---

## 13. Open questions (answer before the phase that needs it)

1. **New product name** (W14, can wait until P5). Run a trademark and domain check before committing.
2. **Free-tier counting** (A1): confirm "people and things count, jobs don't", and that 15 stays the number.
3. **Attachments inside the database** (A4): OK with backups growing, or prefer linking to files on disk (the pre-031 approach, weaker security)?
4. **Tray mode** (W11): acceptable that it changes "closing quits" when turned on?
5. **Which starter templates ship first**: proposed Human services and Staff credentials in P1, Auto & equipment service in P3, Therapy & counseling in P4.
