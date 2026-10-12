import React from 'react'
import { Check, AlertTriangle } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import type { ImportResult } from './importWizardShared'

export interface ImportResultsStepProps {
  gridId: number
  loading: boolean
  importProgress: { imported: number; total: number } | null
  error: string | null
  importResult: ImportResult | null
  undo: 'idle' | 'busy' | 'done'
  onUndo: () => Promise<void>
  warningsExpanded: boolean
  setWarningsExpanded: React.Dispatch<React.SetStateAction<boolean>>
}

/** Step 6: progress while importing, then what came in, what was skipped, and Undo */
export function ImportResultsStep({
  gridId, loading, importProgress, error, importResult, undo, onUndo, warningsExpanded, setWarningsExpanded,
}: ImportResultsStepProps): React.ReactElement {
  const { t } = useVocab(gridId)
  return (
    <div className="px-6 py-8 flex flex-col items-center">
      {loading && (
        <div className="flex flex-col items-center gap-3 py-8 w-full max-w-md">
          {importProgress ? (
            <>
              <span className="text-base text-slate-600 dark:text-slate-300">
                Importing {importProgress.imported} of {importProgress.total}…
              </span>
              <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
                  style={{ width: `${Math.round((importProgress.imported / importProgress.total) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <span className="text-base text-slate-500 dark:text-slate-400 animate-pulse">
              Importing…
            </span>
          )}
        </div>
      )}

      {!loading && error && (
        <div className="w-full max-w-md flex items-start gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-base font-medium text-red-700 dark:text-red-300">Import failed</p>
            <p className="text-base text-red-600 dark:text-red-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!loading && importResult && (
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700">
            <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-base font-semibold text-green-800 dark:text-green-200">
                {importResult.imported} {t('record', { count: importResult.imported })} imported
              </p>
              {importResult.skipped > 0 && (
                <p className="text-base text-green-700 dark:text-green-300 mt-0.5">
                  {importResult.skipped} skipped because {importResult.skipped === 1 ? 'it was' : 'they were'} already here
                  {importResult.skippedNames && importResult.skippedNames.length > 0 && (
                    <>: {importResult.skippedNames.slice(0, 10).join(', ')}{importResult.skippedNames.length > 10 ? `, and ${importResult.skippedNames.length - 10} more` : ''}</>
                  )}
                </p>
              )}
            </div>
          </div>

          {(importResult.newRowIds?.length ?? 0) > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              {undo === 'done' ? (
                <p role="status" className="text-base text-slate-700 dark:text-slate-200">
                  Undone: the {importResult.newRowIds!.length} imported {t('record', { count: importResult.newRowIds!.length })} {importResult.newRowIds!.length === 1 ? 'is' : 'are'} in the Trash, where {importResult.newRowIds!.length === 1 ? 'it' : 'they'} can be restored.
                </p>
              ) : (
                <>
                  <p className="text-base text-slate-600 dark:text-slate-300 flex-1 min-w-[12rem]">Imported into the wrong {t('list')}, or the wrong file?</p>
                  <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={undo === 'busy'} onClick={() => void onUndo()}>
                    {undo === 'busy' ? 'Undoing…' : 'Undo this import'}
                  </button>
                </>
              )}
            </div>
          )}

          {importResult.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-base font-medium text-amber-700 dark:text-amber-300">
                  {importResult.warnings.length} warning{importResult.warnings.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => setWarningsExpanded(v => !v)}
                  className="ml-auto text-base text-amber-700 dark:text-amber-400 hover:underline
                             focus:outline-hidden focus:ring-3 focus:ring-amber-400 rounded-sm min-h-[44px] px-2"
                >
                  {warningsExpanded ? 'Hide' : 'Show'}
                </button>
              </div>
              {warningsExpanded && (
                <ul className="px-4 pb-3 space-y-1">
                  {importResult.warnings.slice(0, 10).map((w, i) => (
                    <li key={i} className="text-sm text-amber-700 dark:text-amber-300">
                      {w}
                    </li>
                  ))}
                  {importResult.warnings.length > 10 && (
                    <li className="text-sm text-amber-700 dark:text-amber-400">
                      ...and {importResult.warnings.length - 10} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
