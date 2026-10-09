/**
 * Dashboard "Stages" card (W06 §6): per list with a stage, how many are in
 * each stage as a colored bar, the average stay, and who has waited longest.
 * A segment opens that list's board filtered to the stage.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Columns3 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { ACTIVITY_COLORS, type ActivityColor } from '../../../shared/activityTypes'
import type { StageSummary } from '../../../shared/stages'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { ACTIVITY_SWATCH } from '../../hooks/useActivityTypes'
import { useVocab } from '../../hooks/useVocab'

function swatch(color: string | undefined): { className?: string; style?: React.CSSProperties } {
  if (color && (ACTIVITY_COLORS as readonly string[]).includes(color)) return { className: ACTIVITY_SWATCH[color as ActivityColor] }
  if (color?.startsWith('#')) return { style: { backgroundColor: color } }
  return { className: 'bg-slate-400' }
}

export function StagesCard(): React.ReactElement | null {
  const navigate = useNavigate()
  const { t } = useVocab(null)
  const [summary, setSummary] = useState<StageSummary[]>([])

  const load = useCallback(async () => {
    const res = await safeInvoke<StageSummary[]>(IPC.STAGE_SUMMARY)
    if (res.ok) setSummary(res.data)
  }, [])
  useEffect(() => { void load() }, [load])

  async function openStage(s: StageSummary, value: string) {
    const grid = useGridStore.getState()
    await grid.loadGrid(s.gridId)
    useGridStore.setState({ activeFilters: [{ columnId: s.columnId, operator: 'equals', value }], filterMode: 'and' })
    useGridStore.getState().setViewMode('board')
    navigate('/grid')
  }

  if (summary.length === 0) return null

  return (
    <section aria-labelledby="stages-card-title" className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-4">
      <h2 id="stages-card-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <Columns3 className="w-5 h-5" aria-hidden="true" />{t('stage', { many: true, cap: true })}
      </h2>
      {summary.map(s => {
        const total = s.stages.reduce((n, x) => n + x.count, 0)
        return (
          <div key={s.gridId} className="space-y-2">
            <h3 className="text-base font-medium text-slate-700 dark:text-slate-200">{s.gridName} <span className="font-normal text-slate-500 dark:text-slate-400">by {s.columnName}</span></h3>
            {total > 0 && (
              <div className="flex h-8 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" role="group" aria-label={`${s.gridName} by ${s.columnName}`}>
                {s.stages.filter(x => x.count > 0).map(x => {
                  const sw = swatch(x.color)
                  return (
                    <button key={x.value} type="button" aria-label={`${x.value}: ${x.count}`} title={`${x.value}: ${x.count}`}
                      onClick={() => void openStage(s, x.value)}
                      className={`h-full hover:opacity-80 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500 ${sw.className ?? ''} ${x.done ? 'opacity-50' : ''}`}
                      style={{ ...sw.style, width: `${(x.count / total) * 100}%`, minWidth: 12 }} />
                  )
                })}
              </div>
            )}
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
              {s.stages.map(x => (
                <li key={x.value} className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded-sm ${swatch(x.color).className ?? ''}`} style={swatch(x.color).style} aria-hidden="true" />
                  {x.value}: {x.count}{x.avgDays !== null ? ` · usually ${x.avgDays} day${x.avgDays === 1 ? '' : 's'}` : ''}
                </li>
              ))}
              {s.noStage > 0 && <li>No {s.columnName.toLowerCase()}: {s.noStage}</li>}
            </ul>
            {s.oldest && (
              <p className="text-base text-slate-700 dark:text-slate-200">
                Waiting longest:{' '}
                <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                  onClick={() => navigate(`/profile/${s.oldest!.rowId}?gridId=${s.gridId}`)}>
                  {s.oldest.name}
                </button>
                , {s.oldest.stage} for {s.oldest.approximate ? 'about ' : ''}{s.oldest.days} day{s.oldest.days === 1 ? '' : 's'}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
