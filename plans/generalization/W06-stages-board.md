# W06. Stages and the board view

Size: M (5 days). Phase: P3. Depends on W01 (feature `stages`), W05 (relative rules for "after entering stage X").

## 1. User stories
1. *As a shop owner*, I see jobs as cards in columns (Estimate → Approved → Waiting on parts → In progress → Ready → Picked up) and drag them along.
2. *As an intake coordinator*, moving someone to "Intake" adds the intake checklist and starts the 30-day assessment deadline automatically.
3. *As a supervisor*, I want to know how long things sit in each stage.
4. *As a keyboard user*, I can move cards without a mouse.

## 2. Stage column
- **Any `status` or `dropdown` column can be marked "This is the stage"** from the column menu (feature `stages`), one per list.
- **Column config:**
  ```ts
  stage: {
    options: Array<{
      value: string                 // matches the dropdown option
      color: string                 // palette key
      done?: boolean                // counts as finished (excluded from "open" counts, board can collapse it)
      onEnter?: {
        checklistTemplateId?: number      // add this checklist to the record
        stampColumnId?: number            // set this date column to today ("Picked up date") → anchors relative rules (W05)
        activityTypeKey?: string          // log an activity "Moved to Ready"
      }
    }>
    hideDoneAfterDays?: number      // board hides cards done more than N days ago (default 14)
  }
  ```
- Marking a column as the stage turns on `log_changes` for it (stage history comes from `cell_history`). A dialog explains this and lets the user set colors and on-enter actions per option.
- The order of options = the board column order (drag to reorder in the dialog, mirrored to dropdown options).

## 3. Board view
- **Toggle** in the grid toolbar: [Table] [Board] (shown when the list has a stage column). The choice is saved per list (settings `grid_view_mode_<gridId>`) and in saved views (`saved_views.config.viewMode`).
- **Layout:** horizontal columns, one per stage option, plus "No stage". Column headers show the name, count and color bar. Columns are 280px wide with horizontal scroll; at narrow widths it's one column with a stage switcher.
- **Card:**
  - display name (W02) and the auto number if present;
  - up to 3 chosen fields (board settings "Show on cards");
  - the nearest deadline chip (W05 color);
  - link chips (W04, first link column);
  - time in stage ("4 days");
  - priority badge;
  - starred icon.
  - Click → profile; double-click → quick edit popover of the card fields.
- **Drag** (@dnd-kit, already installed: `DndContext` + `SortableContext` per column):
  - between columns → stage change;
  - within a column → manual order, stored in `rows.position` only if the board is sorted "manually" (otherwise sorted by due date or name, chosen in the header menu).
- **Keyboard:**
  - arrows move focus (←/→ across columns, ↑/↓ within);
  - Enter opens; Space picks up and arrows move; Ctrl+Shift+←/→ moves the focused card to the previous/next stage;
  - screen-reader announcements via an `aria-live` region ("Moved 2017 Civic to Ready").
- **Filters, search and saved views** apply (same FilterBar state as the table).
- **Performance:**
  - virtualize card lists over 50 per column (`@tanstack/react-virtual`, already installed);
  - 300 cards render in under 100 ms;
  - drag at 60 fps (no store writes until drop).

## 4. On-enter actions (main, one transaction per move)
`STAGE_MOVE(rowId, columnId, newValue)` does:
1. Run the `CELL_UPDATE` logic (history, system log if enabled).
2. Apply the target option's `onEnter`:
   - add the checklist (existing `CHECKLIST_APPLY_TEMPLATE` logic);
   - stamp the date column (with history);
   - log the activity.
3. Return `{ sysLogIds, checklistItemIds, stampedPrev }`.

The renderer pushes **one undo step** that reverts the cell, deletes the checklist items, restores the stamp and voids the logs, the same pattern as A4's `completeDeadlines`.

## 5. Time in stage
- `src/main/stages.ts`, `stageDurations(gridId, columnId, rowIds?)`: walks `cell_history` per row ordered by `changed_at` and returns the current stage's entry time plus completed stays `{ stage, from, to, days }`.
- Before history exists (stage column marked after the fact), entry time = `rows.created_at` for the current value, flagged as approximate.
- **Used by:**
  - card badges;
  - the profile "Stage history" mini-timeline;
  - the dashboard card "Average days per stage";
  - the report builder field "days in stage" (W10).

## 6. Dashboard card "Stages"
Per list with a stage column: counts per stage as a horizontal bar (colors), oldest open card ("In progress for 12 days: J-0042"). Click a segment → the board filtered to that stage.

## 7. IPC
| Channel | Purpose |
|-|-|
| `STAGE_CONFIG_SAVE` | (columnId, stageConfig): validates options match the column's dropdown options; sets `log_changes` |
| `STAGE_MOVE` | (rowId, columnId, value) → side-effect ids for undo |
| `STAGE_DURATIONS` | (gridId, columnId, rowIds?) → durations |

## 8. Starters
`StarterList.stage = { column: 'Status', options: [...] }` with `onEnter` references by **name**:
- checklist name;
- stamp column name;
- activity type key.

The auto-service starter's Jobs board and the sales starter's pipeline use it.

## 9. Tests
- Config validation; marking a stage turns on logging.
- `STAGE_MOVE` side effects (checklist, stamp, activity) and full undo.
- Durations from synthetic history (including no history, back-and-forth moves, and edits made in table view counting the same).
- Board renders, drag-and-drop (simulated), keyboard moves with announcements, virtualization threshold.
- Saved view remembers board mode.

## 10. Commits
1. Stage config (column menu dialog) + `STAGE_CONFIG_SAVE` + log-changes auto-on.
2. `STAGE_MOVE` with on-enter actions + undo.
3. Board view (read-only cards, toggle, saved views).
4. Drag and keyboard moves + announcements.
5. Durations + card badges + profile stage history.
6. Dashboard "Stages" card.
