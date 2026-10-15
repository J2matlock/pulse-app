import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import type { Column, ColumnType } from '../../../shared/types'
import { COLUMN_TYPE_INFO } from '../../../shared/columnTypes'
import { AUTO_NUMBER_PREFIX_MAX, DEFAULT_AUTO_NUMBER, formatAutoNumber, parseAutoNumberConfig } from '../../../shared/autoNumber'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { useVocab } from '../../hooks/useVocab'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { FeatureOffer } from '../shared/FeatureOffer'
import { FEATURE_SUGGESTIONS } from '../../../shared/featureSuggestions'
import { DeadlineQuestion } from './DeadlineQuestion'
import { ensurePlainRule, type DeadlineChoice } from '../alerts/plainRule'

/** Every type a new column can be (links and file counts have their own entries) */
const COLUMN_TYPES = COLUMN_TYPE_INFO

interface AddColumnDraftOptions {
  /** The pop-up is open: its name field takes focus */
  open: boolean
  /** Records in the list now (an auto-number column can number them) */
  rowCount: number
  /** Closes the pop-up after a column is added */
  onAdded: () => void
  /** "More options…" was chosen for a date: open the full rule editor for this column */
  onMoreOptions: (columnId: number) => void
}

/**
 * What's typed into "Add a column". Kept by the toolbar, not the pop-up, so closing
 * the pop-up and opening it again keeps a half-filled form.
 */
export function useAddColumnDraft({ open, rowCount, onAdded, onMoreOptions }: AddColumnDraftOptions) {
  const addColumn = useGridStore(s => s.addColumn)
  const alertRules = useAlertStore(s => s.rules)
  const createRule = useAlertStore(s => s.createRule)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColumnType>('text')
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice>({ mode: 'none' })
  const [dropdownOptions, setDropdownOptions] = useState('')
  const [sourceColumnId, setSourceColumnId] = useState<number | null>(null)
  const [autoPrefix, setAutoPrefix] = useState('')
  const [autoPad, setAutoPad] = useState(DEFAULT_AUTO_NUMBER.pad)
  const [numberExisting, setNumberExisting] = useState(true)
  const colNameInputRef = useRef<HTMLInputElement>(null)

  // Imperatively focus the input each time the popup opens (autoFocus is unreliable
  // in Electron after a loadGrid re-render resets focus state)
  useEffect(() => {
    if (open) {
      setTimeout(() => colNameInputRef.current?.focus(), 0)
    }
  }, [open])

  async function handleAddColumn(e: React.FormEvent) {
    e.preventDefault()
    await addWithName(newColName.trim())
  }

  /** Adds the column under this name (the form's own, or the "Phone 2" offered for a duplicate, B-14) */
  async function addWithName(name: string) {
    if (!name) return

    let config: string | undefined
    if (newColType === 'dropdown') {
      const options = dropdownOptions.split('\n').map(o => o.trim()).filter(Boolean)
      config = JSON.stringify({ options })
    } else if (newColType === 'status') {
      const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
      const labels = dropdownOptions.split('\n').map(o => o.trim()).filter(Boolean)
      const options = labels.map((label, i) => ({ label, color: STATUS_COLORS[i % STATUS_COLORS.length] }))
      config = JSON.stringify({ options })
    } else if (newColType === 'age_from_dob' || newColType === 'calculated_days') {
      if (sourceColumnId === null) { toast.error('Choose the date it works from.'); return }
      config = JSON.stringify({ source_column_id: sourceColumnId })
    } else if (newColType === 'auto_number') {
      config = JSON.stringify(parseAutoNumberConfig({ prefix: autoPrefix, pad: autoPad, next: 1 }))
    } else if (newColType === 'date' || newColType === 'deadline') {
      // "Does this date come due again?": a plain rule now, or the full editor once the column exists
      const ruleId = await ensurePlainRule(deadlineChoice, alertRules, createRule)
      if (ruleId !== null) config = JSON.stringify({ alert_rule_id: ruleId })
    }

    const colId = await addColumn(name, newColType, config, { numberExisting: rowCount > 0 && numberExisting })
    if (colId !== null && (newColType === 'date' || newColType === 'deadline') && deadlineChoice.mode === 'more') onMoreOptions(colId)
    setDeadlineChoice({ mode: 'none' })
    setNewColName('')
    setNewColType('text')
    setDropdownOptions('')
    setAutoPrefix('')
    setAutoPad(DEFAULT_AUTO_NUMBER.pad)
    setNumberExisting(true)
    onAdded()
  }

  return {
    newColName, setNewColName, newColType, setNewColType, deadlineChoice, setDeadlineChoice,
    dropdownOptions, setDropdownOptions, sourceColumnId, setSourceColumnId, autoPrefix, setAutoPrefix,
    autoPad, setAutoPad, numberExisting, setNumberExisting, colNameInputRef, handleAddColumn, addWithName,
  }
}

export type AddColumnDraft = ReturnType<typeof useAddColumnDraft>

export interface AddColumnFormProps {
  draft: AddColumnDraft
  /** Every column of the list, hidden ones too, in order */
  allColumns: Column[]
  rowCount: number
  gridCount: number
  linksOn: boolean
  filesOn: boolean
  /** "Link to another list…" was picked: that's set up in its own dialog */
  onLinkColumn: () => void
  onCancel: () => void
}

/** "Phone" taken → "Phone 2", "Phone 3"… the first name no column has (B-14) */
export function freeColumnName(name: string, allColumns: Array<{ name: string }>): string {
  const taken = new Set(allColumns.map(c => c.name.trim().toLowerCase()))
  if (!taken.has(name.trim().toLowerCase())) return name
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** The column, hidden or shown, already called this (case doesn't matter) */
export function sameNamedColumn(name: string, allColumns: Column[]): Column | undefined {
  const wanted = name.trim().toLowerCase()
  return wanted ? allColumns.find(c => c.name.trim().toLowerCase() === wanted) : undefined
}

/**
 * The "Add a column" form, as a centred dialog (B-03): name, type, and what that
 * type needs. A name a column already has is caught before it's added (B-14).
 */
export function AddColumnForm({ draft, allColumns, rowCount, gridCount, linksOn, filesOn, onLinkColumn, onCancel }: AddColumnFormProps): React.ReactElement {
  const { t, f } = useVocab()
  const formId = useId()
  // The name field takes focus at once, before the trap's own first-field focus
  const nameRef = draft.colNameInputRef
  useLayoutEffect(() => { nameRef.current?.focus() }, [nameRef])
  const [duplicateOf, setDuplicateOf] = useState<Column | null>(null)
  const typedName = draft.newColName.trim()
  const suggestion = duplicateOf ? freeColumnName(typedName, allColumns) : ''

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const existing = sameNamedColumn(typedName, allColumns)
    if (existing) { setDuplicateOf(existing); return }
    void draft.handleAddColumn(e)
  }

  return createPortal(
    <Dialog open onClose={onCancel} title="Add a column" size="md"
      footer={<>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton type="submit" form={formId}>Add</PrimaryButton>
      </>}>
      <form id={formId} onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="new-col-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Column name
          </label>
          <input
            id="new-col-name"
            ref={draft.colNameInputRef}
            type="text"
            className="input"
            style={{ minHeight: 36 }}
            value={draft.newColName}
            onChange={e => { draft.setNewColName(e.target.value); setDuplicateOf(null) }}
            placeholder="e.g. Last contact date"
            aria-describedby={duplicateOf ? `${formId}-dup` : undefined}
            aria-invalid={duplicateOf ? true : undefined}
          />
          {duplicateOf && (
            <div id={`${formId}-dup`} role="alert" className="mt-2 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
              <p className="text-base text-amber-900 dark:text-amber-200">
                There's already a column called “{duplicateOf.name}”{duplicateOf.is_visible === 0 ? ' (hidden)' : ''}. Two with the same name are hard to tell apart in filters and reports.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" style={{ minHeight: 44, fontSize: 15 }}
                  onClick={() => { setDuplicateOf(null); void draft.addWithName(suggestion) }}>
                  Add as “{suggestion}”
                </button>
                <button type="button" className="btn-secondary" style={{ minHeight: 44, fontSize: 15 }}
                  onClick={() => { setDuplicateOf(null); nameRef.current?.focus() }}>
                  Change the name
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="new-col-type" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Type
          </label>
          <select
            id="new-col-type"
            className="input"
            style={{ minHeight: 36 }}
            value={draft.newColType}
            onChange={e => {
              // A link column is set up in its own dialog (W04 §7.1)
              if (e.target.value === 'link') { onLinkColumn(); return }
              draft.setNewColType(e.target.value as ColumnType); draft.setDropdownOptions('')
              draft.setDeadlineChoice(e.target.value === 'deadline' ? { mode: 'every', n: 12, unit: 'months' } : { mode: 'none' })
            }}
          >
            {COLUMN_TYPES.map(({ type, label }) => (
              <option key={type} value={type}>{label}</option>
            ))}
            {linksOn && <option value="link">Link to another {t('list')}…</option>}
            {filesOn && <option value="file_count">Files (how many)</option>}
          </select>
          {COLUMN_TYPES.find(c => c.type === draft.newColType) && (
            <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{COLUMN_TYPES.find(c => c.type === draft.newColType)!.description}</p>
          )}
        </div>
        {!linksOn && gridCount > 1 && (
          <FeatureOffer feature="links" message={f(FEATURE_SUGGESTIONS.links.message)} />
        )}

        {(draft.newColType === 'date' || draft.newColType === 'deadline') && (
          <DeadlineQuestion type={draft.newColType} value={draft.deadlineChoice} onChange={draft.setDeadlineChoice} />
        )}

        {(draft.newColType === 'age_from_dob' || draft.newColType === 'calculated_days') && (
          <div>
            <label htmlFor="new-col-source" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Worked out from</label>
            <select id="new-col-source" className="input" style={{ minHeight: 36 }} value={draft.sourceColumnId ?? ''} onChange={e => draft.setSourceColumnId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose a date column…</option>
              {allColumns.filter(c => c.column_type === 'date').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!allColumns.some(c => c.column_type === 'date') && <p className="mt-1 text-base text-slate-500 dark:text-slate-400">Add a date column first.</p>}
          </div>
        )}

        {(draft.newColType === 'dropdown' || draft.newColType === 'status') && (
          <div>
            <label htmlFor="new-col-options" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              {draft.newColType === 'status' ? 'Statuses' : 'Choices'} <span className="font-normal text-slate-500 dark:text-slate-400">(one per line)</span>
            </label>
            <textarea
              id="new-col-options"
              className="input resize-none"
              rows={4}
              value={draft.dropdownOptions}
              onChange={e => draft.setDropdownOptions(e.target.value)}
              placeholder={draft.newColType === 'status' ? 'Active\nPending\nClosed' : 'Option A\nOption B\nOption C'}
              style={{ minHeight: 'unset', height: 'auto', padding: '8px 12px' }}
            />
            {draft.newColType === 'status' && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Colors are assigned automatically.</p>
            )}
          </div>
        )}

        {draft.newColType === 'auto_number' && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="new-col-prefix" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Starts with <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
                </label>
                <input id="new-col-prefix" className="input" style={{ minHeight: 36 }} maxLength={AUTO_NUMBER_PREFIX_MAX}
                  placeholder="e.g. J-" value={draft.autoPrefix} onChange={e => draft.setAutoPrefix(e.target.value)} />
              </div>
              <div className="w-28">
                <label htmlFor="new-col-pad" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Digits</label>
                <select id="new-col-pad" className="input" style={{ minHeight: 36 }} value={draft.autoPad} onChange={e => draft.setAutoPad(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Each new {t('record')} gets the next number: {formatAutoNumber({ prefix: draft.autoPrefix, pad: draft.autoPad }, 1)}, {formatAutoNumber({ prefix: draft.autoPrefix, pad: draft.autoPad }, 2)}…
            </p>
            {rowCount > 0 && (
              <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="checkbox" className="w-5 h-5" checked={draft.numberExisting} onChange={e => draft.setNumberExisting(e.target.checked)} />
                Number the {t('record', { many: true })} already in this {t('list')}
              </label>
            )}
          </div>
        )}
      </form>
    </Dialog>,
    document.body
  )
}
