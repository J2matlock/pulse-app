/** Dashboard card: the latest notes across lists (W10 §4). */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquareText } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import type { RecentActivityItem } from '../../../../shared/ipc-contract'
import { parseDbTimestamp } from '../../../../shared/dates'
import { safeInvoke } from '../../../utils/safeInvoke'
import { useVocab } from '../../../hooks/useVocab'
import { useActivityTypes } from '../../../hooks/useActivityTypes'

const when = (ts: string) => parseDbTimestamp(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function RecentActivityCard(): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(null)
  const types = useActivityTypes()
  const [items, setItems] = useState<RecentActivityItem[] | null>(null)
  const load = useCallback(async () => {
    const r = await safeInvoke<RecentActivityItem[]>(IPC.DASHBOARD_RECENT_ACTIVITY)
    setItems(r.ok ? r.data : [])
  }, [])
  useEffect(() => {
    void load()
    return window.api.on(IPC.CASE_LOG_CHANGED, () => { void load() })
  }, [load])

  return (
    <section aria-labelledby="recent-activity-title" className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-2">
      <h2 id="recent-activity-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <MessageSquareText className="w-5 h-5" aria-hidden="true" />Recent {t('activity', { many: true })}
      </h2>
      {items && items.length === 0 && <p className="text-base text-slate-500 dark:text-slate-400">No {t('activity', { many: true })} yet.</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {(items ?? []).map(n => (
          <li key={n.id}>
            <button type="button" onClick={() => navigate(`/profile/${n.row_id}?gridId=${n.grid_id}`)}
              className="w-full text-left py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" style={{ minHeight: 44 }}>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-base font-medium text-slate-800 dark:text-slate-100">{n.name}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{types.label(n.log_type)} · {when(n.created_at)} · {n.grid_name}</span>
              </span>
              {n.text && <span className="block text-base text-slate-600 dark:text-slate-300 truncate">{n.text}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
