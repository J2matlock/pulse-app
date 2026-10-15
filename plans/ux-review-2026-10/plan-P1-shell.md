# P1 — Shell: sidebar, top bar, Settings tab list, theme default, sample banner

**Findings:** D-01 (Blocker), D-03, D-14, D-15, D-16, D-17, D-18, D-38, D-48, E-03, E-04, E-19, E-33, A-02 (=B-47), A-28, B-32, C-41. Full text in `D-daily-work.md`, `E-settings-help.md`, `A-first-run.md`, `B-grid.md`.

**Files you own:** `src/renderer/components/layout/Sidebar.tsx`, `TopBar.tsx`, `MainLayout.tsx`, `StatusBar.tsx`, `src/renderer/components/shared/SampleDataBanner.tsx`, `src/renderer/views/SettingsView.tsx` (the tab list and default tab only — P6 owns the sections), `src/renderer/stores/settingsStore.ts` (theme default only), their tests. Don't touch grid, profile, dashboard or settings-section components.

## Commits, in order

1. **Sidebar menu visible on laptops (D-01).** Render the list "⋯" menu through a portal on `document.body` (there's a `createPortal` pattern in `GridContextMenu`/`ProfileMoreMenu`; check which one positions by rect). Keep keyboard handling and the "click outside closes" behaviour. Add `tests/renderer/a11y/sidebarMenuVisible.test.tsx` (or extend the Sidebar test): with `data-more-below` set on the nav, the menu's element is not a descendant of the masked nav.
2. **Sidebar fits 1280×720 (D-03, D-14, D-15, D-16, E-04, A-28, C-41).** Drop the WORKSPACE and SYSTEM group headers (Dashboard, Calendar, Tasks first; then the lists group; then TOOLS with Reports, Contacts, Snippets, Templates, Letters, Trash; bottom block Focus Mode / Settings / Help / Lock stays). Tool rows 40 px, no blank spacer rows. Replace the faint "+" with a last row "+ New {list}" (icon only when collapsed). Full-opacity "⋯" on the active list; hide the drag handle unless ≥2 lists. **Acceptance:** at 1280×720 with the human-services feature set plus Letters and Focus mode on, every sidebar item is fully visible with no scrolling (check with the review harness: `e2e/ux-review/`, `sizeWindow(ctx, 1280, 720)`). Only if that can't be reached: fold Snippets, Templates and Letters into one "Templates" entry (tabs on the page) — say so in your report.
3. **Top bar (D-17, D-18, D-48, E-33).** Remove the "Press ? for shortcuts" text; the "?" button gets a visible "Help" label next to the icon; the recent-clients clock gets a "Recent" label; drop the undo count number from the toolbar button (keep it in the tooltip/history panel).
4. **Settings tab list (E-03, E-19).** One-line tab labels (descriptions become the panel subtitle), so nine rows fit at 720 without scrolling; open on the first tab; rename "Workspace" → "Words & features" (keep the `workspace` id). Update `tests/renderer/views/SettingsView*` and anything scanning the nav labels.
5. **Theme default (A-02).** `theme: 'system'` in the store's initial state. Existing installs have a stored value, so nothing changes for them. Check `hydrateFromSettings` and the lock/setup screens pick up `system` correctly; update tests that assert the old default.
6. **Sample banner scope (D-38, B-32).** Show the banner only on the list page of a list that actually has sample rows and on the dashboard; elsewhere a small "sample data" chip in the status bar is enough (or nothing). Use that list's record word.

## Rules
- Vocabulary layer for every word (`useVocab`); no hard-coded "client"/"caseload".
- 15 px text, 44 px targets (40 px rows are fine when the row is the target and the text is 15 px), 3 px focus rings.
- Run `npm run typecheck`, `npx eslint src --quiet`, then `npm test` before each commit. Source-scanning tests to watch: `tests/shortcuts.test.ts`, the TourOverlay target scan (`tourSteps.tsx` targets must still exist after sidebar changes — don't rename `data-tour` ids), `tests/renderer/vocabStaticText.test.tsx`.
- Commit per step with a plain message; no push.
