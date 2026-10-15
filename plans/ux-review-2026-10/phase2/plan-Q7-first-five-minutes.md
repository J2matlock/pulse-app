# Q7 — The first five minutes feel finished

**Idea 7 (ORCHESTRATION.md, Phase 2):** replace the 7-step first-run tour with two things.

- **(a)** A single "here's your caseload" moment: the sample list with one overdue row highlighted and one hint: "Red means overdue. Click Done when you've seen them."
- **(b)** Small one-time hints shown the first time the user reaches each screen. They're stored in settings, never repeat, and "Retake the tour" stays in Help.

**Wave B.** No migrations: the new settings key uses the `onboarding_` prefix that `src/main/ipc/ipc-settings.ts:42/63` already allows, so nothing changes in the main process. No network. Vocabulary layer everywhere. 15 px / 44 px / 3 px. Honour reduced motion: both `prefers-reduced-motion` and the app's own `html.reduce-motion` class, set in `hooks/useThemeEffect.ts:65`.

---

## Goal

A new user finishes setup and lands on their list. One thing is lit up: a red, overdue row, with one sentence and a real **Done** button that does the job and shows the result. After that, each screen explains one thing, once, in a small card that doesn't block anything. The full tour is still in Help for anyone who wants it. Existing users see none of this.

---

## Current behaviour (after Phase 1)

- The setup "done" step asks "Would you like a quick tour of the main features?" with **Show me around** (primary) and **No thanks, I'll explore on my own** (`src/renderer/views/SetupView.tsx:414-436`).
- **Show me around** calls `onStartTour` (`SetupView.tsx:40, 118, 429`). `App.tsx:180-183` then runs `showTourAfterOnboarding()` (which is just `finishSetup`, `hooks/useAuthGating.ts:90-105`) and `setShowTour(true)`.
- `showTour` is `boolean | 'full'` (`hooks/useModalManager.ts:7, 22`). `true` plays the short tour, `'full'` every step (Help, `App.tsx:299`).
- `TourOverlay` (`components/shared/TourOverlay.tsx:45-56`) filters `STEPS` by `FIRST_RUN_TOUR` unless `full`. `FIRST_RUN_TOUR = ['sidebar', 'add-client', 'deadline-colors', 'open-profile', 'dashboard', 'calendar', 'help']` (`components/shared/tourSteps.tsx:51`). It's a blocking spotlight dialog: "Step n of 7", Next/Back/Skip, focus trap, Escape skips (`TourOverlay.tsx:131-305`).
- `MorningBriefing` is suppressed while a tour runs (`App.tsx:315`).
- **The grid already has a one-time hint of its own:** a blue tip bar, "Tip: click a column name to sort. The ⋯ next to it has deadline rules, hiding and more. The person icon opens {a record}'s page." (`components/grid/GridNotices.tsx:10-27`, `text-sm`). It's dismissed through **localStorage** `pulse-grid-hints-dismissed` (`components/grid/DataGrid.tsx:254-261, 620`), so it's per browser profile, not per workspace.
- **Other one-time things stored in settings:** `dashboard_color_guide_seen` (Q2 removes its auto-open), `feature_offers_dismissed` (`components/shared/FeatureOffer.tsx:11`), and `onboarding_getting_started_dismissed` (`views/dashboard/GettingStartedCard.tsx:62`).
- **Help:** "Retake the full tour" asks first: "Start the {n}-step tour?" (`views/HelpView.tsx:251-275`). "Show me" buttons play `MiniTour` with steps from `STEPS` (`App.tsx:324-333`).
- **Tests and e2e that depend on the short tour:**
  - `tests/renderer/components/shared/TourOverlay.test.tsx:44-48`: the first-run tour is ≤ 8 steps and ends at Help.
  - `TourOverlay.test.tsx:107-109`: no first-run step promises a page.
  - `TourOverlay.test.tsx:31-42`: the target scan (every `STEPS` target's `data-tour` exists in `src/renderer`).
  - `tests/renderer/views/SetupView.test.tsx:250`: the "Show me around" order.
  - `tests/renderer/components/grid/DataGrid.test.tsx:973-976`: the tip bar.
  - `e2e/helpers.ts:150-155, 176`: `finishSetup` clicks "explore on my own", used by `skipOnboarding` and `launchToMainUI` in five specs.
  - `e2e/workspace-words.spec.ts:119`.
  - The git-excluded `e2e/ux-review/harness.ts:174-189` (`openSeededApp` goes through `skipOnboarding`).
- **Sample data has overdue rows.** The human-services starter's sample records use negative `daysFromToday` on rule columns (e.g. "Auth Expiration -14", "Annual Assessment -3", in `src/shared/starters/human-services.json`). Sample rows are tracked in `sample_rows` (`src/main/sample-marks.ts`) and exposed as `useGridStore().sampleRows`. Grid cells carry `data-row-id` / `data-col-id` (`components/grid/SortableRow.tsx:437-438`).

---

## The change

### A. One settings key for "seen"

Key `onboarding_hints_seen` (allowed by the `onboarding_` prefix). Its value:

| Stored value | Meaning |
|-|-|
| absent (`null`) | Every hint counts as seen. This is every install from before this change, so **existing users never see hints or the first look**. |
| `"all"` | Every hint seen (e2e helpers write this). |
| JSON array of ids, e.g. `["caseload","dashboard"]` | Those are seen. |

It's written as `"[]"` **only** at the end of a true first run: `finishSetup` in `useAuthGating.ts:90` when `setupStart === 'welcome'`. Setup shown again after the last list is deleted (`setup:open`, `useAuthGating.ts:41`) has a different `setupStart`, so an experienced user isn't re-taught. It's written only if the key is still absent (`SETTINGS_GET` first).

New `src/renderer/stores/hintStore.ts` (zustand), with `seen: Set<string> | 'all' | null` (null = not loaded):

- `load()` runs on unlock, next to the workspace and activity-type loads (`useAuthGating.ts:64-65`), and after `finishSetup`.
- `markSeen(id)` updates the store first, then writes the array back. If the write fails, the hint is still treated as seen this session.
- `reset()` runs on lock (the `isLocked` branch, `useAuthGating.ts:81-83`). A restored backup then reloads with the database it came from.

**A hint is marked seen the moment it's shown**, not when it's dismissed. That makes "never repeat" hold even if the user navigates away or quits.

### B. The first look ("here's your caseload")

New `src/renderer/components/onboarding/FirstLook.tsx` (the folder is new).

**Trigger.** The setup done step gets a single primary button, **"Open my {list}"** (vocab `t('list')`). It replaces "Show me around" and "No thanks…" (`SetupView.tsx:428-436`). The update-check choice stays below (`:437-440`, UX-A-18). The `onStartTour` prop is removed. In `App.tsx`, `onComplete` becomes "`completeOnboarding()`, then, when `setupStart === 'welcome'`, `setFirstLook(true)`". `onCancel` ("Not now", `SetupView.tsx:311-312`) stays a plain finish with no first look.

**What it waits for**, giving up quietly after about 4 s:

- `useGridStore` has `loadedGridId === activeGridId` and rows;
- `useAlertStore().isLoaded`;
- a matching cell in the DOM.

The 100 / 400 / 800 ms re-measure pattern from `TourOverlay.tsx:85-100` works here.

**Which row:**

1. Walk the rendered cells `[data-row-id][data-col-id]` in document order (top-left first, so normally no scrolling).
2. For each cell whose column has a rule (`ruleOfColumn`, `utils/filterMatch.ts:50`), evaluate it with `evaluateRuleForRow` (`utils/deadlineCalc.ts:57`). Late means `daysUntil < 0` and the state is neither `done` nor `paused`, exactly as `dueStatusIs` (`filterMatch.ts:56-63`) decides it.
3. Prefer a deadline whose Done simply starts the next cycle, `startsNextCycle(interval, kind)` (`views/dashboard/completeDeadline.ts:57`). Meter, one-off and quota deadlines need a dialog, so they rank lower. Prefer sample rows (`sampleRows[rowId] !== undefined`) when the list has both.
4. If nothing is late in the DOM, use the store's first late row: call `cell.scrollIntoView({ block: 'center', inline: 'nearest' })` if the cell is rendered, otherwise skip to the fallback. **No DataGrid change** is needed to reveal rows.
5. **Fallback** (blank list, imported list with nothing late, or a starter whose sample data isn't late): no first look at all. Mark `caseload` seen and let the grid hint teach on a later visit.

**What it shows:**

- A spotlight cut-out around the whole row element (the `[aria-rowindex]` ancestor of the cell), clipped to the grid's visible box like `columnRect` (`TourOverlay.tsx:37-43`). A stronger 3 px ring sits on the overdue cell. The ring pulses (`tour-pulse`, as in `TourOverlay.tsx:200-205`), and **not at all** under reduced motion.
- A card placed with `computeTooltipPosition` (`components/shared/tourPosition.ts`) beside the row, never over the lit cell. It's a `role="dialog" aria-modal="true"`, labelled, with focus trapped (`useFocusTrap`) and focus on **Done**.
  - Title: "Here's your {list}"
  - Line 1: "{Name}'s {Column} is red." (name from the row's display name; column from the store)
  - Line 2, the owner's sentence verbatim: "Red means overdue. Click Done when you've seen them."
  - Buttons: **Done** (primary) and **Close** (secondary). Escape = Close.
  - With no Done-able deadline (step 3 found only meter, one-off or quota), line 2 is "Red means overdue." and the only button is **Got it**.
- **Done** calls `completeDeadlines([item], { onUndone })` (`completeDeadline.ts:116`) with the same `DeadlineToComplete` fields the dashboard builds (`DashboardView.tsx:445`). That gives the normal undo entry and toast. It then emits `deadline:changed` and closes. The cell recolours in place: the visible "result" is the teaching.
- Opening the first look marks `caseload` seen. `MorningBriefing` is suppressed while it's open: add `firstLook` to the `suppressed` expression, `App.tsx:315`.

**After Q3 merges:** Q3 adds the shared deadline card to grid cells. Then a follow-up line may point at the cell's own Done ("…or click the date and choose Done"). That isn't part of this plan; the card's own Done works without Q3.

### C. One-time hints, one per screen

New, all in `src/renderer/components/onboarding/`:

- `screenHints.ts`: pure data, no JSX, so tests and e2e can import it. It holds `HINT_IDS` (`as const`) and `HINTS: Record<HintId, { route: RegExp; target?: string; text: string; when?: () => boolean }>`.
- `ScreenHint.tsx`: the host. It's mounted once in `App.tsx`'s overlay block (`App.tsx:311-334`, inside `HashRouter`, so `useLocation` works). **Views are not edited.**

Host behaviour:

- On each route change, find the hint whose `route` matches `location.pathname` and that isn't seen. Wait 800 ms for the screen to settle, then show it if all of these hold:
  - no tour, mini-tour or first look is running (props from `useModalManager`);
  - focus mode is off;
  - no `[aria-modal="true"]` element is in the DOM (this covers the morning briefing, What's New and every dialog);
  - the target exists, when one is given.
- If the target never appears, don't show it and don't mark it. It gets another chance on the next visit.
- **At most one hint per screen visit.** None on the visit where the first look ran.
- **Card:** small, white (slate-800 in dark), shadow, `max-width: 360px`, `text-base`, a single **Got it** button (44 px). It's anchored beside `target` with `computeTooltipPosition`. With no target, it sits fixed bottom-right above the status bar.
- **No backdrop, no focus trap, no focus stealing.** The container is `role="status"`, so the text is announced politely.
- Escape closes it when focus is inside it. Clicking the target also closes it.
- While it's visible, a 1 s interval re-checks the "nothing modal open" rule and hides the card if a dialog opens.
- It hides on route change.

Hint list. These are *how-to* sentences, so they don't repeat Q2's *what-it's-for* purpose lines; both plans' reviewers check the pair.

| Id | Route | Target (existing `data-tour`) | Text |
|-|-|-|-|
| `grid` | `/grid` | `[data-tour="profile-icon"]` (`SortableRow.tsx:217`), only when rows exist | "This icon opens {a record}'s page: notes, deadlines and files together. Click a column name to sort." |
| `profile` | `/profile/` | `[data-tour="case-log"]` (`ProfileView.tsx:557`) | "Write what happened in the note box. Pick the kind first, like a visit or a call." |
| `dashboard` | `/dashboard` | `[data-tour="dashboard-tabs"]` (`DashboardView.tsx:512`) | "The most urgent is at the top. \"What do the colors mean?\" explains the stripes." |
| `calendar` | `/calendar` | none (bottom-right) | "Click a day to see everything due that day, or to add an appointment." |
| `tasks` | `/tasks` | `[data-tour="tasks-area"]` (`TasksView.tsx:542`) | "Tick the box when a task is done. Repeating tasks come back on their next date." |
| `contacts` | `/contacts` | `[data-tour="add-provider"]` (`ContactsView.tsx:234`) | "After you add {a contact}, link them to {a record} from that {record}'s page." |
| `settings` | `/settings` | `[data-tour="settings-backup-tab"]` | "Backups and your password are under Backup and Security. Changes save as you go." |
| `help` | `/help` | none | "Many answers have a Show me button that points at the thing on screen." |

The text goes through `useVocab(null).f` (tokens such as `{a record}`, `{contact}`). Quoted labels ("What do the colors mean?", "Show me", "Backup", "Security") must exist: add `components/onboarding/screenHints.ts` to `HELP_FILES` in `tests/renderer/help/faqLabelsExist.test.ts:53`.

The `caseload` id (the first look) lives in the same `HINT_IDS` list.

**The grid tip bar goes:** it's replaced by the `grid` hint. Delete `GridHintBanner` (`GridNotices.tsx:10-27`) and its state and render in `DataGrid.tsx:254-261, 620`. The localStorage key is simply no longer read.

### D. The tour stays only as Help's full tour

- `tourSteps.tsx`: delete `FIRST_RUN_TOUR` (`:50-51`). `STEPS`, `tourSteps()` and `ruleColumnTarget()` stay. The `deadline-colors` step stays part of the full tour.
- `TourOverlay.tsx`: drop the `full` prop and the `FIRST_RUN_TOUR` filter (`:27-31, 56`). It always plays `tourSteps(STEPS)`. Remove `FIRST_RUN_TOUR` from the re-export (`:22, 25`).
- `useModalManager.ts`: `showTour` becomes `boolean`. Add `firstLook` / `setFirstLook`.
- `App.tsx:299`: `onStartTour={() => setShowTour(true)}`. Help's button label becomes "Take the tour" ("Retake the full tour" is wrong for someone who never took it). **Q2 makes that rename**, because Q2 owns the HelpView header hunk. Q7 doesn't edit `HelpView.tsx`.
- `useAuthGating.ts`: remove `showTourAfterOnboarding` (`:24, 105, 134`).

---

## Files owned

New:

- `src/renderer/components/onboarding/FirstLook.tsx`
- `src/renderer/components/onboarding/ScreenHint.tsx`
- `src/renderer/components/onboarding/screenHints.ts`
- `src/renderer/stores/hintStore.ts`
- their tests

Edited:

| File | Hunk | Shared with |
|-|-|-|
| `src/renderer/components/shared/tourSteps.tsx` | `:50-51` | — |
| `src/renderer/components/shared/TourOverlay.tsx` | `:22-31, 56` | — |
| `src/renderer/hooks/useModalManager.ts` | whole | — |
| `src/renderer/hooks/useAuthGating.ts` | `:19-26, 61-85, 90-105, 130-136` | — |
| `src/renderer/App.tsx` | imports `:32-33`; SetupView props `:176-184`; HelpView prop `:299`; overlay block `:311-334` | Q4 if it touches `UndoToast` (`:317`) only in its own file; nothing else expected |
| `src/renderer/views/SetupView.tsx` | Props `:36-41, 118`; done step `:414-436` only | **Q1a** (import that just works), which edits the `sheet-*` steps of the same file |
| `src/renderer/components/grid/DataGrid.tsx` | delete `:254-261` and `:620` | **Q3**, **Q1a** (deletions only, two hunks) |
| `src/renderer/components/grid/GridNotices.tsx` | delete `GridHintBanner` `:10-27` | — |
| `e2e/helpers.ts` | `finishSetup` `:150-155`, comment `:176` | — |
| `e2e/workspace-words.spec.ts` | `:119` | — |

Read only (import, don't edit):

- `views/dashboard/completeDeadline.ts` (Q3 may refactor it; if it does, keep `completeDeadlines` / `startsNextCycle` exported or tell Q7)
- `utils/filterMatch.ts`, `utils/deadlineCalc.ts`, `components/shared/tourPosition.ts`, `hooks/useFocusTrap.ts`

Not touched: `HelpView.tsx` (Q2 does the label rename), `DashboardView.tsx` (Q2), `MainLayout.tsx`, `ipc-settings.ts`.

Local only (git-excluded): `e2e/ux-review/harness.ts`. Add `silenceHints(page)` (writes `onboarding_hints_seen = "all"`) and call it in `openSeededApp` after `skipOnboarding`, so every other review spec stays clean. Also `e2e/ux-review/Q7.spec.ts` (new).

Tests owned:

- `tests/renderer/components/shared/TourOverlay.test.tsx`
- `tests/renderer/views/SetupView.test.tsx`
- `tests/renderer/components/grid/DataGrid.test.tsx` (the tip test at `:973`)
- `tests/renderer/vocabStaticText.test.tsx` (add `HINTS` and the first-look text)
- `tests/renderer/help/faqLabelsExist.test.ts`
- `tests/renderer/a11y/dialogFocusTrap.test.tsx` (`TourOverlay` render at `:74` loses nothing; add FirstLook)
- new: `tests/renderer/components/onboarding/FirstLook.test.tsx`, `ScreenHint.test.tsx`, `tests/renderer/stores/hintStore.test.ts`, `tests/renderer/onboarding/hintTargets.test.ts`
- `tests/renderer/hooks/useAuthGating*.test.ts` if one exists

---

## Commits, in order (`npm run gate` green before each)

1. **Seen-hints store and key.** `hintStore.ts`, the `useAuthGating` load/reset, and the first-run `"[]"` write (welcome start only, key absent only). Tests:
   - absent = all seen; `"all"` = all seen; array parsing; a bad JSON value counts as all seen (never nag on a corrupt value);
   - `markSeen` writes the merged array;
   - the first-run write happens only for `setupStart === 'welcome'` and only when the key is absent;
   - lock resets the store.
2. **Screen hints.** `screenHints.ts`, `ScreenHint.tsx`, mounted in `App.tsx`. Remove the grid tip bar (`DataGrid.tsx`, `GridNotices.tsx`) and update `DataGrid.test.tsx:973`. Tests:
   - shows after the delay on a matching route with its target present, and is marked seen on show;
   - not shown again after re-mount;
   - not shown while an `aria-modal` element exists, while `showTour` / `firstLook` is on, or when the target is missing (not marked then);
   - at most one per visit; Escape and Got it close it;
   - the target is clicked → closes;
   - doesn't take focus (`document.activeElement` unchanged);
   - car-shop words render through vocab.
   
   New `hintTargets.test.ts` scans `src/renderer` for every hint's `data-tour` target, the same way as `TourOverlay.test.tsx:31-42`, and asserts every `HINT_IDS` entry has a `HINTS` row (`Record<HintId, …>` makes this a compile check too).
3. **The first look replaces the short tour.** `FirstLook.tsx`, the `SetupView` done step, the `App.tsx` wiring, `useModalManager`, `TourOverlay` without `full`, and `tourSteps` without `FIRST_RUN_TOUR`. Tests:
   - FirstLook picks the top-most late cell; prefers Done-able and sample rows; ignores done or paused deadlines;
   - shows nothing and marks `caseload` when nothing is late;
   - **Done** calls `completeDeadlines` with the row's fields and closes; Close and Escape close without completing;
   - with only a meter, one-off or quota late deadline: "Got it" only, no Done;
   - the pulse has no animation under `reduceMotion`;
   - it's a labelled modal dialog with focus on Done.
   
   `TourOverlay.test.tsx`:
   - replace `:44-48` with "the tour Help plays covers every switched-on step and ends at Help";
   - drop `:107-109`, or keep it over all `STEPS`;
   - keep the target scan `:31-42` unchanged, since it reads `STEPS`, which still exist.
   
   `SetupView.test.tsx:250`: the update-check box comes after "Open my {list}"; the Done screen has exactly one primary. `MorningBriefing` is suppressed while the first look is open.
4. **e2e helpers.** `finishSetup` clicks `/^Open my /`. Then, if the first-look dialog appears (`role=dialog` name "Here's your …"), it clicks **Close**. Then it writes `onboarding_hints_seen = "all"` via `window.api.invoke('settings:update', …)`, so existing e2e specs see no hints. Also update `workspace-words.spec.ts:119`. Run `npm run test:e2e` (with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11`) and fix any spec that relied on the old done screen.
5. **Screenshots** (no code): the spec below.

Commit messages end with the Co-Authored-By / Claude-Session lines from the brief. Don't push.

---

## Acceptance checks

- `npm run gate` green, `npm run test:tz` green, `npm run test:e2e` green.
- No new `eslint-disable`, no hard-coded record or list words, text 15 px, buttons 44 px, focus 3 px.
- A fresh install, through the example path, ends on "You're all set" with one button, "Open my caseload". Clicking it shows the list with one red row lit up and the card beside it.
- **Done** recolours that cell and shows the usual toast with Undo. Undo brings the red back.
- Relaunch and unlock: no first look, no hint repeats. A hint appears once on each of dashboard, calendar, tasks, contacts, settings, help and profile, and once on the grid on a later visit.
- An existing workspace (key absent) after upgrade: no first look, no hints.
- Setup re-shown after deleting the last list: no hints, no first look.
- Help → "Take the tour" still plays every step (after Q2's rename), and "Show me" mini-tours still work.
- The hint never covers its own target and never takes focus. It disappears when a dialog opens.

### Screenshot check (`e2e/ux-review/Q7.spec.ts`, local)

1. `openFreshInstall()`, `setupPassword`, then `startSetup` and the example path as in `e2e/helpers.ts:161-174`.
2. Shoot `Q7-done.light` (one button). Click "Open my caseload". Wait for the dialog and shoot `Q7-firstlook` at 1366×768 and at 1024×768, light and dark. Check the card doesn't cover the lit cell.
3. Click Done and shoot `Q7-after-done` (cell recoloured, toast).
4. Go to `#/dashboard`, wait 1 s, shoot `Q7-hint-dashboard`. Go to `#/grid` and back to `#/dashboard`, and assert there's no hint card. Then `#/grid` (expect the grid hint) and `#/calendar`, shooting each.
5. Close the app, relaunch and unlock. Assert the first look and the dashboard hint don't appear.

Run with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q7.spec.ts`. Rerun `after.spec.ts` to confirm `silenceHints` keeps the other screenshots clean.

---

## Risks

- **E2E and review flakiness.** Every e2e run goes through setup, so a new overlay there breaks specs that click the grid straight away. Mitigation: `finishSetup` closes the first look and writes `"all"`, and the harness does the same. Commit 4 is gated on `npm run test:e2e`.
- **Merge conflicts.** `SetupView.tsx` is shared with Q1a, and `DataGrid.tsx` with Q3 and Q1a. Q7's hunks are small and mostly deletions. Merge Q7 after Q1a and Q3, or rebase onto them. Don't reflow nearby code.
- **The first look finds nothing.** A starter whose sample data isn't late, a blank list, or a slow load all end in a silent skip by design. Optional follow-up, not in this plan: a test that every starter with sample data has at least one late value on a rule column (starters JSON belongs to no Phase 2 plan).
- **"Click Done when you've seen them" is read as "close this card".** The card's Done really does mark the deadline done, and the cell visibly changes. The secondary is labelled Close, not Got it, so the two buttons can't be confused.
- **Hint timing.** On a slow machine the 800 ms settle may pass before the target renders. Then the hint is skipped and not marked, and it gets another chance next visit.
- **Hint copy repeats Q2's purpose lines.** Cross-check during review: Q2 says what a screen is for, Q7 says how to do one thing on it.
- **A corrupt settings value nags forever.** Parse failures count as all seen.
