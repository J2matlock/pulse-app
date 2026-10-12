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
}

/** Step 4: each column in the file goes into a new column, an existing one, or nowhere */
export function ImportMappingStep({ gridId, preview, mappings, existingColumns, updateMapping }: ImportMappingStepProps): React.ReactElement {
  const { t } = useVocab(gridId)
  return (
    <div className="px-6 py-4 space-y-3">
      <p className="text-base text-slate-600 dark:text-slate-400">
        Map each column from your file to a column in this {t('list')}.
      </p>
      <div className="overflow-y-auto max-h-[400px] border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                Import Column
              </th>
              <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                Map To
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
                    {isNotesColumn(col.originalName) && mapping.action !== 'skip' && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        Notes come in as a text column, so nothing is lost.
                      </p>
                    )}
                  </td>

                  {/* Map-to controls */}
                  <td className="px-3 py-3 space-y-2">
                    <div className="relative">
                      <select
                        value={
                          mapping.action === 'create' ? 'create'
                          : mapping.action === 'skip' ? 'skip'
                          : String(mapping.action)
                        }
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
                        <option value="create">Create new column</option>
                        <option value="skip">Skip (do not import)</option>
                        {existingColumns.filter(ec => canImportInto(ec.column_type)).map(ec => (
                          <option key={ec.id} value={String(ec.id)}>{ec.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                    </div>

                    {mapping.action === 'create' && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={mapping.newName ?? ''}
                          onChange={e => updateMapping(i, { newName: e.target.value })}
                          placeholder="Column name"
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600
                                     bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                     px-3 py-2 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                     min-h-[44px]"
                        />
                        <div className="relative">
                          <select
                            value={mapping.newType ?? 'text'}
                            onChange={e => updateMapping(i, { newType: e.target.value })}
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
