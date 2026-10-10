# Build tracks for the audit plan (round 1)

Items are from PLAN.md (read the item there for the problem, fix and files). Decisions are at the top of PLAN.md. Each track runs in its own git worktree and branch, and the branches are merged in this order: B, D, G, R, S, X, F. Track A (polish) runs after the merge.

| Track | Area | Items | Migration number (only if needed) |
|-|-|-|-|
| B | Note dates (`occurred_at`) | 1.22, 1.23 | 044 |
| D | Deadlines, rules, dashboard | 1.7, 1.8 (rule/link-type parts), 1.17, 1.18, 1.20, 1.21, 1.35, 2.5, 3.1, 3.3, 3.10, 3.20, 4.5, 5.3, 5.4 (D-11) | 046 |
| G | List grid, board, lists and columns | 1.8 (column parts), 1.9, 1.10, 1.11, 1.12, 1.14, 1.15, 1.16, 1.33, 1.34, 2.2, 3.2, 3.9, 3.11, 3.12, 3.13, 5.2, 5.8 | 045 |
| R | Record page | 1.1, 1.2, 1.19, 1.24, 1.30 (record parts), 1.31, 1.37 (record parts), 3.4, 3.5, 3.6, 3.7, 3.8, 3.19 | none |
| S | Calendar, tasks, checklists, stages | 1.13, 1.25, 1.26 (make Repeat work), 1.27, 1.32, 1.36, 3.14, 3.15, 3.16 (without S-06), 3.17 | none |
| X | Settings, backup, import/export, letters | 1.4, 1.5, 1.6, 1.28, 1.29, 1.30 (settings parts), 1.37 (settings parts), 2.12, 3.21, 3.22 | none |
| F | First run, sample data, navigation, help | 1.3, 2.1, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.13, 2.14, 2.15, 3.18, 5.9 | 047 (only if sample marking needs it) |
| A | Polish, after the merge | 4.1, 4.2, 4.3, 4.4, 4.6, 4.7 | none |

Not in this round: 5.1 (Decision A3), 5.5–5.7 (Decision G, later), the contact-rule part of 5.4 (L-32).
