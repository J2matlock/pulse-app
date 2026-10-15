import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { localDateString } from '../../../shared/dates'
import { useFeature } from '../../hooks/useFeature'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVocab } from '../../hooks/useVocab'
import { formatTime } from '../../../shared/calendar'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Briefing {
  overdue: number
  dueToday: number
  dueThisWeek: number
  followUpsDue: number
  tasksDue: number
  checklistDue: number
  appointmentsToday?: number
  /** Past appointments still marked scheduled (S-09) */
  needsOutcome?: number
  firstAppointment?: string | null
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/**
 * Daily summary shown the first time Pulse is unlocked each day:
 * what's overdue, due today, and due this week, with one click to work it.
 */
export function MorningBriefing({ suppressed, onFocusMode }: { suppressed: boolean; onFocusMode: () => void }): React.ReactElement | null {
  const showFocus = useFeature('focusMode')
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const clock = useSettingsStore(s => s.clockFormat)
  const { t } = useVocab(null)
  const [name, setName] = useState('')
  const [keepShowing, setKeepShowing] = useState(true)
  const checked = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useFocusTrap(panelRef, !!briefing && !suppressed)

  useEffect(() => {
    if (suppressed || checked.current) return
    checked.current = true
    void (async () => {
      const today = localDateString()
      const [enabled, last] = await Promise.all([
        safeInvoke(IPC.SETTINGS_GET, 'briefing_enabled'),
        safeInvoke(IPC.SETTINGS_GET, 'briefing_last_shown'),
      ])
      if (enabled.ok && enabled.data === 'false') return
      if (last.ok && last.data === today) return
      const [res, profileName] = await Promise.all([
        safeInvoke(IPC.DASHBOARD_GET_BRIEFING),
        safeInvoke(IPC.SETTINGS_GET, 'profile_name'),
      ])
      if (!res.ok) return
      await safeInvoke(IPC.SETTINGS_UPDATE, 'briefing_last_shown', today)
      if (profileName.ok && profileName.data) setName(profileName.data.split(/\s+/)[0] ?? '')
      setBriefing(res.data)
    })()
  }, [suppressed])

  if (!briefing || suppressed) return null

  // Every way out saves the "show this each day" choice, the two buttons included
  async function close(then?: () => void) {
    setBriefing(null)
    then?.()
    if (!keepShowing) await safeInvoke(IPC.SETTINGS_UPDATE, 'briefing_enabled', 'false')
  }

  const b = briefing
  const nothingUrgent = b.overdue + b.dueToday + b.followUpsDue + b.tasksDue + b.checklistDue + (b.needsOutcome ?? 0) === 0
  // [one, many] for each line, since the noun isn't always the last word (audit D-30)
  const items: Array<[number, [string, string], string]> = [
    [b.overdue, ['overdue deadline', 'overdue deadlines'], 'text-red-700 dark:text-red-300'],
    [b.dueToday, ['deadline due today', 'deadlines due today'], 'text-orange-700 dark:text-orange-300'],
    [b.dueThisWeek, ['more due in the next 7 days', 'more due in the next 7 days'], 'text-slate-800 dark:text-slate-100'],
    [b.followUpsDue, ['follow-up due', 'follow-ups due'], 'text-slate-800 dark:text-slate-100'],
    // Each line says what it counts, so the dashboard tile and the Tasks badge add up (UX D-05)
    [b.tasksDue, ['task due', 'tasks due'], 'text-slate-800 dark:text-slate-100'],
    [b.checklistDue, ['checklist item due', 'checklist items due'], 'text-slate-800 dark:text-slate-100'],
    [b.needsOutcome ?? 0, [`past ${t('appointment')} still needs marking done, no-show or cancelled`, `past ${t('appointment', { many: true })} still need marking done, no-show or cancelled`], 'text-amber-800 dark:text-amber-200'],
  ]

  return (
    <div className="fixed inset-0 z-[150] flex items-center-safe justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => void close()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="briefing-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key !== 'Escape') return
          // preventDefault tells page-level Escape handlers (the record page) it's taken
          e.preventDefault()
          e.stopPropagation()
          void close()
        }}>
        <div className="flex items-start gap-3 mb-4">
          <Sun className="w-7 h-7 text-amber-500 flex-shrink-0" aria-hidden="true" />
          <h2 id="briefing-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">
            {greeting()}{name ? `, ${name}` : ''}
          </h2>
          <button type="button" aria-label="Close" onClick={() => void close()}
            className="hit-44 p-1 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        {(b.appointmentsToday ?? 0) > 0 && (
          <p className="text-lg text-blue-800 dark:text-blue-200 mb-3">
            <span className="font-bold tabular-nums">{b.appointmentsToday}</span> {t('appointment', { count: b.appointmentsToday })} today{b.firstAppointment ? `, first at ${formatTime(b.firstAppointment, clock)}` : ''}
          </p>
        )}
        {nothingUrgent ? (
          <p className="text-base text-slate-700 dark:text-slate-200 mb-5">
            Nothing is overdue or due today.{b.dueThisWeek > 0 ? ` ${b.dueThisWeek} deadline${b.dueThisWeek === 1 ? ' is' : 's are'} coming up this week.` : ' Enjoy the quiet day.'}
          </p>
        ) : (
          <ul className="space-y-2 mb-5">
            {items.filter(([n]) => n > 0).map(([n, [one, many], cls]) => (
              <li key={one} className={`text-lg ${cls}`}>
                <span className="font-bold tabular-nums">{n}</span> {n === 1 ? one : many}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-3">
          {!nothingUrgent && showFocus && (
            <button type="button" className="btn-primary" onClick={() => void close(onFocusMode)}>
              Start Focus Mode
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => void close(() => navigate('/dashboard'))}>
            Open dashboard
          </button>
        </div>
        <label className="mt-5 flex items-center gap-2 text-base text-slate-600 dark:text-slate-300 cursor-pointer select-none" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={keepShowing} onChange={e => setKeepShowing(e.target.checked)}
            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500" />
          Show this summary the first time I unlock each day
        </label>
      </div>
    </div>
  )
}
