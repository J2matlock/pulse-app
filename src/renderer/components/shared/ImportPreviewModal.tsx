/**
 * ImportPreviewModal — Shows a preview of a .pulse template file and lets the
 * user choose to create a new grid or apply to an existing one.
 *
 * Used by TemplateManagerView (manual import) and App.tsx (file association open).
 */
import React, { useState } from 'react'
import { FileText, ChevronDown } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { IPC } from '../../../shared/ipc-channels'
import type { Grid } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { reloadAfterApply } from '../../utils/reloadAfterApply'
import { friendlyError } from '../../utils/friendlyError'

export interface PulseImportPreview {
  name: string
  description?: string
  columnCount: number
  alertRuleCount: number
  checklistCount: number
  columns: Array<{ name: string; column_type: string; degraded?: boolean }>
  warnings: string[]
}

export interface ImportedFile {
  filePath: string
  preview: PulseImportPreview
}

type ApplyMode = 'new' | 'existing'

function Badge({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
      {children}
    </span>
  )
}

interface ImportPreviewModalProps {
  imported: ImportedFile
  grids: Grid[]
  onClose: () => void
  onApplied: () => void
}

export function ImportPreviewModal({ imported, grids, onClose, onApplied }: ImportPreviewModalProps): React.ReactElement {
  const { filePath, preview } = imported
  const { t } = useVocab(null)
  const [applyMode, setApplyMode] = useState<ApplyMode>('new')
  const [selectedGridId, setSelectedGridId] = useState<number | null>(grids[0]?.id ?? null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApply() {
    setError(null)
    if (applyMode === 'existing' && !selectedGridId) {
      setError(`Choose ${t('list', { article: true })} to add it to.`)
      return
    }
    setApplying(true)
    try {
      const res = await safeInvoke<{ pulse: unknown; preview: PulseImportPreview }>(
        IPC.SETUP_TEMPLATE_IMPORT,
        filePath
      )

      if (!res.ok) {
        setError(friendlyError(res.error, "We couldn't bring in the template — try again"))
        return
      }

      const applyRes = await safeInvoke(
        IPC.SETUP_TEMPLATE_APPLY,
        JSON.stringify(res.data.pulse),
        applyMode,
        applyMode === 'existing' ? selectedGridId : undefined,
        true  // save to library
      )

      if (!applyRes.ok) {
        setError(friendlyError(applyRes.error, "We couldn't use the template — try again"))
        return
      }

      // Its deadline rules and, in an existing list, its new columns show straight away
      await reloadAfterApply(applyMode === 'existing' ? selectedGridId : null)
      onApplied()
    } catch {
      setError("We couldn't use the template — try again")
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Import template" size="lg"
      icon={<FileText className="w-6 h-6 text-blue-500" aria-hidden="true" />}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton
          onClick={handleApply}
          disabled={applying || (applyMode === 'existing' && grids.length === 0)}
        >
          {applying ? 'Applying…' : applyMode === 'new' ? `Make the ${t('list')}` : `Add to this ${t('list')}`}
        </PrimaryButton>
      </>}>
        <div className="space-y-6">
          {/* Template info */}
          <div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{preview.name}</h3>
            {preview.description && (
              <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{preview.description}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{preview.columnCount} column{preview.columnCount !== 1 ? 's' : ''}</Badge>
              <Badge>{preview.alertRuleCount} deadline rule{preview.alertRuleCount !== 1 ? 's' : ''}</Badge>
              <Badge>{preview.checklistCount} checklist{preview.checklistCount !== 1 ? 's' : ''}</Badge>
            </div>
          </div>

          {/* Column list */}
          {preview.columns.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">
                Columns
              </h4>
              <ul className="space-y-1">
                {preview.columns.map((col, i) => (
                  <li key={i} className="flex items-center justify-between text-base">
                    <span className={col.degraded ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
                      {col.name}
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">{col.column_type}{col.degraded ? ' (simplified)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {preview.warnings.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">Heads up</p>
              <ul className="space-y-1">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-400">{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Apply mode */}
          <div>
            <h4 className="text-base font-medium text-slate-700 dark:text-slate-300 mb-3">
              Where should this be applied?
            </h4>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                <input
                  type="radio"
                  name="applyMode"
                  value="new"
                  checked={applyMode === 'new'}
                  onChange={() => setApplyMode('new')}
                  className="w-4 h-4 text-blue-600 focus:ring-3 focus:ring-blue-500"
                />
                <span className="text-base text-slate-700 dark:text-slate-300">Make a new {t('list')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                <input
                  type="radio"
                  name="applyMode"
                  value="existing"
                  checked={applyMode === 'existing'}
                  onChange={() => setApplyMode('existing')}
                  className="w-4 h-4 text-blue-600 focus:ring-3 focus:ring-blue-500"
                />
                <span className="text-base text-slate-700 dark:text-slate-300">Add to {t('list', { article: true })} I already have</span>
              </label>
            </div>

            {applyMode === 'existing' && (
              <div className="mt-3">
                {grids.length === 0 ? (
                  <p className="text-base text-slate-500 dark:text-slate-400">There are no {t('list', { many: true })} yet. Choose &ldquo;Make a new {t('list')}&rdquo; instead.</p>
                ) : (
                  <div className="relative">
                    <select
                      value={selectedGridId ?? ''}
                      onChange={e => setSelectedGridId(parseInt(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                                 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                                 px-3 py-2 text-base min-h-[44px] appearance-none
                                 focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent pr-10"
                    >
                      {grids.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="text-base text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>
    </Dialog>
  )
}
