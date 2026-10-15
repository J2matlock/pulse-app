import React from 'react'
import { ChevronDown } from 'lucide-react'
import type { Column } from '../../../shared/types'
import { canImportInto } from '../../../shared/types'
import { columnTypeLabel } from '../../../shared/columnTypes'
import { useVocab } from '../../hooks/useVocab'
import { COLUMN_TYPES, TypeBadge, isNotesColumn, type ColumnMapping, type ImportPreview } from './importWizardShared'

export interface ImportMappingStepProps {
  gridId: number
  preview: ImportPreview
  mappings: ColumnMapping[]
  existingColumns: Column[]
  updateMapping: (index: number, changes: Partial<ColumnMapping>) => void
  /** A first-name and a last-name column were found in the file (UX-A-07) */
  nameParts: { firstIndex: number; lastIndex: number; first: string; last: string; example: string | null } | null
  combineNames: boolean
  setCombineNames: (combine: boolean) => void
}

/** Step 4: each column in the file goes into a new column, an existing one, or nowhere */
export function ImportMappingStep({
  gridId, preview, mappings, existingColumns, updateMapping, nameParts, combineNames, setCombineNames,
}: ImportMappingStepProps): React.ReactElement {
  const { t } = useVocab(gridId)
  const importable = existingColumns.filter(ec => canImportInto(ec.column_type))
  // Where the first name goes, to say where the whole name will be
  const firstMapping = nameParts ? mappings.find(m => m.sourceIndex === nameParts.firstIndex) : undefined
  const nameTarget = !firstMapping || firstMapping.action === 'skip' ? null
    : firstMapping.action === 'create' ? (firstMapping.newName || nameParts!.first)
    : existingColumns.find(c => c.id === firstMapping.action)?.name ?? nameParts!.first
  return (
    <div className="px-6 py-4 space-y-3">
      <p className="text-base text-slate-600 dark:text-slate-400">
        Choose where each column in your file goes in this {t('list')}.
      </p>
      {nameParts && nameTarget && (
        <label className="flex items-start gap-3 cursor-pointer min-h-[44px] p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
          <input
            type="checkbox"
            checked={combineNames}
            onChange={e => setCombineNames(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
          />
          <span className="text-base text-slate-700 dark:text-slate-200">
            Combine "{nameParts.first}" + "{nameParts.last}" into {nameTarget}
            {nameParts.example && <span className="text-slate-600 dark:text-slate-300"> ({nameParts.example})</span>}
          </span>
        </label>
      )}
      <div className="overflow-y-auto max-h-[400px] border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                Column in your file
              </th>
              <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                Goes into
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.detectedColumns.map((col, i) => {
              const mapping = mappings[i] ?? { sourceIndex: col.index, action: 'create', newName: col.originalName, newType: col.detectedType }
              return (
                <tr key={col.index} className="border-b border-slate-100 dark:border-slate-700/50">
                  {/* Source column */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-slate-700 dark:text-slate-200">
                        {col.originalName}
                      </span>
                      <TypeBadge type={col.detectedType} />
                    </div>
                    {col.samples.filter(Boolean).length > 0 && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        e.g. {col.samples.filter(Boolean).slice(0, 2).join(', ')}
                      </p>
                    )}
                    {nameParts && nameTarget && combineNames && col.index === nameParts.lastIndex && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        {mapping.action === 'skip'
                          ? `Already part of ${nameTarget}. Choose "A new column" to keep it on its own too.`
                          : `Also part of ${nameTarget}.`}
                      </p>
                    )}
                    {isNotesColumn(col.originalName) && mapping.action !== 'skip' && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        Notes come in as a notes column, so long text is kept whole.
                      </p>
                    )}
                  </td>

                  {/* Where it goes */}
                  <td className="px-3 py-3 space-y-2">
                    <div className="relative">
                      <select
                        value={
                          mapping.action === 'create' ? 'create'
                          : mapping.action === 'skip' ? 'skip'
                          : String(mapping.action)
                        }
                        aria-label={`Where "${col.originalName}" goes`}
                        onChange={e => {
                          const v = e.target.value
                          if (v === 'create') {
                            updateMapping(i, { action: 'create', newName: col.originalName, newType: col.detectedType })
                          } else if (v === 'skip') {
                            updateMapping(i, { action: 'skip', newName: undefined, newType: undefined })
                          } else {
                            updateMapping(i, { action: Number(v), newName: undefined, newType: undefined })
                          }
                        }}
                        className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-600
                                   bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                   px-3 py-2 pr-8 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                   min-h-[44px]"
                      >
                        <option value="create">A new column</option>
                        <option value="skip">Leave it out</option>
                        {importable.length > 0 && (
                          <optgroup label={`A column already in this ${t('list')}`}>
                            {importable.map(ec => (
                              <option key={ec.id} value={String(ec.id)}>{ec.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                    </div>

                    {mapping.action === 'create' && (
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={mapping.newName ?? ''}
                          onChange={e => updateMapping(i, { newName: e.target.value })}
                          placeholder="Column name"
                          aria-label={`Name of the new column for "${col.originalName}"`}
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600
                                     bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                     px-3 py-2 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                     min-h-[44px]"
                        />
                        <div className="relative">
                          <select
                            value={mapping.newType ?? 'text'}
                            onChange={e => updateMapping(i, { newType: e.target.value })}
                            aria-label={`What the new column for "${col.originalName}" holds`}
                            className="appearance-none rounded-lg border border-slate-300 dark:border-slate-600
                                       bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                       px-3 py-2 pr-8 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                       min-h-[44px]"
                          >
                            {COLUMN_TYPES.map(t => (
                              <option key={t} value={t}>{columnTypeLabel(t)}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
