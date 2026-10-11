import React, { useCallback, useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { MissingInfoDialog } from '../../components/reports/MissingInfoDialog'
import type { MissingInfoGrid } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

/** Dashboard: a one-line nudge when clients are missing required information. */
export function MissingInfoNotice(): React.ReactElement | null {
  const { t } = useVocab(null)
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    const res = await safeInvoke<MissingInfoGrid[]>(IPC.MISSING_INFO_GET)
    // Only required values here: dates Pulse can't read are listed in the report, not counted on the dashboard (AUDIT-026)
    if (res.ok) setCount(res.data.reduce((n, g) => n + g.clients.filter(c => c.missing.length > 0).length, 0))
  }, [])
  const close = useCallback(() => { setOpen(false); void load() }, [load])
  useEffect(() => { void load() }, [load])

  if (count === 0) return null
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <FileWarning className="w-5 h-5 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <span className="flex-1 text-base text-amber-900 dark:text-amber-100">
        {count} {t('record', { count })} {count === 1 ? 'is' : 'are'} missing required information.
      </span>
      <button type="button" className="btn-compact-secondary" onClick={() => setOpen(true)}>Review</button>
      {open && <MissingInfoDialog onClose={close} />}
    </div>
  )
}
