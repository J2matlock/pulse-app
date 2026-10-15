# Q8: Visual polish that reads as quality

**Idea 8 (ORCHESTRATION.md, Phase 2):**
- more whitespace and fewer card borders (group by spacing; **the grid keeps its chunky lines on purpose**);
- one accent colour for actions, with deadline colours only for status;
- designed empty states (icon + one sentence + one action);
- an intentional app icon, window title and About screen.

**Wave:** C (cross-cutting, after Wave B is merged).
- **Depends on Q5.** Steps 1–3 need Q5's `PrimaryButton` / `SecondaryButton` (with `tone="inverse"`), `Section`, `PageHeader`, `EmptyState size=…`, the accent and radius tokens, and the `designSystem` ratchet test. Step 3 also needs Q5 part 2's dialog migration to be finished for the dialogs whose empty states it touches. Only steps 4b–4d and the asset part of 4a can start before Q5 part 2 is merged.
- **Order in Wave C:** Q5 part 2 → **Q8** → Q6 (motion). Q8 and Q6 both touch the dashboard rows, the count tiles and the focus-mode items. Q8 changes their look, and Q6 animates the result. Q9's speed fixes (DataGrid, ProfileView data loading, memoisation) can run beside Q8 if the README keeps `ProfileView.tsx` with Q9: Q8 only needs the profile *section* components below, not ProfileView itself.
- **Starts from what Wave B left.** Q2 adopts `PageHeader` on screens, Q3 builds the shared deadline card, and Q7 rebuilds the first run. Grep before each change; the line numbers below are from main @ f4fc6be9.

**No migration, no network, no new stored data.**

## Goal
- A screen should look calm.
- The only blue on it is what you can do, and the only red, orange, yellow or green is how late something is.
- Sections are told apart by space and a heading, not by boxes inside boxes.
- An empty panel looks designed and tells you the one thing to do.
- Pulse looks like *Pulse* (its own mark) from the taskbar to the About page.

## Current behaviour (from `ux-review-shots/after-phase1/*.png` and the code)

### 1. Competing action colours
Inventory of solid or tinted coloured *actions* that aren't the accent:

| Where | file:line | What |
|-|-|-|
| Bulk bar | `components/grid/BulkActionBar.tsx:117` emerald "Unarchive" · `:150` amber "Archive…" · `:157` indigo "Change a value…" · `:164`, `:171` blue "Move to {list}…", "Letters and labels…" · `:183` violet "Set {priority}" · `:238` red "Move to Trash" | Six colours on one bar. Amber reads as "due this month", which is a status colour. |
| Focus mode "Done" | `views/focus-mode/ChecklistFocusItem.tsx:42` amber-700 · `FollowUpFocusItem.tsx:42` sky-700 · `TaskFocusItem.tsx:51` purple-700 · `ClientFocusItem.tsx:87` green-700 (+ `:76` green text "Done on…") · `views/FocusModeView.tsx:521` teal-700 | The same verb in five colours, depending on the kind of item |
| Dashboard rows | `views/dashboard/TaskRow.tsx:55` purple hover tint, `:64` purple check circle, the purple "task" pill · `FollowUpDashRow.tsx:41`, `:50` amber · `ChecklistDueRow.tsx:58`, `:67` teal · `DeadlineRow.tsx:143` green "Done", `:157` green "Done on…" | The kind is shown by colour, and amber/green collide with the status stripe colours |
| Profile deadline cards | `components/profile/DeadlinePanel.tsx:364`, `:473` green "Done" (the light-green chip in `12-profile.light.png`) | Done looks like an "on track" badge, not a button |
| Count tiles | `views/DashboardView.tsx:813` blue "Active {records}", `:843` purple "Tasks, checklist items and follow-ups"; the status tiles `:820` red, `:828` orange, `:835` yellow are correct | Purple and blue numbers carry no status |
| Small ones | `grid/SavedViewsDropdown.tsx:77` purple count badge · `grid/GroupingBar.tsx:147`, `:286` indigo · `grid/GridContextMenu.tsx:295` green, `:303` amber menu items · `profile/CaseLogEntry.tsx:414` green hover · `template-manager/ChecklistTemplateRow.tsx:52` green hover | — |
| "Soft" blue buttons | `.btn-compact-soft` (`styles/globals.css:249`): `TasksView.tsx:581` "Add a set of tasks…", `settings/SecurityCheckup.tsx:105`, `contact-req/ContactRequirementsDialog.tsx:94`, `settings/BackupSection.tsx:272` "Move to a new computer…" | They look like a selected tab, or a disabled primary (`13-tasks`, `19-settings-backup.dark`) |

**These are *data* colours and stay:**
- calendar layers (events, follow-ups, tasks);
- contact category chips (`14-contacts.light.png`);
- note-kind colours (`hooks/useActivityTypes.ts:21–22`);
- password strength bars (`shared/PasswordStrength.tsx:7–9`);
- the sample-data amber banner;
- alert callouts (red/amber boxes that announce a problem).

They're labels or status, not buttons. Q5's ratchet test allowlists these files for the `action-colour` rule.

### 2. Boxes inside boxes
- **Profile** (`12-profile.light.png`). Every section is a white card with a slate-200 border:
  - `ProfileHeader.tsx:365`, `DeadlinePanel.tsx:304`, `Checklist.tsx:591`, `CaseLog.tsx:599` and `:837`, `GridDataSummary.tsx:271`;
  - DeadlinePanel nests a *second* bordered card per deadline (`:332`), so the page is a card holding cards inside a column.
- **Dashboard** (`11-dashboard.light.png`):
  - five bordered tiles (`views/dashboard/SummaryCard.tsx:28` border + `:36` / `:45`);
  - a 2 px blue-bordered "Getting started" box (`GettingStartedCard.tsx:101`, `:117`);
  - a bordered tab panel (`DashboardView.tsx:511`);
  - a bordered "Recently archived" section (`:750`).
- **Reports:** 2 px card borders (`ReportsView.tsx:37`) and 2 px dashed empty boxes (`:113`, `:128`).
- **Settings:**
  - Backup: a 2 px bordered "Save a copy" box (`settings/BackupSection.tsx:277`) above a bordered blue info box (`:303`) above a bordered list (`:358`);
  - About: two bordered boxes (`AboutSection.tsx:168`, `:184`).
- **Contacts:** each card bordered and shadowed (`contacts/ContactCard.tsx:37`).
- **Templates:** the editor column is a bordered card (`TemplateManagerView.tsx:262`).
- **Overall:** 136 files combine `rounded-lg/xl` with `border-slate-200`. Dialogs, menus and popovers are among them and keep their border and shadow; this step is about **page-level** containers.

### 3. Uneven page frames
- Page gutters:
  - `px-6`: Tasks (`TasksView.tsx:542`), Trash (`TrashView.tsx:144`), Help (`HelpView.tsx:226`);
  - `px-4`: Contacts (`ContactsView.tsx:197`), Calendar (`CalendarView.tsx:288`), Letters (`LetterTemplateView.tsx:113`);
  - about `px-12`: Dashboard.
- Page titles (`<h1>`): `text-xl font-semibold` ×7, `text-xl font-bold` (TrashView:146), plus one each of `text-lg`, `text-base` and `text-2xl bold`.
- Q2 standardises the headers through Q5's `PageHeader`. Q8 finishes any screen Q2 didn't touch and sets the gutter.

### 4. Empty states
Hand-written paragraphs, each styled differently:
- `DashboardView.tsx:598` "Nothing here yet" (centred text + secondary button)
- `grid/GridLoadingState.tsx:54` "No columns yet"
- `ContactsView.tsx:368` "Select {a contact} to view details" (the right half of `14-contacts.light.png` is an icon and grey text)
- `ReportsView.tsx:113`, `:128` (dashed boxes)
- `profile/Checklist.tsx:624`, `profile/CaseLog.tsx:919`, `profile/RecordFiles.tsx:69`
- `contacts/ContactInteractionLog.tsx:309`, `contacts/CategoryManager.tsx:106`
- `forms/FormsDialog.tsx:64`
- `settings/AlertsSection.tsx:56`, `settings/DaysOffSection.tsx:103`, `settings/BackupSection.tsx:354`
- `grid/CellConditionalFormatPanel.tsx:182`, `calendar/DeadlineColumnsMenu.tsx:74`

Menus and pickers have one-line ones that stay text: `FilterBar.tsx:360`, `SavedViewsDropdown.tsx:144`, `DoneChecklistPicker.tsx:47`, `ColumnRulePicker.tsx:79`, `BatchDocumentsDialog.tsx:227`, `ProfileHeader.tsx:547`.

Phase 1 already rewrote the *words* (commit 1f5a739f, "empty panels say what they're for and how to start"). Q8 does the *design*.

### 5. Brand: icon, window, About
- **The real mark never appears inside the app.** `build/icon*.png` (a navy knot running into an orange pulse line) is used only for the OS. Instead:
  - Password setup uses a lucide `Shield` (`PasswordSetupView.tsx:151`, `:221`, `:245`, `01-setup.light.png`);
  - the lock screen uses `Shield` (`LockScreenView.tsx:183`);
  - the welcome screen uses a blue `ClipboardList` tile (`SetupView.tsx:268`, `03-onboarding-welcome.light.png`);
  - About has text only.
  - That's three different "logos" in the first minute.
- **The OS icon doesn't read at small sizes.** `build/icon.ico` holds 16/32/48/64/128/256 frames at **8 bits per pixel**. At 16 px the thin knot is a grey smudge on a light square. It's lost on a dark taskbar (checked by extracting the frames with ImageMagick).
- **Window:**
  - `src/main/index.ts:223` sets `title: PRODUCT_NAME`;
  - `:227` `backgroundColor: '#F8FAFC'` is fixed, so since P1 made the theme follow the computer, a dark-mode user gets a light flash on every launch;
  - `MainLayout.tsx:39–57,107` titles the window "{Page} – Pulse by BaringaSoft", and the list page is just "Clients", not the list's name.
- **About** (`settings/AboutSection.tsx:164–217`):
  - a bordered box with the name, "Offline-first {list} management" (`:170`, jargon for this audience) and a mono "v2.6.0";
  - a second bordered box of licence buttons;
  - the auto-update preference is a checkbox (`:30–40`).

## The change

### Step 1: One accent for actions (waits for Q5 Button)
- **Rule:**
  - the action you came for on a screen or card is `PrimaryButton` (accent);
  - everything else is `SecondaryButton` (neutral) or a link;
  - destructive actions are `DangerButton` (only in a confirmation or a danger menu item; elsewhere red *text*);
  - colour never encodes a *kind* of thing on a button.
- **Bulk bar:**
  - Stays a dark floating bar.
  - Every action becomes `SecondaryButton tone="inverse"` (white/10 fill, white text): Unarchive, Archive…, Change a value…, Move to…, Letters and labels…, Set {priority}.
  - "Move to Trash" becomes inverse with red-300 text and a trash icon.
  - Order: most common first, Trash last after a divider.
  - Nothing on it is primary; the selection itself is the context.
- **Focus mode:** every "Done" is `PrimaryButton size="compact" icon={<Check/>}`, the card's one action. "Done on…" is a link-style secondary. `FocusModeView.tsx:406`, `:421` become `PrimaryButton`.
- **Dashboard rows:**
  - The check circle is neutral (`border-slate-400`, accent on hover and focus).
  - Kind pills ("task", "follow-up", "checklist") are neutral slate pills with the kind's icon. Amber/teal/purple go, because amber means "due this month".
  - `DeadlineRow` "Done" becomes `SecondaryButton size="compact"` with a check icon; "Done on…" becomes a link.
  - The row's status stripe stays: it's the status.
- **Profile deadline Done:** `SecondaryButton` with a check icon, so the page's primary stays "Case note". If Q3's shared deadline card replaced `DeadlinePanel`'s buttons, apply this in that card instead. If Q3 already used Q5's buttons, nothing to do.
- **Count tiles:** "Active {records}" and the tasks tile use a neutral number (`text-slate-800 dark:text-slate-100`). Overdue, due-in-7 and due-in-30 keep red, orange and yellow, and drop to slate when their count is 0 (the overdue tile already does).
- **Small ones:**
  - SavedViews badge → slate;
  - GroupingBar indigo → accent text for links, neutral for chips;
  - GridContextMenu green/amber items → neutral text with their icon;
  - CaseLogEntry and ChecklistTemplateRow hovers → `hover:bg-slate-100`.
- **`.btn-compact-soft`:** its four users → `SecondaryButton size="compact"`. Delete the class from `globals.css:249–252`.
- **Result:** the `action-colour` rule's baseline reaches **0** outside the data-colour allowlist. Tighten the baseline in this commit.

### Step 2: Space instead of boxes (waits for Q5 Section; after Q2/Q3)
- **Rule:**
  - page → sections (an 18 px heading, a 24 px gap, a 32 px gap between sections, **no border**) → items;
  - an item gets a container only when it's a *thing you can click or that has a status*: report cards, contact cards, deadline cards with their status stripe;
  - even then, 1 px slate-200 (dark slate-700) or a tinted background, never both, never 2 px;
  - dialogs, menus, popovers, alerts and the grid are unchanged.
- **Profile:**
  - `ProfileHeader`, `DeadlinePanel`, `Checklist`, `CaseLog` and `GridDataSummary` sections become `Section`, on the page background.
  - Deadline items keep their left status stripe on a light tint, with no outer section card (removes the card-in-card at `DeadlinePanel.tsx:304` + `:332`).
  - The left checklist column (`Checklist.tsx:591`) becomes a plain column with a heading.
  - Also fix the after-phase1 leftover (1): the checklist's "Edit" / "Delete" labels wrap each item to three lines in the ~300 px column. Show the words beside the icons only when the *column* is wide enough, using a container query (`@container` on the checklist column; Tailwind 4 has `@container` / `@md:` variants built in), not the viewport.
- **Dashboard:**
  - Count tiles: no border, `bg-slate-50 dark:bg-slate-800/60`, the hover tint kept (they're buttons).
  - Getting started: tint only, no 2 px border. If Q2 removed or reshaped it, skip.
  - "Recently archived" becomes `Section`.
  - The tabbed due list keeps its one container (it's the work list).
- **Reports:** cards 1 px with hover shadow; the dashed empty boxes become `EmptyState` (step 3).
- **Settings → Backup:**
  - "Save a copy" box → `Section` with the button on the right;
  - the blue info box → plain secondary text under the heading;
  - the auto-backup list keeps its single border (it's a list).
- **Contacts:** cards keep a 1 px border, lose the resting shadow (shadow on hover only), and get `gap-3` between cards.
- **Templates:** the editor column (`TemplateManagerView.tsx:262`) becomes `Section`.
- **Page frame:**
  - every top-level view gets the same gutter (`px-6`, `pt-6`) and `PageHeader`, wherever Q2 didn't already apply it;
  - one title style (`text-2xl font-semibold`, from `PageHeader`);
  - hero screens (setup, lock, welcome) keep `text-3xl`.
- **Keep:** the grid's `--border-grid` lines, cell borders, header and frozen-column divider.
- **Spacing in owned files:** off-system steps (`1.5`, `2.5`, `5`, …) move to the five steps. The `spacing` and `radius` baselines for the files Q8 touches go to 0.

### Step 3: Designed empty states (waits for Q5 EmptyState)
- Each place in the §4 list becomes `EmptyState`:
  - `size="page"` for a whole screen or main panel: Dashboard with no records, Reports with no reports, Contacts' right pane, a grid with no columns;
  - `size="panel"` inside a page section: profile checklist, notes, files; contact history; categories; Settings lists; forms; colour rules; the deadline-columns menu.
- Each has:
  - **an icon** from the screen's own sidebar icon, so it's recognisable;
  - **one sentence**, keeping Phase 1's words and shortening any two-sentence text to one;
  - **one action** that fills it.
- Examples:
  - Dashboard: "Your dashboard fills up as you add {records} with dates." → "See an example with sample data"
  - Contacts right pane: no action, since the list on the left *is* the action, and "Pick {a contact} on the left to see their details" + icon
  - Reports: "Ask a question about your work and Pulse will count it." → "New report"
  - Checklist: "Things to do for this {record}." → "Add an item" (focuses the input)
  - Files: the drop zone keeps its dashed outline, because it's a target, but uses the EmptyState layout inside.
- Menus and pickers keep one line of text with the same `text-slate-600` style (`EmptyState size="inline"`).
- Search-with-no-results gets its own text, never the empty-state action (`DashboardView.tsx:592`, "Nothing matches '…'" stays text only).
- All words go through the vocabulary layer (`useVocab().t` / `f`). The EmptyState props `title` / `description` / `label` are covered by the vocab ESLint rule.

### Step 4: Pulse looks like Pulse
- **4a. In-app mark.**
  - Add `src/renderer/assets/pulse-mark.png`: 128 px, made from `build/icon-512.png` with `magick` (available on this machine), so it stays small; the 256 px source is 88 KB.
  - Declare `declare module '*.png' { const src: string; export default src }` in `src/renderer/types/global.d.ts`. The renderer has no `vite/client` types.
  - New `components/ui/PulseMark.tsx` (`size: 32 | 48 | 64`, decorative `alt=""` unless `label` is given). It renders the PNG on a white rounded tile with a 1 px slate-200 ring, in *both* themes: the navy knot has too little contrast on slate-900, and a tile is how an app icon looks anyway.
  - The CSP already allows `img-src 'self' data:` (`index.html:7`, `src/main/index.ts:372`).
  - Replace `Shield` / `ClipboardList` at `PasswordSetupView.tsx:151`, `:221`, `:245`, `LockScreenView.tsx:183`, `SetupView.tsx:268` (or wherever Q7's new first run puts its welcome), and About.
- **4b. OS icon (owner decision before shipping).**
  - Produce a candidate set in `ux-review-shots/q8-icons/`: the mark on a rounded-square tile, full 32-bit colour at 16, 24, 32, 48, 64, 128, 256 and 512.
  - At ≤32 px use a simplified glyph: the pulse line alone, thicker, with the orange peak, because the knot can't be drawn at 16 px.
  - Show each size on light and dark backgrounds.
  - Replace `build/icon.png`, `icon-256.png`, `icon-512.png` and `icon.ico` **only after the owner picks one**. Until then, step 4b ends with the candidates and a note in the final report.
  - No change to `package.json` build config; the paths stay.
- **4c. Window.**
  - `src/main/index.ts:227`: `backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F172A' : '#F8FAFC'`. Import `nativeTheme` from electron. The stored theme lives in the locked database at window creation, so the computer's setting is the best guess, and it matches the default.
  - `MainLayout.tsx:39–57`: on `/grid`, title the window with the open list's name ("Social Worker Caseload – Pulse by BaringaSoft"). Record pages stay generic ("Client – …"): **a person's name must never be in the window title**, which shows in taskbars, Alt+Tab and screen sharing. Write that reason in the comment.
  - The lock screen resets to `PRODUCT_NAME` (already, `:109`).
- **4d. About** (`AboutSection.tsx`):
  - `PulseMark size={64}`, the product name (`text-2xl`), "Version 2.6.0" in words (not mono), and "What's new" as `SecondaryButton`.
  - One plain line instead of "Offline-first {list} management": "Keeps track of your {records} and what's due for each, on this computer only."
  - Then `Section` "Your data", with the existing two sentences (`:180–181`).
  - Then `Section` "Free and open source", with the GPL sentence and its three `SecondaryButton`s (no box).
  - Then `Section` "Updates": `CheckForUpdatesButton`, with `AutoUpdateCheckToggle` as a Q5 `ToggleRow` (unless Q1c already converted it).
  - Last, a quiet footer line, "© 2026 BaringaSoft · GPL-3.0".

### Step 5: Dark-mode and fit pass
- Compare every changed screen in dark mode against light.
- Neutral fills that replace borders need enough contrast to still separate in dark: `slate-800/60` on `slate-900` is visible; check tiles and deadline tints.
- Check 1280×720 and 1366×768.
- Fix anything the removal of borders made ambiguous, such as where one section ends.

## Files owned
**Step 1:**
- `components/grid/BulkActionBar.tsx`, `SavedViewsDropdown.tsx` (badge only), `GroupingBar.tsx` (colours only), `GridContextMenu.tsx` (:295, :303 only)
- `views/focus-mode/ChecklistFocusItem.tsx`, `FollowUpFocusItem.tsx`, `TaskFocusItem.tsx`, `ClientFocusItem.tsx`; `views/FocusModeView.tsx` (:406, :421, :521 only)
- `views/dashboard/TaskRow.tsx`, `FollowUpDashRow.tsx`, `ChecklistDueRow.tsx`, `DeadlineRow.tsx`, `SummaryCard.tsx`
- `views/DashboardView.tsx` (tile `colorClass` :813–843, sections :511, :750, empty :590–605 only)
- `components/profile/DeadlinePanel.tsx` (or Q3's deadline card file, buttons only)
- `components/profile/CaseLogEntry.tsx` (:414 only), `views/template-manager/ChecklistTemplateRow.tsx` (:52 only)
- `styles/globals.css` (delete `.btn-compact-soft`), plus its 4 users: `TasksView.tsx` (:581 only), `settings/SecurityCheckup.tsx`, `contact-req/ContactRequirementsDialog.tsx`, `settings/BackupSection.tsx`

**Step 2:**
- `components/profile/ProfileHeader.tsx`, `DeadlinePanel.tsx`, `Checklist.tsx`, `ChecklistItem.tsx` (container query), `CaseLog.tsx`, `GridDataSummary.tsx` (outer containers only)
- `views/dashboard/GettingStartedCard.tsx`
- `views/ReportsView.tsx`, `contacts/ContactCard.tsx`, `settings/BackupSection.tsx`, `views/TemplateManagerView.tsx` (:262)
- Page wrappers of `TasksView.tsx`, `ContactsView.tsx`, `CalendarView.tsx`, `TrashView.tsx`, `LetterTemplateView.tsx`, `SnippetsView.tsx`, `HelpView.tsx`: header and gutter lines only, where Q2 didn't

**Step 3:** the §4 files, empty-state markup only:
- `grid/GridLoadingState.tsx`, `grid/CellConditionalFormatPanel.tsx`
- `profile/RecordFiles.tsx`
- `contacts/ContactInteractionLog.tsx`, `contacts/CategoryManager.tsx`
- `forms/FormsDialog.tsx`
- `settings/AlertsSection.tsx`, `settings/DaysOffSection.tsx`
- `calendar/DeadlineColumnsMenu.tsx`
- plus the step 1–2 files already listed

**Step 4:**
- new `src/renderer/components/ui/PulseMark.tsx` and `src/renderer/assets/pulse-mark.png`
- `src/renderer/types/global.d.ts` (one declaration)
- `views/PasswordSetupView.tsx`, `views/LockScreenView.tsx`, `views/SetupView.tsx` (logo lines only)
- `components/settings/AboutSection.tsx`
- `components/layout/MainLayout.tsx` (`viewName` / title effect only)
- `src/main/index.ts` (:227 + import only)
- `build/icon.png`, `icon-256.png`, `icon-512.png`, `icon.ico` (only after owner approval)

**Tests:** the unit tests listed under "Tests to add / update", plus `e2e/ux-review/Q8.spec.ts` (git-excluded).

**Shared files, and why:**
- `styles/globals.css`: one deletion.
- `tests/renderer/design-system-baseline.json`: tightened once at the end. Q8 only lowers counts.
- `src/main/index.ts`: one line, plus an import.
- **Coordinate with Q6:** `views/dashboard/*Row.tsx`, `SummaryCard.tsx`, `views/focus-mode/*` and `DashboardView.tsx` are also Q6 targets. Run Q8 first (see Wave), or split by lines (Q8 = className and markup, Q6 = motion wrappers in the list containers) and merge Q8 first.

## Commits, in order
1. **Accent only (step 1).** One commit for the dashboard and focus mode, one for the bulk bar and small ones, one for `.btn-compact-soft`. Tighten the baseline's `action-colour`.
2. **Profile sections (step 2)**, including the checklist container query.
3. **Dashboard, Reports, Contacts, Settings → Backup, Templates (step 2).**
4. **Page frames** (gutter and `PageHeader` on the screens Q2 didn't reach).
5. **Empty states (step 3)**, one commit for page-size states and one for panel-size states.
6. **PulseMark and in-app logos (4a)** and **About (4d)**.
7. **Window background and title (4c).**
8. **Icon candidates (4b):** files in `ux-review-shots/q8-icons/`, not committed. A separate commit swaps `build/` icons once the owner approves; leave that commit out if there's no answer.
9. **Dark-mode / fit fixes (step 5)**, then a baseline tighten, `npm run test:tz`, `npm run build` and `npm run gate`.

Before every commit: `npm run typecheck`, `npx eslint src --quiet`, targeted `npm test -- …`, then `npm run gate`. No new `eslint-disable`, `@ts-…` or `as any`. Messages end with the Co-Authored-By / Claude-Session lines in effect. Don't push.

## Acceptance checks
- `npm run gate` green. `designSystem` baseline:
  - `action-colour` = 0 outside the allowlist;
  - `radius` and `spacing` = 0 in every file Q8 owns;
  - total lower than before Q8. Report the numbers.
- **One accent:** on every main screen in light and dark, the only filled blue controls are the screen's primary action and selected states; no filled purple, teal, indigo, violet, emerald, sky or amber button anywhere. Check visually in the shots and by the rule count.
- **Grid untouched:** grid shots match after-phase1 apart from button radius (Q5) and the bulk bar.
- **Empty states:** every §4 place shows icon + one sentence + at most one action. Fresh-install shots show them.
- **Brand:**
  - the same mark on password setup, lock, welcome and About;
  - no light flash when launching with the computer in dark mode (Playwright: `electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })` before the window shows isn't possible after launch, so check `BrowserWindow.getBackgroundColor()` equals `#0F172A` when `nativeTheme.shouldUseDarkColors`);
  - the window title on the list page names the list, and on a record page doesn't name the person.
- **Screenshots** with the harness. Write `e2e/ux-review/Q8.spec.ts`, then run `npm run build` and `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q8.spec.ts --reporter=line`. Use `shotter('q8')`. Shots, light and dark:
  - Seeded (`openSeededApp()` + `go()`): grid; grid with 3 rows selected (bulk bar); dashboard; profile (`#/profile/${firstRowId}`) at 1366×768 and 1280×720; tasks; contacts; calendar; reports; settings backup and about; focus mode open from the sidebar.
  - Fresh (`openFreshInstall()`): the password-setup screen; then setup → blank list; then dashboard, contacts, reports, tasks and trash empty states.
  - Lock: click Lock in the sidebar, then the lock screen.
  - Compare side by side with `ux-review-shots/after-phase1/*.png`, and rerun `e2e/ux-review/after.spec.ts` with `AFTER_LABEL=after-q8`.

## Tests to add / update
- **Add:**
  - `tests/renderer/components/ui/PulseMark.test.tsx` (decorative by default, labelled when asked);
  - a `MainLayout` title test: list name on `/grid`, no record name on `/profile/:id`;
  - a main-process test that `createWindow` picks the dark background when `nativeTheme.shouldUseDarkColors` (mock electron, like the existing `src/main/index.ts` tests do; find them with `grep -rl "BrowserWindow" tests`);
  - EmptyState rendering tests for the dashboard, contacts and reports empty cases (vocab: call `setWords()`).
- **Update:**
  - `tests/renderer/views/FocusModeDone.test.tsx` (`button.btn-primary` at :119; still true since `PrimaryButton` renders that class);
  - dashboard row tests (`tests/renderer/dashboardDueFirst.test.tsx`, `DeadlineRowExtend.test.tsx`, `DeadlineRowMeter.test.tsx`, `bulkMarkDone.test.ts` if they query colour classes);
  - `DeadlinePanelDone.test.tsx`, `DeadlinePanelSteps.test.tsx`;
  - `tests/renderer/views/DashboardView.test.tsx`, `dashboardNumbers.test.tsx` (tile classes);
  - `tests/renderer/components/grid/*BulkAction*` tests;
  - Settings About / Backup tests;
  - `tests/renderer/a11y/views.a11y.test.tsx`, `profile.a11y.test.tsx`, `settings.a11y.test.tsx` (axe colour contrast on the new neutral pills and the inverse bulk-bar buttons).
- **Source-scanning tests to check:**
  - `tests/renderer/contrast.test.ts:26`: `ALLOWED` lists `/components/grid/BulkActionBar.tsx`. Remove that entry if the bar no longer needs it.
  - `tests/renderer/a11y/urgencyContrast.test.ts`, `colorConsistency.test.tsx`: status colours must stay identical.
  - `tests/renderer/a11y/clickTargets.test.ts`: the dashboard check circle is `w-5 h-5` with `hit-44`; keep `hit-44`.
  - `tests/renderer/a11y/hoverRevealFocus.test.ts`.
  - The tour target scan (`tourSteps.tsx` `data-tour` targets on dashboard tiles, the profile and the bulk bar must survive).
  - `tests/renderer/vocabStaticText.test.tsx` and `tests/vocab-leak-main.test.ts` (window title words).
  - `tests/renderer/sentenceCase.test.ts`, `punctuation.test.ts` for new copy.

## Risks
- **Removing borders can make sections run together**, especially in dark mode and on low-contrast laptop screens, which this audience has. Spacing and headings must carry it; check every shot at 1366×768 in both themes, and keep a hairline divider where a heading alone isn't enough.
- **Kind no longer shown by colour on dashboard rows.** The pill text and icon must carry it. Screen readers already get the text.
- **Conflicts with Q6** on dashboard and focus-mode rows (see Wave). Merge Q8 first.
- **The OS icon is the owner's brand.** Never replace `build/` icons without explicit approval. The in-app mark uses the existing artwork unchanged.
- **Window title:** a list name can itself be sensitive in some workplaces. If the owner objects, keep the generic "{Records} – …". Mention it in the report.
- **CLAUDE.md:** the close-out adds Decision Log rows: "one accent colour for actions; kind/status colours only on labels and stripes", "window title shows the list name, never a record's name", and the icon change if approved.
