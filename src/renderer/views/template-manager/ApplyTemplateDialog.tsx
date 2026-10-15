import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Grid } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { reloadAfterApply } from '../../utils/reloadAfterApply'
import type { SetupTemplate } from './types'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'

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
  async function handleApply() {
    setError(null)
    if (applyMode === 'existing' && !selectedGridId) {
      setError(`Choose ${t('list', { article: true })} first.`)
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
        setError(friendlyError(res.error, "We couldn't add the checklist — try again"))
        return
      }
      // Its deadline rules and, in an existing list, its new columns show straight away
      await reloadAfterApply(applyMode === 'existing' ? selectedGridId : null)
      onApplied()
    } catch {
      setError("We couldn't add the checklist — try again")
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open onClose={onClose} size="md" title={<>Apply "{template.name}"</>}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={handleApply} disabled={applying}>
          {applying ? 'Applying…' : applyMode === 'new' ? `Make the ${t('list')}` : `Add to this ${t('list')}`}
        </PrimaryButton>
      </>}>
      <div className="space-y-4">
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
            <span className="text-base text-slate-700 dark:text-slate-300">Add to {t('list', { article: true })} I already have</span>
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
          <div role="alert" className="text-base text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  )
}
