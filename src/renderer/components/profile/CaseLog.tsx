import toast from 'react-hot-toast'
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search, Plus, X, ArrowUpDown, Pencil } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { CaseLogEntry as CaseLogEntryType, CreatedCaseLogEntry, Snippet } from '../../../shared/types'
import { guessArticle } from '../../../shared/vocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useMeasures } from '../../hooks/useMeasures'
import { MeasureInput } from './MeasureInput'
import type { NoteMeasureValues } from './CaseLogEntry'
import { useGridStore } from '../../stores/gridStore'
import { pulseEvents } from '../../events'
import { builtinFormatsFor, composeNote, parseCustomFormats, type NoteFormat } from '../../../shared/noteFormats'
import { NoteFormatsDialog } from './NoteFormatsDialog'
import { useNoteTracking } from '../../hooks/useNoteTracking'
import { CaseLogEntry } from './CaseLogEntry'
import { expandVariables, detectTrigger, matchSnippets } from '../../utils/snippetExpander'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUndoStore } from '../../stores/undoStore'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { isMod, modHelp } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { FeatureOffer } from '../shared/FeatureOffer'
import { NoteFiles } from './NoteFiles'
import type { Attachment } from '../../../shared/attachments'
import { getNoteDraft, setNoteDraft } from '../../utils/noteDrafts'
import type { NoteDateUpdate, NoteDateRevert } from '../../../shared/types'
import { localDateString, parseDbTimestamp, ymdLocalDate } from '../../../shared/dates'
import { friendlyError } from '../../utils/friendlyError'

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
  return ymdLocalDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Last Visit to Oct 31" for the toast after dates follow a note */
function datesText(updates: NoteDateUpdate[]): string {
  const day = updates[0]!.new_value
  return `${updates.map(u => u.column_name).join(', ')} to ${day === localDateString() ? 'today' : shortDay(day)}`
}

/** "Also set Last Visit back to Sep 2" after a note is voided or deleted (audit 1.23) */
function revertedText(reverted: NoteDateRevert[]): string {
  return `Also set ${reverted.map(r => `${r.column_name} back to ${r.new_value ? shortDay(r.new_value.slice(0, 10)) : 'blank'}`).join(', ')}`
}

/** Dates main put back or moved again, shown without a reload */
function showDateChanges(rowId: number, data: unknown): void {
  const d = (data ?? {}) as { reverted_dates?: NoteDateRevert[]; updated_dates?: NoteDateUpdate[] }
  const reverted = d.reverted_dates ?? []
  const updated = d.updated_dates ?? []
  if (reverted.length) applyDatesLocally(rowId, reverted.map(r => [r.column_id, r.new_value]))
  if (updated.length) applyDatesLocally(rowId, updated.map(u => [u.column_id, u.new_value]))
  if (reverted.length) toast.success(revertedText(reverted), { id: 'note-dates' })
}

interface Props {
  rowId: number
  clientName?: string
  /** Pre-loaded snippets from parent (avoids duplicate fetch when ScratchPad also needs them) */
  snippets?: Snippet[]
  /** Set to a function that opens the note box and puts the cursor in it ("+ Note") */
  focusRef?: React.MutableRefObject<(() => void) | null>
  /** Shown between the note box and the list of past notes (the record page puts deadlines and details there) */
  between?: React.ReactNode
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

export function CaseLog({ rowId, clientName, snippets: externalSnippets, focusRef, between }: Props) {
  const [offer, setOffer] = useState<'timeTracking' | 'mileage' | null>(null)
  const snippetsOn = useFeature('snippets')
  const { t } = useVocab()
  // {today} and {now} follow Settings → Date format and Clock (A21a-09)
  const snippetFormats = { dateFormat: useSettingsStore(s => s.dateFormat), clockFormat: useSettingsStore(s => s.clockFormat) }
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
  // An unsaved draft for this record comes back when the record opens again (1.2)
  const [draft0] = useState(() => getNoteDraft(rowId))
  const [newContent, setNewContent] = useState(draft0?.content ?? '')
  const [newFollowUp, setNewFollowUp] = useState(draft0?.followUp ?? '')
  // The day it happened; empty means today
  const [newDay, setNewDay] = useState(draft0?.day ?? '')
  const [showFollowUp, setShowFollowUp] = useState(!!draft0?.followUp)
  const [adding, setAdding] = useState(false)
  const tracking = useNoteTracking()
  const [newMinutes, setNewMinutes] = useState(draft0?.minutes ?? '')
  const [newMiles, setNewMiles] = useState(draft0?.miles ?? '')
  const measures = useMeasures()
  const [newExtra, setNewExtra] = useState<Record<string, string>>(draft0?.extra ?? {})
  // Structured formats (DAP, SOAP…): one box per section, saved as one note
  const [customFormats, setCustomFormats] = useState<NoteFormat[]>([])
  // Free text each time (C-06): a DAP picked once for one note shouldn't turn every
  // record's box into three empty sections; an unsaved draft keeps its own format
  const [formatId, setFormatId] = useState(draft0?.format ?? '')
  const [fieldValues, setFieldValues] = useState<string[]>(draft0?.fieldValues ?? [])
  // When and Format live under "More options", open when a draft uses them (C-12)
  const [moreOpen, setMoreOpen] = useState(!!(draft0?.day || draft0?.format))
  // The note box starts as one line, "Add a note…", and opens when used (3.4)
  const [composerOpen, setComposerOpen] = useState(!!draft0)
  const openComposer = useCallback(() => {
    setComposerOpen(true)
    setTimeout(() => contentRef.current?.focus(), 0)
  }, [])
  useEffect(() => {
    if (!focusRef) return
    focusRef.current = openComposer
    return () => { focusRef.current = null }
  }, [focusRef, openComposer])
  useEffect(() => {
    setNoteDraft(rowId, { content: newContent, fieldValues, followUp: newFollowUp, minutes: newMinutes, miles: newMiles, extra: newExtra, day: newDay, format: formatId })
  }, [rowId, newContent, fieldValues, newFollowUp, newMinutes, newMiles, newExtra, newDay, formatId])
  const [editingFormats, setEditingFormats] = useState(false)
  const builtinFormats = builtinFormatsFor(t('record'))
  const allFormats = [...builtinFormats, ...customFormats]
  const format = allFormats.find(f => f.id === formatId)
  const composedContent = format ? composeNote(format, fieldValues) : newContent.trim()
  const [internalSnippets, setInternalSnippets] = useState<Snippet[]>([])
  // With snippets switched off the "/" menu finds nothing to offer
  const snippets = snippetsOn ? (externalSnippets ?? internalSnippets) : NO_SNIPPETS
  const [snippetMenu, setSnippetMenu] = useState<{ items: Snippet[]; query: string } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  // The "/" menu is a listbox the text box points at (audit A06-32)
  const snippetMenuId = useId()
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const snippetMenuRef = useRef(snippetMenu)
  const selectedIndexRef = useRef(selectedIndex)
  useEffect(() => { snippetMenuRef.current = snippetMenu }, [snippetMenu])
  useEffect(() => { selectedIndexRef.current = selectedIndex }, [selectedIndex])
  // Reset selection when menu contents change
  useEffect(() => { setSelectedIndex(-1) }, [snippetMenu?.items.length])

  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'note_formats')
      .then(formatsRes => { setCustomFormats(formatsRes.ok ? parseCustomFormats(formatsRes.data) : []) })
  }, [])

  function chooseFormat(id: string) {
    setFormatId(id)
    setFieldValues([])
  }

  // Search and sort run in the database so they cover every note, not just the
  // loaded page (1.31). The box is debounced so each keystroke isn't a query.
  const [query, setQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])
  const [total, setTotal] = useState<number | null>(null)
  // One log (3.4): notes by default; changes the app recorded, one kind, or voided notes on request
  const [show, setShow] = useState<string>('notes')
  const [showVoided, setShowVoided] = useState(false)
  const includeSystem = show === 'everything' || show === 'changes'
  const kindFilter = show === 'changes' ? 'system' : show === 'notes' || show === 'everything' ? undefined : show
  // What the current filter hides: change entries (C-01) and voided notes (C-26), so the
  // page can say "3 changes are hidden" and offer "Show voided" only when there's one
  const [hidden, setHidden] = useState<{ changes: number; voided: number }>({ changes: 0, voided: 0 })
  const refreshHidden = useCallback(async () => {
    const [changes, all, live] = await Promise.all([
      safeInvoke<number>(IPC.CASE_LOG_COUNT, rowId, true, false, { logType: 'system' }),
      safeInvoke<number>(IPC.CASE_LOG_COUNT, rowId, true, true),
      safeInvoke<number>(IPC.CASE_LOG_COUNT, rowId, true, false),
    ])
    const n = (r: { ok: boolean; data?: unknown }) => r.ok && typeof r.data === 'number' ? r.data : 0
    setHidden({ changes: n(changes), voided: Math.max(0, n(all) - n(live)) })
  }, [rowId])
  const load = useCallback(async () => {
    setLoading(true)
    const opts = { query, oldestFirst, ...(kindFilter ? { logType: kindFilter } : {}) }
    const [res, count] = await Promise.all([
      safeInvoke<CaseLogEntryType[]>(IPC.CASE_LOG_GET, rowId, includeSystem, showVoided, PAGE_SIZE + 1, 0, opts),
      safeInvoke<number>(IPC.CASE_LOG_COUNT, rowId, includeSystem, showVoided, opts),
      refreshHidden(),
    ])
    if (res.ok) {
      const data = res.data
      setHasMore(data.length > PAGE_SIZE)
      setEntries(data.slice(0, PAGE_SIZE))
    }
    setTotal(count.ok ? count.data : null)
    setLoading(false)
  }, [rowId, PAGE_SIZE, query, oldestFirst, includeSystem, showVoided, kindFilter, refreshHidden])

  // One page at a time: a second click before the first page arrives would ask for the same page again (AUDIT-136)
  const loadingMoreRef = useRef(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const res = await safeInvoke<CaseLogEntryType[]>(IPC.CASE_LOG_GET, rowId, includeSystem, showVoided, PAGE_SIZE + 1, entries.length, { query, oldestFirst, ...(kindFilter ? { logType: kindFilter } : {}) })
      if (res.ok) {
        const data = res.data
        setHasMore(data.length > PAGE_SIZE)
        setEntries(prev => [...prev, ...data.slice(0, PAGE_SIZE)])
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [rowId, entries.length, PAGE_SIZE, query, oldestFirst, includeSystem, showVoided, kindFilter])

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
      // Enter picks a snippet only once one was chosen with the arrow keys; otherwise it's a new line
      if (e.key === 'Tab' || (e.key === 'Enter' && !isMod(e) && selectedIndexRef.current >= 0)) {
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

    const expanded = expandVariables(snippet.expansion, clientName, snippetFormats)
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
        // Removing the note puts back the dates it moved, and restoring it moves them again (main does both)
        undo: async () => {
          // Past the delete window, undo voids the note instead (it stays in the record)
          let res
          try { res = await mustInvoke(IPC.CASE_LOG_DELETE, created.id) } catch { res = await mustInvoke(IPC.CASE_LOG_VOID, created.id, 'Undone') }
          showDateChanges(rowId, res.data)
        },
        redo: async () => {
          const res = await mustInvoke(IPC.CASE_LOG_RESTORE, created)
          showDateChanges(rowId, res.data)
        },
      })
    } else {
      // e.g. minutes or miles out of range; the note text is kept so nothing is lost
      toast.error(friendlyError(res.error))
    }
    setAdding(false)
  }

  async function handleSetMeasures(id: number, values: NoteMeasureValues) {
    const res = await safeInvoke(IPC.CASE_LOG_SET_MEASURES, id, values)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
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
      const res = await safeInvoke<{ occurred_at: string; updated_dates: NoteDateUpdate[]; reverted_dates: NoteDateRevert[] }>(IPC.CASE_LOG_SET_OCCURRED, id, to)
      if (!res.ok) { toast.error(friendlyError(res.error)); return false }
      setEntries(prev => prev.map(e => e.id === id ? { ...e, occurred_at: res.data.occurred_at } : e).sort(byHappened))
      showDateChanges(rowId, res.data)
      if (res.data.updated_dates.length > 0) toast.success(`Also updated ${datesText(res.data.updated_dates)}`, { id: 'note-dates' })
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
    const res = await safeInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, pinned)
    if (!res.ok) { toast.error(`We couldn't ${pinned ? 'pin' : 'unpin'} that ${t('activity')} — try again`); return }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, is_pinned: pinned ? 1 : 0 } : e))
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `${pinned ? 'Pinned' : 'Unpinned'} ${t('activity')}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'pin',
      undo: async () => {
        await mustInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, !pinned)
      },
      redo: async () => {
        await mustInvoke(IPC.CASE_LOG_TOGGLE_PIN, id, pinned)
      },
    })
  }

  /** Returns false when the change wasn't saved, so the editor stays open with it. */
  async function handleEdit(id: number, content: string): Promise<boolean> {
    const entry = entries.find(e => e.id === id)
    const prevContent = entry?.content ?? ''
    const res = await safeInvoke(IPC.CASE_LOG_UPDATE, id, content)
    if (!res.ok) { toast.error(`We couldn't save your changes to that ${t('activity')} — try again`); return false }
    {
      const now = new Date().toISOString()
      setEntries(prev => prev.map(e => e.id === id ? { ...e, content, updated_at: now } : e))
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Edited ${t('activity')}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'edit',
        undo: async () => {
          await mustInvoke(IPC.CASE_LOG_UPDATE, id, prevContent)
        },
        redo: async () => {
          await mustInvoke(IPC.CASE_LOG_UPDATE, id, content)
        },
      })
    }
    return true
  }

  async function handleDelete(id: number) {
    const entry = entries.find(e => e.id === id)
    const res = await safeInvoke(IPC.CASE_LOG_DELETE, id)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    setEntries(prev => prev.filter(e => e.id !== id))
    showDateChanges(rowId, res.data)
    if (entry) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Deleted ${t('activity')}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'trash',
        undo: async () => {
          const back = await mustInvoke(IPC.CASE_LOG_RESTORE, entry)
          showDateChanges(rowId, back.data)
        },
        redo: async () => {
          const again = await mustInvoke(IPC.CASE_LOG_DELETE, id)
          showDateChanges(rowId, again.data)
        },
      })
    }
  }

  async function handleVoid(id: number, reason: string) {
    const res = await safeInvoke(IPC.CASE_LOG_VOID, id, reason)
    if (!res.ok) { toast.error(`We couldn't void that ${t('activity')} — try again`); return }
    setEntries(prev => prev.filter(e => e.id !== id))
    showDateChanges(rowId, res.data)
    void refreshHidden()
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Voided ${t('activity')}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'trash',
      undo: async () => { const r = await mustInvoke(IPC.CASE_LOG_UNVOID, id); showDateChanges(rowId, r.data) },
      redo: async () => { const r = await mustInvoke(IPC.CASE_LOG_VOID, id, reason); showDateChanges(rowId, r.data) },
    })
  }

  async function handleRestore(id: number) {
    const entry = entries.find(e => e.id === id)
    const res = await safeInvoke(IPC.CASE_LOG_UNVOID, id, { logRestore: true })
    if (!res.ok) { toast.error(`We couldn't restore that ${t('activity')} — try again`); return }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, voided_at: null, voided_reason: null } : e))
    // Counting again, it moves its dates again (Track B)
    showDateChanges(rowId, res.data)
    void refreshHidden()
    const reason = entry?.voided_reason ?? 'Voided'
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Restored ${t('activity')}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'undo',
      undo: async () => { const r = await mustInvoke(IPC.CASE_LOG_VOID, id, reason); showDateChanges(rowId, r.data) },
      redo: async () => { const r = await mustInvoke(IPC.CASE_LOG_UNVOID, id); showDateChanges(rowId, r.data) },
    })
  }

  async function handleCompleteFollowUp(id: number) {
    const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CASE_LOG_COMPLETE_FOLLOWUP, id)
    if (!res.ok) { toast.error('We couldn\'t mark that follow-up done — try again'); return }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, follow_up_completed: 1 } : e))
    {
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
          await mustInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, id)
          // CASE_LOG_CHANGED push from main will trigger CaseLog to reload
        },
        redo: async () => {
          await mustInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, id)
        },
      })
    }
  }

  // Already searched and sorted by the database
  const filtered = entries
  const pinned = filtered.filter(e => e.is_pinned === 1)
  // Sorted by the database, by the day each happened (a visit written up later sits on its own day)
  const sortedUnpinned = filtered.filter(e => e.is_pinned !== 1)
  const shownTotal = total ?? entries.length

  return (
    <>
    {/* The note box comes first on the record page (3.4); past notes follow further down.
        With a header button to open it (focusRef), the box stays out of the way until then (C-34) */}
    <section aria-label={`New ${t('activity')}`} hidden={!composerOpen && !!focusRef}
      className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {!composerOpen && !focusRef && (
        <button type="button" onClick={openComposer}
          className="w-full text-left px-4 text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 52 }}>
          <Plus className="inline w-4 h-4 mr-2" aria-hidden="true" />Add {t('activity', { article: true })}…
        </button>
      )}
      {/* Quick-add form */}
      <div className={`px-4 py-3 space-y-2${composerOpen ? '' : ' hidden'}`} data-testid="note-composer">
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
            <p className="text-base text-slate-500 dark:text-slate-400">Saved as one {t('activity')} with these headings; empty ones are left out. {modHelp('Ctrl+Enter')} saves.</p>
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
            aria-controls={snippetMenu && snippetMenu.items.length > 0 ? snippetMenuId : undefined}
            aria-activedescendant={snippetMenu && snippetMenu.items.length > 0 && selectedIndex >= 0 ? `${snippetMenuId}-opt-${selectedIndex}` : undefined}
            placeholder={`Add ${guessArticle(activity.label(chosenType))} ${activity.label(chosenType).toLowerCase()} entry…`}
            rows={3}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                       bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                       px-3 py-2 resize-none focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15 }}
          />

          <span role="status" className="sr-only">
            {snippetMenu && snippetMenu.items.length > 0
              ? `${snippetMenu.items.length} ${snippetMenu.items.length === 1 ? 'snippet matches' : 'snippets match'}. Tab inserts the first, or the one you choose with the up and down arrows.`
              : ''}
          </span>

          {/* Snippet autocomplete */}
          {snippetMenu && snippetMenu.items.length > 0 && (
            <div className="absolute left-0 bottom-full mb-1 z-50 bg-white dark:bg-slate-800
                            border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg py-1 min-w-48 max-w-xs">
              <div id={snippetMenuId} role="listbox" aria-label="Snippets">
              {snippetMenu.items.map((s, i) => (
                <div
                  key={s.id}
                  id={`${snippetMenuId}-opt-${i}`}
                  role="option"
                  aria-selected={i === selectedIndex}
                  onMouseDown={e => { e.preventDefault(); applySnippet(s) }}
                  className={`hit-44 flex items-start gap-2 w-full px-3 py-2 text-left cursor-pointer
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
                </div>
              ))}
              </div>
              <div aria-hidden="true" className="px-3 py-1 border-t border-slate-100 dark:border-slate-700 mt-1">
                <span className="text-base text-slate-500 dark:text-slate-400">Tab inserts · ↑↓ then Enter to pick another · Esc closes</span>
              </div>
            </div>
          )}
        </div>
        {/* Static help, not in the placeholder, so it's still there once typing starts (C-12) */}
        <p className="text-base text-slate-500 dark:text-slate-400">{modHelp('Ctrl+Enter')} saves{snippetsOn ? ' · Type / to insert a snippet' : ''}</p>
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

        {/* When it happened and the format, out of the way until wanted (C-12) */}
        {moreOpen && (
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
            {/* Format only when one exists (built-in under human-services words, or the user's own); the pencil edits them (C-33) */}
            {allFormats.length > 0 && (<>
              <span className="w-2" aria-hidden />
              <label htmlFor={`note-format-${rowId}`} className="text-base text-slate-600 dark:text-slate-300">Format</label>
              <select id={`note-format-${rowId}`} className="input w-auto" value={formatId} onChange={e => chooseFormat(e.target.value)}>
                <option value="">Free text</option>
                {allFormats.map(f => <option key={f.id} value={f.id}>{f.name} — {f.fields.join(', ')}</option>)}
              </select>
              <button type="button" onClick={() => setEditingFormats(true)} aria-label="Edit formats" title="Add or change formats"
                className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            </>)}
          </div>
        )}

        {/* Follow-up date, more options, Add */}
        <div className="flex flex-wrap items-center gap-2">
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
              aria-label="Follow-up date"
              className="rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900
                         text-base text-slate-900 dark:text-slate-100 px-2 py-1
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            />
          )}
          <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
            className="hit-44 text-base text-slate-500 hover:text-slate-700 dark:hover:text-slate-300
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
            {moreOpen ? 'Fewer options' : `More options (when${allFormats.length > 0 ? ', format' : ''})`}
          </button>
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
                : `This ${t('activity')} mentions miles. Record mileage on ${t('activity', { many: true })} for your monthly claim? (This one won't have them — add miles when you edit it.)`} />
          </div>
        )}
      </div>

    </section>

    {between}

    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <MessageSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 flex-1">
          {t('activityLog', { cap: true })}
          {(shownTotal > 0 || query) && (
            <span className="ml-2 text-base font-normal text-slate-500 dark:text-slate-400">({query ? `${shownTotal} found` : shownTotal})</span>
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

      {/* What the log shows: a view, or one kind of note (C-23) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-slate-100 dark:border-slate-700/50">
        <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
          Show:
          <select className="input w-auto" value={show} onChange={e => setShow(e.target.value)} aria-label="What to show">
            <optgroup label="Show">
              <option value="notes">{t('activity', { many: true, cap: true })} only</option>
              <option value="everything">{t('activity', { many: true, cap: true })} and column changes</option>
              <option value="changes">Column changes only</option>
            </optgroup>
            <optgroup label="Only one kind">
              {activity.all.map(k => <option key={k.key} value={k.key}>{k.label}{k.is_archived ? ' (archived)' : ''}</option>)}
            </optgroup>
          </select>
        </label>
        {/* Only when there is a voided note to show (C-26) */}
        {(hidden.voided > 0 || showVoided) && (
          <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} />
            Show {hidden.voided} voided {t('activity', { many: hidden.voided !== 1 })}
          </label>
        )}
      </div>
      {/* Changes a column keeps a history of are findable even when the filter hides them (C-01) */}
      {show === 'notes' && hidden.changes > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 px-4 py-1 border-b border-slate-100 dark:border-slate-700/50 text-base text-slate-600 dark:text-slate-300" role="status">
          <span>{hidden.changes} {hidden.changes === 1 ? 'change is' : 'changes are'} hidden —</span>
          <button type="button" onClick={() => setShow('everything')}
            className="hit-44 text-blue-700 dark:text-blue-300 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            Show {hidden.changes === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

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
            aria-label={`Search ${t('activityLog')}`}
            className="w-full pl-8 pr-3 py-1.5 rounded-sm border border-slate-200 dark:border-slate-600
                       bg-slate-50 dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Entry list */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50 max-h-[600px] overflow-y-auto">
        {loading && (
          <p className="text-base text-slate-500 dark:text-slate-400 text-center py-8">Loading…</p>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-base text-slate-500 dark:text-slate-400 text-center py-8">
            {search ? 'No entries match your search.'
              : show === 'notes' || show === 'everything' ? `No ${t('activity', { many: true })} yet.`
              // "Changes only" or one note type: the record may have plenty of other entries
              : `Nothing of this kind yet. Choose "${t('activity', { many: true, cap: true })} only" under Show to see the rest.`}
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
                onRestore={handleRestore}
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
                onRestore={handleRestore}
                tracking={tracking}
                onSetMeasures={handleSetMeasures}
                onSetDay={handleSetDay}
              />
              {filesOn && <NoteFiles rowId={rowId} noteId={entry.id} files={filesByNote.get(entry.id) ?? NO_FILES} canAttach={entry.log_type !== 'system' && !entry.voided_at} />}
            </div>
          ))}
        </div>
        {hasMore && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
            {total != null && <span className="text-base text-slate-600 dark:text-slate-300">Showing {entries.length} of {total}</span>}
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="hit-44 text-base text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-60"
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
    </>
  )
}
