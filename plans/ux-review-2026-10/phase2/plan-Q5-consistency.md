# Q5: Consistency as a system (shared components, tokens, ratchet test)

**Idea 5 (ORCHESTRATION.md, Phase 2):** shared components that enforce the style guide, call sites migrated to them, a small design-token set, and a test that flags off-system values in new code.

**Wave:** split in two.
- **Q5 part 1 runs in Wave A** (foundations). Everything in Wave B is written against its components. It runs alongside Q9-measure and Q10 (doc only), and their files don't overlap.
- **Q5 part 2 runs at the start of Wave C**, before Q8. It's the long-tail migration, and Q8's agent can do it as its first commits.

**No migration, no network, no new stored data.**

## Goal
- One way to draw each kind of control, so a button, a dialog, a switch, a "⋯" menu, an empty panel and a toast look and behave the same on every screen.
- The 15 px / 44 px / 3 px rules hold *because the component does it*, not because each call site remembers to (today 315 call sites add `style={{ minHeight: 44 }}` by hand).
- New code that steps off the system fails a test. Old code is counted in a baseline that can only go down.

## Current behaviour (main @ f4fc6be9, after Phase 1)

### Buttons: five CSS classes plus hand-rolled copies
| Pattern | Hits / files | Where defined |
|-|-|-|
| `.btn-primary` | 106 / 79 | `styles/globals.css:229` (`bg-blue-600`, radius `--radius-sm` = 4 px via `@utility btn` at :171–191) |
| `.btn-secondary` | 143 / 86 | `globals.css:233` |
| `.btn-danger` | 5 / 4 (ReportBuilder:465, LinkSetupDialog:165, SecuritySection:377) | `globals.css:237` |
| `.btn-compact-primary` / `-secondary` / `-soft` | 14/11 · 78/43 · 4 users | `globals.css:242–252` (36 px + `::after` 44 px hit area, radius 6 px) |
| Hand-rolled primary (`bg-blue-600 … hover:bg-blue-700` on a `<button>`) | 44 lines / ~25 files | e.g. ContactImportExport.tsx:234,337,372,398,417 · CategoryManager.tsx:129,229,322 · Checklist.tsx:1116,1174,1340,1360 · ProfileHeader.tsx:570,692,737 · ImportWizard.tsx:689,702,714 · FindReplaceBar.tsx:325,326 · LetterTemplateView.tsx:121,250 · FocusModeView.tsx:406,421 · BulkActionBar.tsx:164,171 |
| Hand-rolled secondary (`border-slate-300 … hover:bg-slate-50/100`) | ~20 lines | e.g. ProfileMoreMenu.tsx:55, DeadlinePanel.tsx:481 |
| Hand-rolled red | 9 lines / 9 files | ConfirmDialog.tsx:185, SnippetsView.tsx:362, SetupTemplateCard.tsx:103, Sidebar.tsx:81, CaseLogEntry.tsx:226,257, BulkActionBar.tsx:238, CategoryManager.tsx:248, DataSection.tsx:394 |
| Buttons below 44 px (`minHeight: 40`) | 11 | ConfirmDialog.tsx:174,188 (every confirmation in the app) · FindReplaceBar.tsx:237,296 · SupervisorReportDialog.tsx:237,246 · CategoryManager.tsx:126,129,132 · ColumnSelectDialog.tsx:200,208 |

The radius depends on which pattern a button uses: 4 px (`.btn`), 6 px (`.btn-compact`) or 8 px (hand-rolled `rounded-lg`). You can see it in `ux-review-shots/after-phase1/12-profile.light.png`, where "Case note" is 8 px, and `13-tasks.light.png`, where "+ Add task" is 4 px.

### Dialogs: 73 files build their own
- `aria-modal` appears in 75 files. 73 of them call `useFocusTrap` themselves (`hooks/useFocusTrap.ts:14`). There's no shared dialog shell.
- Backdrop z-index varies: `z-[200]` ×40, `z-50` ×32, `z-40` ×17, plus 8 one-offs (`z-[60]`, `z-[100]`, `z-[150]`, `z-[210]`, `z-[300]`, `z-[9999]`). A z-50 dialog opened from a z-[200] one goes underneath it.
- Widths vary: `max-w-md` ×21, `2xl` ×19, `lg` ×18, `sm` ×12, `xl` ×5, and one each of 3xl/4xl/5xl.
- About 23 have a pinned header and footer (`flex-col` + `overflow-y-auto` body + `flex-shrink-0` footer). `ListSettingsDialog.tsx:198–300` is the best example. The others scroll their buttons out of view at 768 px. That was Phase 1 finding #13, which was fixed one dialog at a time.
- By folder: grid 15, shared 14, profile 9, dashboard 4, reports 4, calendar 4, contacts 3, then 1–2 each across 16 more folders.
- `ConfirmDialog.tsx` (199 lines) has 38 call sites in 28 files. It's the model to copy: it uses `alertdialog` for destructive actions (:87), traps focus with Escape (:47), stops propagation for nested dialogs (:93), lets Enter confirm only from the primary button (:69–78), and scrolls at 200 % zoom (:107). Its buttons are 40 px (:174, :188).

### Switches: four different drawings, plus checkboxes
- `role="switch"`, four implementations:
  - `AppearanceSection.tsx:47–70`: local `SettingSwitch`, slate track.
  - `grid/SettingSwitchRow.tsx:19–56`: blue track. The whole row is the switch. Used by `CalendarColumnSwitch.tsx:31` and `ColumnSettingsDialog.tsx:53,62,73`.
  - `AcuityConfigPanel.tsx:100`.
  - `profile/Checklist.tsx:1236–1239`: `bg-blue-500`, no off-state border.
- 13 on/off settings that apply immediately are plain checkboxes: RemindersSection:45,71 · BackgroundSection:32,43 · DaysOffSection:66 · FeaturesSection:64 · NotesSection:57 · SecuritySection:240,350 · AboutSection:32 · AlertsSection:176 · BackupSection:409,511.
- `SettingSwitchRow` puts `role="switch"` on the whole row. The forced-colours rules in `globals.css:634–644` (`[role="switch"] > span` is the knob) then outline the entire row and treat its icon as the knob.

### "⋯" and "More ▾" menus: no shared component
- `role="menu"`: 18 instances in 12 files.
- ⋯ triggers (`MoreHorizontal`): Sidebar.tsx:230, GridHeaderRow.tsx:246, SortableRow.tsx:269, ColumnHeader.tsx:331, AppointmentActions.tsx:97, ChecklistToolbar.tsx:79, TaskItem.tsx:398.
- `hooks/useMenuKeys.ts` handles keyboard for 16 files.
- `profile/ProfileMoreMenu.tsx` (83 lines) is the cleanest "More ▾" menu, with a danger item after a divider and a description line. It has its own key handling, not `useMenuKeys`, and isn't portalled (Phase 1 D-01 was a clipped menu).
- Other "▾" menus build their own: PrintExportMenu.tsx:39, CaseLog.tsx:642, GridToolbar.tsx:184,232,313,412,519, TopBar.tsx:327.

### Empty states: one component, most screens skip it
- `shared/EmptyState.tsx` (43 lines) is used in 7 views only: Grid, Contacts, Trash, Tasks, Snippets, TemplateManager, LetterTemplate.
- About 29 other places write a "No … yet" paragraph by hand (listed in Q8, which designs them).

### Tooltips: mostly native `title=`
- `shared/Tooltip.tsx` (114 lines) handles hover and focus, has a grace period and Escape. It's used in only 7 files (TopBar 4, GridToolbar 3, ProfileView 3, GroupingBar 2, ColumnHeader, FilterBar, FilterControls).
- Native `title=` appears 392 times in 115 files. It's slow (about 1 s), mouse-only, and often repeats the visible text (`ConfirmDialog.tsx:117,175,189`).

### Toasts: two systems in the same corner
- react-hot-toast: `<Toaster position="bottom-right">` is rendered five times in `App.tsx` (:141, :153, :165, :185, :366), once per auth state, with default styling. That means a white bubble in dark mode and emoji icons from call sites: LockScreenView.tsx:121 `'⚠️'`, RecoveryKeyReminderToast.tsx:57 `'🔑'`, useBackupReminder.ts:31–39. It's imported in 102 files: 223 `toast.error`, 66 `toast.success`, 13 `toast(`, 5 `toast.dismiss`.
- `shared/UndoToast.tsx:46` is a separate `fixed bottom-6 right-6 z-[300]` box, mounted at App.tsx:317. The two overlap when both show. That's the Phase 1 leftover in ORCHESTRATION.md:113, which was filed under Q6. It's a shared-toast problem, so **Q5 takes it** (README: drop it from Q6).

### Colour key: three presentations
- `grid/ColorKeyPopover.tsx` (P3b) is portalled, has a `DeadlineColorKey` with shapes per rule, and is used by `ColumnHeader.tsx:292`.
- `grid/GridStatusFooter.tsx:47–102` has its own `ColorKeyButton` popover. It's absolutely positioned, has its own `SHAPES` list (:18), and calls `RuleColorKey` directly (:82).
- `DashboardView.tsx:108–120, 534–558` draws an inline panel that starts **expanded** until "Got it". The setting is `dashboard_color_guide_seen` (:55). That panel is the after-phase1 leftover (2): it pushes the due rows below the fold at 768 px (`11-dashboard.light.png`).

### Tokens today
- `globals.css:7–59` `@theme` defines alert colours, text sizes (`--text-xs` 14, `sm`/`base` 15, `lg` 16, `xl` 18, `2xl` 20, `3xl` 24, `4xl` 28), touch/row heights and the grid border.
- `--accent`/`--accent-hover` exist as plain CSS variables (:104–105, :117–118). No utility uses them; 72 call sites write `bg-blue-600` directly.
- Usage counts:
  - Radius: `rounded-lg` 387, `rounded-sm` 383, `rounded-full` 143, `rounded-xl` 111, `rounded-md` 76, bare `rounded` 61, `rounded-2xl` 4.
  - Text: `text-base` 1213, `text-sm` 653, `text-lg` 79, `text-xl` 62, `text-2xl` 10, `text-3xl` 10, `text-xs` 13, `text-[15px]` 26.
  - Inline `fontSize`: 296, of which 287 are `fontSize: 15`, the same as `text-base`.
  - Padding/margin/gap steps: 2 ×1360, 3 ×938, 1 ×703, 4 ×600, 1.5 ×385, 6 ×252, 0.5 ×223, 5 ×113, 8 ×69, 2.5 ×55, then 12/16/9/7/10/24/14/11.

## The change

### 1. Tokens (in `globals.css` `@theme`, about 20 lines)
Keep Tailwind's own names as the API. The system is a short list of which names are allowed. No new vocabulary to learn.

| Token | Value | Utility | Note |
|-|-|-|-|
| Accent | `--color-accent: #2563EB` (dark `#3B82F6`), `--color-accent-hover: #1D4ED8` (dark `#2563EB`), `--color-accent-soft: #EFF6FF` (dark `rgb(30 58 138 / .4)`) | `bg-accent`, `text-accent`, `ring-accent`, `border-accent`, `bg-accent-soft` | The dark values go in the existing `.dark {}` block (:109). The old `--accent`/`--ring-color` become aliases of these, so there's one source. |
| Radius | `--radius-lg: 0.5rem` (stated explicitly, with a comment) | `rounded-lg` (+ `rounded-full` for pills, avatars, switches, dots) | `.btn`, `.btn-compact` and `.input` move from 4 / 6 px to 8 px. `rounded-sm` stays allowed only on elements 20 px or smaller (swatches, checkboxes), where 8 px would turn them into circles. |
| Text (3 sizes) | 15 px body (`text-base`; `text-sm` is the same size and stays allowed), 18 px section heading (`text-xl`), 20 px page title (`text-2xl`) | — | `text-lg` (16 px, reads as a mistake next to 15) and `text-3xl`/`4xl` are off-system except on the hero screens (Setup, PasswordSetup, LockScreen, onboarding welcome, Focus mode "all caught up"). `text-xs` keeps its existing rule (keys and count badges, `tests/renderer/textSize.test.ts`). |
| Spacing (5 steps + one section gap) | 4 · 8 · 12 · 16 · 24 px, and 32 px between page sections | `-1 -2 -3 -4 -6`, `-8` | Applies to `p*/m*/gap*/space-*` only. `w-`/`h-` sizing keeps the full scale: resetting `--spacing` would break every icon size. `0`, `px` and `0.5` stay allowed (hairline nudges, badge padding). Off-system: `1.5`, `2.5`, `3.5`, `5`, `7`, `9`, `10`, `11`, `12`, `14`, `16`, `20`, `24`. |
| Layers | dialog `z-[200]`, popover/menu `z-[250]`, toast `z-[300]` | constants in `components/ui/layers.ts` | Not a theme token. Used only inside the ui components, which replaces the 11 z-values above. |

Don't override `--radius-sm/md/xl` globally. 383 `rounded-sm` include 16 px swatches and checkbox squares that would become circles.

### 2. Components (new folder `src/renderer/components/ui/`, the "system" boundary the test exempts)
All components:
- use named exports;
- take a React 19 `ref` prop;
- **spread the rest of their props** onto the real element, so `data-tour` (the tour target scan), `data-testid`, `id` and `aria-*` survive;
- carry no hard-coded record or list words (labels come from the caller).

Text props are named `title`, `label`, `description` or `message`, which `eslint/vocab-rule.mjs:23` (`ATTR_ALL`) already checks. If a new text prop is unavoidable, add its name to `ATTR_ALL` in the same commit.

- **`Button.tsx`**: `PrimaryButton`, `SecondaryButton`, `DangerButton`, `IconButton`.
  - Props: `size?: 'normal' | 'compact'` (44 px, or 36 px visible inside a 44 px hit area), `icon?: ReactNode` (lucide icon, `aria-hidden`), `busy?: boolean` (sets `disabled` and `aria-busy`; Q6 adds the delayed spinner), `tone?: 'default' | 'inverse'` (for dark bars: BulkActionBar, UndoToast).
  - They render the existing `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-compact-*` classes, so CSS stays in one place. `button.btn-primary` selectors keep working (`tests/renderer/views/FocusModeDone.test.tsx:119`, forced-colours rules at `globals.css:616–618`).
  - `type="button"` by default.
  - `IconButton` requires `label`. It sets `aria-label` and wraps itself in `Tooltip` (not `title=`), with an optional `shortcut` ("Ctrl+F") appended to the tooltip.
- **`Dialog.tsx`**: `Dialog({ open, onClose, title, description?, size?: 'sm'|'md'|'lg'|'xl', role?: 'dialog'|'alertdialog', initialFocus?, footer?, children })`.
  - Layout: header with title and an X `IconButton` labelled "Close"; a body that scrolls (`min-h-0 overflow-y-auto`); a **pinned footer** (`flex-shrink-0 border-t`, actions right-aligned, Cancel before the primary).
  - Panel: `max-h-[calc(100vh-2rem)]`, `rounded-lg`, `z-[200]`, motion `backdropVariants` / `modalPanelVariants` (`utils/animations.ts:40,47`) so reduced motion is honoured.
  - It folds in every ConfirmDialog safety detail: `useFocusTrap(…, { onEscape })`, Escape with `preventDefault` + `stopPropagation`, `onClick` stopPropagation for nested dialogs (Q-051), and backdrop click = `onClose`.
- **`ConfirmDialog`** (stays at `shared/ConfirmDialog.tsx`; tests read that path) is rebuilt on `Dialog`. Same props, so all 38 call sites are untouched. Its buttons go from 40 to 44 px (fixes :174, :188) and the destructive button becomes `DangerButton`. Q4 later decides which call sites become Undo.
- **`Toggle.tsx`**: `Toggle({ checked, onChange, labelId?, label?, describedBy?, disabled? })` and `ToggleRow({ label, description?, icon?, checked, onChange, disabled? })`.
  - `role="switch"` goes on the track button only, whose first child span is the knob, so `globals.css:634–644` works.
  - `ToggleRow` is a 44 px row. Clicking the label or description toggles too, through `onClick` on the row, without nesting interactive elements.
  - On = accent track with a white knob; off = outlined track with a grey knob (keeps A06-30's 3:1 contrast). It shows "On" / "Off" text like `SettingSwitchRow` does.
  - Rule, written in the component's doc comment: a setting that applies at once is a Toggle; a choice inside a form that's saved later is a checkbox.
- **`RowMenu.tsx`**: two parts.
  - `MenuButton({ label, items, icon?, variant?: 'secondary'|'ghost' })` for "More ▾" / "Print or save ▾".
  - `RowMenu({ label, items })` for "⋯": an `IconButton` that is **always visible**, not hover-only (Phase 1 B-01, D-12).
  - Items: `{ label, onSelect, description?, icon?, danger?, disabled? }`. A danger item goes last, after a separator, in red text.
  - The menu is portalled to `document.body` and placed with the same edge-aware maths as `ColorKeyPopover.tsx:85–92`. Keyboard comes from `useMenuKeys` (`hooks/useMenuKeys.ts`). Layer `z-[250]`.
- **`EmptyState`** (stays at `shared/EmptyState.tsx`). The current props are kept, so the 8 call sites are untouched. New optional props:
  - `size?: 'page' | 'panel' | 'inline'` (page: icon in a 56 px soft circle, `py-16`; panel: 40 px icon, `py-8`; inline: text only);
  - `secondaryAction?: { label, onClick }` (rendered as a link-style button).
  - The action becomes `PrimaryButton` and drops the inline style at :34.
  - The doc comment states the copy rule: one sentence on what goes here, one action that fills it.
- **`PageHeader.tsx`** / **`Section.tsx`**:
  - `PageHeader({ title, description?, primary?, actions?, breadcrumb? })` draws a 20 px semibold title, the one-sentence description under it, the primary action on the right and secondary actions before it.
  - `Section({ title, description?, actions?, children })` draws an 18 px heading with spacing and **no border**.
  - **Q5 migrates no screens to these.** Q2 ("one obvious next step") adopts `PageHeader` per screen in Wave B, and Q8 adopts `Section` and finishes the rest. They're built here so both use one header.
- **`ToastHost.tsx`** (`components/shared/`): one bottom-right column holding the undo toast and react-hot-toast.
  - It renders a single `<Toaster position="bottom-right" containerStyle={{ bottom: undoHeight + 24 }} gutter={8} toastOptions={…} />`. `undoHeight` is measured with a `ResizeObserver` on the UndoToast (0 when none), so react-hot-toast toasts stack **above** the Undo toast instead of on top of it.
  - `toastOptions`: `className` with tokens (`rounded-lg`, 15 px, `bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100`, border), `duration: 5500`, `success.icon` / `error.icon` as lucide `CheckCircle2` / `AlertTriangle` nodes.
  - App.tsx's five `<Toaster>` become `<ToastHost />`. UndoToast keeps its logic and its `UNDO_TOAST_MS` from `undoStore`. Q4 may change the duration; only its outer `fixed bottom-6 right-6` moves into the host's layout.
  - The emoji `icon:` call sites (LockScreenView.tsx:121, RecoveryKeyReminderToast.tsx:57, useBackupReminder.ts:31,37,39) switch to lucide icons.
  - The 102 files that import `toast` don't change.
- **Colour key, one component.**
  - `ColorKeyPopover` gains `intro?: string` (rendered before the rules) and `triggerVariant?: 'icon' | 'link'`.
  - `GridStatusFooter` deletes `ColorKeyButton` and `SHAPES` (:18–102) and mounts `<ColorKeyPopover placement="above" triggerVariant="link" label="What do the colors mean?" …>`, with `columnNames` built from the shown columns. The per-rule shapes from `DeadlineColorKey` replace the footer's separate shapes list.
  - `DashboardView`'s link (:534–540) opens the same popover with the stripe sentence (:547–549) as `intro`. The inline panel (:542–558), its auto-open (:108–120) and the "Got it" button go.
  - That fixes after-phase1 leftover (2) with one key everywhere. The first-visit teaching moment moves to Q7's one-time screen hints (README: Q7 adds a dashboard colours hint).
  - Nothing in the database changes. `dashboard_color_guide_seen` is simply no longer read.

### 3. The ratchet test (lint for off-system values)
`tests/renderer/designSystem.test.ts` plus `tests/renderer/design-system-baseline.json`.

- **What it scans:** every `src/renderer/**/*.tsx`, except:
  - `components/ui/**` (the system itself);
  - `components/shared/help-demos/**` (demo data);
  - `components/profile/ProfilePrintLayout.tsx` (print CSS);
  - a short allowlist of *data-colour* files, where colour is a label, not an action: `hooks/useActivityTypes.ts`, `components/shared/PasswordStrength.tsx`, calendar layer colours, contact category colours.
- For each file it counts rule hits and compares them with the baseline. **The test fails only when a count goes up, or a new file or rule appears.** The failure message names the rule and what to use instead.
- When counts go down, the test passes. The orchestrator tightens the baseline after each merge with `UPDATE_DESIGN_BASELINE=1 npm test -- tests/renderer/designSystem.test.ts`: when that variable is set, the test writes the JSON instead of asserting. So parallel worktrees never edit the JSON unless they add a violation, which they shouldn't. That avoids merge conflicts in one shared file.
- It's a test rather than an ESLint rule because:
  - it has to read class strings inside template literals and objects;
  - it needs a per-file baseline;
  - the warning count in CLAUDE.md's quality gates (146) must not grow.

| Rule id | Flags | Use instead |
|-|-|-|
| `radius` | `rounded-(md\|xl\|2xl\|3xl)`, bare `rounded`, `rounded-sm` without a `w-/h-[3-5]` size in the same class string | `rounded-lg` / `rounded-full` |
| `text-size` | `text-lg`, `text-[Npx]`, `text-3xl`/`4xl` outside hero files, `fontSize:` in `style` | `text-base` / `text-xl` / `text-2xl` |
| `spacing` | `(p\|px\|py\|pt\|pb\|pl\|pr\|m\|mx\|my\|mt\|mb\|ml\|mr\|gap\|gap-x\|gap-y\|space-x\|space-y)-(1.5\|2.5\|3.5\|5\|7\|9\|10\|11\|12\|14\|16\|20\|24)` | 1, 2, 3, 4, 6, 8 |
| `action-colour` | in a `<button …>` opening tag's className: `bg-(violet\|purple\|indigo\|teal\|emerald\|sky\|cyan\|pink\|fuchsia\|lime)-*`, or `bg-(green\|amber\|orange\|yellow\|red)-(500\|600\|700)` | `PrimaryButton` (accent), `SecondaryButton`, `DangerButton`. Deadline colours are for status only. |
| `raw-button` | `<button className="btn-…">`, and hand-rolled `bg-blue-600 … hover:bg-blue-7xx` on a `<button>` | the Button components |
| `raw-dialog` | `aria-modal` outside `ui/Dialog.tsx` | `Dialog` (allowlist: CommandPalette, TourOverlay, MiniTour, FocusModeView full screen, MorningBriefing if it isn't a plain dialog) |
| `raw-switch` | `role="switch"` outside `ui/Toggle.tsx` | `Toggle` / `ToggleRow` |
| `raw-menu` | `role="menu"` outside `ui/RowMenu.tsx` | `RowMenu` / `MenuButton` (GridContextMenu and the grid toolbar menus stay in the baseline) |
| `inline-size` | `style={{ minHeight: …` on a `<button>` | the component's `size` |
| `native-title` | `title=` on a `<button>` | `IconButton label` or `Tooltip` |

A second block in the same file asserts that `globals.css` `@theme` declares `--color-accent`, `--color-accent-hover`, `--color-accent-soft` and `--radius-lg`, and that `.dark` redefines the accent.

### Staged migration (biggest reach first)
| Stage | What | Reach | Files edited |
|-|-|-|-|
| 0 | Re-point `.btn*`, `.btn-compact*`, `.input` to tokens (accent, `rounded-lg`) | ~350 buttons and every `.input`, at once | `globals.css` only |
| 1 | `ConfirmDialog` on `Dialog`, `EmptyState` upgrade | 38 + 8 call sites, untouched | 2 |
| 2 | `ToastHost` | every toast; overlap fixed | App.tsx, UndoToast.tsx, 4 emoji call sites |
| 3 | Switches → `Toggle` / `ToggleRow` | 4 implementations, 6 call sites | AppearanceSection, SettingSwitchRow (becomes a re-export of `ToggleRow` so its 2 importers don't change), AcuityConfigPanel, Checklist |
| 4 | Colour key | 3 presentations → 1 | ColorKeyPopover, GridStatusFooter, DashboardView |
| 5 | Hand-rolled buttons → components, one commit per folder in this order: contacts (11 lines) → profile (9) → shared (5) → views (10) → grid (9; BulkActionBar's colours are Q8's, so only swap its blue/red to components there) | 44 primary + ~20 secondary + 9 red, the 11 sub-44 px buttons fixed | ~35 |
| 6 | Menus → `RowMenu` / `MenuButton` | ProfileMoreMenu (rewritten as a thin wrapper, callers unchanged), TaskItem:398–401, ChecklistToolbar:79–82, AppointmentActions:97–100, PrintExportMenu:39, CaseLog:642 | 6 |
| 7 | Dialogs → `Dialog`, part 1: `shared/` (14), `settings/` (2), `views/dashboard/` (4) | 20 most-shared dialogs | 20 |
| 8 (part 2, Wave C) | Dialogs, part 2: grid 15 → profile 9 → reports 4 → calendar 4 → contacts 3 → the rest (~18) | remaining ~53 | ~53 |
| 9 (part 2) | ⋯ triggers in the grid and sidebar → `IconButton` (SortableRow:269, ColumnHeader:331, GridHeaderRow:246, Sidebar:230). Leftover hand-rolled buttons. The settings checkboxes Q1c kept → `ToggleRow`. | — | ~10 |

The 13 settings checkboxes go to **Q1c** (Wave B audits every setting and will delete some; converting the ones it keeps is one more line each). Q5 part 2 picks up what Q1c didn't.

## Files owned

**Part 1 (Wave A).** New:
- `src/renderer/components/ui/Button.tsx`, `Dialog.tsx`, `Toggle.tsx`, `RowMenu.tsx`, `PageHeader.tsx`, `Section.tsx`, `layers.ts`
- `src/renderer/components/shared/ToastHost.tsx`
- `tests/renderer/designSystem.test.ts`, `tests/renderer/design-system-baseline.json`
- `tests/renderer/components/ui/{Button,Dialog,Toggle,RowMenu,PageHeader}.test.tsx`, `tests/renderer/components/shared/ToastHost.test.tsx`

Edited:
- `src/renderer/styles/globals.css` (tokens; `.btn*`/`.input` re-pointed)
- `components/shared/ConfirmDialog.tsx`, `EmptyState.tsx`, `UndoToast.tsx`, `RecoveryKeyReminderToast.tsx` (icon only)
- `components/grid/ColorKeyPopover.tsx`, `GridStatusFooter.tsx`, `SettingSwitchRow.tsx`, `AcuityConfigPanel.tsx` (switch only)
- `components/settings/AppearanceSection.tsx` (switch only)
- `components/profile/ProfileMoreMenu.tsx`, `profile/Checklist.tsx` (switch :1236 and buttons :1116,1174,1340,1360 only)
- `views/LockScreenView.tsx:121` (icon only), `hooks/useBackupReminder.ts` (icons only)
- Stage 5–7 call-site files: exactly the files named in the tables above, button/dialog/menu markup only
- Their existing tests

Shared files touched, and why:
- `src/renderer/App.tsx`: the five `<Toaster>` lines → `<ToastHost />`, and the UndoToast mount moves inside it. No other lines.
- `views/DashboardView.tsx`: only the colour-key lines :55, :108–120, :534–558. Q2 owns the rest of the file in Wave B and starts from this.
- `eslint/vocab-rule.mjs`: one line, only if a new text prop name is needed.

**Part 2 (Wave C, before Q8):** the stage 8–9 files. The README's ownership map must give these to Q5-part-2, or to Q8's agent if Q8 does them.

**Not Q5:** BulkActionBar colours, focus-mode / dashboard Done colours, card borders, empty-state copy and layout on screens, the About screen, the app icon (all Q8). Page headers (Q2). Undo instead of confirm (Q4). Motion and spinners (Q6).

## Commits, in order (part 1)
1. **Tokens.** `@theme` additions, `.dark` accent values, `--accent` aliases, `.btn`/`.btn-compact`/`.input` radius → `rounded-lg`, `.btn-primary` → `bg-accent hover:bg-accent-hover`, `.btn-compact-soft` → same look as `.btn-compact-secondary` (its 4 users: TasksView:581, SecurityCheckup:105, ContactRequirementsDialog:94, BackupSection:272; delete the class in Q8). Screenshot check (below).
2. **Ratchet test** and the first baseline. From here on, every commit's counts only go down.
3. **`Button.tsx`** (all four) with tests. Migrate `EmptyState`'s action to it.
4. **`Dialog.tsx`**. Rebuild `ConfirmDialog` on it. Tests for focus trap, Escape, nested click, alertdialog role, pinned-footer structure, and 44 px buttons.
5. **`Toggle.tsx`**, then stage 3.
6. **`RowMenu.tsx`**, then stage 6.
7. **`ToastHost`**, then stage 2.
8. **Colour key**, stage 4.
9. **`PageHeader` / `Section`** (components and tests only).
10. **Stage 5**, one commit per folder.
11. **Stage 7**, one commit per folder (shared, settings, dashboard).
12. **Baseline tightened**, `npm run test:tz` (nothing date-related expected, but it's cheap), then `npm run gate`.

Each commit: `npm run typecheck`, `npx eslint src --quiet`, targeted `npm test -- <files>`, and `npm run gate` before committing. No new `eslint-disable`, `@ts-…` or `as any`. Commit messages end with the Co-Authored-By / Claude-Session lines in effect.

## Acceptance checks
- `npm run gate` green. The design baseline total is lower than at commit 2 by at least the stage 5–7 counts. Report before and after per rule.
- No button anywhere under 44 px: `minHeight: 40` count 0. ConfirmDialog buttons measured at 44 px in a jsdom style check.
- Toggles: every `role="switch"` is inside `ui/Toggle.tsx`. Forced-colours rules still match (`contrastModesCss.test.ts`).
- Toasts: an Undo toast and a react-hot-toast shown together don't overlap (ToastHost test: container `bottom` offset ≥ the undo toast's height + 24). In dark mode the toast is dark.
- One colour key: GridStatusFooter, ColumnHeader and Dashboard all open `ColorKeyPopover`. The dashboard's due rows start right under the tabs at 1366×768.
- **Screenshots**, with the git-excluded harness. Write `e2e/ux-review/Q5.spec.ts` using `openSeededApp()`, `shotter('q5')`, `go()`, `setTheme()` and `sizeWindow()`. Run it with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q5.spec.ts --reporter=line` after `npm run build`. Shots, light and dark, at 1366×768:
  - grid, profile, tasks, contacts, settings (appearance with toggles) and backup, to compare against `ux-review-shots/after-phase1/` (same button radius everywhere, nothing else moved);
  - profile → More → "Move to Trash" confirmation;
  - list settings dialog at 1280×720 (footer visible without scrolling);
  - dashboard with the colour key popover open, and the grid footer popover open;
  - an Undo toast plus a success toast together: archive a row from the profile's More menu, then trigger an export through the harness's `mockSaveDialog` so `exportNotice` fires.
  - Also rerun `e2e/ux-review/after.spec.ts` with `AFTER_LABEL=after-q5` and look at every screen for anything that moved unexpectedly.
- `npm run test:e2e` smoke still passes, in particular `e2e/smoke-persist.spec.ts`. The e2e specs use role names, not classes, but the agent should grep `e2e/` for any `btn-` or `role="switch"` selectors before stage 0.

## Tests to add / update
- **Add:** `tests/renderer/designSystem.test.ts` (+ baseline); `tests/renderer/components/ui/*.test.tsx` (Button: classes, `type`, rest props, `busy`, IconButton label → aria-label + Tooltip; Dialog: as above; Toggle: role on track, aria-checked, row click, keyboard Space; RowMenu: portal, arrows, Escape returns focus, danger after separator, always-visible trigger); `ToastHost.test.tsx`. Add `Dialog`, `Toggle`, `RowMenu` and `EmptyState size="page"` to `tests/renderer/a11y/sharedComponents.a11y.test.tsx` (axe).
- **Update:**
  - `tests/renderer/components/shared/ConfirmDialog.test.tsx` and `EmptyState.test.tsx`;
  - `tests/renderer/components/grid/ColorKeyPopover.test.tsx`;
  - `GridStatusFooter.test.tsx:161–162` (same names; panel now portalled);
  - `tests/renderer/views/DashboardView.test.tsx:267–271` ("Got it" / `dashboard_color_guide_seen` go; assert the link opens the dialog "What the colors mean");
  - `ColumnHeader.test.tsx` and the ColumnSettingsDialog tests (ToggleRow markup);
  - the settings tests for AppearanceSection;
  - the dialog suites `tests/renderer/a11y/dialogRoles`, `dialogEscape`, `dialogEscapeNames`, `dialogFocusTrap` and `tests/renderer/components/shared/dialogRoles.test.tsx` (add `Dialog`; make sure the migrated dialogs keep their accessible names);
  - `reducedMotion.test.tsx`.
- **Source-scanning tests that need edits or path checks:**
  - `tests/renderer/a11y/clickTargets.test.ts`: `BIG_ENOUGH` (:40) only sees `<button>` tags. Also scan `<IconButton` / `<…Button size="compact"` for nothing (the component guarantees the size), and keep the file-specific reads of `SortableRow.tsx` (:67) and `ContactImportExport.tsx` (:82) passing after stages 5 and 9.
  - `tests/renderer/a11y/iconButtonsLabelled.test.tsx`: treat `<IconButton label=…>` as labelled.
  - `tests/renderer/a11y/focusRingWidth.test.ts`: the ui components must use `ring-3` / `outline 3px`.
  - `tests/renderer/a11y/contrastModesCss.test.ts`: switch markup.
  - `tests/renderer/textSize.test.ts`: token checks still pass.
  - `tests/renderer/confirmDialogLabels.test.ts`: excludes and reads `shared/ConfirmDialog.tsx` by path at :42 and :70. Keep the path. Extend the "verb, not OK" rule to `Dialog` footers' primary labels.
  - `tests/renderer/contrast.test.ts:26`: ALLOWED names `BulkActionBar.tsx`.
  - `tests/renderer/a11y/colorConsistency.test.tsx`: reads `globals.css`.
  - `tests/renderer/views/FocusModeDone.test.tsx:119`: `button.btn-primary` keeps working because the class is kept.
  - The tour target scan over `tourSteps.tsx`: `data-tour` must survive every migration.
  - `tests/renderer/vocabStaticText.test.tsx`, `sentenceCase.test.ts`, `punctuation.test.ts`: they read JSX text, which now sits as component children, so they still see it. Check none of them keys on `<button` specifically.

## Risks
- **Behaviour regressions in migrated dialogs.** Lost Escape handling, nested-dialog clicks closing the parent, initial focus, `data-testid` or `id` that a test or the tour uses, z-order with menus opened from a dialog. Mitigations:
  - `Dialog` copies every ConfirmDialog safety detail;
  - one folder per commit, with that folder's tests run before committing;
  - migrate *markup only*, never the dialog's logic;
  - stop and leave a dialog in the baseline if it has custom key handling (e.g. ImportWizard steps, CommandPalette).
- **Wave B plans cite pre-Q5 line numbers.** Their agents must grep, not trust line numbers. The README should say so.
- **Stage 0 changes every button's radius and colour token at once.** Small, but every screenshot changes. Check the after-phase1 comparison before going further.
- **Baseline JSON merge conflicts:** avoided by "fail only on increase" and tightening at merge time.
- **ToastHost's measured offset:** if the ResizeObserver isn't available (jsdom), fall back to a fixed 96 px offset whenever the undo toast is present.
- **CLAUDE.md:** the close-out adds a Decision Log row ("shared ui components + design ratchet test; colour key is a popover everywhere, dashboard key no longer auto-opens") and the component folder count (17 → 18 subdirectories).
