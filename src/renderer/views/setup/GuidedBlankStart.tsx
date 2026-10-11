/**
 * Guided blank start (W01 §5.2): six short questions that set up a first
 * list from nothing. Continuing without answering keeps what's on screen,
 * so clicking straight through still makes a usable list.
 *
 *   1. What's it called?   2. People, things or jobs?   3. The words
 *   4. Details to keep     5. Which dates repeat?      6. A few quick questions
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { DateRuleAnswer } from '../../../shared/ipc-contract'
import type { ColumnType, RecordKind } from '../../../shared/types'
import { guessArticle } from '../../../shared/vocab'
import { wordsFromListName } from '../../../shared/listWords'
import { safeInvoke } from '../../utils/safeInvoke'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { DateRepeatPicker, suggestRepeat, type DateAnswer } from './DateRepeatPicker'
import { friendlyError } from '../../utils/friendlyError'

type Step = 1 | 2 | 3 | 4 | 5 | 6

interface Suggestion { name: string; type: ColumnType; options?: string[]; checked: boolean }

const NAME_CHIPS = ['My clients', 'Customers', 'Students', 'Staff', 'Vehicles', 'Equipment', 'Jobs']

export const RECORD_KINDS: Array<{ kind: RecordKind; label: string; example: string }> = [
  { kind: 'person', label: 'People', example: 'Clients, students, customers, staff' },
  { kind: 'thing', label: 'Things', example: 'Vehicles, equipment, buildings, documents' },
  { kind: 'job', label: 'Jobs or tasks', example: 'Work orders, cases, projects, requests' },
]

/** The first column is always kept: it names each record */
export const SUGGESTIONS: Record<RecordKind, Suggestion[]> = {
  person: [
    { name: 'Name', type: 'text', checked: true },
    { name: 'Phone', type: 'phone', checked: true },
    { name: 'Email', type: 'email', checked: true },
    { name: 'Address', type: 'address', checked: false },
    { name: 'Date of birth', type: 'date', checked: false },
    { name: 'Status', type: 'dropdown', options: ['Active', 'Inactive'], checked: true },
    { name: 'Notes', type: 'notes', checked: false },
    { name: 'Start date', type: 'date', checked: false },
  ],
  thing: [
    { name: 'Name', type: 'text', checked: true },
    { name: 'ID or serial', type: 'text', checked: true },
    { name: 'Location', type: 'text', checked: true },
    { name: 'Status', type: 'dropdown', options: ['In use', 'In storage', 'Out of service'], checked: true },
    { name: 'Purchased', type: 'date', checked: false },
    { name: 'Warranty ends', type: 'date', checked: false },
    { name: 'Last service', type: 'date', checked: true },
  ],
  job: [
    { name: 'Title', type: 'text', checked: true },
    { name: 'Number', type: 'auto_number', checked: true },
    { name: 'Status', type: 'dropdown', options: ['New', 'In progress', 'Waiting', 'Done'], checked: true },
    { name: 'Due date', type: 'date', checked: true },
    { name: 'Assigned to', type: 'text', checked: false },
    { name: 'Amount', type: 'currency', checked: false },
  ],
}

const OWN_TYPES: Array<{ type: ColumnType; label: string }> = [
  { type: 'text', label: 'Text' }, { type: 'date', label: 'Date' }, { type: 'number', label: 'Number' },
  { type: 'phone', label: 'Phone' }, { type: 'email', label: 'Email' }, { type: 'checkbox', label: 'Checkbox' },
  { type: 'currency', label: 'Money' }, { type: 'dropdown', label: 'Pick from a list' },
]

const h2 = 'text-2xl font-bold text-slate-900 dark:text-slate-100'
const lead = 'text-base text-slate-600 dark:text-slate-300'
const field = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500'
const box = 'w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 flex-shrink-0'

export interface GuidedProgress { gridId: number; name: string; kind: RecordKind; one: string; many: string }

interface Props {
  onBack: () => void
  /** Called once everything is saved; setup then shows its last screen */
  onFinished: () => Promise<void>
  /** Carry on after an interruption: the list already exists */
  resume?: GuidedProgress
  /** The list was made (setup saves its place) */
  onProgress?: (p: GuidedProgress) => void
}

export function GuidedBlankStart({ onBack, onFinished, resume, onProgress }: Props): React.ReactElement {
  const [step, setStep] = useState<Step>(resume ? 6 : 1)
  const [name, setName] = useState(resume?.name ?? '')
  const [kind, setKind] = useState<RecordKind>(resume?.kind ?? 'person')
  const [words, setWords] = useState({ one: resume?.one ?? '', many: resume?.many ?? '' })
  // Typed words stay; guessed ones follow a renamed list
  const [wordsTyped, setWordsTyped] = useState(!!resume)
  const [picks, setPicks] = useState<Suggestion[]>(SUGGESTIONS[resume?.kind ?? 'person'])
  const [own, setOwn] = useState<Array<{ name: string; type: ColumnType }>>([])
  const [gridId, setGridId] = useState<number | null>(resume?.gridId ?? null)
  const [dateCols, setDateCols] = useState<Array<{ id: number; name: string }>>([])
  const [dates, setDates] = useState<Record<number, DateAnswer>>({})
  const [answers, setAnswers] = useState({ checklists: true, tasks: true, timeTracking: false, mileage: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updateWorkspace = useWorkspaceStore(s => s.update)

  const listName = name.trim() || 'My list'
  // No name typed: keep the neutral words rather than guessing from "My list"
  const guessed = name.trim() ? wordsFromListName(name) : { one: 'record', many: 'records' }
  const one = words.one.trim() || guessed.one
  const many = words.many.trim() || guessed.many

  const columns = useMemo(() => {
    const chosen = picks.filter((p, i) => i === 0 || p.checked)
    const extra = own.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), type: o.type, checked: true }))
    // Same name twice would clash; the first one wins
    const seen = new Set<string>()
    return [...chosen, ...extra].filter(c => { const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  }, [picks, own])

  const go = (s: Step) => { setError(null); setStep(s) }

  // Resuming: ask about the list's dates again if it has any
  useEffect(() => {
    if (!resume) return
    void safeInvoke(IPC.GRID_GET, resume.gridId).then(r => {
      if (!r.ok) return
      const found = [...r.data.columns, ...r.data.hiddenColumns].filter(c => c.column_type === 'date').map(c => ({ id: c.id, name: c.name }))
      if (found.length === 0) return
      setDateCols(found)
      setDates(Object.fromEntries(found.map(c => [c.id, suggestRepeat(c.name)])))
      setStep(5)
    }).catch(() => { /* stay on the last questions */ })
  }, [resume])

  function chooseKind(k: RecordKind) {
    setKind(k)
    setPicks(SUGGESTIONS[k])
  }

  function toWords() {
    if (!wordsTyped) setWords(guessed)
    go(3)
  }

  /** cols: what to create ("Just the name column" passes only that one) */
  async function createList(cols: Array<{ name: string; type: ColumnType; options?: string[] }> = columns) {
    setBusy(true)
    setError(null)
    try {
      const res = await safeInvoke(IPC.ONBOARDING_SETUP_GRID, {
        gridName: listName,
        columns: cols.map((c, i) => ({
          name: c.name, type: c.type, isNameCol: i === 0,
          ...(c.type === 'dropdown' ? { config: JSON.stringify({ options: c.options ?? ['Yes', 'No'] }) } : {}),
        })),
      })
      if (!res.ok) { setError("We couldn't create the list. Please try again."); return }
      const newId = res.data.gridId
      setGridId(newId)
      // Words are saved now, not at the end, so an interruption doesn't lose them
      const term = { one: one.slice(0, 40), many: many.slice(0, 40), article: guessArticle(one) }
      await safeInvoke(IPC.GRID_SETTINGS_UPDATE, newId, { record_kind: kind, vocab: { record: term } })
      await updateWorkspace({ vocab: { record: term } })
      onProgress?.({ gridId: newId, name: listName, kind, one: term.one, many: term.many })
      const found = cols.filter(c => c.type === 'date').flatMap(c => {
        const id = res.data.colIdByName[c.name.toLowerCase()]
        return id ? [{ id, name: c.name }] : []
      })
      setDateCols(found)
      setDates(Object.fromEntries(found.map(c => [c.id, suggestRepeat(c.name)])))
      go(found.length > 0 ? 5 : 6)
    } finally { setBusy(false) }
  }

  async function saveDates() {
    if (gridId !== null) {
      const list: DateRuleAnswer[] = Object.entries(dates).flatMap(([id, a]): DateRuleAnswer[] =>
        a.repeat === 'due' ? [{ columnId: Number(id), repeat: 'due' }]
          : a.repeat === 'every' ? [{ columnId: Number(id), repeat: 'every', n: a.n, unit: a.unit }] : [])
      if (list.length > 0) {
        setBusy(true)
        try {
          const res = await safeInvoke(IPC.ONBOARDING_DATE_RULES, gridId, list)
          if (!res.ok) { setError(friendlyError(res.error, "We couldn't save those dates. Please try again.")); return }
        } finally { setBusy(false) }
      }
    }
    go(6)
  }

  async function finish() {
    if (gridId === null) return
    setBusy(true)
    setError(null)
    try {
      const term = { one: one.slice(0, 40), many: many.slice(0, 40), article: guessArticle(one) }
      // The list keeps its own words too, so a later list with other words doesn't change it
      const listRes = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, { record_kind: kind, vocab: { record: term } })
      if (!listRes.ok) { setError(friendlyError(listRes.error, "We couldn't save that. Please try again.")); return }
      await updateWorkspace({ vocab: { record: term }, features: answers })
      await onFinished()
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : null, "We couldn't save that. Please try again."))
    } finally { setBusy(false) }
  }

  const nav = (opts: { back?: () => void; skip?: () => void; skipLabel?: string; next: () => void; nextLabel?: string; nextDisabled?: boolean }) => (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {opts.back && (
        <button type="button" onClick={opts.back} className="hit-44 inline-flex items-center gap-2 text-base text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </button>
      )}
      <span className="flex-1" />
      {opts.skip && <button type="button" className="btn-secondary" disabled={busy} onClick={opts.skip}>{opts.skipLabel ?? 'Skip'}</button>}
      <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy || opts.nextDisabled} onClick={opts.next}>
        {busy ? 'Working…' : opts.nextLabel ?? 'Continue'} {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  )

  return (
    <div className="p-8 space-y-5">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400" aria-live="polite">Step {step} of 6</p>

      {step === 1 && (
        <>
          <h2 className={h2}>What's your first list called?</h2>
          <div>
            <label htmlFor="guided-name" className="sr-only">List name</label>
            <input id="guided-name" className={field} value={name} maxLength={200} autoFocus placeholder="e.g. Customers" onChange={e => setName(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Suggestions">
            {NAME_CHIPS.map(c => (
              <button key={c} type="button" onClick={() => setName(c)}
                className="hit-44 px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 text-base text-slate-700 dark:text-slate-200 hover:border-blue-500 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                {c}
              </button>
            ))}
          </div>
          {nav({ back: onBack, next: () => go(2) })}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className={h2}>What does it hold?</h2>
          <fieldset className="space-y-2">
            <legend className="sr-only">What does it hold?</legend>
            {RECORD_KINDS.map(k => (
              <label key={k.kind} className="flex items-start gap-3 p-4 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                <input type="radio" name="guided-kind" className="w-5 h-5 mt-0.5" checked={kind === k.kind} onChange={() => chooseKind(k.kind)} />
                <span>
                  <span className="block text-lg font-semibold text-slate-900 dark:text-slate-100">{k.label}</span>
                  <span className="block text-base text-slate-600 dark:text-slate-300">{k.example}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {nav({ back: () => go(1), next: toWords })}
        </>
      )}

      {step === 3 && (
        <>
          <h2 className={h2}>What do you call one of them? And more than one?</h2>
          <p className={lead}>These words are used everywhere, like “Add {words.one.trim() ? guessArticle(one) : 'a'} {one}” and “3 {many} due this week”.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="guided-one" className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">One</label>
              <input id="guided-one" className={field} maxLength={40} value={words.one} onChange={e => { setWordsTyped(true); setWords(w => ({ ...w, one: e.target.value })) }} />
            </div>
            <div>
              <label htmlFor="guided-many" className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">More than one</label>
              <input id="guided-many" className={field} maxLength={40} value={words.many} onChange={e => { setWordsTyped(true); setWords(w => ({ ...w, many: e.target.value })) }} />
            </div>
          </div>
          {nav({ back: () => go(2), next: () => go(4) })}
        </>
      )}

      {step === 4 && (
        <>
          <h2 className={h2}>Pick the details you want to keep</h2>
          <p className={lead}>Each one is a column. You can add, rename or remove columns any time.</p>
          <ul className="space-y-1">
            {picks.map((p, i) => (
              <li key={p.name}>
                <label className="flex items-center gap-3 cursor-pointer select-none text-base text-slate-800 dark:text-slate-100" style={{ minHeight: 44 }}>
                  <input type="checkbox" className={box} checked={i === 0 || p.checked} disabled={i === 0}
                    onChange={e => setPicks(ps => ps.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
                  {p.name}{i === 0 && <span className="text-sm text-slate-500 dark:text-slate-400">(always)</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200">Add your own</p>
            {own.map((o, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`guided-own-${i}`}>Column name</label>
                <input id={`guided-own-${i}`} className="input flex-1 min-w-[12rem]" placeholder="Column name" maxLength={100} value={o.name}
                  onChange={e => setOwn(list => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <label className="sr-only" htmlFor={`guided-own-type-${i}`}>Kind of column</label>
                <select id={`guided-own-type-${i}`} className="input w-auto" value={o.type}
                  onChange={e => setOwn(list => list.map((x, j) => (j === i ? { ...x, type: e.target.value as ColumnType } : x)))}>
                  {OWN_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <button type="button" aria-label={`Remove ${o.name || 'this column'}`} onClick={() => setOwn(list => list.filter((_, j) => j !== i))}
                  className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {own.length < 20 && (
              <button type="button" className="btn-compact-secondary inline-flex items-center gap-2" onClick={() => setOwn(list => [...list, { name: '', type: 'text' }])}>
                <Plus className="w-4 h-4" aria-hidden="true" /> Add a column
              </button>
            )}
          </div>
          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
          {nav({
            back: () => go(3),
            skip: () => void createList([picks[0]!]), skipLabel: 'Just the name column',
            next: () => void createList(), nextLabel: 'Create list',
          })}
        </>
      )}

      {step === 5 && (
        <>
          <h2 className={h2}>Do any of these dates repeat or need reminders?</h2>
          <p className={lead}>Dates with a reminder change color as they come due: green, then yellow, orange and red.</p>
          <DateRepeatPicker columns={dateCols} value={dates} onChange={setDates} />
          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
          {nav({ next: () => void saveDates() })}
        </>
      )}

      {step === 6 && (
        <>
          <h2 className={h2}>A few quick questions</h2>
          <p className={lead}>This turns on only what you'll use. You can change it later in Settings → Workspace.</p>
          {([
            ['checklists', `Do you follow step-by-step checklists for each ${one}?`],
            ['tasks', 'Do you keep a to-do list of your own?'],
            ['timeTracking', 'Do you track the time you spend?'],
            ['mileage', 'Do you claim mileage?'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer select-none text-base text-slate-800 dark:text-slate-100" style={{ minHeight: 44 }}>
              <input type="checkbox" className={box} checked={answers[key]} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
          {nav({ back: dateCols.length > 0 ? () => go(5) : undefined, next: () => void finish(), nextLabel: 'Finish' })}
        </>
      )}
    </div>
  )
}
