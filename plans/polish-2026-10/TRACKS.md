# Polish pass: build tracks

The findings are in R1–R7.md (and later V1.md) in this folder. Several reviewers found the same problem. Each problem belongs to the track that owns its main file, and that track fixes it once.

The owner's audit decisions A–H in `plans/audit-2026-10/PLAN.md` still hold.

Already done on main, so skip these:
- R1 items 1–3: deadline words width, truncation, redraw when the context arrives.
- The setup grid reload.

## Ownership

| Track | Owns (edit freely) | Findings |
|-|-|-|
| P1 Grid & board | `src/renderer/components/grid/**`, `components/board/**`, `hooks/useGridGrouping.ts`, `hooks/useShownCount.ts`, `stores/gridStore.ts` and its slices, `views/GridView.tsx`, `utils/gridSort.ts` | R1 (items 4 onwards); R7 items in those files; R2 items about restored records not appearing in the open list |
| P2 Record & tasks | `views/ProfileView.tsx`, `components/profile/**`, `views/TasksView.tsx`, `views/tasks/**`, `components/tasks/**`, `stores/taskStore.ts`, `stores/profileStore.ts`, `views/FocusModeView.tsx`, calendar/appointments/forms/attachments/snippets views and components, `views/dashboard/TaskRow.tsx`, `stores/undoStore.ts`, main-side handlers for tasks, appointments, case log, forms, letters | R3; R2 items for the profile loop and task undo; R6 briefing appointments count; R7 items in those files (two names on record page, "can't load" on Tasks/Focus) |
| P3 Dashboard, rules & reports | `views/DashboardView.tsx`, `views/dashboard/**` (not TaskRow), reports views/components, `components/alerts/**`, `stores/alertStore.ts`, `shared/deadlineEngine.ts`, `utils/deadlineCalc.ts`, main-side deadline/report/dashboard/alerts handlers, the deadline-rules part of Settings | R4; R2 items for dashboard refresh and rule pickers/"Used by"; R6 items about deadline columns (note-date updates, stages, ISO dates in timeline/letters/forms); R7 "can't load" on the Dashboard, duplicated due badges |
| P4 Data lifecycle | rest of `src/main/**` (starters, sample data, import, export, backup, contacts, trash, ipc-grid/row), `views/SetupView.tsx`, `PasswordSetupView.tsx`, starters components, ImportWizard and import UI, `components/settings/**` (not deadline rules), contacts components, `stores/workspaceStore.ts`, `stores/contactsStore.ts`, Sidebar | R5; R6 (except items P2/P3 own); R2 items for import, templates/sample list rule reload, sample removal, link store, list words, emptying the Trash; R7 ContactForm custom fields, compaction toast, jargon errors |

R7's leftover hygiene items run as a last pass after these merge: dead code, ⌘ vs Ctrl, the vocabulary rule gap, misplaced lint comments, help caption sizes, duplicated date parsing.

## Shared files

Keep edits to these small and additive:
- `ipc-channels.ts`
- `ipc-contract.ts`
- `events.ts`
- `tests/helpers.ts`
- `database.ts`

`undoStore.ts` belongs to P2. Other tracks only call its public API.

No migrations in this pass. If a fix truly needs one, skip it and report it.
