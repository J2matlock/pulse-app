# P7 — Wording sweep (runs after P1–P6 are merged)

**Findings:** F-02, F-04, F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13, F-15, F-17. Full text, string lists and the style guide in `F-wording.md`. Decisions in `plans/ux-review-2026-10.md` override F where they differ ("Color rules", "Show"/"Saved views", "What's due", "Save as PDF…", "Make a letter…", "Keep a history of changes", "Words & features").

**Scope:** every file in `src/` — this package is cross-cutting by design, which is why it runs alone after the merge. Many of the strings F lists will already have been changed by P1–P6; grep before editing and skip what's done.

## Commits, in order

1. **Naming table (F-02, F-13).** Apply the remaining renames concept by concept: color rules (menu, dialog, toasts, FAQ), saved view / saved filter, deadline rule (no "alert rule" in user text), scratch notes, "{record}'s page" (no "profile" in user text — keep the route and component names), "Save as PDF…", templates naming, contact history, column not field (Contacts "Extra details"), the delete/trash/remove/discard verbs. Fix the six vocabulary leaks (sample list name via `word()`, TrashView headers, ContactDetail "Log" tab, ApplyStarterDialog / SampleDataBanner "entry", FAQ "email programs"); extend `tests/vocab-leak-main.test.ts` to `sample-data.ts` constants.
2. **Icon-only buttons (F-04).** Every icon button gets an `aria-label` that is a plain verb phrase (suffixes like "(Esc)" stay in `title` only); the six with no label at all first. In repeated rows (task, checklist, contact header, acuity levels) show the text beside the icon at normal width and collapse below ~700 px, or fold into a "⋯" menu. Add `tests/renderer/a11y/iconButtonsLabelled.test.tsx`: no `<button>` in `src/renderer` whose JSX children are only an icon component lacks `aria-label` (source scan; allow-list for "×" close buttons that already have one).
3. **Errors (F-05, F-09).** Rewrite the user-fixable `fail()` strings with the limit in words; the generic fallback in `src/shared/constants.ts` says what's safe and what to do; replace the nine "Something went wrong" and three "An unexpected error occurred" renderer strings with "We couldn't <do X> — <next step>"; one error template in the stores ("We couldn't … — try again"), validation as imperatives, one success wording per action. Extend `tests/renderer/friendlyError.test.ts` with a must-pass-through list.
4. **Confirm dialogs (F-06).** Fold `DeleteConfirmModal` and the inline "Are you sure?" into `ConfirmDialog`; one title form ("<Verb> <thing>?"), one of the two undo sentences, button = the title's verb; remove the `'Confirm'` default label and add a test that every `ConfirmDialog` passes `confirmLabel`.
5. **Sentence case (F-07).** The full list in F-07, plus OS dialog titles; add the source-scanning test with a proper-noun allow-list.
6. **Jargon and empties (F-08, F-10, F-12).** Settings → Data/Appearance/Profile/About wording; Contacts "field" → "detail"; the seventeen weak empty states get a purpose sentence and a first action; verb-less buttons get verbs ("More…" at minimum).
7. **Punctuation and keys (F-11, F-15, F-17).** "…" not "..."; "and" not "&" unless width forces it; "like" / "for example" instead of "e.g." where it reads better; one apostrophe; shortcuts as the second sentence never the first; PDF "Extra details"; checklist-file error messages in person voice.

## Rules
- Vocabulary layer; don't add `eslint-disable`; keep every source-scanning test's path list current if you move anything.
- `npm run typecheck`, `npx eslint src --quiet`, `npm test` before each commit; `npm run test:tz` once at the end.
- Commit per step; no push.
