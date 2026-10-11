/**
 * Profile "Linked" section (W04 §7.3): one block per link this record's list
 * has, both directions, with each linked record's key details and any of its
 * deadlines that are overdue or coming up.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link2, Plus, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { RowLinks, LinkedRecord } from '../../../shared/links'
import type { DeadlineResult } from '../../../shared/deadlineEngine'
import { formatDue } from '../../../shared/deadlineEngine'
import { safeInvoke } from '../../utils/safeInvoke'
import { unlinkRecords, createAndLink } from '../../utils/linkActions'
import { LinkPicker } from '../links/LinkPicker'
import { useGridStore } from '../../stores/gridStore'

/** A linked record's deadline worth mentioning, as DEADLINES_GET returns it */
type Rollup = DeadlineResult & { row_id: number; column_name: string }

const SOON = 7

function rollupText(d: Rollup): string {
  const n = d.daysUntil ?? 0
  if (n < 0) return `${d.column_name} overdue ${-n} day${n === -1 ? '' : 's'}`
  if (n === 0) return `${d.column_name} due today`
  return `${d.column_name} due in ${n} day${n === 1 ? '' : 's'}`
}

function detailText(d: { value: string; type: string }): string {
  return d.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(d.value) ? formatDue(d.value.slice(0, 10)) : d.value
}

export function LinkedRecords({ rowId, onCount }: { rowId: number; onCount?: (n: number) => void }): React.ReactElement | null {
  const navigate = useNavigate()
  const [links, setLinks] = useState<RowLinks[] | null>(null)
  const [rollups, setRollups] = useState<Rollup[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    const res = await safeInvoke<RowLinks[]>(IPC.RECORD_LINKS_GET, rowId)
    if (!res.ok) return
    setLinks(res.data)
    const ids = [...new Set(res.data.flatMap(l => l.records.map(r => r.row_id)))]
    if (ids.length === 0) { setRollups([]); return }
    const dl = await safeInvoke<Rollup[]>(IPC.DEADLINES_GET, { rowIds: ids.slice(0, 5000) })
    if (dl.ok) setRollups(dl.data.filter(d => d.daysUntil !== null && d.daysUntil <= SOON && d.state !== 'paused' && d.state !== 'done'))
  }, [rowId])

  useEffect(() => { void load() }, [load])
  const linkCount = links?.reduce((n, l) => n + l.records.length, 0) ?? null
  useEffect(() => { if (linkCount !== null) onCount?.(linkCount) }, [linkCount, onCount])
  useEffect(() => window.api.on(IPC.RECORD_LINKS_CHANGED, (ids: unknown) => {
    if (Array.isArray(ids)) void load()
  }), [load])

  const rollupsByRow = useMemo(() => {
    const m = new Map<number, Rollup[]>()
    for (const d of rollups) m.set(d.row_id, [...(m.get(d.row_id) ?? []), d])
    for (const list of m.values()) list.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
    return m
  }, [rollups])

  if (!links || links.length === 0) return null

  const open = (r: LinkedRecord) => navigate(`/profile/${r.row_id}?gridId=${r.grid_id}`)

  return (
    <div className="space-y-4">
      {links.map(block => {
        const key = `${block.type.id}:${block.direction}`
        return (
          <section key={key} aria-label={block.label} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-slate-500" aria-hidden="true" />{block.label} ({block.records.length})
              </h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">from {block.other_grid_name}</span>
              <div className="ml-auto flex gap-1">
                <button type="button" className="btn-compact-secondary" onClick={() => { setPicking(picking === key ? null : key); setAdding(null) }}>
                  <Plus className="w-4 h-4" />{block.single && block.records.length ? 'Change' : 'Link'}
                </button>
                <button type="button" className="btn-compact-secondary" onClick={() => { setAdding(adding === key ? null : key); setPicking(null); setNewName('') }}>
                  <Plus className="w-4 h-4" />New
                </button>
              </div>
            </div>

            {picking === key && (
              <LinkPicker type={block.type} direction={block.direction} rowId={rowId}
                chips={block.records.map(r => ({ rowId: r.row_id, name: r.display_name }))} onClose={() => setPicking(null)} />
            )}

            {adding === key && (
              <form className="flex flex-wrap gap-2" onSubmit={e => {
                e.preventDefault()
                if (!newName.trim()) return
                void createAndLink(block.type.id, block.direction, rowId, newName).then(id => {
                  if (id === null) return
                  setAdding(null); setNewName('')
                  // A link within one list: the new record belongs to the open list too
                  const grid = useGridStore.getState()
                  if (block.other_grid_id === grid.activeGridId) void grid.loadGrid(block.other_grid_id)
                })
              }}>
                <input className="input flex-1 min-w-[12rem]" autoFocus aria-label={`New in ${block.other_grid_name}: name`} value={newName}
                  onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setAdding(null) }}
                  placeholder={`Name for the new one in ${block.other_grid_name}`} />
                <button type="submit" className="btn-primary" disabled={!newName.trim()}>Add and link</button>
                <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
              </form>
            )}

            {block.records.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">None linked yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700">
                {block.records.map(r => (
                  <li key={r.row_id} className="flex items-start gap-2 px-3 py-2" style={{ minHeight: 44 }}>
                    <div className="flex-1 min-w-0">
                      <button type="button" onClick={() => open(r)}
                        className={`text-left text-base font-medium hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm ${r.is_active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400 italic'}`}>
                        {r.display_name || '(unnamed)'}{!r.is_active && ' (archived)'}
                      </button>
                      {r.details && (
                        <p className="text-sm text-slate-600 dark:text-slate-300 truncate">
                          {r.details.map(d => `${d.label}: ${detailText(d)}`).join(' · ')}
                        </p>
                      )}
                      {(rollupsByRow.get(r.row_id) ?? []).map(d => (
                        <p key={`${d.row_id}-${d.column_name}`} className={`text-sm font-medium ${(d.daysUntil ?? 0) < 0 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          {rollupText(d)}
                        </p>
                      ))}
                    </div>
                    <button type="button" aria-label={`Unlink ${r.display_name}`}
                      onClick={() => void unlinkRecords(block.type.id, block.direction, rowId, r.row_id, r.display_name)}
                      className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
