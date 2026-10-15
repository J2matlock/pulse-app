/**
 * ImportSummary — the one screen of the import (UX Q1a). Before the import it
 * shows Pulse's guesses ("Ready to bring in 80 clients", names put together,
 * which dates repeat); after it, what came in, what was skipped and what to
 * check. The wizard owns the buttons; this is what sits between them.
 */
import React, { useId, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type { Column } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { describeRepeats, everyPhrase, type DateAnswer } from '../../utils/repeatGuess'
import { DateRepeatPicker } from '../../views/setup/DateRepeatPicker'
import { SecondaryButton } from '../ui/Button'
import { TypeBadge, findNameParts, splitWarning, type ColumnMapping, type ImportOptions, type ImportPreview, type ImportResult } from './importWizardShared'

/** Column chips shown before "and N more" */
const CHIPS_MAX = 12

export interface ImportSummaryProps {
  gridId: number
  /** Before the import: the guesses. After: what came in */
  phase: 'before' | 'after'
  preview: ImportPreview
  mappings: ColumnMapping[]
  combineNames: boolean
  flipNames: boolean
  duplicateStrategy: ImportOptions['duplicateStrategy']
  existingColumns: Column[]
  result: ImportResult | null
  loading: boolean
  importProgress: { imported: number; total: number } | null
  undo: 'idle' | 'busy' | 'done'
  /** The new date columns, keyed by their place in the file */
  dateColumns: Array<{ id: number; name: string }>
  dateAnswers: Record<number, DateAnswer>
  onDateAnswers: (next: Record<number, DateAnswer>) => void
  /** Show the repeat picker here (false once it was answered before the import) */
  askDates: boolean
  /** Setup's list name and "Each line is one…" */
  slot?: React.ReactNode
  onUseOtherSheet?: () => void
  onPickHeaderRow?: () => void
}

/** One warning: a short line, and the reason behind "Why?" (UX-B-35) */
export function WarningLine({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const { line, why } = splitWarning(text)
  return (
    <li className="text-base text-amber-800 dark:text-amber-200">
      <span>{line}</span>
      {why && (
        <>
          {' '}
          <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
            className="hit-44 text-base text-amber-800 dark:text-amber-200 underline rounded-full focus:outline-hidden focus:ring-3 focus:ring-amber-400">
            {open ? 'Hide why' : 'Why?'}
          </button>
          {open && <p className="text-base text-amber-800 dark:text-amber-300 mt-1">{why}</p>}
        </>
      )}
    </li>
  )
}

/** "Things to check": collapsed, with its count */
function ThingsToCheck({ warnings }: { warnings: string[] }): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  if (warnings.length === 0) return null
  return (
    <section className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 min-h-[44px] text-left text-base font-medium text-amber-800 dark:text-amber-200 rounded-lg focus:outline-hidden focus:ring-3 focus:ring-amber-400">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1">{warnings.length} {warnings.length === 1 ? 'thing' : 'things'} to check</span>
        <span className="underline">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-1">
          {warnings.slice(0, 10).map((w, i) => <WarningLine key={i} text={w} />)}
          {warnings.length > 10 && <li className="text-base text-amber-800 dark:text-amber-300">…and {warnings.length - 10} more</li>}
        </ul>
      )}
    </section>
  )
}

/**
 * "Some dates in Plan Review are in the future. Are these the dates it's next
 * due, or the dates it was last done?" One per partly-future date column, to
 * answer before Import (persona study R4: future reviews became "Last done").
 */
function FutureDatesQuestion({ name, answer, onPick }: {
  name: string
  answer: DateAnswer & { mixed: NonNullable<DateAnswer['mixed']> }
  onPick: (picked: 'due' | 'last') => void
}): React.ReactElement {
  const id = useId()
  const { every } = answer.mixed
  const options: Array<{ value: 'due' | 'last'; label: React.ReactNode }> = [
    { value: 'due', label: <>Next due: these are the dates it&apos;s due</> },
    { value: 'last', label: <>Last done: it&apos;s due again {everyPhrase(every.n, every.unit)} after them</> },
  ]
  return (
    <fieldset className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3" data-testid="future-dates-question">
      <legend className="sr-only">{name}: next due or last done?</legend>
      <p className="text-base text-slate-800 dark:text-slate-100">
        Some dates in <strong>{name}</strong> are in the future. Are these the dates it&apos;s <strong>next due</strong>, or the dates it was <strong>last done</strong>?
      </p>
      <div className="mt-2 space-y-1">
        {options.map(o => (
          <label key={o.value} className="flex items-center gap-3 min-h-[44px] px-1 text-base text-slate-800 dark:text-slate-100 cursor-pointer">
            <input type="radio" name={`${id}-future`} className="w-5 h-5 flex-shrink-0" checked={answer.mixed.picked === o.value} onChange={() => onPick(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {answer.mixed.picked === null && <p className="text-sm text-amber-800 dark:text-amber-200">Choose one to go on.</p>}
    </fieldset>
  )
}

/** The answer after "next due" or "last done" on the future-dates question; the question stays */
export function pickFutureDates(a: DateAnswer, picked: 'due' | 'last'): DateAnswer {
  if (!a.mixed) return a
  const mixed = { ...a.mixed, picked }
  return picked === 'due' ? { repeat: 'due', mixed } : { repeat: 'every', n: a.mixed.every.n, unit: a.mixed.every.unit, mixed }
}

/**
 * The repeat picker's answers, keeping what it doesn't know about: a changed
 * column's future-dates question follows the new choice (a due date = "next
 * due", a repeat = "last done"); "no reminder" drops the question.
 */
export function mergePickerAnswers(prev: Record<number, DateAnswer>, next: Record<number, DateAnswer>): Record<number, DateAnswer> {
  return Object.fromEntries(Object.entries(next).map(([id, a]): [string, DateAnswer] => {
    const old = prev[Number(id)]
    if (!old || a === old) return [id, a]
    // "Update from notes" is the summary's own checkbox: the picker keeps it
    const follows = old.followsNotes && a.followsNotes === undefined ? { followsNotes: old.followsNotes, followsNotesOff: old.followsNotesOff } : {}
    if (!old.mixed) return [id, { ...a, ...follows }]
    if (a.repeat === 'no') return [id, { repeat: 'no', ...follows }]
    const mixed = a.repeat === 'due' ? { ...old.mixed, picked: 'due' as const } : { ...old.mixed, picked: 'last' as const, every: { n: a.n, unit: a.unit } }
    return [id, { ...a, mixed, ...follows }]
  }))
}

/** "Visit, Phone or Email" from note type keys */
function orList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** "Update Last Contact when I log a note": the import's guess, one click to turn off */
function FollowsNotesBox({ name, on, onChange }: { name: string; on: boolean; onChange: (on: boolean) => void }): React.ReactElement {
  const { t } = useVocab()
  return (
    <label className="flex items-center gap-3 min-h-[44px] text-base text-slate-800 dark:text-slate-100 cursor-pointer">
      <input type="checkbox" className="w-5 h-5 flex-shrink-0" checked={on} onChange={e => onChange(e.target.checked)} />
      <span>Update {name} when I log {t('activity', { article: true })}</span>
    </label>
  )
}

/** A column as the summary lists it: its name in the list and what it holds */
interface ColumnChip { key: number; name: string; type: string; existing: boolean }

function chipsBefore(preview: ImportPreview, mappings: ColumnMapping[], existingColumns: Column[]): ColumnChip[] {
  return mappings.flatMap((m): ColumnChip[] => {
    if (m.action === 'skip') return []
    if (m.action === 'create') {
      const detected = preview.detectedColumns.find(c => c.index === m.sourceIndex)
      return [{ key: m.sourceIndex, name: m.newName || preview.headers[m.sourceIndex] || `Column ${m.sourceIndex + 1}`, type: m.newType ?? detected?.detectedType ?? 'text', existing: false }]
    }
    const col = existingColumns.find(c => c.id === m.action)
    return col ? [{ key: m.sourceIndex, name: col.name, type: col.column_type, existing: true }] : []
  })
}

function chipsAfter(result: ImportResult): ColumnChip[] {
  return (result.columns ?? []).map(c => ({ key: c.sourceIndex, name: c.name, type: c.type, existing: !c.created }))
}

export function ImportSummary({
  gridId, phase, preview, mappings, combineNames, flipNames, duplicateStrategy, existingColumns, result, loading, importProgress, undo,
  dateColumns, dateAnswers, onDateAnswers, askDates, slot, onUseOtherSheet, onPickHeaderRow,
}: ImportSummaryProps): React.ReactElement {
  const { t } = useVocab(gridId)
  const activity = useActivityTypes()
  const before = phase === 'before'

  if (loading) {
    return (
      <div className="px-6 py-8 flex flex-col items-center gap-3" role="status">
        {importProgress ? (
          <>
            <span className="text-base text-slate-600 dark:text-slate-300">Importing {importProgress.imported} of {importProgress.total}…</span>
            <div className="w-full max-w-md h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
                style={{ width: `${Math.round((importProgress.imported / Math.max(importProgress.total, 1)) * 100)}%` }} />
            </div>
          </>
        ) : (
          <span className="text-base text-slate-500 dark:text-slate-400 animate-pulse">Importing…</span>
        )}
      </div>
    )
  }

  const count = before ? (preview.dataRowCount ?? preview.rows.length) : (result?.imported ?? 0)
  const undoneCount = result?.newRowIds?.length ?? 0

  // ── What Pulse does (or did) ───────────────────────────────────────────────
  const did: React.ReactNode[] = []
  const parts = findNameParts(preview)
  const firstGoesIn = parts ? mappings.find(m => m.sourceIndex === parts.firstIndex)?.action !== 'skip' : false
  if (before ? (combineNames && parts && firstGoesIn) : result?.combinedNames) {
    did.push(<>First and last names {before ? 'go' : 'were put'} together{parts?.example ? <>, like “{parts.example}”</> : null}.</>)
  }
  const flipColumn = preview.detectedColumns.find(c => c.lastFirstNames && mappings.find(m => m.sourceIndex === c.index)?.action !== 'skip')
  if (before ? (flipNames && flipColumn) : (result?.flippedColumns?.length ?? 0) > 0) {
    const sample = flipColumn?.samples.find(v => /^[^,]+,\s*[^,]+$/.test(v))
    const turned = sample ? sample.split(',').map(x => x.trim()) : null
    did.push(<>Names written last name first {before ? 'are' : 'were'} turned around{turned ? <>, like “{sample}” → “{turned[1]} {turned[0]}”</> : null}.</>)
  }
  const placeholders = before
    ? preview.detectedColumns.flatMap(c => {
      const m = mappings.find(x => x.sourceIndex === c.index)
      const intoDate = m && (m.action === 'create' ? m.newType === 'date' : m.action !== 'skip' && existingColumns.find(e => e.id === m.action)?.column_type === 'date')
      return c.placeholders && intoDate ? [{ column: m.action === 'create' ? (m.newName || c.originalName) : c.originalName, ...c.placeholders }] : []
    })
    : (result?.placeholderDates ?? [])
  for (const p of placeholders) {
    did.push(<>{p.count} {p.count === 1 ? 'cell' : 'cells'} in “{p.column}” {before ? (p.count === 1 ? 'says' : 'say') : 'said'} things like “{p.example}”, so {p.count === 1 ? 'it has' : 'they have'} no date yet.</>)
  }
  const hidden = preview.hiddenRowCount ?? 0
  if (before && hidden > 0) did.push(<>{hidden} {hidden === 1 ? 'row is' : 'rows are'} hidden in the spreadsheet. {hidden === 1 ? 'It comes' : 'They come'} in too.</>)

  const chips = before ? chipsBefore(preview, mappings, existingColumns) : (result ? chipsAfter(result) : [])
  const leftOut = before ? mappings.filter(m => m.action === 'skip' && !(combineNames && parts && m.sourceIndex === parts.lastIndex))
    .map(m => preview.headers[m.sourceIndex] ?? '').filter(Boolean) : []

  const repeats = describeRepeats(dateColumns, dateAnswers)
  // Columns that will follow notes ("Logging Visit or Phone notes will update Last Contact"), unless turned off here
  const followers = dateColumns.flatMap(c => {
    const a = dateAnswers[c.id]
    return a?.followsNotes?.length && a.repeat === 'every' ? [{ column: c, types: a.followsNotes, on: !a.followsNotesOff }] : []
  })
  const toggleFollow = (id: number, on: boolean) => {
    const a = dateAnswers[id]
    if (a) onDateAnswers({ ...dateAnswers, [id]: { ...a, followsNotesOff: on ? undefined : true } })
  }
  const futureQuestions = dateColumns.flatMap(c => {
    const a = dateAnswers[c.id]
    return a?.mixed ? [{ column: c, answer: { ...a, mixed: a.mixed } }] : []
  })
  const warnings = before ? (preview.warnings ?? []) : (result?.warnings ?? [])
  const sheetName = preview.sheets[preview.activeSheet] ?? preview.sheets[0] ?? ''

  return (
    <div className="px-6 py-4 space-y-4">
      {slot}

      {/* 1. What comes in */}
      <div role={before ? undefined : 'status'} className={`flex items-start gap-3 p-4 rounded-lg border ${before
        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
        : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'}`}>
        {!before && (
          <span className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <Check className="w-5 h-5 text-white" />
          </span>
        )}
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
            {before ? `Ready to bring in ${count} ${t('record', { count })}` : `We brought in ${count} ${t('record', { count })}`}
          </h3>
          {before && duplicateStrategy !== 'none' && (
            <p className="text-base text-slate-700 dark:text-slate-200">
              Anyone already in this {t('list')} with the same name{duplicateStrategy === 'name_and_dob' ? ' and date of birth' : ''} isn&apos;t added again.
            </p>
          )}
          {!before && result && result.skipped > 0 && (
            <p className="text-base text-slate-700 dark:text-slate-200">
              {result.skipped} {result.skipped === 1 ? 'was' : 'were'} already here, so {result.skipped === 1 ? "it wasn't" : "they weren't"} added again
              {result.skippedNames && result.skippedNames.length > 0 && (
                <>: {result.skippedNames.slice(0, 10).join(', ')}{result.skippedNames.length > 10 ? `, and ${result.skippedNames.length - 10} more` : ''}</>
              )}
            </p>
          )}
          {!before && undo === 'done' && (
            <p className="text-base text-slate-700 dark:text-slate-200">
              Undone: the {undoneCount} imported {t('record', { count: undoneCount })} {undoneCount === 1 ? 'is' : 'are'} in the Trash, where {undoneCount === 1 ? 'it' : 'they'} can be restored.
            </p>
          )}
        </div>
      </div>

      {/* 2. Where it came from, when that isn't obvious */}
      {preview.sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base text-slate-700 dark:text-slate-200 flex-1 min-w-[16rem]">
            From the sheet “{sheetName}” (the file has {preview.sheets.length} sheets).
          </p>
          {onUseOtherSheet && <SecondaryButton size="compact" onClick={onUseOtherSheet}>Use a different sheet</SecondaryButton>}
        </div>
      )}
      {preview.detectedHeaderRow > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base text-slate-700 dark:text-slate-200 flex-1 min-w-[16rem]">Column names were on row {preview.detectedHeaderRow + 1}.</p>
          {onPickHeaderRow && <SecondaryButton size="compact" onClick={onPickHeaderRow}>Pick another row</SecondaryButton>}
        </div>
      )}

      {/* 3. What Pulse does */}
      {(chips.length > 0 || did.length > 0) && undo !== 'done' && (
        <section aria-labelledby="import-summary-did" className="space-y-2">
          <h3 id="import-summary-did" className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {before ? 'What Pulse will do' : 'What Pulse did'}
          </h3>
          <ul className="space-y-1 list-disc pl-6">
            {did.map((line, i) => <li key={i} className="text-base text-slate-700 dark:text-slate-200">{line}</li>)}
            {chips.length > 0 && (
              <li className="text-base text-slate-700 dark:text-slate-200">
                {chips.length} {chips.length === 1 ? 'column' : 'columns'}{leftOut.length > 0 ? ` (left out: ${leftOut.join(', ')})` : ''}:
                <span className="flex flex-wrap gap-2 mt-1">
                  {chips.slice(0, CHIPS_MAX).map(c => (
                    <span key={c.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-base">
                      {c.name}<TypeBadge type={c.type} />
                    </span>
                  ))}
                  {chips.length > CHIPS_MAX && <span className="text-base text-slate-600 dark:text-slate-300 self-center">and {chips.length - CHIPS_MAX} more</span>}
                </span>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* 4. Dates that come due */}
      {dateColumns.length > 0 && undo !== 'done' && (
        <section aria-labelledby="import-summary-dates" className="space-y-2">
          <h3 id="import-summary-dates" className="text-base font-semibold text-slate-800 dark:text-slate-100">Which dates come due again?</h3>
          <p className="text-base text-slate-700 dark:text-slate-200">
            {repeats ?? 'None of these dates repeat, so they won\'t change color.'}
            {repeats && ' They turn yellow, then red, as they come due.'}
          </p>
          {followers.filter(f => f.on).map(f => (
            <p key={f.column.id} className="text-base text-slate-700 dark:text-slate-200" data-testid="follows-notes-line">
              Logging {orList(f.types.map(k => activity.label(k)))} {t('activity', { many: true })} will update {f.column.name}.
            </p>
          ))}
          {askDates && futureQuestions.map(({ column, answer }) => (
            <FutureDatesQuestion key={column.id} name={column.name} answer={answer}
              onPick={picked => onDateAnswers({ ...dateAnswers, [column.id]: pickFutureDates(answer, picked) })} />
          ))}
          {/* The sentence states the guesses; the picker waits a click away, so the summary fits a laptop screen */}
          {askDates && (
            <details className="rounded-lg border border-slate-200 dark:border-slate-700">
              <summary className="cursor-pointer min-h-[44px] flex items-center px-4 text-base font-medium text-blue-700 dark:text-blue-300 rounded-lg focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                Change these
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <DateRepeatPicker columns={dateColumns} value={dateAnswers} onChange={next => onDateAnswers(mergePickerAnswers(dateAnswers, next))} />
                {followers.map(f => (
                  <FollowsNotesBox key={f.column.id} name={f.column.name} on={f.on} onChange={on => toggleFollow(f.column.id, on)} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* 5. Things to check */}
      <ThingsToCheck warnings={warnings} />
    </div>
  )
}
