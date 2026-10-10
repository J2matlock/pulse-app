# Reports review (2026-10-10)

Looked at the report builder end to end: the code (`report-builder.ts`, `shared/reports.ts`, `ReportBuilder.tsx`, `ReportsView.tsx`, `ReportTable.tsx`, `export-report.ts`, the pinned dashboard card) and a scripted walkthrough in the real app with the tree service sample (build "Jobs by stage", total the estimates, save, pin, notes per month, a deadlines list).

**The engine is sound:**
- no text reaches SQL, and fields are checked against the list
- limits and timeouts work
- totals add up
- saving, pinning and deleting a report also unpins it

**The clunkiness is in the builder's defaults and layout.** Several defaults actively produce wrong-looking results, which makes the whole thing feel broken.

## Bugs (wrong results or dead ends)
| # | What happens | Why | Fix |
|-|-|-|-|
| B1 | Clicking **Add a filter** drops the preview to **0 matched** before you've typed anything | The new filter is "Date added is before (blank)", and a blank date matches nothing | Ignore a filter until its value is filled in. Default the new filter to a sensible field (a status, dropdown or text column), not "Date added" |
| B2 | **Add a grouping** groups by **Date added, by month** | It picks the first field that isn't plain text | Default to the stage/status column, then a dropdown, then a link; dates only when nothing else fits |
| B3 | **Add a value** adds **"Total Days in stage"** (a meaningless sum) | It picks the first number field, which is "Days in stage" | Default to the first currency column, then a real number column; never "Days in stage" or "Days overdue" for a total |
| B4 | Groups are sorted A–Z: Approved, Done, Estimate requested… | Group keys are compared as text | Sort stage, status and dropdown groups in their own option order (Estimate requested → … → Done) |
| B5 | Dates show as `2026-07-31` and months as `2026-10` in the table, PDF and dashboard card | Values are formatted raw | Show "Jul 31, 2026", "Oct 2026", "Week of Oct 4", "Q4 2026"; keep ISO in the CSV so spreadsheets sort it |
| B6 | **Delete** removes a saved report at once, with no confirmation and no undo | — | Ask first ("Delete 'Jobs by stage'? It also comes off the dashboard"), or offer undo |
| B7 | Switching to another saved report or **New report** silently throws away unsaved changes | — | Ask before leaving with unsaved changes; show "Unsaved changes" next to Save |

## Clunky (works, but hard to use)
| # | What | Change |
|-|-|-|
| C1 | **Save with no name** gives an error toast | Suggest a name from the settings ("Jobs by Stage", "Notes per month"). An empty name falls back to the suggestion |
| C2 | Filter values for dropdown, status, stage, checkbox and link fields are free text: you have to type "Done" exactly | Offer a pick-list of the field's options and values (fields gain an `options` list) |
| C3 | Cramped three-column layout at 1366 px (saved list, a 440 px builder, a narrow preview). The builder is a long scroll, and Export / Pin / Delete sit at the bottom of it, far from the preview | Put the actions in a bar above the preview (Save, Export PDF, Export CSV, Pin, Delete). Let the saved list collapse. Keep the preview in view (sticky) while the steps scroll |
| C4 | Every control is full width, so each trash button wraps onto its own line, and the "Heading (optional)" box is cut off | Lay each filter, grouping and value out as one tidy row (field, condition, value, remove), wrapping as a unit |
| C5 | A blank page to start from | Add a "Start from a common report" row: *How many {records} by {stage}*, *{activities} per month*, *Overdue deadlines by deadline*, *{appointments} this month by status*, *Total {currency column} by {stage}*. Each fills in the steps, which the user can then change |
| C6 | "Each line counts" is hard to parse | "What do you want to count?" (radio labels stay: Jobs / Notes / Appointments / Deadlines) |
| C7 | A deadlines report with no grouping shows only "How many 9" | When you list items without choosing columns, show sensible ones by default (name + the main fields for that source) |
| C8 | The PDF doesn't say what's in it, so a supervisor can't tell which filters or dates were used | Add a line under the title: "Jobs · Stage is Done · Date added: this month" |
| C9 | Pin needs a saved report but doesn't say so | Show Pin always; if unsaved, save first (with the suggested name) |
| C10 | The "List" picker's accessible name includes all of its options (screen readers read them all) | Use `htmlFor`/`id` labels on the builder's selects |

## Not changing
- The engine's shape (sources, limits, field ids, saved config format). Saved reports keep working, and new settings stay optional.
- The top bar showing the current list name on the Reports, Calendar and Dashboard pages is an app-wide header behavior. Noted for separate polish, not part of this.

## Order of work (each its own commit, tests with each)
1. **B1–B4 and C7:** fix the defaults and filtering in `shared/reports.ts` / `report-builder.ts` / the builder, plus engine tests (blank filters ignored, option-order sort, default picks)
2. **B5 and C8:** friendly date and bucket formatting in the table, the PDF and the card (CSV stays ISO), plus the PDF description line
3. **B6, B7 and C1:** confirm delete, unsaved-changes guard, suggested names
4. **C2:** field options for pick-lists (main `reportFields` returns options)
5. **C3, C4, C6, C9 and C10:** layout pass (action bar, tidy rows, sticky preview, collapsible saved list), wording, labels
6. **C5:** common-report presets
7. Re-run the scripted walkthrough and look at the screenshots, then update help (`faqData`) where wording changed

Effort: about a day. No migrations.
