# Q1b: features that offer to turn themselves on

Phase 2, idea 1(b). Wave B. No migration, no new IPC channel, no new settings key, no network.

## Goal

A feature that is switched off shouldn't have to be found in Settings → Words & features. When someone does something the feature would help with, Pulse offers it once, in one line, with "Turn on" and "Not now":
- searching Help for its topic;
- putting a 30-day rule on a "Contact" or "Visit" column;
- typing "45 min" or "12 miles" into a note;
- adding a "Next appointment" date column;
- importing a "Doctor" column.

"Not now" is remembered per feature, as today. The triggers live in **one typed map keyed by `FeatureKey`**, so adding a feature without saying when to offer it fails typecheck, like `FEATURE_PLACES` does.

## Current behaviour (after Phase 1)

- `FeatureOffer` (`src/renderer/components/shared/FeatureOffer.tsx:48-89`) is a one-line card with "Turn on" / "Not now". "Not now" is stored in the `feature_offers_dismissed` settings key as a JSON list (`:11-41`; the key is already allowed in `src/main/ipc/ipc-settings.ts:22`). The `always` prop shows the card even after "Not now", without that button (`:52-57`). The success toast says only "<label> is on. You can turn it off in Settings → Words & features." (`:70`), not where to find the feature.
- `FEATURE_PLACES` (`src/shared/featurePlaces.ts:12-36`) is a `Record<FeatureKey, string>` of where each feature shows. It's printed only under the switches in Settings (`components/settings/FeaturesSection.tsx:75`).
- The offer is used in four places, each with its own hard-coded trigger:
  1. Notes: `offerFor(text, tracking)` in `components/profile/CaseLog.tsx:93-97` (a regex for minutes/hours and miles), set after saving (`:378-379`), shown at `:823-828` with two hand-written messages. Only `timeTracking` and `mileage`.
  2. Add column: a static `links` offer when there's more than one list (`components/grid/AddColumnPanel.tsx:223-225`).
  3. Settings → Deadlines & reminders: `always` offers for `requirements` and `notifications` where their sections would be (`components/settings/AlertsSection.tsx:142-155`).
  4. Help: off-feature topics are moved into a "More features you can turn on" section at the bottom (`views/HelpView.tsx:128-153`, `:340-347`), with a "Turn on …" button inside each opened answer (`:177-181`). When a search matches only off-feature topics, the "Best matches first" box renders **empty** above them (`:320-326`). Nothing at the top says "that's a feature you can turn on".
- Rules reach columns from several places: the column's "Deadline rule…" dialog (`components/grid/ColumnHeader.tsx:116-130`, `ColumnRulePicker.tsx`), Add column (`DeadlineQuestion`), import results and setup. None of them suggests Requirements for a monthly contact rule.
- Typed event bus: `src/renderer/events.ts:4-46`. The grid store holds `activeGridId`, `columns` and `hiddenColumns` (`stores/gridStore.ts:51-110`). Rule intervals come from `toRuleInterval` (`src/shared/ruleInterval.ts:29-39`).

## The change

### 1. The trigger map: `src/shared/featureSuggestions.ts` (new, pure, no React)

```ts
export const SUGGESTION_TRIGGERS = ['help', 'columnAdded', 'ruleSet', 'noteText'] as const
export type SuggestionTrigger = typeof SUGGESTION_TRIGGERS[number]

export interface FeatureSuggestion {
  /** Extra words that point at this feature in a Help search (its label always counts) */
  helpWords: readonly string[]
  /** A new column whose name matches (and whose type is listed, if given) */
  column?: { name: RegExp; types?: readonly ColumnType[] }
  /** A deadline rule of at most `maxDays` (a month counts as 31) put on a column whose name matches */
  rule?: { name: RegExp; maxDays: number }
  /** Words in a saved note */
  noteText?: RegExp
  /** The one-line offer; may hold {word} tokens (show through useVocab().f) */
  message: string
}

export const FEATURE_SUGGESTIONS: Record<FeatureKey, FeatureSuggestion> = { … }

/** The first switched-off feature this trigger points at, or null */
export function suggestFeature(trigger: SuggestionTrigger, input: SuggestionInput, isOff: (k: FeatureKey) => boolean): FeatureKey | null
```

`SuggestionInput` is a discriminated union per trigger: `{ query }`, `{ name, type }`, `{ name, interval }`, `{ text }`. `suggestFeature` switches on `trigger` and ends with `assertNever` (the values only come from code). The map order decides which feature wins.

The entries, grounded in today's features (`src/shared/features.ts`, `FEATURE_DEFS`):

| Feature | Help words (besides its label) | Column / rule / note trigger | Offer (tokens filled by `f`) |
|-|-|-|-|
| requirements | requirement, minimum, how many visits, contacts per month, monthly contact, quota, behind | rule ≤ 31 days on a column matching `contact\|visit\|call\|check[- ]?in\|face[- ]to[- ]face\|home visit\|seen\|touch` | "Want Pulse to count how many {activity:many} each {record} gets per month, and show who's behind? Turn on {Requirement:many}." |
| timeTracking | time, minutes, units, billing, hours | note text: today's `offerFor` minutes regex (`CaseLog.tsx:95`) | "This {activity} mentions time. Record minutes on {activity:many} and total them each month?" (today's text, `:827`) |
| mileage | mileage, miles, drive, travel, reimbursement | note text: today's miles regex (`:96`) | today's text (`:828`) |
| appointments | appointment, schedule, meeting, session, calendar | column `appointment\|appt\|next visit\|scheduled\|meeting\|session` (type date); note text `\b(appt|appointment)\b[^.]{0,40}\b\d{1,2}[/:]\d{1,2}` | "Put {appointment:many} on the calendar with a time and a reminder? Turn on {Appointment:many}." |
| contactsDirectory | contact, provider, doctor, pharmacy, agency, directory, referral | column `doctor\|physician\|pcp\|provider\|pharmacy\|therapist\|psychiatrist\|case manager\|guardian\|payee\|agency` | "Keep {contact:many} like doctors and agencies in one place, and link them to each {record}? Turn on the {ContactDirectory} page." |
| personFields | age, birthday, date of birth, dob | column `birth\|\bdob\b\|\bborn\b` (type date) | "Show each {record}'s age from their date of birth? Turn on People details." |
| priority | priority, acuity, risk, urgency, level of need, triage | column `acuity\|priority\|risk level\|level of care\|tier` | "Score how much attention each {record} needs, and sort by it? Turn on {Priority:many}." |
| stages | board, kanban, stage, pipeline, workflow, step | column `^(stage\|status\|phase\|step)$` (types dropdown, status) | "See these as columns on a board, and drag each {record} along? Turn on Stages and board." |
| attachments | file, attach, document, photo, scan, pdf, upload | column `document\|attachment\|\bfiles?\b\|scan\|photo` | "Keep files and photos with each {record}, stored encrypted inside Pulse? Turn on Files." |
| links | link, connect, household, family, related | none (Add column keeps its own offer) | "Connect your {list:many}, like customers and their vehicles?" (today's text) |
| checklists | checklist, steps, intake steps | none | "Step-by-step checklists on each {record}? Turn on Checklists." |
| tasks | task, to do, todo | none | "Your own to-do list, with repeating tasks? Turn on Tasks." |
| notifications | notification, remind me, desktop, morning reminder | none | "Want a desktop notification each morning? Turn on Reminders." (today's text, `AlertsSection.tsx:154`) |
| focusMode | focus, one at a time, distraction | none | "Go through what needs attention one at a time? Turn on Focus mode." |
| letters | letter, mail merge, envelope, label, template | none | "Fill in letters from templates for each {record}? Turn on Letters and documents." |
| summaryReport | supervisor, monthly report, activity report | none | "A report of {activity:many} and deadlines for your supervisor? Turn on Summary report." |
| handoff | handoff, transfer, packet, discharge, hand over | none | "One PDF with everything about {a record}, for a transfer? Turn on Handoff packet." |
| forms | form, intake form, questionnaire | none | "Fill in or print a form to add or update {a record}? Turn on Forms." |
| measures | labor, cost, parts, measure | none (a "$" in human-services notes is too noisy) | "Add your own numbers, like labor hours or parts cost, to {activity:many}? Turn on Your own numbers." |
| snippets | snippet, shortcut, canned text, slash | none | "Type a short code to insert text you use often? Turn on Snippets." |

Help matching: the query goes through `searchWords` (`HelpView.tsx:39`). A feature matches when every query word appears in its filled label or in one of its help words, by prefix: "mile" finds mileage, "contacts per month" finds requirements. The first match in map order wins.

### 2. Help: say it at the top (`views/HelpView.tsx`)

- While searching, when `suggestFeature('help', { query }, off)` returns a feature, show `<FeatureOffer feature={key} always message={f(FEATURE_SUGGESTIONS[key].message)} />` above "Best matches first". `always` is right here: she asked.
- Don't render the "Best matches first" heading and box when every match is an off-feature topic (`:320-326`). The offer and the "More features you can turn on" section say it all.
- Untouched: the browse view, categories, the tour buttons and the per-answer "Turn on" button.

### 3. Notes: from the map (`components/profile/CaseLog.tsx`)

- Replace `offerFor` (`:93-97`) with `suggestFeature('noteText', { text }, off)`. `off` reads `isOn` from the workspace store, which covers `timeTracking`, `mileage` and now `appointments`.
- The `offer` state (`:103`) becomes `FeatureKey | null`. The message at `:826-828` becomes `f(FEATURE_SUGGESTIONS[offer].message)`. Mileage keeps its "(This one won't have them; add miles when you edit it.)" tail as part of its map message.
- That's the whole edit. **Q2 may be changing the note box (opening it with a kind selected). Keep this diff to these three spots.**

### 4. Column and rule triggers: one watcher, no edits to the column UI

New `src/renderer/components/shared/FeatureSuggestionWatcher.tsx`, mounted once in `components/layout/MainLayout.tsx` (one import and one element). It renders nothing itself. It subscribes to `useGridStore` (`activeGridId`, `columns`, `hiddenColumns`) and `useAlertStore` (`rules`), and keeps, for the session, a set of every column id it has seen and each column's last `alert_rule_id`:
- **First time a list is seen** (opening it, or after setup or an example): record a baseline and offer nothing. Old columns never trigger.
- **A column id it has never seen**, in a list it has: a `columnAdded` trigger with `{ name, type }`. This covers Add column, the import (the list reloads after it), duplicating and a pasted column. A column brought back by Undo was seen before, so it doesn't count.
- **A column whose `alert_rule_id` changed** to a rule whose `toRuleInterval` is ≤ 31 days or 1 month: a `ruleSet` trigger with `{ name, interval }`. This covers the Deadline rule dialog, a new rule from the rule editor, Add column's question and the import summary (Q1a), with no edits to `ColumnHeader.tsx`, `ColumnRulePicker.tsx` or `AddColumnPanel.tsx`.
- When a trigger returns a feature that isn't dismissed (`useOfferDismissed`) and hasn't been offered this session, show it with `toast(t => <FeatureSuggestionToast id={t.id} feature={k} />, { id: 'feature-offer-' + k, duration: 20_000 })`, the pattern `RecoveryKeyReminderToast.tsx:57` uses. `FeatureSuggestionToast` (same file) wraps `<FeatureOffer>` and dismisses the toast on Turn on / Not now through `onDone`.
- At most one suggestion on screen. Any others wait until the next trigger (not stored).
- No suggestions while the sample-data list is the active list (sample columns are a demo), or in the first 60 seconds after setup finishes (`onboarding_complete` just set).

The toast is announced: `FeatureOffer` is `role="status"`. It's reachable with the keyboard through react-hot-toast's region and pauses on hover and focus. With "Less movement" on, there's no slide (existing `AppMotionConfig`).

### 5. A better "it's on" message (`FeatureOffer.tsx`)

On "Turn on", the success toast says where the feature appeared, from `FEATURE_PLACES`: "{label} is on. Find it in: {place}. You can turn it off in Settings → Words & features." This makes the first moment after turning something on useful. It changes every existing offer, which is intended.

### 6. Existing hand-written offers move to the map

- `AlertsSection.tsx:145` and `:154` use `FEATURE_SUGGESTIONS.requirements.message` / `.notifications.message`, so the text lives in one place. That's two one-line edits; **Q1c also edits `AlertsSection.tsx`**, so coordinate (see Overlaps).
- `AddColumnPanel.tsx:224` uses `FEATURE_SUGGESTIONS.links.message`. Optional: skip it if Q3 is in that file, since the text is identical.

## Files owned

New:
- `src/shared/featureSuggestions.ts`
- `src/renderer/components/shared/FeatureSuggestionWatcher.tsx` (watcher and `FeatureSuggestionToast`)
- `tests/featureSuggestions.test.ts`
- `tests/renderer/components/shared/FeatureSuggestionWatcher.test.tsx`
- `e2e/ux-review/Q1b.spec.ts` (git-excluded)

Edited (owned):
- `src/renderer/components/shared/FeatureOffer.tsx` (the success message)
- `src/renderer/views/HelpView.tsx` (results area only, `:308-347`)
- Tests: `tests/renderer/components/shared/FeatureOffer.test.tsx` (`offerFor` cases move to `featureSuggestions.test.ts`), `tests/renderer/views/HelpView.test.tsx`, `tests/renderer/help/helpSearch.test.tsx`, `tests/exhaustiveness.test.ts` (a `FEATURE_SUGGESTIONS` keys check next to the `FEATURE_PLACES` one at `:136-139`), `tests/renderer/vocabStaticText.test.tsx` (scan the map's messages for raw record words, like `FAQ_ITEMS`)

Shared (small edits, with the reason):
- `src/renderer/components/profile/CaseLog.tsx`: `:93-97`, `:103`, `:823-828` only (Q2 may edit the note box).
- `src/renderer/components/layout/MainLayout.tsx`: one import and one `<FeatureSuggestionWatcher />` next to `<SampleDataBanner>` (Q7's one-time hints may mount here too).
- `src/renderer/components/settings/AlertsSection.tsx:145,154`: message constants only (Q1c owns the file; if Q1c merges first, rebase onto it; if Q1b merges first, Q1c keeps these lines).

Not touched: `ColumnHeader.tsx`, `ColumnRulePicker.tsx`, `AddColumnPanel.tsx` (optional one-liner, see 6), `src/shared/features.ts`, `src/shared/featurePlaces.ts`, the import wizard, any main-process file.

## Commit steps

Each commit passes `npm run gate`.
1. **The map.** `featureSuggestions.ts` and `featureSuggestions.test.ts`: every key present; each regex tested on positive and negative examples ("Monthly contact" yes, "Contact phone" with no rule no; "45 min" yes, "admin" no; "Doctor" yes, "Doctorate earned" accepted as a known false positive, see Risks). Add `exhaustiveness.test.ts` and `vocabStaticText.test.tsx` coverage.
2. **Notes from the map.** The `CaseLog.tsx` edits, with `FeatureOffer.test.tsx` updated.
3. **Help.** Offer at the top, no empty box. `HelpView.test.tsx` and `helpSearch.test.tsx`: searching "mileage" with mileage off shows the offer first; with it on, it doesn't.
4. **Watcher.** `FeatureSuggestionWatcher.tsx`, the `MainLayout` mount, and tests: baseline then new column; a monthly rule on "Monthly contact" offers requirements; a yearly rule doesn't; an undone column doesn't; one at a time; dismissed stays quiet; sample list quiet.
5. **"It's on" message and moved texts.** `FeatureOffer.tsx`, plus the `AlertsSection` and `AddColumnPanel` constant swaps if no conflict.
6. **Screenshots.** Run `e2e/ux-review/Q1b.spec.ts` and look at the shots.

## Acceptance checks

- Help → search "mileage" with mileage off: the first thing under the search box is "This {activity} mentions miles…" or the mileage offer with "Turn on". No empty "Best matches first" box. After Turn on, the toast says "Mileage on case notes is on. Find it in: The case note box, and the summary report…".
- Grid → "Monthly contact" column → ⋯ → Deadline rule… → "Every month": within a second a toast says "Want Pulse to count how many case notes each client gets per month, and show who's behind? Turn on Requirements." "Not now", then the same on another column: no toast. A yearly rule on "Annual review": no toast.
- Add a date column "Next appointment" with Appointments off: Appointments is offered. With it on: nothing.
- Import a file with a "Doctor" column with Contacts off: the Contacts page is offered once after the import closes.
- A note "Drove 12 miles, 45 min visit": one offer (time first, by map order). After "Not now", the next note mentioning miles offers mileage.
- Opening a list never offers anything. Only changes after it opened do.
- Vocab: with car-shop words the offers say "jobs"/"work notes", never "clients" (`setWords` in tests).
- 15 px text, 44 px click targets (`btn-compact-secondary` is 36 px tall with a 44 px hit area through `::after`, `styles/globals.css:194-215`), 3 px focus rings. The toast's buttons are reachable by Tab and work with Enter.
- Screenshots: `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q1b.spec.ts` (after `npm run build`) writes `ux-review-shots/Q1b/` at 1366×768, light and dark:
  - `01-help-search-off-feature`
  - `02-rule-requirements-toast`
  - `03-appointment-column-toast`
  - `04-note-mileage-offer`
  - `05-turned-on-toast`

  Check: the toast doesn't cover the grid's selected cell or the dialog that just closed (bottom-right, like other toasts), the text fits on two lines at 1366 px, and there's only one offer at a time.

## Tests to add or update

- New: `tests/featureSuggestions.test.ts`, `tests/renderer/components/shared/FeatureSuggestionWatcher.test.tsx`.
- Update: `tests/renderer/components/shared/FeatureOffer.test.tsx`, `tests/renderer/views/HelpView.test.tsx`, `tests/renderer/help/helpSearch.test.tsx`, `tests/exhaustiveness.test.ts`, `tests/renderer/vocabStaticText.test.tsx`, and `tests/renderer/helpFeatures.test.tsx` if it asserts the empty "Best matches" box.
- Check: `tests/renderer/vocabLeak.test.tsx` and the eslint vocab rule (offer messages are `message` props, already scanned).

## Risks

- **Nagging.** Mitigations: session-once per feature, permanent "Not now", one at a time, nothing on first sight of a list, nothing on the sample list or right after setup. If it's still too chatty in the usability test, raise the bar (only `ruleSet` and `help` automatically).
- **Name regexes misfire** ("Doctorate", "Status" on a list that already has a board-like column). The cost is one dismissible line. Tests pin the obvious negatives. The map is the only place to tune.
- **The watcher depends on the grid store's shape** (`columns`, `hiddenColumns`, `activeGridId`). If Q3 or Q9 change how columns load (for example optimistic inserts with temporary ids), a temporary id could look new. Mitigation: ignore ids ≤ 0 and wait one tick for the reload. The watcher test covers an optimistic insert followed by a reload.
- **Overlap with Q2 in `CaseLog.tsx` and Q1c in `AlertsSection.tsx`**: tiny, line-local diffs. The second to merge rebases.
- **Help "always" offer after "Not now"**: intended (she searched for it), and it has no "Not now" button, so nothing is recorded.
