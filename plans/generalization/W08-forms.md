# W08. Forms

Size: M (5 days). Phase: P4. Depends on W01 (feature `forms`), W04 (link fields).

## 1. User stories
1. *As a front-desk worker*, I add a new customer by filling a clean form, not by typing across a wide grid.
2. *As an intake worker*, I print a blank intake form for people to fill on paper, then type it in later.
3. *As a shop owner*, the vehicle check-in form also logs a "Check-in" note with the answers.
4. *As anyone*, required fields are enforced on the form.

## 2. Data (migration 041)
```sql
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  intro TEXT,                          -- shown at the top (and printed)
  fields TEXT NOT NULL,                -- JSON FormField[]
  log_activity_type TEXT,              -- optional: also log an activity with the answers
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
```ts
type FormField =
  | { kind: 'column'; columnId: number; label?: string; help?: string; required?: boolean; width?: 'full' | 'half' }
  | { kind: 'section'; title: string; text?: string }
  | { kind: 'note'; label: string; help?: string; required?: boolean }      // free-text answer that goes into the logged activity, not a column
```

## 3. Builder (list menu → "Forms…")
- Left: available columns (click to add) + "Section heading" + "Question for the note".
- Middle: the form preview with drag to reorder; each field's label override, help text, required toggle and half/full width.
- Right: form settings (name, intro, "also log a note of type…").
- Required defaults to the column's B2 "Required field" flag.
- Columns that can't be filled (auto number, age, calculated, deadline) are shown as read-only info or excluded.

## 4. Filling
- **Entry points:**
  - grid toolbar "New {record} ▾" → "Blank row" / "Use form: {name}";
  - profile "Fill form ▾" (updates this record, prefilled with current values);
  - command palette "Fill form…".
- **The form dialog:**
  - large fields using the same editors as grid cells (date picker, dropdowns, phone formatting, link picker from W04);
  - required fields marked and validated on submit;
  - errors listed at the top and focused.
- **Submit (main `FORM_SUBMIT(formId, rowId | null, values, noteAnswers)`), in one transaction:**
  - create the row (free-tier check) or update the changed cells only (history kept);
  - log the activity if configured, with content = "Q: A" lines from note questions plus changed fields when updating.
- **Undo:** one step (delete the created row, or restore the previous values, and void the note).

## 5. Printable blank form
`FORM_PRINT_BLANK(formId)` → PDF (jsPDF, letter):
- title, intro, each field label with a writing line (or boxes for dates `__/__/____`), checkbox squares for checkbox columns, dropdown options listed with squares;
- sections as headings;
- a footer with the list name and "Page X of Y".

"Print filled form" from a profile prints the same layout with values (for signatures).

## 6. Starters
`StarterList.forms` with fields referencing columns by **name**:
- human services: "Intake";
- auto service: "Vehicle check-in", "New customer";
- staff credentials: "New hire";
- therapy: "New client intake".

## 7. Tests
- Builder validation (unknown column, duplicate field, max 80 fields).
- Submit create/update; required enforcement in main as well as the UI; note logging; undo; free-tier block on create.
- Blank and filled PDF generation (page count, contains labels).
- A form survives column rename (by id) and delete (field dropped, shown as a warning in the builder).

## 8. Commits
1. Migration 041 + `forms.ts` + IPC + tests.
2. Builder UI.
3. Fill dialog + submit + undo.
4. Printable blank/filled PDFs.
5. Starter support.
