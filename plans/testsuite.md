# Testing Instructions for CaseConnect Pulse

Write a comprehensive integration test suite using Vitest. Tests should run against a real SQLCipher database (in-memory or temp file) — no mocks for the database layer. Organize tests into the files listed below. Every test should be a scenario that would actually break a user's experience if it failed.

---

## 1. Database Layer Tests (`tests/database.test.ts`)

### Schema & Migrations
- Fresh database creates all tables with correct columns and indexes
- Running migrations twice doesn't error (idempotent)
- Foreign key cascades work: delete a row → verify its cells, checklist_items, case_log, scrap_notes, document_refs are ALL gone
- Foreign key cascades: delete a column → verify all cells for that column are gone
- Foreign key cascades: delete a grid → verify all rows, columns, cells, alerts, tags, saved_views, saved_filters are gone

### SQLCipher Encryption
- Open database with correct password succeeds
- Open database with wrong password throws error (not silent corruption)
- Database file on disk is NOT readable as plain text (read first 100 bytes, verify it's not "SQLite format 3")
- Change password with PRAGMA rekey, close, reopen with new password succeeds
- After rekey, old password no longer works

### Cell Operations
- Create cell, read it back, values match
- Update cell value, verify old value is recorded in cell_history
- Update cell 10 times, verify cell_history has 10 entries with correct old/new values
- Bulk update cells in a single transaction, verify all updated
- NULL values stored and retrieved correctly
- Very long text (10,000 characters) stores and retrieves correctly
- Unicode text (Chinese, Arabic, emoji) stores and retrieves correctly
- Special characters in values: quotes, backslashes, semicolons, SQL injection attempts like `'; DROP TABLE rows;--`

### Row Operations
- Create row, verify position auto-increments
- Archive row: is_active becomes 0, archived_at is set, archived_reason is stored
- Unarchive row: is_active back to 1, archived_at cleared
- Duplicate row: new row created with same cell values, different ID, cleared name
- Star/unstar row
- Color label: set, change, clear
- Row ordering: reorder rows, verify positions update correctly

### Performance
- Insert 500 rows with 20 columns each (10,000 cells) in under 5 seconds
- Query all rows for a grid with 500 rows returns in under 300ms
- Search across 500 rows returns in under 200ms

---

## 2. Deadline Calculation Engine Tests (`tests/deadlines.test.ts`)

### Core Calculations
- Date 90 days from now → returns "green" zone (or whatever the first threshold is)
- Date 30 days from now → returns "yellow"
- Date 14 days from now → returns "orange"
- Date 7 days from now → returns "red"
- Date is today → returns "due today" / pulse
- Date was yesterday → returns "1 day overdue"
- Date was 30 days ago → returns "30 days overdue"
- Date was 365 days ago → returns correct overdue count
- NULL date → returns no alert (not a crash)
- Invalid date string → returns no alert (not a crash)

### Alert Rule Application
- Apply "Annual Assessment" template (365-day cycle) to a date, verify thresholds match spec
- Apply "Monthly Contact" template (30-day cycle), verify thresholds
- Custom rule with custom thresholds, verify each threshold triggers at correct day count
- Rule with no cycle (one-time date like Court Date), verify it doesn't auto-cycle

### Auto-Cycling
- Date column with 365-day cycle: enter new date → verify old date saved to cell_history
- Verify new date is exactly [cycle_days] after the entered date (or however cycling works)
- Verify case_log auto-entry is created: "Annual Assessment date updated from [old] to [new]"

### Edge Cases
- Leap year: Feb 29 date calculations don't break
- Date far in the future (year 2099): doesn't crash
- Date far in the past (year 1950): doesn't crash
- Multiple alert rules on different columns, verify each calculates independently
- "Due today" at 11:59 PM still shows as due today (date-only, not datetime)

### Dashboard Queries
- Priority List: verify items sorted by urgency (most overdue first)
- "This Week" view: verify only items due within the current week are shown
- "Overdue" filter: returns only items past due date
- Stats: total active clients count is correct, overdue count is correct, due-this-week count is correct

---

## 3. Import Parser Tests (`tests/import.test.ts`)

### CSV Parsing
- Standard CSV with headers: parses correctly, correct row count, correct column count
- CSV with quoted fields containing commas: "Smith, Jr." doesn't split into two columns
- CSV with quoted fields containing newlines: multi-line notes field parses as single value
- CSV with empty rows: skipped, not imported as blank clients
- CSV with no headers (just data): still parses, columns named "Column 1", "Column 2", etc.
- CSV with trailing commas: doesn't create phantom empty columns
- CSV with mixed line endings (\\r\\n and \\n): parses correctly
- CSV with BOM (byte order mark): parses correctly
- Empty CSV file: graceful error, not crash
- CSV with only headers, no data rows: graceful handling

### Excel Parsing
- .xlsx file with single sheet: parses correctly
- .xlsx file with multiple sheets: returns sheet names for user selection
- .xlsx with formatted dates (Excel serial date numbers): converts to readable dates
- .xlsx with merged cells: handles gracefully (unmerge and fill)
- .xls (legacy format): parses correctly
- Empty .xlsx: graceful error

### Column Type Auto-Detection
- Column of "01/15/2026", "02/28/2025", "12/01/2024" → detected as date
- Column of "1/5/26", "2/8/25" → detected as date (short format)
- Column of "January 15, 2026" → detected as date (long format)
- Column of "(518) 555-0142", "518-555-0287" → detected as phone
- Column of "5185550142", "5185550287" → detected as phone (10-digit)
- Column of "user@email.com", "name@domain.org" → detected as email
- Column of "42", "17", "103" → detected as number
- Column of "$42.00", "$1,250.50" → detected as currency
- Column of "TRUE", "FALSE", "true", "false" → detected as checkbox
- Column of "Active", "Inactive", "Pending" (repeating values, <10 unique) → detected as dropdown
- Column of mixed text with no pattern → detected as text
- Column with 80% dates and 20% garbage → detected as date (with warnings on bad rows)

### Data Cleanup
- Leading/trailing whitespace stripped: " John Smith " → "John Smith"
- Phone auto-formatted: "5185550142" → "(518) 555-0142"
- Date normalization: "1/5/26" → "01/05/2026" (or user's configured format)
- Empty strings converted to NULL
- Duplicate detection: two rows with same name flagged as potential duplicates

### Error Handling
- Row with wrong number of columns: import continues, row flagged with warning
- Completely corrupted file (binary garbage): graceful error message
- File over 10MB: still works (test with generated large CSV)
- File with 50+ columns: handles correctly

---

## 4. Undo System Tests (`tests/undo.test.ts`)

### Cell Edits
- Edit a cell → undo → cell returns to previous value
- Edit a cell → undo → redo → cell has the new value again
- Edit same cell 5 times → undo 5 times → original value restored
- Edit same cell 5 times → undo 3 times → make new edit → redo stack is cleared

### Row Operations
- Create a row → undo → row is deleted
- Delete a row → undo → row is restored with all its cells, checklist items, and case log entries
- Archive a row → undo → row is active again
- Duplicate a row → undo → duplicate is removed, original untouched
- Reorder rows → undo → original order restored

### Column Operations
- Create a column → undo → column and all its cells are removed
- Delete a column → undo → column and all its cell data are restored
- Rename a column → undo → original name restored

### Bulk Operations
- Select 5 rows, bulk archive → undo → all 5 rows are active again (single undo, not 5)
- Select 3 rows, bulk tag → undo → tags removed from all 3

### Checklist
- Complete a checklist item → undo → item is uncompleted, completed_at is cleared
- Create a checklist item → undo → item removed
- Delete a checklist item → undo → item restored with all fields

### Case Log
- Create case log entry → undo → entry removed
- Edit case log entry → undo → original content restored
- Delete case log entry → undo → entry restored

### Stack Behavior
- Undo stack respects 100-action limit: perform 110 actions, undo 100 times, verify you stop at action 11 (oldest action is gone)
- Undo stack clears on app restart (test by simulating session change)
- Undo toast appears after destructive actions (row delete)

---

## 5. Backup & Restore Tests (`tests/backup.test.ts`)

### Auto-Backup on Close
- Simulate app close → verify backup file created in backups/ folder
- Verify backup filename matches pattern: pulse-auto-YYYY-MM-DD-HHMMSS.db
- Create 7 auto-backups → verify only the 5 most recent remain (oldest 2 deleted)
- Verify backup file is encrypted (not readable as plain SQLite)

### Manual Backup
- Create manual backup → verify file created at chosen path
- Verify backup contains all data (open backup with password, query row count)
- Backup file is a valid SQLCipher database

### Restore
- Create data (10 clients) → backup → delete 5 clients → restore → verify all 10 clients are back
- Restore creates a pre-restore safety backup before overwriting
- Restore from backup with different password than current database: works when correct backup password provided
- Restore from corrupted file: graceful error, current database untouched

### Pack & Go
- Pack & Go creates a compressed file
- Compressed file is smaller than raw database
- Extract and open the database inside: data intact

### Password Change + Backup Interaction
- Create backup → change password → verify old backup requires OLD password to restore
- After password change, new auto-backups use the NEW password

---

## 6. Sorting Tests (`tests/sorting.test.ts`)

### Single Column Sort
- Sort text column ascending: A, B, C order
- Sort text column descending: Z, Y, X order
- Sort date column ascending: earliest first (NOT alphabetical — "02/01" before "12/01")
- Sort number column: numeric order (2 before 10, not string "10" before "2")
- Sort checkbox column: unchecked first (ascending), checked first (descending)
- Sort currency column: numeric by value, not by formatted string

### Multi-Column Sort
- Sort by Status (primary), then Name (secondary): verify grouping within status
- Sort by 3 columns: verify priority order is respected
- Remove secondary sort: primary sort still active

### Null Handling
- Rows with NULL values sort to bottom regardless of direction
- Rows with empty strings sort to bottom

### Sort Persistence
- Set a sort → close and reopen grid → sort is still active
- Sort config stored correctly in grids.sort_config JSON

---

## General Test Requirements
- Use Vitest as test runner
- Use a temp directory for test databases (clean up after each test)
- Each test file should set up a fresh database in beforeEach
- Tests should be runnable with `npm test`
- No network calls in any test
- Tests should complete in under 60 seconds total
