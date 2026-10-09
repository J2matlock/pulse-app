# UI Polish Pass — Plan

**Status:** DONE 2026-09-30 — strategy B, dark mode kept and polished. Before/after screenshots: `test-results/ui-tour/before/` and `after/` (regenerate with `npm run ui-tour`).

## Goal
Make every screen meet the app's own UI rules (15px text, 44px targets, 3px focus rings, readable contrast, plain-English copy) and look consistent. This pass polishes; it does not redesign layouts or add features.

## Where things stand (measured 2026-09-30)

| Area | Finding |
|-|-|
| Text size | `--text-sm` is **13px** and used **~870×**; `text-xs` (12px) **87×**; plus 16× `fontSize: 13` and a handful of 10–12px arbitrary sizes. `text-base` (15px) is used only 286×. Worst areas: grid (240), views (213), profile (147), shared (126), settings (105) |
| Contrast | **~450** uses of `text-slate-300/400` on light backgrounds. slate-400 on white is about 2.6:1; WCAG AA needs 4.5:1. slate-500 is 4.8:1 and passes. Many hints and labels are hard to read |
| Click targets | 617 `<button>`s; ~260 clearly get 44px (via `.btn*` or `min-h`). The rest need checking, especially icon buttons in grid headers, toolbars, and chips |
| Focus rings | Mostly `ring-3` (329). 28 use `ring-0/1/2`; review each |
| New screens | Restore-from-backup (setup and lock screens) and the recovery-key password prompt have never been seen in the real app, or in dark mode |

## Method
1. **Screenshot tour (baseline).** A Playwright script (`e2e/ui-tour.ts`, not part of CI) launches the built app with an isolated data dir, seeds a realistic caseload (40 clients, several date columns with deadline rules, case notes, tasks, contacts), and captures every main view and key dialog at **1366×768**, in light and dark mode, into `test-results/ui-tour/before/`.
2. **Global fixes first** (one change, big reach): the theme tokens and the `.btn`/input base styles in `globals.css`.
3. **Per-area passes**, one commit each: shell & navigation → grid → client profile → dashboard, tasks & focus mode → contacts → settings, backup & security → dialogs, lock & setup screens, onboarding. In each area:
   - body and interactive text → 15px; small text only for badges, counts, and timestamps
   - light-gray text → slate-500 or darker (dark mode: slate-400 or lighter)
   - every clickable element → at least 44×44 hit area (icon buttons get padding, not bigger icons)
   - thin focus rings → 3px
   - consistent empty, loading, and error states; plain-English copy with no jargon ("rows", "fields", error codes)
4. **Screenshot tour (after)** → `test-results/ui-tour/after/`, with before/after pairs you can flip through.
5. Gates after each area: `npm run typecheck`, `npx eslint src --quiet`, `npm test` (renderer tests assert some class names, so update any that change).

## Decisions needed
1. **Text size strategy.** Recommended: **B**.
   - A. Change nothing global; convert usages one at a time (slowest, most precise)
   - **B. Raise `--text-sm` to 14px and `--text-xs` to 13px globally, then convert body and interactive text to 15px per area** (fast, lifts everything at once; secondary text stays a step smaller for hierarchy)
   - C. Make `text-sm` = 15px (instant compliance, but flattens hierarchy and may crowd dense grid and toolbar UI)
2. **Dark mode.** Your old notes say "get rid of dark mode". Keep and polish it (plan assumes this), or remove it (less to maintain, one less thing to test)?
3. **Anything that bugs you or your users** on specific screens? Those go first.

## Out of scope
Layout redesigns, new features, the IT security review, the functionality brainstorm.

## Rough size
Global styles + tour script: ~1 short session. Per-area passes: ~7 commits, each reviewable with screenshots.

## Outcome (2026-09-30)
- Global: secondary text 13/12px → 14/13px; ~630 low-contrast grays fixed in both themes; native controls follow the theme; readable placeholders; overdue pulse no longer fades text
- Interactive text → 15px on ~350 controls; every button has a ≥44px click area (`hit-44` utility, or `btn-compact-*` for toolbars); hover-revealed buttons deliberately excluded
- 3px focus rings everywhere; inline quick-add inputs got a visible ring
- Layout: trial notice moved into the status bar (was covering the sidebar); stray scrollbars removed; setup/lock screens scroll instead of clipping at 768px
- Copy: "row/field" → "client/column", "stored:" → "based on", next-due dates shown on profile deadline cards, Security copy tidied
- Not done / follow-ups: help-page demo illustrations left as-is; ~400 secondary `text-sm` (now 14px) kept by design; onboarding steps beyond the welcome screen and less-used dialogs only spot-checked; "Unknown" availability badge wording
