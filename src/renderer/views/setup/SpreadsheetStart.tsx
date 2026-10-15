/**
 * Setup's "Bring in a spreadsheet" (UX Q1a): the file chooser, then the
 * import summary, and done. The list is made at once ("My list") and named
 * after the file ("caseload_export.xlsx" → "Caseload export"); what each line
 * is comes from the list's name or the column names ("Student ID" →
 * students). Both show at the top of the summary and save as they change.
 * Cancelling removes the list again.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { SetupProgress } from '../../../shared/ipc-contract'
import type { RecordKind } from '../../../shared/types'
import { guessArticle } from '../../../shared/vocab'
import { ownWordsProblem } from '../../../shared/listWords'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { ImportWizard } from '../../components/grid/ImportWizard'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { KINDS, NO_ANSWER, ROW_CHOICES, guessRowsFor, listNameFromFile, type RowsAnswer } from './rowWords'

const DEFAULT_NAME = 'My list'

const field = 'w-full px-3 py-2 min-h-[44px] border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500'
const labelCls = 'block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface Props {
  /** An interrupted setup that had already made its list */
  resume?: { gridId: number; listName: string }
  /** Cancelled before anything came in: back to "How do you want to start?" */
  onCancel: () => void
  onFinished: () => void | Promise<void>
  onProgress: (progress: SetupProgress | null) => void
}

/** The words a choice stands for, or a reason they can't be used yet */
function chosenWords(rows: RowsAnswer): { one: string; many: string; kind: RecordKind } | { problem: string } {
  if (rows.choice === null) return { problem: 'Pick what each line of your spreadsheet is, or choose "Something else".' }
  if (rows.choice === 'other') {
    const problem = ownWordsProblem(rows.one, rows.many)
    return problem ? { problem } : { one: rows.one.trim(), many: rows.many.trim(), kind: rows.kind }
  }
  return ROW_CHOICES[rows.choice]!
}

export function SpreadsheetStart({ resume, onCancel, onFinished, onProgress }: Props): React.ReactElement {
  const [gridId, setGridId] = useState<number | null>(resume?.gridId ?? null)
  const [listName, setListName] = useState(resume?.listName ?? DEFAULT_NAME)
  const [rows, setRows] = useState<RowsAnswer>(NO_ANSWER)
  const [error, setError] = useState<string | null>(null)
  const updateWorkspace = useWorkspaceStore(s => s.update)
  const importDone = useRef(false)
  const importUndone = useRef(false)
  /** The name and words last saved, so they're written once */
  const savedName = useRef(resume?.listName ?? DEFAULT_NAME)
  const savedWords = useRef<string | null>(null)
  const started = useRef(false)

  const createList = useCallback(async () => {
    setError(null)
    try {
      const res = await safeInvoke(IPC.GRID_CREATE, DEFAULT_NAME)
      if (!res.ok) { setError("We couldn't create the list — try again"); return }
      setGridId(res.data)
      onProgress({ step: 'sheet-import', gridId: res.data, listName: DEFAULT_NAME })
    } catch { setError("We couldn't create the list — try again") }
  }, [onProgress])

  // The list is made for this import straight away: choosing the file is the first question
  useEffect(() => {
    if (started.current || resume) return
    started.current = true
    void createList()
  }, [resume, createList])

  async function saveName(name: string): Promise<string | null> {
    const next = name.trim().slice(0, 200)
    if (gridId === null || !next || next === savedName.current) return null
    const res = await safeInvoke(IPC.GRID_UPDATE, gridId, { name: next })
    if (!res.ok) return friendlyError(res.error, "We couldn't rename the list — try again")
    savedName.current = next
    onProgress({ step: 'sheet-import', gridId, listName: next })
    return null
  }

  async function saveWords(answer: RowsAnswer): Promise<string | null> {
    if (gridId === null) return null
    const chosen = chosenWords(answer)
    if ('problem' in chosen) return chosen.problem
    const key = `${chosen.one}|${chosen.many}|${chosen.kind}`
    if (key === savedWords.current) return null
    const term = { one: chosen.one, many: chosen.many, article: guessArticle(chosen.one) }
    try {
      // The list keeps its own words too (as the guided start does), so a later example's words don't rename it
      const listRes = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, { record_kind: chosen.kind, vocab: { record: term } })
      if (!listRes.ok) return friendlyError(listRes.error, "We couldn't save that — try again")
      await updateWorkspace({ vocab: { record: term } })
      savedWords.current = key
      return null
    } catch (err) {
      return friendlyError(err instanceof Error ? err.message : null, "We couldn't save that — try again")
    }
  }

  /** The file was read: name the list after it and guess what each line is, before the summary shows */
  async function fileChosen(path: string, preview: { headers: string[] }) {
    const name = listNameFromFile(path) || DEFAULT_NAME
    setListName(name)
    await saveName(name)
    const guess = guessRowsFor(name, preview.headers)
    setRows(guess)
    if (guess.choice !== null) await saveWords(guess)
  }

  async function changeRows(next: RowsAnswer) {
    setRows(next)
    setError(null)
    if (next.choice !== 'other') {
      const problem = await saveWords(next)
      if (problem) setError(problem)
    }
  }

  function cancel() {
    if (importDone.current) { void onFinished(); return }
    if (gridId !== null) {
      const id = gridId
      // The list was made only for this import. Left empty, it's removed for good rather than
      // piling up "My list" entries in the Trash; after an undone import its records wait there.
      const keep = importUndone.current
      void safeInvoke(IPC.GRID_DELETE, id).then(r => { if (r.ok && !keep) void safeInvoke(IPC.GRID_PURGE, id) })
    }
    onProgress(null)
    onCancel()
  }

  if (gridId === null) {
    return (
      <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full space-y-4">
          {error ? (
            <>
              <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>
              <div className="flex justify-between gap-3">
                <SecondaryButton onClick={onCancel}>Back</SecondaryButton>
                <PrimaryButton onClick={() => void createList()}>Try again</PrimaryButton>
              </div>
            </>
          ) : (
            <p role="status" className="text-base text-slate-600 dark:text-slate-300">Getting ready…</p>
          )}
        </div>
      </div>
    )
  }

  const value = rows.choice === null ? '' : String(rows.choice)
  const slot = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
      <div>
        <label htmlFor="setup-sheet-list-name" className={labelCls}>List name</label>
        <input id="setup-sheet-list-name" className={field} value={listName} maxLength={200}
          onChange={e => setListName(e.target.value)}
          onBlur={() => { void saveName(listName).then(p => { if (p) setError(p) }) }} />
      </div>
      <div>
        <label htmlFor="setup-sheet-rows" className={labelCls}>Each line of your spreadsheet is one…</label>
        <select id="setup-sheet-rows" className={field} value={value}
          onChange={e => {
            const v = e.target.value
            if (v === 'other') void changeRows({ ...rows, choice: 'other' })
            else if (v === 'suggested' && rows.suggested) void changeRows({ ...rows, choice: 'other', one: rows.suggested.one, many: rows.suggested.many })
            else if (v !== '') void changeRows({ ...rows, choice: Number(v), kind: ROW_CHOICES[Number(v)]!.kind })
          }}>
          <option value="" disabled>Choose…</option>
          {ROW_CHOICES.map((c, i) => <option key={c.one} value={String(i)}>{cap(c.one)}</option>)}
          {rows.suggested && rows.choice === null && <option value="suggested">{cap(rows.suggested.one)} (from the list&apos;s name)</option>}
          <option value="other">Something else…</option>
        </select>
      </div>
      {rows.choice === 'other' && (
        <div className="sm:col-span-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="setup-sheet-one" className={labelCls}>One of them</label>
              <input id="setup-sheet-one" className={field} placeholder="e.g. member" maxLength={40} value={rows.one}
                onChange={e => setRows(r => ({ ...r, one: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="setup-sheet-many" className={labelCls}>More than one</label>
              <input id="setup-sheet-many" className={field} placeholder="e.g. members" maxLength={40} value={rows.many}
                onChange={e => setRows(r => ({ ...r, many: e.target.value }))} />
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-4">
            <legend className={labelCls}>Are they…</legend>
            {KINDS.map(k => (
              <label key={k.kind} className="flex items-center gap-2 min-h-[44px] text-base text-slate-800 dark:text-slate-100 cursor-pointer">
                <input type="radio" name="setup-sheet-kind" className="w-5 h-5 flex-shrink-0" checked={rows.kind === k.kind}
                  onChange={() => setRows(r => ({ ...r, kind: k.kind }))} />
                {k.label} <span className="text-base text-slate-500 dark:text-slate-400">({k.example})</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {error && <p role="alert" className="sm:col-span-2 text-base text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center">
      <ImportWizard open gridId={gridId} slot={slot}
        onFileChosen={fileChosen}
        beforeDone={async () => (await saveName(listName)) ?? (await saveWords(rows))}
        onClose={cancel}
        onImported={r => {
          // "Undo this import" then close: nothing came in, so it's like cancelling
          if (r.undone) { importUndone.current = true; return }
          importDone.current = true
        }} />
    </div>
  )
}
