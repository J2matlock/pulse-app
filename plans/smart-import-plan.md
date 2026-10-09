# Smart Header Detection — Implementation Plan

## Problem

The current importer hardcodes row 1 as the header row. Real-world spreadsheets often have title rows, blank rows, or merged cells above the actual data headers. When the user's file has headers on row 5 (e.g., "First, Last, Billed, DOB, PHQ9, POC"), the importer picks up row 1's scattered values ("42", "Acuity") as column names and misses everything.

## Architecture Overview

Three-layer change:

1. **Main process** (`src/main/import.ts`): Add `detectHeaderRow()` function and `headerRowIndex` parameter to `parseImportFile` and `getCachedOrParse`
2. **IPC layer** (`src/main/ipc/ipc-export.ts`): Extend `IMPORT_FILE_PREVIEW` to accept and return `headerRowIndex`
3. **Renderer** (`src/renderer/components/grid/ImportWizard.tsx`): Show detected header row in preview, allow user adjustment

---

## 1. Header Detection Algorithm

**File:** `src/main/import.ts`

### Types

```typescript
export interface HeaderDetectionResult {
  headerRowIndex: number    // 0-based index into raw rows array
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

interface MergedCellInfo {
  row: number      // 0-based
  startCol: number
  endCol: number
}
```

### Function: `detectHeaderRow(rawRows: string[][], mergedRanges?: MergedCellInfo[]): HeaderDetectionResult`

Pseudocode:

```
1. Cap scan to min(rawRows.length, 20)
2. For each row index i from 0..scanLimit:
   a. Skip if row is completely empty (all cells blank/whitespace)
   b. Skip if row has only 1 non-empty cell (likely a title row)
   c. Count non-empty cells → nonEmptyCount
   d. Count "short distinct text" cells (length 1-40, not purely numeric, not a date) → textCount
   e. If row has a merged cell spanning >50% of total columns, skip it
   f. Score the row:
      - distinctRatio = uniqueNonEmptyCells / nonEmptyCount
      - textRatio = textCount / nonEmptyCount
      - nextRowDataScore: check row i+1 — mix of types (text + numbers + dates) = likely data
      - score = textRatio * 0.4 + distinctRatio * 0.3 + nextRowDataScore * 0.3
      - Candidate if textCount >= 3 AND textCount >= nonEmptyCount * 0.5
3. Return first candidate with highest score
4. Fallback: { headerRowIndex: 0, confidence: 'low', reason: 'defaulted to row 1' }
```

Confidence: score >= 0.8 = 'high', >= 0.5 = 'medium', else 'low'

### Helper: `isShortDistinctText(value: string): boolean`

```
- Trim whitespace
- Return false if empty
- Return false if length > 40
- Return false if purely numeric (matches /^\d+\.?\d*$/)
- Return false if looks like a date (reuse looksLikeDate())
- Return true otherwise
```

### Helper: `extractMergedRanges(ws: ExcelJS.Worksheet): MergedCellInfo[]`

Extract merged cell info from ExcelJS worksheet. Row with merged cell spanning >50% of column count is skipped as candidate.

---

## 2. Changes to `src/main/import.ts`

### 2.1 New exports

- [ ] `detectHeaderRow(rawRows: string[][], mergedRanges?: MergedCellInfo[]): HeaderDetectionResult`
- [ ] `isShortDistinctText(value: string): boolean` (private helper)
- [ ] `HeaderDetectionResult` interface
- [ ] `MergedCellInfo` interface
- [ ] `extractMergedRanges(ws: ExcelJS.Worksheet): MergedCellInfo[]`

### 2.2 Refactor `getCachedOrParse`

**Current:** `getCachedOrParse(filePath: string, sheetName?: string)`
**New:** `getCachedOrParse(filePath: string, sheetName?: string, headerRowIndex?: number)`

Both CSV and Excel paths refactored to:
1. Read ALL rows as raw `string[][]` first
2. Auto-detect or use provided `headerRowIndex` to split headers vs data

```typescript
// CSV path (was):
headers = raw[0]?.map(h => String(h).trim()) || []
allRows = raw.slice(1)

// CSV path (becomes):
const headerIdx = headerRowIndex ?? detectHeaderRow(raw).headerRowIndex
headers = raw[headerIdx]?.map(h => String(h).trim()) || []
allRows = raw.slice(headerIdx + 1)
```

```typescript
// Excel path (becomes):
const rawRows: string[][] = []
for (let r = 1; r <= maxRow; r++) { ... }
const mergedRanges = extractMergedRanges(ws)
const headerIdx = headerRowIndex ?? detectHeaderRow(rawRows, mergedRanges).headerRowIndex
headers = rawRows[headerIdx]?.map(h => h.trim()) || []
allRows = rawRows.slice(headerIdx + 1)
```

- [ ] Refactor Excel parsing to read all rows as raw `string[][]` first
- [ ] Refactor CSV parsing similarly — **IMPORTANT:** PapaParse currently uses `skipEmptyLines: true` (line 258). For header detection, raw rows must include blanks. Two approaches: (a) Parse once with `skipEmptyLines: false`, run detection on full raw data, then filter blank rows from the data portion (after header index) before building `allRows`. (b) Parse once without skipping, use detected headerIndex to split, then filter blanks only from data rows. **Approach (a) is simpler and preserves the existing behavior** where data rows don't include blanks.
- [ ] **Refactor cache to store raw rows only**, not already-split headers/data. Derive headers and allRows from rawRows + headerRowIndex at cache-read time. This avoids duplicate storage when the user adjusts headerRowIndex. Cache key: `(filePath, mtime)` for raw data; split is computed on read.

### 2.3 Modify `parseImportFile`

**Current:** `parseImportFile(filePath: string, sheetIndex = 0): Promise<ImportPreview>`
**New:** `parseImportFile(filePath: string, sheetIndex = 0, headerRowIndex?: number): Promise<ImportPreview>`

Add to `ImportPreview`:

```typescript
export interface ImportPreview {
  // ... existing fields ...
  detectedHeaderRow: number           // 0-based index of detected/selected header row
  headerDetectionConfidence: 'high' | 'medium' | 'low'
  rawRowCount: number                 // total raw rows before header
  rawPreviewRows?: string[][]         // first ~20 raw rows for preview display
}
```

- [ ] Add new fields to `ImportPreview`
- [ ] Pass `headerRowIndex` through to `getCachedOrParse`
- [ ] Populate fields from `detectHeaderRow` result
- [ ] `rawPreviewRows`: first `min(20, rawRowCount)` rows INCLUDING pre-header rows

### 2.4 Modify `ImportOptions`

```typescript
export interface ImportOptions {
  // ... existing fields ...
  headerRowIndex?: number  // 0-based. If omitted, auto-detect.
}
```

- [ ] Add `headerRowIndex` to `ImportOptions`
- [ ] In `executeImport`, pass `options.headerRowIndex` to `getCachedOrParse`

---

## 3. IPC Changes

**File:** `src/main/ipc/ipc-export.ts`

### `IMPORT_FILE_PREVIEW` handler

**Current:** `(filePath: string, sheetIndex?: number)`
**New:** `(filePath: string, sheetIndex?: number, headerRowIndex?: number)`

- [ ] Add `headerRowIndex` parameter (3rd arg)
- [ ] Pass to `parseImportFile(filePath, sheetIndex ?? 0, headerRowIndex)`
- [ ] Validate: if provided, must be non-negative integer < 100
- [ ] **Server-side clamp:** in `getCachedOrParse`, clamp `headerRowIndex` to `Math.min(headerRowIndex, rawRows.length - 2)` to prevent out-of-bounds if user somehow submits a value beyond actual data rows

### `IMPORT_FILE` handler

- [ ] Pass `options.headerRowIndex` to `parseImportFile` inside the handler
- [ ] **Fix existing bug:** handler currently hardcodes `sheetIndex=0` at ipc-export.ts:411 (`parseImportFile(options.filePath, 0)`). Change to pass the correct `sheetIndex` from options as well.

No new IPC channels needed.

---

## 4. Renderer UI Changes

**File:** `src/renderer/components/grid/ImportWizard.tsx`

### 4.1 Update local types

- [ ] Add `detectedHeaderRow: number` to `ImportPreview`
- [ ] Add `headerDetectionConfidence: 'high' | 'medium' | 'low'`
- [ ] Add `rawRowCount: number`
- [ ] Add `rawPreviewRows?: string[][]`
- [ ] Add `headerRowIndex?: number` to `ImportOptions`

### 4.2 New state

```typescript
const [headerRowIndex, setHeaderRowIndex] = useState<number>(0)
// Update when preview loads:
// setHeaderRowIndex(preview.detectedHeaderRow)
```

### 4.3 Step 3 (Preview) — Header Row Selector

Add above preview table:

```
┌─────────────────────────────────────────────────────────┐
│  Header row: Row 5          [▲] [▼]                     │
│  "We found your column headers on row 5.                │
│   Use the arrows if this isn't right."                  │
│  Confidence: High ✓                                     │
└─────────────────────────────────────────────────────────┘
```

When user clicks up/down:
1. Update `headerRowIndex` state
2. Re-call `loadPreview(filePath, selectedSheet, newHeaderRowIndex)` via `IMPORT_FILE_PREVIEW`
3. Preview table updates with new headers and data

- [ ] Add `HeaderRowSelector` section in Step 3
- [ ] Up/down buttons with `min-h-[44px]` click targets
- [ ] Display 1-indexed for user: "Header row: Row {headerRowIndex + 1}"
- [ ] Confidence indicator: green check (high), amber warning (medium/low)
- [ ] Medium/low: "We're not sure where the headers are. Please verify or adjust."
- [ ] Disable up when `headerRowIndex === 0`
- [ ] Disable down when `headerRowIndex >= rawRowCount - 2`

### 4.4 Preview Table — Show Pre-Header Rows

When `rawPreviewRows` available and `headerRowIndex > 0`:

- [ ] Rows 0..headerRowIndex-1: gray muted text (`text-slate-400`), italic, "Skipped" badge
- [ ] Header row: highlighted (`bg-blue-50 dark:bg-blue-900/20 font-semibold`)
- [ ] Data rows: normal styling below
- [ ] Add row number column on left side of preview table

### 4.5 Pass `headerRowIndex` to import

- [ ] In `handleImport()`, include `headerRowIndex` in `ImportOptions` passed to `IMPORT_FILE`

### 4.6 Clipboard paste path

Clipboard data always has row 1 as headers (no detection needed).

- [ ] Set `detectedHeaderRow: 0`, confidence `'high'`, `rawRowCount: rows.length + 1`
- [ ] Hide header row selector when `filePath === '__clipboard__'`

---

## 5. CSV Import

Same `detectHeaderRow` function works for both CSV and Excel (operates on `string[][]`). The refactoring in Section 2.2 handles this.

- [ ] Verify CSV path calls `detectHeaderRow` when `headerRowIndex` not provided
- [ ] Test with CSV files that have title rows

---

## 6. Migration Requirements

**None.** Purely parsing/UI change. No database schema changes.

---

## 7. Implementation Sequence

1. [ ] `detectHeaderRow` + `isShortDistinctText` + `extractMergedRanges` — pure functions, test in isolation
2. [ ] Refactor `getCachedOrParse` — read all rows as raw data, split by header index
3. [ ] Update `parseImportFile` — add `headerRowIndex` param, populate new `ImportPreview` fields
4. [ ] Update `ImportOptions` + `executeImport` — pass through `headerRowIndex`
5. [ ] Update IPC handler — pass `headerRowIndex` to `parseImportFile`
6. [ ] Update `ImportWizard.tsx` types — add new fields to local interfaces
7. [ ] Add header row selector UI in Step 3
8. [ ] Add raw preview rows rendering — pre-header rows grayed out
9. [ ] Wire up `headerRowIndex` in `handleImport`
10. [ ] Write tests
11. [ ] Manual testing with user's actual spreadsheet format

---

## 8. Test Scenarios

### Unit tests (`tests/import-header-detection.test.ts`)

- [ ] Simple file, headers on row 1 → index 0, confidence high
- [ ] Title row + blank row + headers on row 3 → index 2
- [ ] Multiple junk rows + headers on row 5 (user's scenario) → index 4
- [ ] Single-column file → still detects row 0 (relaxed threshold)
- [ ] Numeric headers → `[["1","2","3"],["a","b","c"]]` → picks row 1
- [ ] Empty rows interspersed → blank rows skipped
- [ ] All rows look like data (no clear header) → index 0, confidence 'low'
- [ ] Merged cell spanning full width → row skipped
- [ ] CSV with BOM + title row → BOM doesn't interfere
- [ ] `headerRowIndex` override → user-set value used regardless of auto-detection

### Integration tests

- [ ] Full import flow with header on row 5 → correct data in DB
- [ ] Re-preview with adjusted `headerRowIndex` → different headers returned
- [ ] Onboarding import path → ImportWizard works correctly

---

## 9. Edge Cases

- **Performance**: scans at most 20 rows, O(rows × cols) — negligible
- **Cache strategy**: cache stores raw rows keyed by `(filePath, mtime)`. Header split is computed at read time from raw + headerRowIndex, so changing headerRowIndex doesn't require re-parsing the file.
- **Backward compatibility**: `headerRowIndex` optional everywhere; omitting triggers auto-detect, which for normal files returns 0 — identical to current behavior
- **Clipboard paste**: exempted (always row 0)

---

## Critical Files

| File | Change |
|-|-|
| `src/main/import.ts` | Core: detectHeaderRow(), refactor getCachedOrParse/parseImportFile |
| `src/renderer/components/grid/ImportWizard.tsx` | UI: header row selector, raw preview rows, pass headerRowIndex |
| `src/main/ipc/ipc-export.ts` | IPC: pass headerRowIndex to parseImportFile/executeImport |
| `src/shared/ipc-channels.ts` | Reference only: no new channels needed |
