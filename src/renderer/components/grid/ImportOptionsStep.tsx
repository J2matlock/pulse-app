import React from 'react'
import type { Column } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import type { ColumnMapping, ImportOptions } from './importWizardShared'

export interface ImportOptionsStepProps {
  gridId: number
  duplicateStrategy: ImportOptions['duplicateStrategy']
  setDuplicateStrategy: (strategy: ImportOptions['duplicateStrategy']) => void
  cleanData: boolean
  setCleanData: (clean: boolean) => void
  createMissingLinks: boolean
  setCreateMissingLinks: (create: boolean) => void
  flipNames: boolean
  setFlipNames: (flip: boolean) => void
  mappings: ColumnMapping[]
  existingColumns: Column[]
  /** A "Last, First" name in an imported column, to offer flipping */
  lastFirstExample: { column: string; from: string; to: string } | null
}

/** Step 5: duplicates, cleanup, missing linked records and last-name-first names */
export function ImportOptionsStep({
  gridId, duplicateStrategy, setDuplicateStrategy, cleanData, setCleanData, createMissingLinks, setCreateMissingLinks,
  flipNames, setFlipNames, mappings, existingColumns, lastFirstExample,
}: ImportOptionsStepProps): React.ReactElement {
  const { t } = useVocab(gridId)
  return (
    <div className="px-6 py-6 space-y-6 max-w-xl">
      {/* Someone already here: plain choices, not "duplicate detection" (UX-B-34, A-22) */}
      <fieldset>
        <legend className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
          If a name is already in this {t('list')}
        </legend>
        <div className="space-y-3">
          {(
            [
              { value: 'none', label: 'Import it anyway' },
              { value: 'by_name', label: 'Skip it' },
              { value: 'name_and_dob', label: 'Skip it only if the date of birth matches too' },
            ] as const
          ).map(opt => (
            <label
              key={opt.value}
              className="flex items-center gap-3 cursor-pointer min-h-[44px]"
            >
              <input
                type="radio"
                name="duplicate-strategy"
                value={opt.value}
                checked={duplicateStrategy === opt.value}
                onChange={() => setDuplicateStrategy(opt.value)}
                className="w-5 h-5 text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-base text-slate-700 dark:text-slate-200">{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Tidy up */}
      <div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
          Tidy up
        </h3>
        <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={cleanData}
            onChange={e => setCleanData(e.target.checked)}
            className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
          />
          <div>
            <span className="text-base text-slate-700 dark:text-slate-200">
              Tidy the data as it comes in
            </span>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Removes extra spaces, and writes dates and phone numbers the same way
            </p>
          </div>
        </label>
        {mappings.some(m => typeof m.action === 'number' && existingColumns.find(c => c.id === m.action)?.column_type === 'link') && (
          <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={createMissingLinks}
              onChange={e => setCreateMissingLinks(e.target.checked)}
              className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
            />
            <div>
              <span className="text-base text-slate-700 dark:text-slate-200">Add linked {t('record', { many: true })} that don't exist yet</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Names in link columns are matched to the other {t('list')}. Otherwise, names that match no one are listed afterwards.
              </p>
            </div>
          </label>
        )}
        {lastFirstExample && (
          <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={flipNames}
              onChange={e => setFlipNames(e.target.checked)}
              className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
            />
            <div>
              <span className="text-base text-slate-700 dark:text-slate-200">
                Change "{lastFirstExample.from}" to "{lastFirstExample.to}"
              </span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Names in "{lastFirstExample.column}" are written last name first
              </p>
            </div>
          </label>
        )}
      </div>
    </div>
  )
}
