# Audit brief (shared by every reviewer)

## The app
Pulse ("Pulse by BaringaSoft") is a free, open-source, offline Electron desktop app (React 19 + TypeScript, SQLite/SQLCipher in the main process, IPC via `secureWrap`/`safeInvoke`). It replaces spreadsheets for people who track **people or things with recurring deadlines**: care coordinators and social workers first, but now also tree services, therapists, landlords, tax preparers, households (51 starter templates in `src/shared/starters/`). Read `/home/jmatlock/projects/pulse/CLAUDE.md` first (architecture, UI rules, vocabulary layer).

**The users are not tech-savvy.** Many are overwhelmed social workers on agency laptops. The bar: someone who has only ever used Excel can do their job in Pulse without training, and a power user can still reach advanced controls (custom rules, links, stages, reports) without them getting in everyone else's way. The goal is **progressive disclosure, sensible defaults, plain language and one obvious way to do each thing**, not removing power.

UI rules: 15px minimum text, 44px click targets, 3px focus rings, visible grid borders, human error messages, no jargon, words from the vocabulary layer (never hard-coded "client"), dark mode.

## Evidence you can use
- Code: `/home/jmatlock/projects/pulse/src` (renderer in `src/renderer`, main in `src/main`, shared in `src/shared`). Specs in `plans/` (`plans/generalization/*.md`, `plans/Pulse_Complete_Spec.md`).
- Screenshots (1366×768) you can look at with the Read tool:
  - `test-results/ui-tour/current/*.png`: every main screen in light and dark, with a seeded human-services caseload.
  - `test-results/audit-tour/*.png`: newer screens with the tree-service example (setup gallery, dashboard, board, profiles, calendar, reports, settings tabs, rule editor…). A few clicks in that tour missed, so a file may show a neighboring screen. Say so if one looks mislabeled.
  - `plans/website/screenshots/<starter>/0{1..4}-*.png`: list, dashboard, record and calendar for each of the 51 starters.

## Rules for you
- **Read-only.** Don't edit anything in `src/`, `tests/`, `e2e/` or elsewhere. Don't run `npm test`, builds, Playwright, Electron or git: other work shares the machine and the native module. The only file you write is your own report.
- Ground every finding in the code (file:line) and, where possible, a screenshot. Don't guess: if you suspect a bug, trace the code path to confirm it. Mark anything unconfirmed as "suspected".
- Think like the user first: what they're trying to do, what they see, where they'd get stuck or confused, what they'd click by mistake. Then the logic: is it correct, consistent and safe with their data?
- Keep advanced control. When you propose simplifying something, say how a power user still gets to it.

## Your report
Write `plans/audit-2026-10/<your-area>.md`:
1. **Top 5**: the five changes that would most improve this area, one line each.
2. **Findings**: one short block each:
   - `ID` (area prefix + number, e.g. G-03) · **Title** · Severity: Blocker / High / Medium / Low · Type: bug / logic / usability / consistency / accessibility / wording
   - **Where:** file:line(s) and screen/screenshot
   - **What the user experiences:** concrete
   - **Why it matters**
   - **Fix:** concrete, small enough to act on; mention the power-user path if it changes
   - **Effort:** S (under 2h) / M (half-day) / L (1+ day)
3. **Things that work well**: briefly, so they aren't broken by fixes.

Be thorough. Depth beats breadth within your area, but don't pad: 15–40 real findings is typical. Use plain language a non-programmer could follow in the "What the user experiences" lines.

Your final reply to the parent: under 2000 characters. Give the report path, the counts by severity, and your Top 5. Outcomes, not process.
