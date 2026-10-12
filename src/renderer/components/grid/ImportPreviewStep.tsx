import React from 'react'
import { ChevronUp, ChevronDown, Check, AlertTriangle } from 'lucide-react'
import { TypeBadge, type ImportPreview } from './importWizardShared'

export interface ImportPreviewStepProps {
  preview: ImportPreview
  /** Set for a file (the header row can be moved); a paste has none */
  filePath: string | null
  headerRowIndex: number
  loading: boolean
  skipHiddenRows: boolean
  setSkipHiddenRows: (skip: boolean) => void
  /** Read the file again with its headers on this row */
  onHeaderRowChange: (index: number) => void
}

/** Step 3: the first rows as they'll be read, the header row, and hidden rows and columns */
export function ImportPreviewStep({
  preview, filePath, headerRowIndex, loading, skipHiddenRows, setSkipHiddenRows, onHeaderRowChange,
}: ImportPreviewStepProps): React.ReactElement {
  return (
    <div className="px-6 py-4 space-y-3">
      {(preview.warnings ?? []).map((w, i) => (
        <div key={i} role="status" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-base text-amber-900 dark:text-amber-200">{w}</p>
        </div>
      ))}
      {/* Hidden rows and columns come in like the rest unless left out (AUDIT-127) */}
      {((preview.hiddenRowCount ?? 0) > 0 || (preview.hiddenColumns?.length ?? 0) > 0) && (
        <div role="status" className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 space-y-2">
          {(preview.hiddenRowCount ?? 0) > 0 && (() => {
            const n = preview.hiddenRowCount ?? 0
            return (
              <>
                <p className="text-base text-slate-700 dark:text-slate-200">
                  This spreadsheet has {n} hidden {n === 1 ? 'row' : 'rows'} (for example, rows filtered out or hidden in Excel). {n === 1 ? 'It comes in' : 'They come in'} like the others unless you leave {n === 1 ? 'it' : 'them'} out.
                </p>
                <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={skipHiddenRows}
                    onChange={e => setSkipHiddenRows(e.target.checked)}
                    className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-base text-slate-700 dark:text-slate-200">Leave out {n} hidden {n === 1 ? 'row' : 'rows'}</span>
                </label>
              </>
            )
          })()}
          {(preview.hiddenColumns?.length ?? 0) > 0 && (
            <p className="text-base text-slate-700 dark:text-slate-200">
              Hidden {(preview.hiddenColumns?.length ?? 0) === 1 ? 'column' : 'columns'} in the spreadsheet: {preview.hiddenColumns?.join(', ')}. To leave {(preview.hiddenColumns?.length ?? 0) === 1 ? 'it' : 'them'} out, choose Skip on the next step.
            </p>
          )}
        </div>
      )}
      {/* Header Row Selector — hide for clipboard paste */}
      {filePath && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-slate-700 dark:text-slate-200">
                Header row: Row {headerRowIndex + 1}
              </span>
              {preview.headerDetectionConfidence === 'high' ? (
                <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5" /> Confident
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" /> Verify
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {preview.headerDetectionConfidence === 'high'
                ? 'We found your column headers on this row.'
                : "We're not sure where the headers are. Please verify or adjust."}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => {
                if (headerRowIndex <= 0) return
                onHeaderRowChange(headerRowIndex - 1)
              }}
              disabled={headerRowIndex <= 0 || loading}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600
                         text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500
                         disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
              aria-label="Move header row up"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (headerRowIndex >= (preview.rawRowCount ?? 1) - 2) return
                onHeaderRowChange(headerRowIndex + 1)
              }}
              disabled={headerRowIndex >= (preview.rawRowCount ?? 1) - 2 || loading}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600
                         text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500
                         disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
              aria-label="Move header row down"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <p className="text-base text-slate-600 dark:text-slate-400">
        Showing first {Math.min(preview.rows.length, 20)} rows. Detected {preview.headers.length} column{preview.headers.length !== 1 ? 's' : ''}.
      </p>

      <div className="overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg max-h-[380px]">
        <table className="w-full text-sm border-collapse">
          {/* Show raw preview rows if available and header is not row 0 */}
          {preview.rawPreviewRows && headerRowIndex > 0 && (
            <tbody>
              {preview.rawPreviewRows.slice(0, headerRowIndex).map((row, ri) => (
                <tr key={`pre-${ri}`} className="bg-slate-50 dark:bg-slate-800/50">
                  <td className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                    {ri + 1}
                  </td>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 italic whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                      {cell || ''}
                    </td>
                  ))}
                  {ri === 0 && (
                    <td className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">Skipped</td>
                  )}
                </tr>
              ))}
            </tbody>
          )}
          <thead className="sticky top-0 bg-blue-50 dark:bg-blue-900/20">
            <tr>
              <th className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                {headerRowIndex + 1}
              </th>
              {preview.detectedColumns.map(col => (
                <th
                  scope="col"
                  key={col.index}
                  className="border-b border-blue-200 dark:border-blue-700 px-3 py-2 text-left text-base font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.originalName}</span>
                    <TypeBadge type={col.detectedType} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 20).map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-slate-100 dark:border-slate-700/50 even:bg-slate-50/50 dark:even:bg-slate-800/30"
              >
                <td className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                  {headerRowIndex + 2 + ri}
                </td>
                {preview.headers.map((_, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-base text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                  >
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
