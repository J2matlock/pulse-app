/**
 * Batch documents and address labels (W10 §3.1–3.2): one PDF with a
 * document for each record, two postcards per sheet, or Avery labels.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileStack, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { localDateString } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { UnknownPlaceholders } from '../shared/UnknownPlaceholders'
import { friendlyError } from '../../utils/friendlyError'
import type { Column } from '../../../shared/types'

type Who = 'selected' | 'deadline' | 'all'
const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'

function nextMonth(): { from: string; to: string } {
  const now = new Date()
  return { from: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 1)), to: localDateString(new Date(now.getFullYear(), now.getMonth() + 2, 0)) }
}

export function BatchDocumentsDialog({ gridId: initialGridId, rowIds, initialMode = 'documents', initialTemplateId, pickList = false, onClose }: {
  gridId: number
  /** The selected records, if any */
  rowIds?: number[]
  initialMode?: 'documents' | 'labels'
  /** Start with this template (from the Letters page) */
  initialTemplateId?: number
  /** Let the person choose the list (opened from outside a list) */
  pickList?: boolean
  onClose: () => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [gridId, setGridId] = useState(initialGridId)
  const grids = useGridStore(s => s.grids)
  const { t } = useVocab(gridId)
  const listName = useGridStore(s => s.grids.find(g => g.id === gridId)?.name)
  const columns = useGridStore(s => s.columns)
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  // The open list's columns are in the grid store; another list chosen here
  // (from the Letters page) has its columns loaded for it
  const [loaded, setLoaded] = useState<{ gridId: number; columns: Column[] } | null>(null)
  const fromStore = useMemo(() => [...columns, ...hiddenColumns].filter(c => c.grid_id === gridId), [columns, hiddenColumns, gridId])
  useEffect(() => {
    if (fromStore.length > 0) return
    let alive = true
    void safeInvoke<{ columns: Column[]; hiddenColumns: Column[] } | null>(IPC.GRID_GET, gridId, false).then(r => {
      if (alive && r.ok && r.data) setLoaded({ gridId, columns: [...r.data.columns, ...r.data.hiddenColumns] })
    })
    return () => { alive = false }
  }, [gridId, fromStore.length])
  const all = fromStore.length > 0 ? fromStore : loaded?.gridId === gridId ? loaded.columns : []
  const deadlineColumns = all.filter(c => (c.column_type === 'date' || c.column_type === 'deadline') && /"alert_rule_id"\s*:\s*\d/.test(c.config ?? ''))
  const addressColumns = [...all.filter(c => c.column_type === 'address'), ...all.filter(c => c.column_type === 'text' && /address/i.test(c.name))]
  const [mode, setMode] = useState(initialMode)
  const [templates, setTemplates] = useState<Array<{ id: number; name: string }>>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [who, setWho] = useState<Who>(rowIds?.length ? 'selected' : deadlineColumns.length ? 'deadline' : 'all')
  const [deadlineCol, setDeadlineCol] = useState<number | null>(deadlineColumns[0]?.id ?? null)
  const [range, setRange] = useState(nextMonth)
  const [page, setPage] = useState<'letter' | 'postcard'>('letter')
  const [addressCol, setAddressCol] = useState<number | null>(addressColumns[0]?.id ?? null)
  const [layout, setLayout] = useState<'avery-5160' | 'avery-5163'>('avery-5160')
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState<string[]>([])

  // Another list's columns have other ids: pick that list's first address and deadline columns
  const addressIds = addressColumns.map(c => c.id).join(',')
  const deadlineIds = deadlineColumns.map(c => c.id).join(',')
  useEffect(() => {
    const ids = addressIds ? addressIds.split(',').map(Number) : []
    setAddressCol(cur => (cur !== null && ids.includes(cur) ? cur : ids[0] ?? null))
  }, [addressIds])
  useEffect(() => {
    const ids = deadlineIds ? deadlineIds.split(',').map(Number) : []
    setDeadlineCol(cur => (cur !== null && ids.includes(cur) ? cur : ids[0] ?? null))
    if (ids.length === 0) setWho(w => (w === 'deadline' ? 'all' : w))
  }, [deadlineIds])
  // The selected records belong to the list the dialog opened on
  const selectedHere = gridId === initialGridId && !!rowIds?.length

  useEffect(() => {
    void safeInvoke<Array<{ id: number; name: string }>>(IPC.LETTER_TEMPLATE_GET_ALL).then(r => {
      if (r.ok) { setTemplates(r.data); setTemplateId(r.data.some(x => x.id === initialTemplateId) ? initialTemplateId! : r.data[0]?.id ?? null) }
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const target = {
    gridId,
    ...(who === 'selected' && selectedHere ? { rowIds } : {}),
    ...(who === 'deadline' && deadlineCol ? { deadline: { columnId: deadlineCol, ...range } } : {}),
  }
  const many = t('record', { many: true })

  // How many this makes, and template tags that won't fill in, before anything is saved
  const [preview, setPreview] = useState<{ count: number; unknown: string[]; error?: string } | null>(null)
  const targetKey = JSON.stringify(target)
  const previewTemplate = mode === 'documents' ? templateId : null
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void safeInvoke(IPC.DOC_BATCH_PREVIEW, previewTemplate, JSON.parse(targetKey) as Record<string, unknown>).then(r => {
        if (alive) setPreview(r.ok ? r.data : null)
      })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [previewTemplate, targetKey])
  const ready = (mode === 'documents' ? !!templateId : !!addressCol) && (preview === null || (preview.count > 0 && !preview.error))

  async function make() {
    setBusy(true)
    setUnknown([])
    try {
      if (mode === 'documents') {
        const res = await safeInvoke<{ filePath: string; count: number; unknown: string[] } | null>(IPC.DOC_BATCH, templateId, target, page)
        if (!res.ok) { toast.error(friendlyError(res.error)); return }
        if (!res.data) return
        noteUnencryptedExport()
        toast.success(`Saved ${res.data.count} ${res.data.count === 1 ? 'document' : 'documents'}`)
        if (res.data.unknown.length) { setUnknown(res.data.unknown); return }
      } else {
        const res = await safeInvoke<{ filePath: string; count: number; skipped: number } | null>(IPC.DOC_LABELS, target, addressCol, layout)
        if (!res.ok) { toast.error(friendlyError(res.error)); return }
        if (!res.data) return
        noteUnencryptedExport()
        toast.success(`Saved ${res.data.count} label${res.data.count === 1 ? '' : 's'}${res.data.skipped ? ` (${res.data.skipped} without an address left out)` : ''}`)
      }
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="batch-docs-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="batch-docs-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileStack className="w-5 h-5" aria-hidden="true" />Print documents or labels{listName ? `: ${listName}` : ''}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div role="group" aria-label="Make" className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden w-fit">
          {(['documents', 'labels'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`px-4 text-base ${mode === m ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`} style={{ minHeight: 44 }}>
              {m === 'documents' ? 'Documents' : 'Address labels'}
            </button>
          ))}
        </div>

        {pickList && grids.length > 1 && (
          <label className="block">
            <span className={label}>{t('list', { cap: true })}</span>
            <select className="input w-full" value={gridId} onChange={e => { setGridId(Number(e.target.value)); setWho('all') }}>
              {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}

        <fieldset>
          <legend className={label}>For</legend>
          {selectedHere && rowIds ? (
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
              <input type="radio" name="batch-who" className="w-5 h-5" checked={who === 'selected'} onChange={() => setWho('selected')} />
              The {rowIds.length} selected
            </label>
          ) : null}
          {deadlineColumns.length > 0 && (
            <div>
              <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="radio" name="batch-who" className="w-5 h-5" checked={who === 'deadline'} onChange={() => setWho('deadline')} />
                Everyone with a deadline due between
              </label>
              {who === 'deadline' && (
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <select className="input w-auto" aria-label="Deadline" value={deadlineCol ?? ''} onChange={e => setDeadlineCol(Number(e.target.value) || null)}>
                    {deadlineColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input type="date" className="input w-auto" aria-label="From" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                  <span className="text-base text-slate-600 dark:text-slate-300">and</span>
                  <input type="date" className="input w-auto" aria-label="To" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
                </div>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="radio" name="batch-who" className="w-5 h-5" checked={who === 'all'} onChange={() => setWho('all')} />
            All active {many} in this {t('list')}
          </label>
        </fieldset>

        {mode === 'documents' ? (
          <>
            <label className="block">
              <span className={label}>Template</span>
              {templates.length === 0
                ? <p className="text-base text-slate-500 dark:text-slate-400">No templates yet. Make one under Letters.</p>
                : <select className="input w-full" value={templateId ?? ''} onChange={e => setTemplateId(Number(e.target.value))}>
                    {templates.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                  </select>}
            </label>
            <fieldset>
              <legend className={label}>Page</legend>
              {(['letter', 'postcard'] as const).map(p => (
                <label key={p} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="radio" name="batch-page" className="w-5 h-5" checked={page === p} onChange={() => setPage(p)} />
                  {p === 'letter' ? 'Letter, one per page' : 'Postcards, 4×6 in, two per sheet with cut marks'}
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <label className="block">
              <span className={label}>Address column</span>
              {addressColumns.length === 0
                ? <p className="text-base text-slate-500 dark:text-slate-400">This {t('list')} has no address column.</p>
                : <select className="input w-full" value={addressCol ?? ''} onChange={e => setAddressCol(Number(e.target.value))}>
                    {addressColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>}
            </label>
            <fieldset>
              <legend className={label}>Label sheets</legend>
              {(['avery-5160', 'avery-5163'] as const).map(l => (
                <label key={l} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="radio" name="batch-layout" className="w-5 h-5" checked={layout === l} onChange={() => setLayout(l)} />
                  {l === 'avery-5160' ? 'Avery 5160: 30 per sheet, 2⅝ × 1 in' : 'Avery 5163: 10 per sheet, 4 × 2 in'}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {preview && (
          <p role="status" className={`text-base font-medium ${preview.error || preview.count === 0 ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-100'}`}>
            {preview.error ?? (preview.count === 0
              ? `Nobody matches, so there's nothing to make.`
              : mode === 'documents'
                ? `This makes ${preview.count} ${page === 'postcard' ? (preview.count === 1 ? 'postcard' : 'postcards') : (preview.count === 1 ? 'document' : 'documents')}.`
                : `This makes labels for up to ${preview.count} ${t('record', { count: preview.count })}.`)}
          </p>
        )}
        <UnknownPlaceholders unknown={unknown.length ? unknown : mode === 'documents' ? preview?.unknown ?? [] : []} />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{unknown.length ? 'Close' : 'Cancel'}</button>
          <button type="button" className="btn-primary" disabled={busy || !ready} onClick={() => void make()}>Make PDF</button>
        </div>
      </div>
    </div>
  )
}
