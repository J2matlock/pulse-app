import toast from 'react-hot-toast'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search, Plus, X, ArrowUpDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { CaseLogEntry as CaseLogEntryType, CreatedCaseLogEntry, Snippet } from '../../../shared/types'
import { guessArticle } from '../../../shared/vocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useMeasures } from '../../hooks/useMeasures'
import { MeasureInput } from './MeasureInput'
import type { NoteMeasureValues } from './CaseLogEntry'
import { useGridStore } from '../../stores/gridStore'
import { pulseEvents } from '../../events'
import { BUILTIN_NOTE_FORMATS, composeNote, parseCustomFormats, type NoteFormat } from '../../../shared/noteFormats'
import { NoteFormatsDialog } from './NoteFormatsDialog'
import { useNoteTracking } from '../../hooks/useNoteTracking'
import { CaseLogEntry } from './CaseLogEntry'
import { expandVariables, detectTrigger, matchSnippets } from '../../utils/snippetExpander'
import { useUndoStore } from '../../stores/undoStore'
import { safeInvoke } from '../../utils/safeInvoke'
import { isMod } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { FeatureOffer } from '../shared/FeatureOffer'
import { NoteFiles } from './NoteFiles'
import type { Attachment } from '../../../shared/attachments'
import type { NoteDateUpdate } from '../../../shared/types'
import { localDateString, parseDbTimestamp } from '../../../shared/dates'

/** Show dates the main process changed (notes that update deadline columns) without a reload. */
function applyDatesLocally(rowId: number, values: Array<[columnId: number, value: string | null]>): void {
  if (values.length === 0) return
  const { rows } = useGridStore.getState()
  const patch = Object.fromEntries(values.map(([id, v]) => [`col_${id}`, v]))
  useGridStore.setState({ rows: rows.map(r => r.row_id === rowId ? { ...r, ...patch } : r) })
  pulseEvents.emit('deadline:changed')
}

/** When a note happened (older entries without occurred_at happened when written) */
export function happenedAt(e: CaseLogEntryType): string {
  return e.occurred_at ?? e.created_at
}

/** Newest first by when it happened, then by when it was written */
function byHappened(a: CaseLogEntryType, b: CaseLogEntryType): number {
  return happenedAt(b).localeCompare(happenedAt(a)) || b.created_at.localeCompare(a.created_at) || b.id - a.id
}

/** "Oct 31" for a YYYY-MM-DD day */
function shortDay(day: string): string {
  const [y = NaN, m = NaN, d = NaN] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Last Visit to Oct 31" for the toast after dates follow a note */
function datesText(updates: NoteDateUpdate[]): string {
  const day = updates[0]!.new_value
  return `${updates.map(u => u.column_name).join(', ')} to ${day === localDateString() ? 'today' : shortDay(day)}`
}

interface Props {
  rowId: number
  clientName?: string
  /** Pre-loaded snippets from parent (avoids duplicate fetch when ScratchPad also needs them) */
  snippets?: Snippet[]
}

/** Type chips shown before the rest go into "More…" */
const VISIBLE_TYPES = 6

const NO_SNIPPETS: Snippet[] = []

/** "Spent 45 min", "1.5 hours", "drove 12 miles": the note mentions time or mileage */
export function offerFor(text: string, tracking: { trackTime: boolean; trackMileage: boolean }): 'timeTracking' | 'mileage' | null {
  if (!tracking.trackTime && /\b\d[\d.]*\s?(min|mins|minutes|hr|hrs|hour|hours)\b/i.test(text)) return 'timeTracking'
  if (!tracking.trackMileage && /\b\d[\d.]*\s?(mi|miles|mile)\b/i.test(text)) return 'mileage'
  return null
}

const NO_FILES: Attachment[] = []

export function CaseLog({ rowId, clientName, snippets: externalSnippets }: Props) {
  const [offer, setOffer] = useState<'timeTracking' | 'mileage' | null>(null)
  const snippetsOn = useFeature('snippets')
  const { t } = useVocab()
  const [entries, setEntries] = useState<CaseLogEntryType[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const PAGE_SIZE = 50
  const [search, setSearch] = useState('')
  const [oldestFirst, setOldestFirst] = useState(false)
  const activity = useActivityTypes()
  // Files on notes (W09)
  const filesOn = useFeature('attachments')
  const [noteFiles, setNoteFiles] = useState<Attachment[]>([])
  useEffect(() => {
    if (!filesOn) return
    const load = () => void safeInvoke<Attachment[]>(IPC.ATTACHMENT_LIST, rowId).then(r => { if (r.ok) setNoteFiles(r.data.filter(f => f.case_log_id !== null)) })
    load()
    return window.api.on(IPC.ATTACHMENTS_CHANGED, (changed: unknown) => { if (changed === null || changed === rowId) load() })
  }, [filesOn, rowId])
  const filesByNote = useMemo(() => {
    const m = new Map<number, Attachment[]>()
    for (const f of noteFiles) m.set(f.case_log_id!, [...(m.get(f.case_log_id!) ?? []), f])
    return m
  }, [noteFiles])
  const [newType, setNewType] = useState<string>('note')
  const [moreTypesOpen, setMoreTypesOpen] = useState(false)
  // A remembered or chosen type that was archived since falls back to the first one
  const chosenType = activity.active.some(t => t.key === newType) ? newType : activity.active[0]?.key ?? 'note'
  // The chosen type always shows as a chip, even when it lives under "More…"
  const firstFew = activity.active.slice(0, VISIBLE_TYPES)
  const visibleTypes = firstFew.some(t => t.key === chosenType)
    ? firstFew
    : [...firstFew, ...activity.active.filter(t => t.key === chosenType)]
  const moreTypes = activity.active.filter(t => !visibleTypes.includes(t))

  // Start with the type used last time
  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'note_type_last').then(r => {
      if (r.ok && typeof r.data === 'string' && r.data) setNewType(r.data)
    })
  }, [])

  function pickType(key: string) {
    setNewType(key)
    void safeInvoke(IPC.SETTINGS_UPDATE, 'note_type_last', key)
  }
  const [newContent, setNewContent] = useState('')
  const [newFollowUp, setNewFollowUp] = useState('')
  // The day it happened; empty means today
  const [newDay, setNewDay] = useState('')
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [adding, setAdding] = useState(false)
  const tracking = useNoteTracking()
  const [newMinutes, setNewMinutes] = useState('')
  const [newMiles, setNewMiles] = useState('')
  const measures = useMeasures()
  const [newExtra, setNewExtra] = useState<Record<string, string>>({})
  // Structured formats (DAP, SOAP…): one box per section, saved as one note
  const [customFormats, setCustomFormats] = useState<NoteFormat[]>([])
  const [formatId, setFormatId] = useState('')
  const [fieldValues, setFieldValues] = useState<string[]>([])
  const [editingFormats, setEditingFormats] = useState(false)
  const allFormats = [...BUILTIN_NOTE_FORMATS, ...customFormats]
  const format = allFormats.find(f => f.id === formatId)
  const composedContent = format ? composeNote(format, fieldValues) : newContent.trim()
  const [internalSnippets, setInternalSnippets] = useState<Snippet[]>([])
  // With snippets switched off the "/" menu finds nothing to offer
  const snippets = snippetsOn ? (externalSnippets ?? internalSnippets) : NO_SNIPPETS
  const [snippetMenu, setSnippetMenu] = useState<{ items: Snippet[]; query: string } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const snippetMenuRef = useRef(snippetMenu)
  const selectedIndexRef = useRef(selectedIndex)
  useEffect(() => { snippetMenuRef.current = snippetMenu }, [snippetMenu])
  useEffect(() => { selectedIndexRef.current = selectedIndex }, [selectedIndex])
  // Reset selection when menu contents change
  useEffect(() => { setSelectedIndex(-1) }, [snippetMenu?.items.length])

  useEffect(() => {
    void Promise.all([safeInvoke<string | null>(IPC.SETTINGS_GET, 'note_formats'), safeInvoke<string | null>(IPC.SETTINGS_GET, 'note_format_last')])
      .then(([formatsRes, lastRes]) => {
        const custom = formatsRes.ok ? parseCustomFormats(formatsRes.data) : []
        setCustomFormats(custom)
        const last = lastRes.ok ? lastRes.data : null
        if (last && [...BUILTIN_NOTE_FORMATS, ...custom].some(f => f.id === last)) setFormatId(last)
      })
  }, [])

  function chooseFormat(id: string) {
    if (id === '__edit') { setEditingFormats(true); return }
    setFormatId(id)
    setFieldValues([])
    void safeInvoke(IPC.SETTINGS_UPDATE, 'note_format_last', id)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await safeInvoke<CaseLogEntryType[]>(IPC.CASE_LOG_GET, rowId, false, false, PAGE_SIZE + 1, 0)
    if (res.ok) {
      const data = res.data
      setHasMore(data.length > PAGE_SIZE)
      setEntries(data.slice(0, PAGE_SIZE))
    }
    setLoading(false)
  }, [rowId, PAGE_SIZE])

  const loadMore = useCallback(async () => {
    const res = await safeInvoke<CaseLogEntryType[]>(IPC.CASE_LOG_GET, rowId, false, false, PAGE_SIZE + 1, entries.length)
    if (res.ok) {
      const data = res.data
      setHasMore(data.length > PAGE_SIZE)
      setEntries(prev => [...prev, ...data.slice(0, PAGE_SIZE)])
    }
  }, [rowId, entries.length, PAGE_SIZE])

  useEffect(() => { load() }, [load])

  // Re-fetch when system entries are written by main process (cell updates, checklist, etc.)
  useEffect(() => {
    return window.api.on(IPC.CASE_LOG_CHANGED, (changedRowId: unknown) => {
      if (changedRowId === rowId) load()
    })
  }, [rowId, load])

  useEffect(() => {
    if (externalSnippets) return // Skip fetch when parent provides snippets
    safeInvoke<Snippet[]>(IPC.SNIPPET_GET_ALL).then(res => {
      if (res.ok) setInternalSnippets(res.data)
    })
  }, [externalSnippets])

  function handleContentInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setNewContent(value)

    // Snippet detection
    const cursor = e.target.selectionStart
    const before = value.slice(0, cursor)
    const match = detectTrigger(before)
    if (match) {
      const matched = matchSnippets(snippets, match.query)
      setSnippetMenu(matched.length > 0 ? { items: matched, query: match.query } : null)
    } else {
      setSnippetMenu(null)
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const menu = snippetMenuRef.current
    if (menu && menu.items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, menu.items.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !isMod(e))) {
        e.preventDefault()
        const idx = selectedIndexRef.current >= 0 ? selectedIndexRef.current : 0
        applySnippet(menu.items[idx]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSnippetMenu(null)
        setSelectedIndex(-1)
        return
      }
    }
    if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); handleAdd() }
  }

  function applySnippet(snippet: Snippet) {
    const el = contentRef.current
    if (!el) return
    const cursor = el.selectionStart
    const before = newContent.slice(0, cursor)
    const after = newContent.slice(cursor)
    const match = detectTrigger(before)
    if (!match) return

    const expanded = expandVariables(snippet.expansion, clientName)
    const newVal = before.slice(0, -match.trigger.length) + expanded + after
    setNewContent(newVal)
    setSnippetMenu(null)
    // restore cursor after expanded text
    const newCursor = before.length - match.trigger.length + expanded.length
    requestAnimationFrame(() => {
      el.setSelectionRange(newCursor, newCursor)
      el.focus()
    })
  }

  async function handleAdd() {
    if (!composedContent) return
    setAdding(true)
    const res = await safeInvoke<CreatedCaseLogEntry>(
      IPC.CASE_LOG_CREATE,
      rowId,
      composedContent,
      chosenType,
      showFollowUp && newFollowUp ? newFollowUp : null,
      {
        minutes: tracking.trackTime && newMinutes.trim() ? Math.round(Number(newMinutes)) : null,
        miles: tracking.trackMileage && newMiles.trim() ? Number(newMiles) : null,
        extra: Object.fromEntries(measures.active.filter(d => newExtra[d.key]?.trim()).map(d => [d.key, Number(newExtra[d.key])])),
      },
      newDay && newDay !== localDateString() ? newDay : null
    )
    if (res.ok) {
      // Time or miles written into the text, while those boxes are off: offer them
      setOffer(offerFor(composedContent, tracking))
      const { updated_dates: updatedDates = [], ...created } = res.data
      setEntries(prev => [created, ...prev].sort(byHappened))
      if (updatedDates.length > 0) {
        applyDatesLocally(rowId, updatedDates.map(u => [u.column_id, u.new_value]))
        toast.success(`Also updated ${datesText(updatedDates)}`, { id: 'note-dates' })
      }
      setNewDay('')
      setNewContent('')
      setFieldValues([])
      setNewMinutes('')
      setNewMiles('')
      setNewExtra({})
      setNewFollowUp('')
      setShowFollowUp(false)
      setSnippetMenu(null)
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added ${t('activity')}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'plus',
        undo: async () => {
          // Past the delete window, undo voids the note instead (it stays in the record)
          const res = await safeInvoke(IPC.CASE_LOG_DELETE, created.id)
          if (!res.ok) await safeInvoke(IPC.CASE_LOG_VOID, created.id, 'Undone')
          for (const u of updatedDates) await safeInvoke(IPC.CELL_UPDATE, rowId, u.column_id, u.old_value)
          applyDatesLocally(rowId, updatedDates.map(u => [u.column_id, u.old_value]))
        },
        redo: async () => {
          await safeInvoke(IPC.CASE_LOG_RESTORE, created)
          for (const u of updatedDates) await safeInvoke(IPC.CELL_UPDATE, rowId, u.column_id, u.new_value)
          applyDatesLocally(rowId, updatedDates.map(u => [u.column_id, u.new_value]))
        },
      })
    } else {
      // e.g. minutes or miles out of range; the note text is kept so nothing is lost
      toast.error(res.error)
    }
    setAdding(false)
  }

  async function handleSetMeasures(id: number, values: NoteMeasureValues) {
    const res = await safeInvoke(IPC.CASE_LOG_SET_MEASURES, id, values)
    if (!res.ok) { toast.error(res.error); return }
    const { extra, ...builtIn } = values
    const kept = Object.entries(extra ?? {}).filter(([, v]) => v != null)
    setEntries(prev => prev.map(e => e.id === id
      ? { ...e, ...builtIn, ...(extra !== undefined ? { extra_measures: kept.length ? JSON.stringify(Object.fromEntries(kept)) : null } : {}) }
      : e))
  }

  /** Correct the day a note happened; the day before is kept in its edit history */
  async function handleSetDay(id: number, day: string) {
    const entry = entries.find(e => e.id === id)
    if (!entry) return
    const prevDay = localDateString(parseDbTimestamp(happenedAt(entry)))
    const setDay = async (to: string): Promise<boolean> => {
      const res = await safeInvoke<{ occurred_at: string; updated_dates: NoteDateUpdate[] }>(IPC.CASE_LOG_SET_OCCURRED, id, to)
      if (!res.ok) { toast.error(res.error); return false }
      setEntries(prev => prev.map(e => e.id === id ? { ...e, occurred_at: res.data.occurred_at } : e).sort(byHappened))
      if (res.data.updated_dates.length > 0) {
        applyDatesLocally(rowId, res.data.updated_dates.map(u => [u.column_id, u.new_value]))
        toast.success(`Also updated ${datesText(res.data.updated_dates)}`, { id: 'note-dates' })
      }
      return true
    }
    if (!await setDay(day)) return
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `Changed the day of ${t('activity', { article: true })}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'edit',
      undo: async () => { await setDay(prevDay) },
      redo: async () => { await setDay(day) },
    })
  }

  async function handlePin(id: number, pinned: boolean) {
    await safeInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, pinned)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, is_pinned: pinned ? 1 : 0 } : e))
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `${pinned ? 'Pinned' : 'Unpinned'} ${t('activity')}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'pin',
      undo: async () => {
        await safeInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, !pinned)
      },
      redo: async () => {
        await safeInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, pinned)
      },
    })
  }

  async function handleEdit(id: number, content: string) {
    const entry = entries.find(e => e.id === id)
    const prevContent = entry?.content ?? ''
    const res = await safeInvoke(IPC.CASE_LOG_UPDATE, id, content)
    if (res.ok) {
      const now = new Date().toISOString()
      setEntries(prev => prev.map(e => e.id === id ? { ...e, content, updated_at: now } : e))
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Edited ${t('activity')}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'edit',
        undo: async () => {
          await safeInvoke(IPC.CASE_LOG_UPDATE, id, prevContent)
        },
        redo: async () => {
          await safeInvoke(IPC.CASE_LOG_UPDATE, id, content)
        },
      })
    }
  }

  async function handleDelete(id: number) {
    const entry = entries.find(e => e.id === id)
    const res = await safeInvoke(IPC.CASE_LOG_DELETE, id)
    if (!res.ok) { toast.error(res.error); return }
    setEntries(prev => prev.filter(e => e.id !== id))
    if (entry) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Deleted ${t('activity')}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'trash',
        undo: async () => {
          await safeInvoke(IPC.CASE_LOG_RESTORE, entry)
        },
        redo: async () => {
          await safeInvoke(IPC.CASE_LOG_DELETE, id)
        },
      })
    }
  }

  async function handleVoid(id: number, reason: string) {
    const res = await safeInvoke(IPC.CASE_LOG_VOID, id, reason)
    if (!res.ok) { toast.error("We couldn't void that note. Please try again."); return }
    setEntries(prev => prev.filter(e => e.id !== id))
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Voided ${t('activity')}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'trash',
      undo: async () => { await safeInvoke(IPC.CASE_LOG_UNVOID, id) },
      redo: async () => { await safeInvoke(IPC.CASE_LOG_VOID, id, reason) },
    })
  }

  async function handleCompleteFollowUp(id: number) {
    const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CASE_LOG_COMPLETE_FOLLOWUP, id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, follow_up_completed: 1 } : e))
    if (res.ok) {
      const { sysLogId } = res.data
      const sideEffects = sysLogId ? [{ type: 'void_case_log' as const, caseLogId: sysLogId }] : undefined
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Completed follow-up',
        timestamp: Date.now(),
        category: 'logged',
        icon: 'check',
        sideEffects,
        undo: async () => {
          await safeInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, id)
          // CASE_LOG_CHANGED push from main will trigger CaseLog to reload
        },
        redo: async () => {
          await safeInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, id)
        },
      })
    }
  }

  // Filter + sort
  const filtered = entries.filter(e =>
    !search || e.content.toLowerCase().includes(search.toLowerCase())
  )

  const pinned = filtered.filter(e => e.is_pinned === 1)
  const unpinned = filtered.filter(e => e.is_pinned !== 1)

  // In the order things happened (a visit written up later sits on its own day)
  const sortedUnpinned = oldestFirst
    ? [...unpinned].sort((a, b) => byHappened(b, a))
    : unpinned  // already newest-first from DB

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <MessageSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 flex-1">
          {t('activityLog', { cap: true })}
          {entries.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">({entries.length})</span>
          )}
        </h2>

        {/* Sort toggle */}
        <button
          onClick={() => setOldestFirst(p => !p)}
          title={oldestFirst ? 'Showing oldest first' : 'Showing newest first'}
          className="hit-44 flex items-center gap-1 px-2 py-1 rounded-sm text-base text-slate-500
                     hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {oldestFirst ? 'Oldest first' : 'Newest first'}
        </button>
      </div>

      {/* Quick-add form */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 space-y-2">
        {/* Type selector: the first few as chips, the rest under "More…" */}
        <div className="flex gap-1 flex-wrap" role="group" aria-label={`Kind of ${t('activity')}`}>
          {visibleTypes.map(type => (
            <button
              key={type.key}
              type="button"
              onClick={() => pickType(type.key)}
              aria-pressed={chosenType === type.key}
              className={`hit-44 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-base transition-colors
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${chosenType === type.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }
              `}
            >
              {type.icon && <span aria-hidden>{type.icon}</span>}
              {type.label}
            </button>
          ))}
          {moreTypes.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreTypesOpen(o => !o)}
                aria-expanded={moreTypesOpen}
                className="hit-44 px-2.5 py-1.5 rounded-full text-base bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              >
                More…
              </button>
              {moreTypesOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreTypesOpen(false)} />
                  <div role="menu" className="absolute z-50 mt-1 min-w-44 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
                    {moreTypes.map(type => (
                      <button key={type.key} type="button" role="menuitem"
                        onClick={() => { pickType(type.key); setMoreTypesOpen(false) }}
                        className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-left text-base text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">
                        {type.icon && <span aria-hidden>{type.icon}</span>}
                        {type.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`note-day-${rowId}`} className="text-base text-slate-600 dark:text-slate-300">When</label>
          <input id={`note-day-${rowId}`} type="date" className="input w-auto" max={localDateString()}
            value={newDay || localDateString()} onChange={e => setNewDay(e.target.value)}
            title="The day it happened, if that wasn't today" />
          {newDay && newDay !== localDateString() && (
            <button type="button" onClick={() => setNewDay('')}
              className="hit-44 text-base text-blue-700 dark:text-blue-300 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              Today
            </button>
          )}
          <span className="w-2" aria-hidden />
          <label htmlFor={`note-format-${rowId}`} className="text-base text-slate-600 dark:text-slate-300">Format</label>
          <select id={`note-format-${rowId}`} className="input w-auto" value={formatId} onChange={e => chooseFormat(e.target.value)}>
            <option value="">Free text</option>
            {allFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="__edit">Edit formats…</option>
          </select>
        </div>

        {format && (
          <div className="space-y-2">
            {format.fields.map((label, i) => (
              <div key={`${format.id}-${label}-${i}`}>
                <label htmlFor={`note-field-${rowId}-${i}`} className="block text-base font-medium text-slate-700 dark:text-slate-200">{label}</label>
                <textarea id={`note-field-${rowId}-${i}`} rows={2}
                  value={fieldValues[i] ?? ''}
                  onChange={e => { const v = e.target.value; setFieldValues(prev => { const next = [...prev]; next[i] = v; return next }) }}
                  onKeyDown={e => { if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); void handleAdd() } }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 resize-y focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                  style={{ fontSize: 15 }} />
              </div>
            ))}
            <p className="text-sm text-slate-500 dark:text-slate-400">Saved as one note with these headings. Empty sections are left out. Ctrl+Enter saves.</p>
          </div>
        )}

        {/* Content textarea with snippet dropdown */}
        {!format && <>
        <div className="relative">
          <textarea
            ref={contentRef}
            value={newContent}
            onChange={handleContentInput}
            onKeyDown={handleTextareaKeyDown}
            placeholder={`Add ${guessArticle(activity.label(chosenType))} ${activity.label(chosenType).toLowerCase()} entry… (Ctrl+Enter to save, type / for snippets)`}
            rows={3}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                       bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                       px-3 py-2 resize-none focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15 }}
          />

          {/* Snippet autocomplete */}
          {snippetMenu && snippetMenu.items.length > 0 && (
            <div className="absolute left-0 bottom-full mb-1 z-50 bg-white dark:bg-slate-800
                            border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg py-1 min-w-48 max-w-xs">
              {snippetMenu.items.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applySnippet(s) }}
                  className={`hit-44 flex items-start gap-2 w-full px-3 py-2 text-left
                             focus-visible:outline-hidden
                             ${i === selectedIndex
                               ? 'bg-blue-100 dark:bg-blue-900/40'
                               : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                             }`}
                >
                  <span className="text-sm font-mono text-blue-700 dark:text-blue-300 flex-shrink-0">
                    /{s.trigger_text}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    {s.expansion.slice(0, 40)}
                  </span>
                </button>
              ))}
              <div className="px-3 py-1 border-t border-slate-100 dark:border-slate-700 mt-1">
                <span className="text-sm text-slate-500 dark:text-slate-400">↑↓ navigate · Tab/Enter select · Esc dismiss</span>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Type / to insert a snippet</p>
        </>}

        {(tracking.trackTime || tracking.trackMileage || measures.active.length > 0) && (
          <div className="flex flex-wrap items-center gap-4">
            {tracking.trackTime && (
              <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Minutes
                <input type="number" min={0} max={1440} className="input w-24" value={newMinutes} onChange={e => setNewMinutes(e.target.value)} />
              </label>
            )}
            {tracking.trackMileage && (
              <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Miles
                <input type="number" min={0} max={2000} step="0.1" className="input w-24" value={newMiles} onChange={e => setNewMiles(e.target.value)} />
              </label>
            )}
            {measures.active.map(d => (
              <MeasureInput key={d.key} def={d} value={newExtra[d.key] ?? ''} onChange={v => setNewExtra(x => ({ ...x, [d.key]: v }))} />
            ))}
          </div>
        )}

        {/* Follow-up date */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFollowUp(p => !p)}
            className="hit-44 text-base text-slate-500 hover:text-slate-700 dark:hover:text-slate-300
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >
            {showFollowUp ? <><X className="w-3.5 h-3.5 inline mr-1" />Remove follow-up</> : '+ Follow-up date'}
          </button>
          {showFollowUp && (
            <input
              type="date"
              value={newFollowUp}
              onChange={e => setNewFollowUp(e.target.value)}
              className="rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900
                         text-base text-slate-900 dark:text-slate-100 px-2 py-1
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            />
          )}
          <div className="flex-1" />
          <button
            onClick={handleAdd}
            disabled={!composedContent || adding}
            title={`Add ${t('activity', { article: true })}`}
            className="hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-base
                       hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>

        </div>
        {offer && (
          <div className="mt-2">
            <FeatureOffer feature={offer} onDone={() => setOffer(null)}
              message={offer === 'timeTracking'
                ? `This ${t('activity')} mentions time. Record minutes on ${t('activity', { many: true })} and total them each month?`
                : `This ${t('activity')} mentions miles. Record mileage on ${t('activity', { many: true })} for your monthly claim?`} />
          </div>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700/50">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${t('activityLog')}…`}
            title={`Search ${t('activityLog')}`}
            className="w-full pl-8 pr-3 py-1.5 rounded-sm border border-slate-200 dark:border-slate-600
                       bg-slate-50 dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Entry list */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50 max-h-[600px] overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading…</p>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
            {search ? 'No entries match your search.' : `No ${t('activity', { many: true })} yet.`}
          </p>
        )}

        {/* Pinned section */}
        {pinned.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-800/30">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                📌 Pinned ({pinned.length})
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {pinned.map(entry => (
                <div key={entry.id} className="p-3">
                  <CaseLogEntry
                    entry={entry}
                    onPin={handlePin}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onVoid={handleVoid}
                    onCompleteFollowUp={handleCompleteFollowUp}
                    tracking={tracking}
                    onSetMeasures={handleSetMeasures}
                    onSetDay={handleSetDay}
                  />
                  {filesOn && <NoteFiles rowId={rowId} noteId={entry.id} files={filesByNote.get(entry.id) ?? NO_FILES} canAttach={entry.log_type !== 'system' && !entry.voided_at} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main entries */}
        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {sortedUnpinned.map(entry => (
            <div key={entry.id} className="p-3">
              <CaseLogEntry
                entry={entry}
                onPin={handlePin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onVoid={handleVoid}
                onCompleteFollowUp={handleCompleteFollowUp}
                tracking={tracking}
                onSetMeasures={handleSetMeasures}
                onSetDay={handleSetDay}
              />
              {filesOn && <NoteFiles rowId={rowId} noteId={entry.id} files={filesByNote.get(entry.id) ?? NO_FILES} canAttach={entry.log_type !== 'system' && !entry.voided_at} />}
            </div>
          ))}
        </div>
        {hasMore && !search && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => void loadMore()}
              className="hit-44 text-base text-blue-600 dark:text-blue-400 hover:underline"
            >
              Load more entries…
            </button>
          </div>
        )}
      </div>
      {editingFormats && (
        <NoteFormatsDialog formats={customFormats} onClose={saved => {
          setEditingFormats(false)
          if (saved) setCustomFormats(saved)
        }} />
      )}
    </section>
  )
}
