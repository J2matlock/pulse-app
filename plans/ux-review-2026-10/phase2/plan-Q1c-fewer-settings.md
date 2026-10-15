# Q1c: fewer settings

Phase 2, idea 1(c). Wave B. No migration, no new IPC channel, no network. Nothing is dropped from the database. Every stored value keeps being read and honoured; "move" and "remove" only change what is on screen.

## Goal

Every setting earns its place. If one value is right for about 95% of people, the choice goes under a "More settings" disclosure, or leaves the screen. Each Settings tab then opens on the few things people actually change. Nobody loses a setting they already changed: a "More settings" group starts **open** when any setting inside it differs from its default.

## Current behaviour (after Phase 1)

Settings has nine tabs (`src/renderer/views/SettingsView.tsx:113-123`). Every control is on show at once:
- Appearance alone has 11 controls (`components/settings/AppearanceSection.tsx:92-378`).
- Backup has 6 (`BackupSection.tsx:276-546`).
- Data has 9 blocks (`DataSection.tsx:140-400`).
- Deadlines & reminders stacks rules, Requirements, Reminders, Running in the background and Days off (`AlertsSection.tsx:46-158`).

The column settings dialog (`components/grid/ColumnSettingsDialog.tsx:53-143`) and the list settings dialog (`ListSettingsDialog.tsx:215-294`) show every option flat. The deadline rule editor shows end-of-month, days-off handling, conditions and the colour thresholds open (`components/alerts/AlertRuleEditor.tsx:404-660`).

Two patterns already exist for keeping a rare option out of the way:
- `<details>` with a 44 px summary: "Advanced: if someone may know your old password…" (`SecuritySection.tsx:235-250`) and "More: name and description" (`AlertRuleEditor.tsx:492-500`).
- Feature gating: Files storage shows only with Files on (`DataSection.tsx:158`), the Background section only with Reminders on (`AlertsSection.tsx:156`).

## The change

### 1. One disclosure component

New `src/renderer/components/settings/MoreSettings.tsx`, wrapping `<details>`:
- props `{ label?: string = 'More settings', changed: boolean, children }`;
- `open` starts as `changed`, then follows the user;
- 44 px summary row, 15 px text, 3 px focus ring, a chevron that turns (no animation with "Less movement" on).

If Q5 (Wave A) shipped a shared `Disclosure`, use it instead and drop this file. The label "More settings" is plain words, chosen over "Advanced" (the F style guide prefers plain words). The existing Security "Advanced: if someone may know your old password…" stays as it is: it names its situation, which is better. Log the label in CLAUDE.md's naming decisions at close-out.

Each section works out `changed` from the values it already loads (for example Appearance: `gridDensity !== 'comfortable' || rowStriping || gridLines !== 'full' || sidebarWidth !== 'normal' || uiScale` not in the presets).

### 2. Locale defaults instead of questions (`stores/settingsStore.ts:103-106`, `:118-120`)

When `clock_format` or `week_start` has **never been stored**, take it from the computer:
- clock: `Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle`, where `h23`/`h24` → `24h`, else `12h`;
- week start: `new Intl.Locale(navigator.language).getWeekInfo?.().firstDay` (Chromium 152), where 1 → monday, 7 → sunday, else sunday.

Nothing is written; a stored value always wins. US installs see no change. This is what lets both choices move under "More settings". `date_format` stays as it is: main reads it for imports (`src/main/import.ts:375-380`), and a renderer-only default wouldn't reach main.

### 3. The audit

Verdicts: **Keep** (stays where it is), **More** (moves under that section's "More settings"), **Hide-if** (shown only when it can matter), **Remove** (off the screen; the stored value is still read). "Stored" says where the value lives, so it's clear nothing in the schema changes.

#### Settings → Words & features (`WorkspaceSection.tsx:40-70`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Words: what you track, lists | `WordsEditor.tsx:15-17` | settings `workspace_vocab` | from setup/example | anyone outside case management | Keep |
| Words: notes, notes history, your role | `WordsEditor.tsx:18-19,24` | same | same | few | More ("More words") |
| Words: outside contacts, contacts page | `WordsEditor.tsx:20-21` | same | same | few | Hide-if Contacts page on, then More |
| Words: requirements | `WordsEditor.tsx:22` | same | same | few | Hide-if Requirements on, then More |
| Words: priority | `WordsEditor.tsx:23` | same | same | few | Hide-if Priorities on, then More |
| Feature switches (20) | `FeaturesSection.tsx:50-80` | settings `workspace_features` | per example | everyone, sometimes | Keep (Q1b makes them come to her) |
| Add lists from an example | `WorkspaceSection.tsx:46-54` | none (action) | n/a | new users | Keep |
| Share my whole setup (export / open a .pulse) | `WorkspaceSection.tsx:56-70` | none (action) | n/a | team leads | More |

#### Settings → Profile (`ProfileSection.tsx:37-60`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Name, title, organization, email, phone | `ProfileSection.tsx:40-60` | settings `profile_*` | empty | anyone making letters | Keep (letters print "My name is ," without them, finding 19) |

#### Settings → Appearance (`AppearanceSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Theme | `:92-116` | `theme` | system | many | Keep |
| Text size presets (Normal / Larger / Largest) | `:120-131` | `ui_scale` | 100 | people with low vision | Keep |
| Text size slider and % box | `:132-182` | `ui_scale` | 100 | few (presets cover it) | More (slider). **Remove** the % number box (`:137-150`): it repeats the slider. `ui_scale` is still read |
| Density | `:189-214` | `grid_density` | comfortable | some with long lists | More |
| Shade every other line | `:216-223` | `row_striping` | off | few | More |
| Cell borders Full / Horizontal / None | `:225-250` | `grid_lines` | full | few | More. **Remove "None"** from the choices (it breaks the chunky-borders rule in CLAUDE.md); a stored `none` is still honoured and shown as a third choice only while it's the current value |
| Sidebar width | `:253-276` | `sidebar_width` | normal | few | More |
| Date format | `:282-302` | `date_format` | us | non-US users; also decides how imports read 03/04 | Keep |
| Clock format | `:304-328` | `clock_format` | 12h, now from the locale (2) | few once it follows the locale | More |
| Week starts on | `:330-354` | `week_start` | sunday, now from the locale (2) | few once it follows the locale | More |
| Less movement | `:361-368` | `reduced_motion` | off | accessibility | Keep |
| Stronger contrast | `:370-377` | `high_contrast` | off | accessibility | Keep |

After the change Appearance shows Theme, Text size, Date format and Accessibility, plus one "More settings" holding the list look, sidebar, clock and week.

#### Settings → Security (`SecuritySection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Security checkup | `:160` | n/a | n/a | everyone | Keep |
| Auto-lock after inactivity | `:162-183` | `auto_lock_minutes` | 15 | some; it's a security control (D-015) | Keep |
| Change password (current, new, confirm, hint) | `:185-257` | auth store | n/a | everyone sometimes | Keep |
| "Also give my data a new key" when changing the password | `:235-250` | n/a (per action) | off | rare | Keep (already behind "Advanced: if someone may know…") |
| Recovery key make / regenerate / revoke | `:280-331` | auth store | n/a | everyone | Keep |
| "Also give my data a new key" when revoking | `:348-360` | n/a (per action) | off | rare | More: same `<details>` wording as the password one, for consistency |

#### Settings → Backup (`BackupSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Back up now… | `:277-300` | n/a | n/a | everyone | Keep |
| Move to a new computer… | `:272` | n/a | n/a | rare but critical | Keep |
| Three-layer explanation box | `:303-308` | n/a | n/a | n/a | Keep (Q8 may restyle it) |
| Auto-backups list + Restore, Restore from file… | `:345-392` | files | n/a | when needed | Keep |
| Enable scheduled backups | `:404-417` | `scheduled_backup_config` | off | people with a network drive | Keep |
| Scheduled frequency | `:422-436` | same | 24 h | few | More (inside the scheduled block) |
| Destination folder, Run now | `:439-493` | same | default folder | whoever turned scheduled backups on | Keep |
| Enable backup reminders | `:506-522` | `backup_reminder_enabled` | on | few turn it off | Keep |
| Remind after N days | `:523-545` | `backup_reminder_days` | 7 | few | More |

#### Settings → Data (`DataSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Where your data is kept / size / count | `:141-157` | n/a | n/a | IT, support | Keep (Q8 may restyle it) |
| Files: size limit, remove files in the Trash | `FilesStorageSection.tsx:37-52` | `attachments_max_mb` | 1000 MB (`shared/attachments.ts:17`) | rare | Hide-if Files on (today), then More |
| Import into + Import a spreadsheet… | `:159-191` | n/a | n/a | many | Keep |
| Export everything as CSV… | `:192-230` | n/a | n/a | some | Keep |
| Old cell values: keep 6/12/24 months, Remove older ones, Delete all history… | `:231-276` | n/a (per action) | 12 | rare | More |
| Check the data file | `:277-297` | n/a | n/a | support only | More |
| File association (.pulse) | `:298-331` | OS | unregistered | rare, Windows only | More |
| Sample data | `:44-62` (`SampleDataControls`, placed `:334`) | rows | n/a | new users, trainers | Keep |
| Start over / Erase everything | `:336-400` | n/a | n/a | rare, irreversible | Keep, visible at the bottom: hiding a destructive action the user is looking for makes it worse; it's already typed-confirm |

#### Settings → Deadlines & reminders (`AlertsSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Deadline rules list, Add deadline rule | `:48-130` | `alert_rules` table | from setup/examples | some | Keep |
| Requirements (or its offer) | `:142-147` | `contact_requirements` table | off | feature users | Keep |
| Summary when I first unlock Pulse | `:160-184` (`DailySummaryToggle`) | `briefing_enabled` | on | some turn it off | Keep |
| Desktop notification at a set time + time + test | `RemindersSection.tsx:44-61` | reminders prefs | off, 08:30 (`src/main/reminders.ts:29`) | feature users | Keep |
| Before each appointment or event | `RemindersSection.tsx:62-69` | reminders prefs | no reminder | some | Keep |
| Show who it's with / event titles | `RemindersSection.tsx:70-80` | reminders prefs | off | few (privacy) | More |
| Keep Pulse running in the background; open at sign-in | `BackgroundSection.tsx:28-58` | `pulse-prefs.json` (`src/main/prefs.ts:17-19`) | off, off | few | More (the whole section) |
| Days off: weekend days, holidays, US federal holidays | `DaysOffSection.tsx:54-100` | workspace holidays (via `HOLIDAYS_SET`) | Sat+Sun, none | only matter for rules that skip days off or count working days | Hide-if: shown open when any rule has `business_days > 0` or a working-days interval, or holidays are set; otherwise a closed "Days off (used by rules that skip weekends and holidays)" disclosure |

#### Settings → Notes (`NotesSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Note kinds | `ActivityTypesEditor.tsx` (placed `:68`) | settings | per example | many | Keep |
| Record time on notes | `:72` | `workspace_features.timeTracking` | off | feature users | Keep |
| One unit is 15/30/60 minutes | `:73-83` | `unit_minutes` | 15 (`shared/timeMileage.ts:6`) | billing staff | Keep (shown only with time on, which is already a choice; it's the reason people turn time on) |
| Record mileage, rate per mile | `:84-98` | `workspace_features.mileage`, `mileage_rate` | off, empty | feature users | Keep |
| Your own numbers | `:100-104` | `workspace_features.measures` | off | non-human-services | Keep |
| Note formats | `:106-113` | `note_formats` | built-ins | some | Keep |

#### Settings → About (`AboutSection.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Check for updates automatically | `:18-40` | `auto_update_check` | on | privacy-minded | Keep (the only network call; CLAUDE.md says it can be turned off here) |
| Check now, What's new | `:166-218` | n/a | n/a | n/a | Keep |

#### Column settings (`components/grid/ColumnSettingsDialog.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Keep a history of changes | `:53-59` | column `config.log_changes` | off (on for setup's date rules, `starters.ts:648`) | few | More |
| Must be filled in | `:61-69` | `config.required` | off | some | Keep |
| Show only the date | `:72-80` | `config.date_only` | on (owner's decision) | some | Keep |
| On the calendar | `:83` (`CalendarColumnSwitch`) | settings `HIDDEN_DEADLINES_KEY` | on | some | Keep |
| Color rules… | `:87-94` | `cell_formats` | none | some | Keep |
| Edit the choices… | `:96-106` | `config.options` | n/a | many | Keep |
| Use as the stage… / Stage settings… | `:108-118` | `config.stage` | n/a | feature users | Keep |
| Link settings… | `:120-130` | link types | n/a | feature users | Keep |
| Notes that count as done (`NoteUpdatePicker`) | `:133-138` | `config.note_updates` | none | contact-deadline users | Keep |
| Checklist when done (`DoneChecklistPicker`) | `:139-141` | `config.done_checklist_id` | none | few | More |

The dialog becomes: switches people use, actions, then "More settings" (history of changes, checklist when done).

#### List settings (`components/grid/ListSettingsDialog.tsx`)

| Setting | File:line | Stored | Default | Who'd change it | Verdict |
|-|-|-|-|-|-|
| Name | `:215-218` | `grids.name` | n/a | many | Keep |
| What does this list hold (people / things / jobs) | `:220-234` | `grids.record_kind` | from setup | rare after setup | More |
| Own words for this list | `:236-254` | `grids.vocab` | workspace words | few | More |
| How to show each one's name (display format) | `:256-276` | `grids.display_format` | name column | few (the dialog itself says "Usually … is enough", `:259-261`) | More |
| Use priorities on this list | `:280-285` | `grids.acuity_enabled` | off | feature users | Keep |
| Monthly requirements… | `:286-290` | table | n/a | feature users | Keep |
| Deleted columns | `:294` | columns | n/a | when needed | Keep |

`changed` is true when the kind differs from the workspace default, own words are on, or `display_format` is set. Those lists open with the disclosure open.

#### Dialogs with choices

| Dialog / choice | File:line | Stored | Default | Verdict |
|-|-|-|-|-|
| Rule editor: interval presets, Custom… | `AlertRuleEditor.tsx:413-460` | rule | n/a | Keep |
| Rule editor: Due by the end of that month | `:463-467` | `alert_rules.end_of_month` | off | More |
| Rule editor: If it lands on a weekend or day off | `:477-487` | `alert_rules.business_days` | leave it | More |
| Rule editor: conditions (`ConditionFields`, `RuleKindFields.tsx:317`) | `:489` | `rule_condition` | none | More |
| Rule editor: Colors as it gets close | `:512-630` | `alert_rules.thresholds` | standard set | Keep for an existing rule; for a new rule show `RuleColorKey` and a "Change colors…" button that opens the editor rows |
| Rule editor: name and description | `:492-510` | rule | auto name | Keep (already under "More") |
| Rule editor: which columns get this change | `:645-655` | n/a | all | Keep (asked only when shared) |
| Import options (duplicates, tidy, flip, links) | `ImportOptionsStep.tsx:22-118` | n/a | n/a | **Q1a** (chosen automatically and shown on the summary); not touched here |
| Calendar export: full names | `reports/CalendarExportDialog.tsx:24-40` | `ics_full_names` | off | Keep (a privacy choice per export) |
| Summary report: include notes / auto-logged changes / tasks, format | `grid/SupervisorReportDialog.tsx:330-420` | n/a | on/off/on, PDF | Keep "Include notes" and the format; More: "Include system activity" and "Include task summary" |
| Handoff packet: scratch pad, pictures, archive after, reason | `profile/HandoffDialog.tsx:98-120` | n/a | n/a | Keep (choices for this one packet) |
| Batch letters: who, template, page, label sheet | `documents/BatchDocumentsDialog.tsx:184-260` | n/a | n/a | Keep (choices for this one job) |

#### Stored but not shown (left alone)

`font_size` (allowed in `ipc-settings.ts:13`, no reader), `show_gridlines` (`ipc-settings.ts:15`, one reader), `track_time`/`track_mileage` (superseded by features; migration 036 reads them), `note_format_last`. Leave them, with no schema or allow-list change: restoring an old backup must still work.

## Files owned

New:
- `src/renderer/components/settings/MoreSettings.tsx` (unless Q5 provides a disclosure)
- `tests/renderer/components/settings/MoreSettings.test.tsx`
- `tests/renderer/components/settings/settingsDisclosure.test.tsx` (each section: the group starts closed at defaults and open with a changed value; everything in it is still reachable by label)
- `e2e/ux-review/Q1c.spec.ts` (git-excluded)

Edited (owned):
- `src/renderer/components/settings/AppearanceSection.tsx`
- `src/renderer/components/settings/SecuritySection.tsx` (revoke checkbox only, `:348-360`)
- `src/renderer/components/settings/BackupSection.tsx`
- `src/renderer/components/settings/DataSection.tsx`
- `src/renderer/components/settings/FilesStorageSection.tsx`
- `src/renderer/components/settings/AlertsSection.tsx`
- `src/renderer/components/settings/RemindersSection.tsx`
- `src/renderer/components/settings/BackgroundSection.tsx`
- `src/renderer/components/settings/DaysOffSection.tsx`
- `src/renderer/components/settings/WordsEditor.tsx`
- `src/renderer/components/settings/WorkspaceSection.tsx`
- `src/renderer/components/grid/ColumnSettingsDialog.tsx`
- `src/renderer/components/grid/ListSettingsDialog.tsx`
- `src/renderer/components/alerts/AlertRuleEditor.tsx`
- `src/renderer/components/grid/SupervisorReportDialog.tsx`
- `src/renderer/stores/settingsStore.ts` (locale defaults, `:103-106` and `:118-120` only)
- Tests: `tests/renderer/components/settings/{AppearanceZoom,BackupSection,DataSection,SecuritySection,WordsEditor,remindersGrouping}.test.tsx`, `tests/renderer/ListSettingsDialog.test.tsx`, `tests/renderer/components/alerts/*` (rule editor cases), `tests/settings.test.ts` (locale defaults)

Shared (with reason):
- `src/renderer/components/settings/AlertsSection.tsx:145,154`: Q1b swaps two message strings for map constants. Keep those two lines as Q1b leaves them; whoever merges second rebases.
- `src/renderer/views/SettingsView.tsx`: **not edited.** The section components keep their props.

Not touched: `NotesSection.tsx`, `ProfileSection.tsx`, `AboutSection.tsx`, `FeaturesSection.tsx` (verdict Keep), any main-process file, `ipc-settings.ts`, the import wizard (Q1a), `ColumnHeader.tsx` (Q3), `HelpView.tsx` (Q1b).

If Q5 has merged, use its `Toggle`/button components where these files already change. Don't migrate other call sites; Q5 does that.

## Commit steps

Each commit passes `npm run gate`.
1. `MoreSettings.tsx` and its test, plus the locale defaults in `settingsStore.ts` (test both hour cycles and week starts with a mocked `Intl`, and that a stored value wins).
2. Appearance: the More group, the % box removed, "None" borders only while current. Update `AppearanceZoom.test.tsx`.
3. Security (revoke disclosure), Backup (frequency, reminder days), Data (history, check, file association, files limit). Update `BackupSection.test.tsx`, `DataSection.test.tsx`, `SecuritySection.test.tsx`.
4. Deadlines & reminders: show names, background, Days off hide-if. Words & features: More words, words hidden for off features, setup sharing under More. Update `remindersGrouping.test.tsx`, `WordsEditor.test.tsx`.
5. Column settings and list settings dialogs. Update `ListSettingsDialog.test.tsx` and any `ColumnHeader`/`ColumnSettingsDialog` test that clicks "Keep a history of changes" (search `tests/` for the label).
6. Rule editor (end of month, days off, conditions, new-rule colours) and the summary report dialog. Update the rule editor tests.
7. Screenshots; add the "More settings" label to CLAUDE.md's naming notes in the close-out commit (the merger does it if the agent can't).

## Acceptance checks

- Each Settings tab at 1366×768 shows its main controls without scrolling more than one screen. Appearance: Theme, Text size, Date format, Accessibility, then a closed "More settings".
- Set Density to Compact, reload Settings: Appearance's "More settings" opens by itself with Density visible. The same holds for every section with a changed value inside.
- A stored `grid_lines = none` still draws no borders and shows "None" as the selected third choice. Choosing Full removes the "None" choice.
- A US-English machine shows 12-hour and Sunday (same as today). With `LANG=en_GB` (or a mocked `Intl`), a fresh install shows 24-hour and Monday, and nothing is written to settings until she picks.
- Days off is a closed one-liner on a workspace whose rules never skip days off. Make a rule with "Move it to the next working day" and it shows open.
- Words & features with the Contacts page off: no "Outside contacts" or "Contacts page" word rows. Turn it on: they appear under "More words".
- Column settings for a plain text column: two switches (history under More), Color rules…. For a date column with a rule: "Show only the date", "On the calendar", "Notes that count as done", and "More settings" holding history and the done checklist.
- List settings: Name, priorities and requirements if on, deleted columns, and a closed "More settings" with kind, words and name format, unless one of them was changed.
- Rule editor, new rule: interval, colour key with "Change colors…", and a closed "More settings" (end of month, days off, conditions). Editing a rule that uses end-of-month opens it.
- Every moved control is still reachable by keyboard: Tab to the summary, Enter or Space opens it. Screen readers announce it as a disclosure (`<details>`/`<summary>`). 15 px text, 44 px summary rows, 3 px focus ring.
- Screenshots: `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q1c.spec.ts` (after `npm run build`) writes `ux-review-shots/Q1c/` at 1366×768, light and dark, for each Settings tab (`19-settings-<tab>`), plus:
  - `30-column-settings-date`
  - `31-list-settings`
  - `32-rule-editor-new`
  - `33-appearance-more-open`

  Compare with `ux-review-shots/after-phase1/19-settings-*.png`: there should be visibly fewer controls above the fold, and no setting the user changed is hidden.

## Tests to add or update

- New: `MoreSettings.test.tsx`, `settingsDisclosure.test.tsx`, plus locale-default cases in `tests/settings.test.ts` (or a new `tests/renderer/stores/settingsLocale.test.ts`).
- Update the section tests named above. In jsdom, content inside a closed `<details>` is still in the DOM, so most `getByLabelText` queries keep working. Assert visibility only where the test is about the disclosure.
- Check `tests/renderer/a11y/` (the axe runs on Settings) and `tests/renderer/components/shared/TourOverlay.test.tsx`: tour targets `settings-security-tab`, `settings-backup-tab` and `settings-change-password` (`SettingsView.tsx:157`, `SecuritySection.tsx:185`) don't move.

## Risks

- **"Where did my setting go?"** Mitigated by auto-open when changed, by the same "More settings" label everywhere, and by the Help answers that name a setting's place: today only `views/help/faqData.tsx:644` names a moved place ("Settings > Deadlines & reminders > Days off"). Re-run a search for every label moved here ("Density", "Sidebar width", "Clock format", "Week starts", "history", "frequency", "Days off") and add "→ More settings" where one appears. **That file is shared with Q1b (read only there) and possibly Q2/Q8.** It's a text edit to the answer strings only; the second to merge rebases. Add `faqData.tsx` to this plan's files for those strings only.
- **Locale defaults change behaviour** for new non-US installs (24-hour, Monday). That's intended. Log it in CLAUDE.md's Decision Log at close-out.
- **Removing the % box and the "None" borders** are the only true removals. Both values stay readable and settable. If the owner objects, they move under More instead, a one-line change each.
- **Tests or e2e clicking a moved control in Playwright** (closed `<details>` hides it from Playwright's visibility checks). Search `e2e/` for "Density", "Shade every other line", "Frequency", "Keep a history of changes" and open the group first. The user's `e2e/ui-tour.spec.ts` is not touched.
- **Overlap with Q8 (visual polish, Wave C)**: Q8 restyles these same files after Wave B merges, so no conflict in Wave B.
