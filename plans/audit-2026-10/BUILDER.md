# Instructions for each build track

You're building one track of the audit plan in Pulse (an offline Electron app; see CLAUDE.md). Your track and items are in `plans/audit-2026-10/TRACKS.md`. Each item's problem, fix and files are in `plans/audit-2026-10/PLAN.md`, with the original findings in the area reports next to it. The owner's decisions are at the top of PLAN.md; follow them.

## Setup (you're in your own git worktree)
1. `pwd` and `git log --oneline -1`: confirm you're in a worktree, not `/home/jmatlock/projects/pulse`.
2. Give the worktree its own dependencies, a real copy, never a symlink (the tests rebuild a native module inside it): `cp -a /home/jmatlock/projects/pulse/node_modules ./node_modules`
3. Read CLAUDE.md, then your items in PLAN.md.

## How to work
- One commit per item, or per 2–3 tightly related items. Commit messages describe the change for a user, the repo's style. End each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push, and don't touch `main` or other branches.
- Before each commit: `npm run typecheck`, `npx eslint --quiet src`, the targeted tests, then the full `npm test`. All must pass. Run tests only through `npm test` (never vitest directly). Add or update tests for every fix: a bug fix gets a test that fails without it.
- Follow CLAUDE.md:
  - UI: 15px text, 44px targets, 3px focus rings, plain words.
  - Vocabulary: never hard-code "client" or "caseload"; use `useVocab`, `<V>` or `word()`.
  - Undo for user-visible changes.
  - `localDateString`/`parseDbTimestamp` for dates.
  - Migrations: only the number TRACKS.md gives your track; follow the `new-migration` skill (`.claude/skills/new-migration/SKILL.md`).
- Stay inside your track's items. If a fix needs a shared file (`ipc-channels.ts`, `ipc-contract.ts`, `undoStore.ts`, `faqData.tsx`, `database.ts`, `tests/helpers.ts`), keep the edit small and additive, since other tracks change these too.
- Don't edit `plans/progress.md`, `CLAUDE.md` or the audit reports; the parent does that when merging.
- Don't run Playwright or Electron. Unit and renderer tests only.
- If an item turns out wrong, already fixed, or much bigger than planned, skip it and say why in your report. Don't invent scope.
- If you hit the usage limit or an error, commit what passes and stop cleanly.

## Report back (under 2000 characters)
- your branch name (`git branch --show-current`) and the commit list (`git log --oneline main..HEAD`)
- items done, and items skipped or partial, with the reason
- any shared-file edits the merger should watch for
- the final full-suite count
