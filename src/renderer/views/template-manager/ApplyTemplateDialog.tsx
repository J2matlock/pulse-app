import React, { useEffect, useRef, useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Grid } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { reloadAfterApply } from '../../utils/reloadAfterApply'
import type { SetupTemplate } from './types'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

type ApplyMode = 'new' | 'existing'

interface ApplyTemplateDialogProps {
  template: SetupTemplate
  grids: Grid[]
  onClose: () => void
  onApplied: () => void
}

export function ApplyTemplateDialog({ template, grids, onClose, onApplied }: ApplyTemplateDialogProps): React.ReactElement {
  const { t } = useVocab(null)
  const [applyMode, setApplyMode] = useState<ApplyMode>('new')
  const [selectedGridId, setSelectedGridId] = useState<number | null>(grids[0]?.id ?? null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleApply() {
    setError(null)
    if (applyMode === 'existing' && !selectedGridId) {
      setError(`Choose a ${t('list')} first.`)
      return
    }
    setApplying(true)
    try {
      const res = await safeInvoke(
        IPC.SETUP_TEMPLATE_APPLY,
        template.pulse_json,
        applyMode,
        applyMode === 'existing' ? selectedGridId : undefined
      )

      if (!res.ok) {
        setError(res.error ?? 'Could not apply the template. Please try again.')
        return
      }
      // Its deadline rules and, in an existing list, its new columns show straight away
      await reloadAfterApply(applyMode === 'existing' ? selectedGridId : null)
      onApplied()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            Apply "{template.name}"
          </h2>
          <button
            onClick={onClose}
            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="applyModeDialog"
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
                name="applyModeDialog"
                value="existing"
                checked={applyMode === 'existing'}
                onChange={() => setApplyMode('existing')}
                className="w-4 h-4 text-blue-600 focus:ring-3 focus:ring-blue-500"
              />
              <span className="text-base text-slate-700 dark:text-slate-300">Add to a {t('list')} I already have</span>
            </label>
          </div>

          {applyMode === 'existing' && (
            grids.length === 0 ? (
              <p className="text-base text-slate-500 dark:text-slate-400">There are no {t('list', { many: true })} yet.</p>
            ) : (
              <div className="relative">
                <select
                  value={selectedGridId ?? ''}
                  onChange={e => setSelectedGridId(parseInt(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                             bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                             px-3 py-2 text-base min-h-[44px] appearance-none
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500 pr-10"
                >
                  {grids.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
              </div>
            )
          )}

          {error && (
            <div className="text-base text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-300
                       hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px]
                       focus:outline-hidden focus:ring-3 focus:ring-slate-400 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-medium
                       min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
          >
            {applying ? 'Applying…' : applyMode === 'new' ? `Make the ${t('list')}` : `Add to this ${t('list')}`}
          </button>
        </div>
      </div>
    </div>
  )
}
