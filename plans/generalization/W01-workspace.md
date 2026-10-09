# W01. Workspace: words, feature switches, starter templates, setup v2

Size: L (about 2.5 weeks including the word rollout). Phase: P0 (scaffolding, lint rule) and P1.

## 1. User stories
1. *As a shop owner*, I want Pulse to say "customers" and "vehicles", not "clients" and "caseloads", everywhere I look, including PDFs.
2. *As a caseworker upgrading*, I want nothing to change unless I choose to change it.
3. *As a new user who doesn't know where to start*, I want to pick an example close to my work and see it working with fake data.
4. *As a new user with a spreadsheet*, I want to bring it in and have Pulse ask me what the rows are.
5. *As a new user who wants it my way*, I want to start blank and be walked through making my first list in a minute.
6. *As any user*, I want to switch features on and off so I only see what I use, and turning one back on brings back everything I'd entered.
7. *As an agency lead*, I want to export my setup (no records) and give it to coworkers.
8. *As someone who does two kinds of work*, I want to add a list from a different example without changing my words for the rest.

## 2. Words (vocabulary layer)

### 2.1 Terms
| Key | Human services (existing users) | Generic (new blank) | Used for |
|-|-|-|-|
| `record` | client / clients | record / records | People or things in a list |
| `list` | caseload / caseloads | list / lists | Sidebar groups, "New list", reports |
| `activity` | case note / case notes | note / notes | The composer, entries, reports |
| `activityLog` | Case log | Activity log | Profile section title, audit trail |
| `contactDirectory` | Contacts | Contacts | Sidebar item |
| `contact` | provider / providers | contact / contacts | Directory entries, "Linked providers" |
| `priority` | acuity | priority | Acuity feature |
| `archive` | discharge (verb), discharged | archive, archived | Archive action and reason prompt |
| `worker` | case manager | — (uses the profile name) | Letters, PDFs ("Prepared by") |
| `requirement` | contact requirement | requirement | A2 requirements |
| `appointment` | appointment | appointment | W07 |
| `stage` | stage | stage | W06 |

Each term is `{ one: string; many: string; article: 'a' | 'an'; oneCap?: string; manyCap?: string }`. Capitalized forms are derived unless overridden (for acronyms like "IEP").

### 2.2 Files
- `src/shared/vocab.ts`
  ```ts
  export type VocabKey = 'record' | 'list' | 'activity' | 'activityLog' | 'contactDirectory' | 'contact'
    | 'priority' | 'archive' | 'worker' | 'requirement' | 'appointment' | 'stage'
  export interface Term { one: string; many: string; article: 'a' | 'an'; oneCap?: string; manyCap?: string }
  export type Vocab = Record<VocabKey, Term>
  export const GENERIC_VOCAB: Vocab
  export const HUMAN_SERVICES_VOCAB: Vocab
  export function resolveVocab(...layers: Array<Partial<Vocab> | null | undefined>): Vocab   // later layers win
  export function term(v: Vocab, key: VocabKey, opts?: { many?: boolean; count?: number; cap?: boolean; article?: boolean }): string
  // term(v,'record',{count:1}) → "client"; {count:3} → "clients"; {article:true} → "a client"; {cap:true,many:true} → "Clients"
  export const vocabSchema: z.ZodType<Partial<Vocab>>   // max 40 chars per word, no HTML
  ```
- `src/renderer/stores/vocabStore.ts`: zustand `{ workspace: Partial<Vocab>; byGrid: Record<number, Partial<Vocab>>; load(); }`. Loads on unlock (in `App.tsx`, next to the alert/settings loads) and on the `WORKSPACE_CHANGED` push.
- `src/renderer/hooks/useVocab.ts`
  - `useVocab(gridId?: number) => { v: Vocab; t: (key, opts?) => string }`.
  - gridId defaults to the active grid when inside grid/profile views.
- `src/renderer/components/shared/V.tsx`: `<V k="record" many cap />` for JSX text.
- `src/main/vocab.ts`: `vocabFor(gridId?: number): Vocab` reads `settings.workspace_vocab` and `grids.vocab`, cached and invalidated by `WORKSPACE_UPDATE` and grid vocab edits.

### 2.3 Rollout plan (the ~116 files)
Order (one commit each, each passing the lint rule *for its directory*):
1. `layout/` (Sidebar, TopBar) + `App.tsx` + toasts in stores.
2. `views/DashboardView.tsx` + `views/dashboard/*`.
3. `components/grid/*` + `views/GridView.tsx` (toolbar, empty states, bulk bar, context menu, dialogs).
4. `views/ProfileView.tsx` + `components/profile/*`.
5. `components/settings/*` + `views/SettingsView.tsx`.
6. Reports/dialogs: `components/reports/*`, `components/contact-req/*`, `components/shared/*` (MorningBriefing, AuditReportDialog, SampleDataBanner, CommandPalette, FocusMode).
7. Onboarding (replaced anyway by setup v2, §5).
8. Help (`views/help/faqData.tsx`): rewrite generically, with vocab in examples.
9. Main-process text:
   - `licensing.ts` (`FREE_LIMIT_MESSAGE`)
   - `import.ts` warnings
   - `export-audit.ts`, `export-handoff.ts`, `compliance.ts`, `export-supervisor.ts`, `export-planner.ts`, `export-pdf.ts`, `time-mileage.ts`
   - `missing-info.ts` CSV headers
   - `sample-data.ts` names
   - letters' default templates
   - `SECURITY_SUMMARY_TEXT`

**Rules for converting:**
- Only user-facing text changes. Variable, IPC, table and CSS names stay.
- Sentences are rebuilt so word order works with any noun ("Add a client" → `Add ${t('record',{article:true})}`). Avoid possessives on the noun ("client's" → "for this client").
- Where text names a specific human-services concept that has no general equivalent (e.g. "Medicaid recertification" in a template), it belongs to the starter template, not the UI.

### 2.4 Lint rule (P0, before rollout)
In `eslint.config.mjs`:
```js
{ files: ['src/renderer/**/*.tsx'], ignores: ['src/renderer/components/shared/V.tsx'],
  rules: { 'no-restricted-syntax': ['error',
    { selector: "JSXText[value=/\\b(clients?|caseloads?|case (notes?|log))\\b/i]", message: 'Use the vocabulary layer (useVocab / <V>) for record/list/activity words.' },
    { selector: "JSXAttribute[name.name=/^(placeholder|title|aria-label|label)$/] > Literal[value=/\\b(clients?|caseloads?|case (notes?|log))\\b/i]", message: 'Use the vocabulary layer.' },
  ] } }
```
Turn it on per directory as the rollout reaches it (an `ignores` list shrinking each commit), so CI stays green. Main-process strings are checked by a unit test that greps the built PDF text fixtures (§8).

### 2.5 Per-list words
- `grids.vocab` (migration 036) holds `Partial<Vocab>`. Typically only `record` is set (a "Vehicles" list in a "Customers" workspace).
- Edited in the list menu → "List settings…" (new dialog, also used by W02 for kind and display format).

## 3. Feature switches

### 3.1 Registry: `src/shared/features.ts`
```ts
export type FeatureKey =
  | 'checklists' | 'tasks' | 'snippets' | 'letters' | 'contactsDirectory' | 'focusMode'
  | 'requirements' | 'timeTracking' | 'mileage' | 'measures' | 'priority'
  | 'summaryReport' | 'handoff' | 'personFields'
  | 'appointments' | 'stages' | 'links' | 'forms' | 'attachments' | 'notifications'
export interface FeatureDef { key: FeatureKey; label: string; description: string; group: 'Records' | 'Notes & activity' | 'Planning' | 'Reports'; blankDefault: boolean; since: string }
export const FEATURES: FeatureDef[]
export type FeatureMap = Partial<Record<FeatureKey, boolean>>
export function isOn(map: FeatureMap, key: FeatureKey): boolean  // falls back to blankDefault
```
The core is always on and not listed: lists, columns, deadline rules, notes, dashboard, reports (audit trail, missing info, requirements summary), backups, security.

### 3.2 Defaults
| Feature | Blank workspace | Existing users (migration 036) |
|-|-|-|
| checklists, tasks, snippets | on | on |
| letters, contactsDirectory, focusMode | off | on |
| requirements | off | on (it shipped on) |
| timeTracking / mileage | off | value of `track_time` / `track_mileage` |
| measures | off | off |
| priority | off | on (it shipped on; per-list acuity flags unchanged) |
| summaryReport, handoff | off | on |
| personFields | on (blank lists default to people) | on |
| appointments, stages, links, forms, attachments, notifications | off | off (new features) |

### 3.3 Where switches apply (hide, never delete)
| Feature | UI hidden when off |
|-|-|
| checklists | Profile checklist section, column-menu "add checklist when done", templates page tab |
| tasks | Sidebar Tasks, dashboard task rows, Ctrl+Shift+T |
| snippets | Sidebar Snippets, "/" snippet menu, settings tab |
| letters | Sidebar Letter templates, profile "Generate letter" |
| contactsDirectory | Sidebar Contacts, profile linked providers, Ctrl+Shift+P |
| focusMode | Sidebar item, Ctrl+Shift+F, briefing button |
| requirements | Dashboard card, profile status line, list menu item, settings section |
| timeTracking, mileage, measures | Composer inputs, entry badges, Export → Totals |
| priority | Acuity config, column, filters |
| summaryReport | Export → Summary report |
| handoff | Profile "Handoff packet" |
| personFields | Age-from-DOB column type, person columns in suggestions |
| new features | Their own entry points (see each spec) |

- **Renderer:** `useFeature(key): boolean` from `workspaceStore` (same store as vocab, `src/renderer/stores/workspaceStore.ts`; vocabStore merges into it).
- **Main:** no enforcement. The only main-side use is choosing which sections reports include (e.g. the requirements summary skips requirements when off).

### 3.4 "Offer in context" prompts
A small `FeatureOffer` component shows a one-line suggestion with "Turn on" / "Not now" (remembered per feature in settings `feature_offers_dismissed`). Placements:
- Creating a 2nd list → links ("Connect these lists?").
- Opening an empty calendar → appointments.
- Adding a status column → stages.
- First time a note is logged with a number in the text like "45 min" → time tracking.

## 4. Starter templates

### 4.1 Format: `.pulse` v2.0, `type: 'workspace'`
```ts
// src/shared/starters/schema.ts (zod schema + inferred types)
interface StarterTemplate {
  pulse_template: '2.0'; type: 'workspace'
  id: string                    // kebab-case, unique among bundled starters
  name: string; description: string; icon: string   // lucide icon name from an allowlist
  group?: string                // catalog group for the gallery
  vocab?: Partial<Vocab>
  suggestedFeatures?: FeatureMap
  activityTypes?: { key: string; label: string; icon?: string; color?: string }[]     // W03
  measures?: { key: string; label: string; unit?: string; kind: 'number' | 'currency' | 'hours' }[] // W03
  lists: StarterList[]
  noteFormats?: NoteFormat[]                       // A5 shape
  documentTemplates?: { name: string; content: string }[]
  dashboardCards?: string[]                        // W10 keys
  sampleData?: SampleDataSpec                      // W12
  helpTips?: { title: string; body: string }[]
}
interface StarterList {
  key: string                   // referenced by links and sample data
  name: string; description?: string
  kind: 'person' | 'thing' | 'job'                  // W02
  vocab?: Partial<Vocab>
  displayFormat?: string                            // W02
  columns: PulseTemplateColumn[]                    // existing shape; config may reference rules/checklists by name
  alertRules?: PulseTemplateAlertRule[]             // + kind/rule_config (W05), columns by name
  checklists?: PulseTemplateChecklist[]
  requirements?: { label: string; note_types: string[]; per_month: number; period?: 'week'|'month'|'quarter'|'year' }[]
  links?: { to: string; forward: string; backward: string; cardinality: 'one_to_one'|'many_to_one'|'many_to_many' }[] // W04
  stage?: { column: string; options: StageOption[] }                     // W06
  forms?: FormSeed[]                                                     // W08
}
```
- v1.0 single-list `setup` files keep working (they're treated as a one-list workspace with no words or features).
- Features a starter needs but the running app version doesn't support (e.g. `links` before P3) make the file fail validation with a clear message ("This example needs a newer version of Pulse").

### 4.2 Where starters live
- `src/shared/starters/*.json`, imported via `src/shared/starters/index.ts` (static imports so Vite bundles them).
- The gallery shows `name`, `description`, `icon`, list names and a "Includes sample data" badge.
- The existing `setup_templates` table keeps working for user-saved single-list templates. Built-in single-list templates (D2's 11) move into the human-services starter as variants (§4.5) and are no longer seeded into `setup_templates` for new installs. Existing rows stay.

### 4.3 Applying: main `src/main/starters.ts`
```ts
export function previewStarter(src: StarterSource): StarterPreview   // lists, words diff, features diff, conflicts
export function applyStarter(src: StarterSource, opts: ApplyOptions): ApplyResult
type StarterSource = { builtinId: string } | { filePath: string }
interface ApplyOptions { lists: string[]; applyWords: boolean; applyFeatures: boolean; sampleData: boolean; variant?: string }
interface ApplyResult { gridIds: Record<string, number>; renamed: Record<string, string>; warnings: string[] }
```
**Order inside one transaction:**
1. Activity types, then measures.
2. Alert rules and checklists (by name, reusing existing ones with the same name only if identical; otherwise the starter's copy gets a "(name 2)" suffix).
3. Grids (name collisions: "Customers 2").
4. Columns (rules and checklists linked by name, A1-style).
5. Link types, then link columns.
6. Stages, requirements, forms.
7. Words and features (if chosen).
8. Then sample data in a second transaction, tracked like D1 so it can be removed.

**The preview dialog** (renderer `components/starters/ApplyStarterDialog.tsx`):
- Checkboxes for each list (all on).
- "Use this example's words" with a before → after table.
- "Turn on the features it uses" listing them.
- "Add sample data".
- Apply / Cancel.

Undo for the whole apply is not offered (too big). Instead the summary says "You can delete these lists later from the list menu", and sample data has its existing one-click removal.

### 4.4 Exporting a setup: `WORKSPACE_EXPORT_TEMPLATE`
Writes a v2.0 workspace file. It includes:
- every non-sample list's columns, rules (by name), checklists, requirements, links, stage config, forms;
- activity types and measures;
- note formats and document templates;
- workspace words and features.

It never includes rows, cells, notes, attachments, settings with personal data (profile name), or license data. This is the same safety rule as today's single-list export. The save dialog defaults to `my-pulse-setup.pulse`.

### 4.5 Variants
The human-services starter carries `variants`: the 11 existing role layouts (OPWDD, Social worker, IEP coordinator, Probation, Therapist, Care manager, School counselor, Foster care, Home health, Re-entry, Waiver). The gallery shows "Human services" and, after picking it, "Which describes your work best?". Variants are just alternative `lists` arrays; everything else is shared.

## 5. Setup v2 (replaces `OnboardingView`)

### 5.1 Screens
1. **Welcome:** "{{ProductName}} keeps track of the people and things you're responsible for, and what's due for each." [Get started]
2. **Your name:** name and title (optional), used on letters and reports. (Same as today's profile step.)
3. **How do you want to start?** Three large cards, equal weight:
   - *Start from an example*: "Pick something close to your work. You can change everything."
   - *Bring in a spreadsheet*: "Excel or CSV. We'll help you match the columns."
   - *Start blank*: "Set up your first list step by step."
   - Under the cards: "Just looking? [Try it with sample data]", which applies the human-services starter with sample data (today's D1 behavior), or the gallery's highlighted starter.
4a. **Example path:** gallery (grouped, searchable, ~4 starters at P1) → variant question if any → the apply dialog (§4.3) in a friendlier one-screen form → Done.
4b. **Spreadsheet path:** today's import wizard, then:
   - "What are these rows?" with common choices (Clients, Customers, Students, Patients, Staff, Vehicles, Properties, Equipment, Jobs) plus "Something else: ___ (one) / ___ (many)". This sets the list's kind (people/things/jobs by choice; free text asks).
   - "Which of these dates repeat?" lists detected date columns with none / every N days, months or years. This creates interval rules.
4c. **Blank path:** see §5.2.
5. **Done:** "Your workspace is ready", then a 3-step tour of features that are switched on (reusing `MiniTour`).

### 5.2 Guided blank start
| Step | Question | Input | Creates |
|-|-|-|-|
| 1 | "What's your first list called?" | text, suggestions chips: My clients, Customers, Students, Staff, Vehicles, Equipment, Jobs | grid name |
| 2 | "What does it hold?" | People / Things / Jobs or tasks (cards with examples) | `record_kind` |
| 3 | "What do you call one of them? And more than one?" | prefilled from step 1 (Customers → customer/customers) | workspace `record` term (also list vocab) |
| 4 | "Pick the details you want to keep" | checklist of suggestions by kind + "Add your own" (name + type) | columns |
| 5 | "Do any of these dates repeat or need reminders?" | per date column: No / Every [N] [days, months, years] after / It's the due date | alert rules (interval) |
| 6 | "A few quick questions" | Do you log visits, calls or sessions? (activity types editor with defaults) · Track time or mileage? · Book appointments? (P4+) · Work through stages, like New → In progress → Done? (P3+) | feature switches + activity types |

**Column suggestions by kind:**
- **People:** Name (always), Phone, Email, Address, Date of birth, Status (Active/Inactive), Notes, Start date.
- **Things:** Name/description (always), ID or serial, Location, Status, Purchased, Warranty ends, Last service.
- **Jobs:** Title (always), Number (auto, W02), Status/stage, Due date, Assigned to, Amount.

Every step has "Skip" and "Back". Skipping everything still creates a usable one-column list.

### 5.3 Existing installs
Setup v2 only runs for new workspaces (`onboarding_complete` not set). Existing users never see it. Settings → Workspace gives them the same tools.

## 6. Settings → Workspace (new tab, first in the list)
Sections:
1. **Words:** a table of terms with one/many inputs and a live sentence preview ("Add a customer · 3 customers due this week · Customer notes"). [Reset to generic] [Reset to human services].
2. **Features:** grouped switches with descriptions (from the `FEATURES` registry).
3. **Add lists from an example:** opens the gallery in "add lists" mode (the apply dialog with words/features unchecked by default).
4. **Share your setup:** [Export my setup as a template…] and [Open a template file…].
Per-list words, kind and display format live in each list's "List settings…".

## 7. Data and IPC

### 7.1 Migration 036 `workspace`
```sql
-- guarded adds
ALTER TABLE grids ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'person';
ALTER TABLE grids ADD COLUMN vocab TEXT DEFAULT NULL;
ALTER TABLE grids ADD COLUMN display_format TEXT DEFAULT NULL;   -- W02
-- existing users: freeze today's experience
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'workspace_vocab', '<HUMAN_SERVICES_VOCAB json>' WHERE EXISTS (SELECT 1 FROM grids);
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'workspace_features', '<computed json, §3.2>' WHERE EXISTS (SELECT 1 FROM grids);
```
The features JSON is computed in TypeScript inside `up()` (reads `track_time`, `track_mileage`, acuity flags) before inserting.

### 7.2 Channels
| Channel | Args → result |
|-|-|
| `WORKSPACE_GET` | () → `{ vocab: Partial<Vocab>; features: FeatureMap; gridVocab: Record<number, Partial<Vocab>> }` |
| `WORKSPACE_UPDATE` | (`{ vocab?: Partial<Vocab>; features?: FeatureMap }`) → same as GET; zod-validated; pushes `WORKSPACE_CHANGED` |
| `GRID_SETTINGS_UPDATE` | (gridId, `{ vocab?; record_kind?; display_format? }`) → ok (W02) |
| `STARTER_LIST` | () → `StarterSummary[]` |
| `STARTER_PREVIEW` | (src) → `StarterPreview` |
| `STARTER_APPLY` | (src, opts) → `ApplyResult` (free-tier check: sample data excluded; lists only, no records, so no limit issue) |
| `STARTER_OPEN_FILE` | () → src with filePath (main file dialog + `assertSafePath`, 2 MB max, zod) |
| `WORKSPACE_EXPORT_TEMPLATE` | () → `{ filePath }` \| null |
| `WORKSPACE_CHANGED` | push main → renderer |

`settings` keys `workspace_vocab`, `workspace_features` and `feature_offers_dismissed` are added to the allowlist, read-only via `SETTINGS_GET`. Writes are allowed only through `WORKSPACE_UPDATE` (rejected in `SETTINGS_UPDATE`).

## 8. Tests
- `tests/vocab.test.ts`: resolution order, `term()` forms (count, article, cap, irregular plurals), schema limits.
- `tests/features.test.ts`: defaults, `isOn` fallback.
- `tests/migration-036.test.ts`:
  - On a schema-35 fixture with grids: the vocab is HUMAN_SERVICES and the features match §3.2.
  - On an empty database: nothing is written.
- `tests/starters.test.ts`:
  - Every bundled starter passes zod and applies to an empty DB.
  - Partial list apply; name collisions.
  - Rules and checklists linked by name.
  - Sample data is removable.
  - Export → re-import gives the same structure, and the export contains no rows or notes.
- Renderer:
  - `useVocab` and `<V>` under two vocabularies.
  - `FeatureOffer` dismissal.
  - The setup v2 blank path creates the expected grid, columns and rules (mocked IPC).
  - Settings → Workspace saves.
- **Leak test:** render the main views and generate each PDF under a vocabulary of nonsense words ("widget/widgets", "bin/bins", "jot/jots") and assert that none of "client", "caseload" or "case note" appears. This is the catch-all for missed strings.
- **e2e:** setup via each of the three paths; Settings → Workspace word change reflects across sidebar, grid, profile and a PDF.

## 9. Commits
1. P0: lint rule (off by default, an `ignores` list for every directory), `vocab.ts` + tests, `features.ts` + tests.
2. Migration 036 + `WORKSPACE_*` IPC + `workspaceStore`/`useVocab`/`useFeature`/`<V>` + `vocabFor` in main.
3. to 11. Word rollout, one directory per commit (§2.3), turning the lint rule on for that directory.
12. Feature switches applied to every entry point (§3.3) + Settings → Features.
13. Starter schema + loader + `previewStarter`/`applyStarter` + tests; convert D2 templates into the human-services starter with variants.
14. Apply dialog + gallery + "Add lists from an example".
15. Export/open setup files.
16. Setup v2: welcome, name, three paths, spreadsheet "what are these rows" step.
17. Guided blank start.
18. Settings → Workspace tab (words editor, features, add lists, share).
19. `FeatureOffer` placements.
20. Leak test + e2e + help updates.

## 10. Edge cases
- **A user sets the same word for one and many** ("staff/staff"): allowed; counts read "3 staff".
- **Very long words:** max 40 chars; UI truncates with a tooltip in tight spots (sidebar).
- **Empty word:** rejected; falls back to the layer below.
- **Words with HTML or quotes:** escaped (React does this by default); PDFs use plain text.
- **Two lists with different record words in one dashboard row:** each row uses its own list's word ("Vehicle due", "Customer follow-up").
- **Switching a feature off while its dialog is open:** the dialog closes. Data stays.
- **Starter file from a newer Pulse:** "This example was made with a newer version of {{ProductName}}. Update to open it."
- **Applying a starter to a workspace with sample data:** allowed; sample data stays tagged separately.
