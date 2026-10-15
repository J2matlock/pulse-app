import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Star, FileText, Plus, X, Phone, Mail, MapPin, Copy, Check, Trash2, Pencil } from 'lucide-react'
import type { GridRow, Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { computeAge } from '../../utils/deadlineCalc'
import { useHoldsPeople } from '../../hooks/useRecordKind'
import { useFeature } from '../../hooks/useFeature'
import { getClientName } from '../../utils/clientName'
import { rlog } from '../../utils/rendererLogger'
import toast from 'react-hot-toast'
import { useCopyFeedbackKeyed } from '../../hooks/useCopyFeedback'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { ProfileMoreMenu, type MoreMenuItem } from './ProfileMoreMenu'
import { SamplePill } from '../shared/SampleDataBanner'
import { shortDate } from '../../../shared/dates'
import { PrimaryButton } from '../ui/Button'

const CONTACT_TYPES = ['phone', 'email', 'address'] as const
type ContactType = typeof CONTACT_TYPES[number]

interface Tag {
  id: number
  grid_id: number
  name: string
  color: string
}

interface ManualContact {
  type: ContactType
  label: string
  value: string
}

export interface ProfileHeaderProps {
  row: GridRow
  columns: Column[]
  gridId: number
  onRowUpdate: (updates: Partial<{ is_starred: 0 | 1 }>) => void
  onAddNote?: () => void
  onGenerateLetter?: () => void
  /** "Print or save ▾": the PDFs of this record — the profile, its change history, a handoff packet (C-08) */
  printItems?: MoreMenuItem[]
  /** "More ▾": archive, duplicate, move, trash (3.6) */
  moreItems?: MoreMenuItem[]
}

const STAR_HINT_KEY = 'pulse-star-hint-shown'

/** The first star says what starring is for, once (C-25) */
function showStarHintOnce(message: string) {
  try {
    if (localStorage.getItem(STAR_HINT_KEY) === '1') return
    localStorage.setItem(STAR_HINT_KEY, '1')
  } catch { /* storage unavailable: the tooltip still says it */ }
  toast(message, { id: 'star-hint' })
}

function contactTypeWord(type: ContactType): string {
  return type === 'phone' ? 'Phone' : type === 'email' ? 'Email' : 'Address'
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await safeInvoke<T>(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function contactIcon(type: string) {
  if (type === 'phone') return <Phone className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
  if (type === 'email') return <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
  return <MapPin className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
}

function contactLink(type: string, value: string) {
  if (type === 'email') {
    return (
      <a href={`mailto:${value}`} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-words">
        {value}
      </a>
    )
  }
  if (type === 'phone') {
    return (
      <a href={`tel:${value.replace(/[^\d+]/g, '')}`} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-words">
        {value}
      </a>
    )
  }
  return <span className="break-words">{value}</span>
}

export function ProfileHeader({
  row,
  columns,
  gridId,
  onRowUpdate,
  onAddNote,
  onGenerateLetter,
  printItems,
  moreItems,
}: ProfileHeaderProps): React.ReactElement {
  const { t } = useVocab(gridId)
  // Age next to a birth date is for people only
  const holdsPeople = useHoldsPeople(gridId)
  const personFields = useFeature('personFields')
  const showAge = holdsPeople && personFields
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [rowTagIds, setRowTagIds] = useState<number[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('')
  const tagPickerRef = useRef<HTMLDivElement>(null)
  // Contact info state
  const [manualContacts, setManualContacts] = useState<ManualContact[]>([])
  const { copiedKey, copyToClipboard } = useCopyFeedbackKeyed()
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContactType, setNewContactType] = useState<ContactType>('phone')
  // After a save: "Want a Phone column for every client?" — a list-wide change, so it's
  // asked after the one-off entry is safe, not mixed into the form (C-10)
  const [columnOffer, setColumnOffer] = useState<ManualContact | null>(null)
  const [newContactLabel, setNewContactLabel] = useState('')
  const [newContactValue, setNewContactValue] = useState('')

  const rowId = row.row_id
  const loadTags = useCallback(async () => {
    try {
      const tags = await invoke<Tag[]>(IPC.TAG_GET_ALL, gridId)
      setAllTags(tags)
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to load tags', err)
    }
  }, [gridId])

  const loadRowTags = useCallback(async () => {
    try {
      const tagIds = await invoke<number[]>(IPC.TAG_GET_FOR_ROW, rowId)
      setRowTagIds(tagIds)
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to load row tags', err)
    }
  }, [rowId])

  const loadManualContacts = useCallback(async () => {
    try {
      const contacts = await invoke<ManualContact[]>(IPC.ROW_GET_MANUAL_CONTACTS, rowId)
      setManualContacts(contacts)
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to load manual contacts', err)
    }
  }, [rowId])

  useEffect(() => {
    void loadTags()
  }, [loadTags])

  useEffect(() => {
    void loadRowTags()
    void loadManualContacts()
  }, [loadRowTags, loadManualContacts])

  /** Saves the list, showing it straight away; puts the old list back if the save fails. */
  async function saveManualContacts(contacts: ManualContact[]): Promise<boolean> {
    const before = manualContacts
    setManualContacts(contacts)
    try {
      await invoke(IPC.ROW_SET_MANUAL_CONTACTS, row.row_id, contacts)
      return true
    } catch (err) {
      setManualContacts(before)
      rlog.error('ProfileHeader', 'Failed to save manual contacts', err)
      toast.error('We couldn\'t save that contact info — try again')
      return false
    }
  }

  async function addManualContact() {
    const value = newContactValue.trim()
    if (!value) return
    const label = newContactLabel.trim() || contactTypeWord(newContactType)
    const entry: ManualContact = { type: newContactType, label, value }
    // Keep what was typed if the save failed, so it can be tried again
    if (!await saveManualContacts([...manualContacts, entry])) return
    const hasColumn = columns.some(c => c.name.toLowerCase() === label.toLowerCase())
    setColumnOffer(hasColumn ? null : entry)
    setNewContactValue('')
    setNewContactLabel('')
    setNewContactType('phone')
    setShowAddContact(false)
  }

  /** A real column: every record gets one, and it's in the list, search and exports (R-27) */
  async function makeColumnFrom(entry: ManualContact) {
    setColumnOffer(null)
    await useGridStore.getState().addColumn(entry.label, entry.type)
    const added = useGridStore.getState().columns
      .filter(c => c.name === entry.label && c.column_type === entry.type)
      .sort((a, b) => b.id - a.id)[0]
    if (!added) return // addColumn already said what went wrong
    await useGridStore.getState().updateCell(row.row_id, added.id, entry.value)
    // The value now lives in the column, so it isn't shown twice
    const index = manualContacts.findIndex(c => c.type === entry.type && c.label === entry.label && c.value === entry.value)
    if (index >= 0) await saveManualContacts(manualContacts.filter((_, i) => i !== index))
  }

  async function removeManualContact(index: number) {
    const updated = manualContacts.filter((_, i) => i !== index)
    await saveManualContacts(updated)
  }

  async function toggleTag(tagId: number) {
    if (rowTagIds.includes(tagId)) {
      setRowTagIds(prev => prev.filter(id => id !== tagId))
      try {
        await invoke(IPC.TAG_UNASSIGN, row.row_id, tagId)
      } catch (err) {
        setRowTagIds(prev => [...prev, tagId])
        rlog.error('ProfileHeader', 'Failed to unassign tag', err)
        toast.error('We couldn\'t remove that tag — try again')
      }
    } else {
      setRowTagIds(prev => [...prev, tagId])
      try {
        await invoke(IPC.TAG_ASSIGN, row.row_id, tagId)
      } catch (err) {
        setRowTagIds(prev => prev.filter(id => id !== tagId))
        rlog.error('ProfileHeader', 'Failed to assign tag', err)
        toast.error('We couldn\'t add that tag — try again')
      }
    }
  }

  async function createAndAssignTag() {
    const name = newTagName.trim()
    if (!name) return
    let newTag: Tag
    try {
      newTag = await invoke<Tag>(IPC.TAG_CREATE, gridId, name, '#6b7280')
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to create tag', err)
      toast.error('We couldn\'t create that tag — try again')
      return
    }
    setAllTags(prev => [...prev, newTag])
    setNewTagName('')
    setRowTagIds(prev => [...prev, newTag.id])
    // Made it and put it on: done (C-27)
    setShowTagPicker(false)
    try {
      await invoke(IPC.TAG_ASSIGN, row.row_id, newTag.id)
    } catch (err) {
      setRowTagIds(prev => prev.filter(id => id !== newTag.id))
      rlog.error('ProfileHeader', 'Failed to assign new tag', err)
      toast.error('We created the tag but couldn\'t add it here — try again')
    }
  }

  function startEditTag(tag: Tag) {
    setEditingTagId(tag.id)
    setEditTagName(tag.name)
    setEditTagColor(tag.color)
  }

  async function saveEditTag() {
    if (editingTagId === null) return
    const name = editTagName.trim()
    if (!name) return
    try {
      await invoke(IPC.TAG_UPDATE, editingTagId, { name, color: editTagColor })
      setAllTags(prev => prev.map(t => t.id === editingTagId ? { ...t, name, color: editTagColor } : t))
      setEditingTagId(null)
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to update tag', err)
      toast.error('We couldn\'t save that tag — try again')
    }
  }

  async function deleteTag(tagId: number) {
    try {
      await invoke(IPC.TAG_DELETE, tagId)
      setAllTags(prev => prev.filter(t => t.id !== tagId))
      setRowTagIds(prev => prev.filter(id => id !== tagId))
    } catch (err) {
      rlog.error('ProfileHeader', 'Failed to delete tag', err)
      toast.error('We couldn\'t delete that tag — try again')
    }
  }

  // copyToClipboard provided by useCopyFeedbackKeyed above

  // Close pickers when clicking outside
  useEffect(() => {
    if (!showTagPicker) return
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTagPicker])

  // Derive display data from columns
  const identifierCols = columns.filter(c => c.is_identifier === 1 && c.is_name_column !== 1)
  const statusIdentifiers = identifierCols.filter(
    c => c.column_type === 'dropdown' || c.column_type === 'status'
  )
  const fieldIdentifiers = identifierCols.filter(
    c => c.column_type !== 'dropdown' && c.column_type !== 'status'
  )

  // Auto-populated contact info from grid columns
  const contactCols = columns.filter(c => CONTACT_TYPES.includes(c.column_type as ContactType))
  const populatedContacts = contactCols
    .map(c => {
      const val = row[`col_${c.id}` as keyof GridRow] as string | null
      return val && val.trim() ? { type: c.column_type as ContactType, label: c.name, value: val.trim(), colId: c.id } : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const hasAnyContacts = populatedContacts.length > 0 || manualContacts.length > 0

  const clientName = getClientName(row, columns, `Unknown ${t('record')}`)
  const isSample = useGridStore(s => s.sampleRows[row.row_id] !== undefined)

  const initials = clientName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  const isStarred = row.is_starred === 1

  function getCellValue(col: Column): string {
    const raw = row[`col_${col.id}` as keyof GridRow] as string | null
    if (!raw) return '—'
    if (col.column_type === 'date') {
      const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
      if (isNaN(d.getTime())) return raw
      const formatted = shortDate(d)
      const isDob = /dob|birth|born/i.test(col.name)
      return isDob && showAge ? `${formatted} (${computeAge(raw)})` : formatted
    }
    if (col.column_type === 'checkbox') return raw === '1' ? 'Yes' : 'No'
    return raw
  }

  function getStatusStyle(col: Column, value: string): React.CSSProperties {
    try {
      // Same colors as the list: status columns keep them on their options (R-21)
      const config = JSON.parse(col.config) as { options?: Array<string | { label?: string; color?: string }>; colors?: Record<string, string> }
      const option = config.options?.find(o => typeof o === 'object' && o.label === value) as { color?: string } | undefined
      const bg = option?.color ?? config.colors?.[value]
      if (bg) return { backgroundColor: bg, color: '#fff' }
    } catch { /* ignore */ }
    return { backgroundColor: 'rgb(var(--color-slate-100) / 1)', color: 'rgb(var(--color-slate-600) / 1)' }
  }

  const assignedTags = allTags.filter(t => rowTagIds.includes(t.id))
  return (
    // On the page itself, not a card (Q8): space and the name's size set it apart.
    // No overflow-hidden: it clipped the "More" menu that opens below the buttons
    <div>
      <div className="px-4 pt-2 pb-4">
        {/* ── Row 1: Avatar + Name + Status Badges + Controls ── */}
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold text-white select-none"
            style={{ backgroundColor: '#64748b' }}
          >
            {initials || '?'}
          </div>

          {/* Name + status badges + identifier fields */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="text-2xl font-bold text-slate-900 dark:text-slate-100 truncate"
                style={{ fontSize: '1.5rem' }}
              >
                {clientName}
              </h1>
              {isSample && <SamplePill />}
              {statusIdentifiers.map(col => {
                const val = row[`col_${col.id}` as keyof GridRow] as string | null
                if (!val) return null
                return (
                  <span
                    key={col.id}
                    className="px-2.5 py-0.5 rounded-full text-sm font-medium"
                    style={getStatusStyle(col, val)}
                  >
                    {val}
                  </span>
                )
              })}
            </div>

            {fieldIdentifiers.length > 0 && (
              <div className="flex items-center gap-0 mt-1 flex-wrap">
                {fieldIdentifiers.map((col, i) => (
                  <span key={col.id} className="text-sm text-slate-600 dark:text-slate-400">
                    {i > 0 && <span className="mx-3 text-slate-300 dark:text-slate-500 select-none">·</span>}
                    <span className="font-medium text-slate-500 dark:text-slate-400">{col.name}:</span>
                    {' '}
                    {getCellValue(col)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right controls: star */}
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {/* Star toggle */}
            <button
              onClick={() => {
                onRowUpdate({ is_starred: isStarred ? 0 : 1 })
                if (!isStarred) showStarHintOnce(`Starred. The ${t('list')} has a Starred filter to find starred ${t('record', { many: true })} quickly.`)
              }}
              className="hit-44 p-1 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              title={isStarred ? 'Remove star' : `Star this ${t('record')} to find it quickly (the ${t('list')} has a Starred filter)`}
              aria-label={isStarred ? 'Remove star' : `Star this ${t('record')}`}
            >
              <Star
                className={`w-5 h-5 ${
                  isStarred
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Row 2: Tags ── */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {assignedTags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm font-medium"
              style={{
                backgroundColor: `${tag.color}22`,
                color: tag.color,
                border: `1px solid ${tag.color}55`,
              }}
            >
              {tag.name}
              <button
                onClick={() => void toggleTag(tag.id)}
                className="hit-44 ml-0.5 rounded-full hover:opacity-70 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-current"
                aria-label={`Remove tag ${tag.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {/* Tag picker */}
          <div className="relative" ref={tagPickerRef}>
            <button
              onClick={() => setShowTagPicker(p => !p)}
              className="hit-44 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-base text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              aria-label="Add tag"
            >
              <Plus className="w-3.5 h-3.5" />
              Add tag
            </button>

            {showTagPicker && (
              <div
                className="absolute left-0 top-8 z-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3"
                style={{ minWidth: 260, maxWidth: 320 }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-base text-slate-600 dark:text-slate-300">
                    Tags are quick labels you can filter the {t('list')} by.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTagPicker(false)}
                    className="hit-44 flex-shrink-0 px-2 text-base font-medium text-blue-600 dark:text-blue-400 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                  >
                    Done
                  </button>
                </div>
                <div className="space-y-0.5 max-h-48 overflow-y-auto mb-2">
                  {allTags.map(tag => (
                    editingTagId === tag.id ? (
                      <div key={tag.id} className="flex items-center gap-1 px-2 py-1">
                        <input
                          type="color"
                          value={editTagColor}
                          onChange={e => setEditTagColor(e.target.value)}
                          className="w-5 h-5 border-0 p-0 cursor-pointer rounded-sm"
                        />
                        <input
                          value={editTagName}
                          onChange={e => setEditTagName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void saveEditTag(); if (e.key === 'Escape') setEditingTagId(null) }}
                          autoFocus
                          className="flex-1 text-base px-1 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                          style={{ fontSize: 15 }}
                        />
                        <button onClick={() => void saveEditTag()} className="hit-44 p-0.5 text-green-600 hover:text-green-700" aria-label="Save">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingTagId(null)} className="hit-44 p-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-600" aria-label="Cancel">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div key={tag.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                        <button
                          onClick={() => void toggleTag(tag.id)}
                          className="hit-44 flex items-center gap-2 flex-1 text-left focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                        >
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                          <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">{tag.name}</span>
                          {rowTagIds.includes(tag.id) && (
                            <span className="text-sm text-blue-600 dark:text-blue-400 font-bold">✓</span>
                          )}
                        </button>
                        <button
                          onClick={() => startEditTag(tag)}
                          className="hit-44 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-opacity focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                          aria-label={`Edit tag ${tag.name}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => void deleteTag(tag.id)}
                          className="hit-44 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 text-slate-500 dark:text-slate-400 hover:text-red-500 transition-opacity focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                          aria-label={`Delete tag ${tag.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )
                  ))}
                  {allTags.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 px-2 py-1">
                      No tags yet — create one below
                    </p>
                  )}
                </div>
                {/* Create new tag */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
                  <div className="flex gap-1">
                    <input
                      value={newTagName}
                      onChange={e => setNewTagName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void createAndAssignTag()
                        }
                      }}
                      placeholder="New tag name…"
                      className="flex-1 text-base px-2 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                      style={{ fontSize: 15 }}
                    />
                    <PrimaryButton size="compact" onClick={() => void createAndAssignTag()} disabled={!newTagName.trim()}>
                      Add
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Row 3: Contact Info ── */}
        {(hasAnyContacts || showAddContact) && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {/* Auto-populated contacts from grid columns */}
              {populatedContacts.map(c => (
                <div key={`col-${c.colId}`} className="flex items-center gap-2 text-sm">
                  {contactIcon(c.type)}
                  <span className="text-slate-500 dark:text-slate-400">{c.label}:</span>
                  <span className="text-slate-900 dark:text-slate-100">
                    {contactLink(c.type, c.value)}
                  </span>
                  <button
                    onClick={() => void copyToClipboard(c.value, `col-${c.colId}`)}
                    title="Copy"
                    aria-label="Copy value"
                    className="hit-44 p-0.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {copiedKey === `col-${c.colId}`
                      ? <Check className="w-3.5 h-3.5 text-green-500" />
                      : <Copy className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              ))}

              {/* Manual contacts */}
              {manualContacts.map((c, i) => (
                <div key={`manual-${i}`} className="flex items-center gap-2 text-sm">
                  {contactIcon(c.type)}
                  <span className="text-slate-500 dark:text-slate-400">{c.label}:</span>
                  <span className="text-slate-900 dark:text-slate-100">
                    {contactLink(c.type, c.value)}
                  </span>
                  <button
                    onClick={() => void copyToClipboard(c.value, `manual-${i}`)}
                    title="Copy"
                    aria-label="Copy value"
                    className="hit-44 p-0.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {copiedKey === `manual-${i}`
                      ? <Check className="w-3.5 h-3.5 text-green-500" />
                      : <Copy className="w-3.5 h-3.5" />
                    }
                  </button>
                  <button
                    onClick={() => void removeManualContact(i)}
                    title="Remove"
                    aria-label="Remove contact"
                    className="hit-44 p-0.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add contact form */}
        {showAddContact ? (
          <div className="mt-2 flex items-end gap-2 flex-wrap">
            <div>
              <label htmlFor="profile-contact-type" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Kind</label>
              <select
                id="profile-contact-type"
                value={newContactType}
                onChange={e => setNewContactType(e.target.value as ContactType)}
                className="text-base px-2 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15, minHeight: 44 }}
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="address">Address</option>
              </select>
            </div>
            <div>
              <label htmlFor="profile-contact-label" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Name</label>
              <input
                id="profile-contact-label"
                value={newContactLabel}
                onChange={e => setNewContactLabel(e.target.value)}
                placeholder={newContactType === 'phone' ? 'e.g. Work phone' : newContactType === 'email' ? 'e.g. Work email' : 'e.g. Home'}
                className="text-base px-2 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15, minHeight: 44, width: 150 }}
              />
            </div>
            <div className="flex-1" style={{ minWidth: 160 }}>
              <label htmlFor="profile-contact-value" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Number or address</label>
              <input
                id="profile-contact-value"
                value={newContactValue}
                onChange={e => setNewContactValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addManualContact()
                  }
                  if (e.key === 'Escape') {
                    setShowAddContact(false)
                  }
                }}
                placeholder={newContactType === 'phone' ? '(555) 123-4567' : newContactType === 'email' ? 'name@example.com' : '123 Main St'}
                className="w-full text-base px-2 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15, minHeight: 44 }}
                autoFocus
              />
            </div>
            <PrimaryButton onClick={() => void addManualContact()} disabled={!newContactValue.trim()}>
              Add
            </PrimaryButton>
            <button
              onClick={() => setShowAddContact(false)}
              className="hit-44 px-2 py-1.5 text-base text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              style={{ minHeight: 44 }}
            >
              Cancel
            </button>
          </div>
        ) : columnOffer ? (
          <div role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-slate-600 dark:text-slate-300">
            <span>
              Want a &ldquo;{columnOffer.label}&rdquo; column for every {t('record')}, so it shows in the {t('list')}, search and exports?
            </span>
            <button type="button" onClick={() => void makeColumnFrom(columnOffer)}
              className="hit-44 font-medium text-blue-600 dark:text-blue-400 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              Add the column
            </button>
            <button type="button" onClick={() => setColumnOffer(null)}
              className="hit-44 text-slate-500 dark:text-slate-400 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              No thanks
            </button>
          </div>
        ) : holdsPeople && (
          // Extra phone numbers and emails are for people; a car or a job doesn't need them (R-27)
          <div className={hasAnyContacts ? 'mt-2' : 'mt-3 pt-3 border-t border-slate-100 dark:border-slate-700'}>
            <button
              onClick={() => { setColumnOffer(null); setShowAddContact(true) }}
              className="hit-44 inline-flex items-center gap-1 text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add contact info
            </button>
          </div>
        )}

        {/* ── Row 4: Quick action buttons ── */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex-wrap">
          {onAddNote && (
            <PrimaryButton onClick={onAddNote} icon={<Plus className="w-4 h-4" />} className="font-semibold shadow-sm">
              {t('activity', { cap: true })}
            </PrimaryButton>
          )}
          {onGenerateLetter && (
            <button
              onClick={onGenerateLetter}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-base font-semibold bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-600 shadow-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-slate-400 focus-visible:ring-offset-3 transition-colors"
              style={{ minHeight: 44, fontSize: 15 }}
              title={`Fill in a letter template with this ${t('record')}'s details`}
            >
              <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              Make a letter…
            </button>
          )}
          {printItems && <ProfileMoreMenu items={printItems} label="Print or save" menuLabel="Print or save" />}
          {moreItems && <ProfileMoreMenu items={moreItems} />}
        </div>
      </div>
    </div>
  )
}
