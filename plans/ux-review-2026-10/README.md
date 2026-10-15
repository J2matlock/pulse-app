# UX review 2026-10 — working folder

Goal: Pulse should be usable, set up and understood with ease by a non-tech-savvy
case manager (persona below), while keeping its advanced features reachable.

Report: `../ux-review-2026-10.md` (merged from the slice files here).
Plans: `plan-*.md` here, one per theme.

## Persona — "Linda"
54, care coordinator at a small non-profit, 80-person caseload. Comfortable with
Excel and Outlook, intimidated by new software, reads every word on a screen
before clicking, never right-clicks, never uses keyboard shortcuts, doesn't know
what a "profile", "record", "view", "rule", "template" or "feature switch" is until
the app tells her. Gives a new app about 5 minutes before deciding.

## Slices
| File | Area |
|-|-|
| `A-first-run.md` | password, recovery key, terms, setup wizard (all three paths), ready screen, tour, first grid, first client |
| `B-grid.md` | the list: toolbar, headers, column menus and settings, add column, deadline rules, filters, grouping, views, bulk bar, right-click, import wizard, list settings, new list |
| `C-profile.md` | profile page: header, contact info, scratch pad, notes log and timeline, checklist, files, links, appointments, letters, More menu, export, handoff |
| `D-daily-work.md` | dashboard, calendar, tasks, focus mode, reports, morning briefing, reminders, marking things done |
| `E-settings-help.md` | settings (all tabs), feature switches, words, deadline rule editor, backup, security, data, help view, command palette, shortcuts, trash, snippets, checklist and letter templates, contacts directory |
| `F-wording.md` | code-level: every user-facing string — jargon, inconsistent terms, unclear errors, tooltips, empty states, confirm dialogs |

## Finding format (one per finding)
```
### UX-A-03 · Blocker · S
**Where:** Setup → "How do you want to start?" (shot: ux-review-shots/A/05-start.png)
**What Linda sees / thinks:** …
**Why it's a problem:** …
**Fix:** … (concrete: new wording, what moves where, what the default becomes)
**Constraint check:** no schema change · touches src/renderer/views/SetupView.tsx
```
Severity: Blocker (she'd give up or do something harmful) · Major (she'd be lost or need help) ·
Minor (friction, she'd recover) · Polish (looks off, no confusion).
Effort: S (< 1 h), M (half a day), L (a day or more).

## Rules for suggested fixes
- Moderate ambition: wording, defaults, help text, spacing, empty states, moving
  things between menus and Settings, progressive disclosure of advanced features,
  new onboarding or tour steps. **No database migrations, no new IPC-heavy features.**
- Keep advanced features reachable; hide, don't remove.
- Respect the app's UI rules (15px text, 44px targets, 3px focus rings, plain English,
  vocabulary layer — never hard-code "client"/"caseload"/"case note").
