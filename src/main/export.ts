/**
 * export.ts — Barrel re-export file.
 * All implementations live in export-csv.ts, export-pdf.ts, and export-supervisor.ts.
 * Shared helpers and types live in export-shared.ts.
 */

// Re-export types so existing `import type { ... } from './export'` still works
export type {
  CsvExportOptions,
  PdfProfileOptions,
  PdfGridOptions,
  SupervisorReportOptions,
} from './export-shared'

// Re-export shared helpers that other modules may use directly
export {
  atomicWriteFileSync,
  atomicWriteFileAsync,
  stripHtml,
  formatDate,
  sanitizeCsvFormula,
  formatCellValue,
  loadGridData,
  getClientName,
  batchGetClientNames,
} from './export-shared'

// Re-export CSV
export { exportCsv } from './export-csv'

// Re-export PDF functions
export {
  exportLetterPdf,
  exportPdfGrid,
  exportPdfProfile,
  exportContactPdf,
  exportDirectoryPdf,
} from './export-pdf'

// Re-export Supervisor Report
export { exportSupervisorReport } from './export-supervisor'
