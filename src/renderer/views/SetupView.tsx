/**
 * SetupView — first-run setup (W01 §5, replaces the old onboarding wizard).
 *
 * Welcome → your name → how do you want to start?
 *   • from an example (the example gallery),
 *   • bring in a spreadsheet (choose the file, then one summary: setup/SpreadsheetStart.tsx),
 *   • or start blank (a guided, step-by-step first list).
 * The example path adds sample data by default, so there's no separate
 * "just looking" entry (UX-A-17). Only new workspaces see this; existing
 * installs never do.
 */
import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, LayoutTemplate, Pencil, User } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import { PRODUCT_NAME } from '../../shared/constants'
import type { DateRuleAnswer, SetupProgress } from '../../shared/ipc-contract'
import type { Column, RecordKind } from '../../shared/types'
import { guessArticle } from '../../shared/vocab'
import { ownWordsProblem } from '../../shared/listWords'

import { safeInvoke } from '../utils/safeInvoke'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ApplyStarterDialog } from '../components/starters/ApplyStarterDialog'
import { DateRepeatPicker, suggestRepeat, type DateAnswer } from './setup/DateRepeatPicker'
import { GuidedBlankStart } from './setup/GuidedBlankStart'
import { SpreadsheetStart } from './setup/SpreadsheetStart'
import { KINDS, ROW_CHOICES, guessRows, type RowsAnswer } from './setup/rowWords'
import { UpdateCheckChoice } from './setup/UpdateCheckChoice'
import { friendlyError } from '../utils/friendlyError'
import { useVocab } from '../hooks/useVocab'
import { PrimaryButton } from '../components/ui/Button'
import { PulseMark } from '../components/ui/PulseMark'

type Step = 'welcome' | 'profile' | 'start' | 'sheet-name' | 'sheet-import' | 'sheet-rows' | 'sheet-dates' | 'blank' | 'done'

interface Props {
  /** Where to begin: the welcome screen (first run), or a starting point when shown again */
  start?: 'welcome' | 'start' | 'examples' | 'sheet-name' | 'blank'
  /** Shown again from the app: a way back without choosing anything */
  onCancel?: () => void
  onComplete: () => void
}

// Moved to setup/rowWords.ts (shared with the spreadsheet start); tests import them from here
export { ROW_CHOICES, guessRows } from './setup/rowWords'

/** Remember where setup is, so a lock or a closed window picks it up again */
function saveProgress(progress: SetupProgress | null): void {
  void safeInvoke(IPC.ONBOARDING_SAVE_PROGRESS, progress).catch(() => { /* resuming is a nicety */ })
}

const card = 'bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden'
const h2 = 'text-2xl font-bold text-slate-900 dark:text-slate-100'
const lead = 'text-base text-slate-600 dark:text-slate-300'
const field = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500'

function StartCard({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left flex items-start gap-4 p-5 rounded-xl border-2 border-slate-200 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 transition-colors"
      style={{ minHeight: 44 }}>
      <span className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="block text-base text-slate-600 dark:text-slate-300">{description}</span>
      </span>
      <ArrowRight className="w-5 h-5 mt-1 text-slate-500 dark:text-slate-400 flex-shrink-0" aria-hidden="true" />
    </button>
  )
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hit-44 inline-flex items-center gap-2 text-base text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
    </button>
  )
}

export default function SetupView({ start = 'welcome', onCancel, onComplete }: Props): React.ReactElement {
  // The list words an example just brought (they reload when it's applied)
  const { t } = useVocab(null)
  const [step, setStep] = useState<Step>(start === 'examples' ? 'start' : start)
  const [profile, setProfile] = useState({ name: '', title: '', org: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Problems while adding an example (e.g. sample data that couldn't load), shown on the done card
  const [exampleWarnings, setExampleWarnings] = useState<string[]>([])
  const [showExamples, setShowExamples] = useState(start === 'examples')
  const [listName, setListName] = useState('')
  const [gridId, setGridId] = useState<number | null>(null)
  const [rows, setRows] = useState<RowsAnswer>({ choice: null, one: '', many: '', kind: 'person' })
  const [resumeBlank, setResumeBlank] = useState<{ gridId: number; name: string; kind: RecordKind; one: string; many: string } | null>(null)
  const [resumed, setResumed] = useState(false)
  const [dateCols, setDateCols] = useState<Column[] | null>(null)
  const [dates, setDates] = useState<Record<number, DateAnswer>>({})
  const updateWorkspace = useWorkspaceStore(s => s.update)

  const go = (s: Step) => { setError(null); setStep(s) }

  // Nothing from the password screens ("Recovery key copied") follows into setup (UX-A-31)
  useEffect(() => { toast.dismiss() }, [])

  // Setup that was interrupted after making a list carries on where it stopped
  useEffect(() => {
    if (start !== 'welcome') return
    let live = true
    void safeInvoke(IPC.ONBOARDING_CHECK).then(r => {
      const p = r.ok ? r.data.progress : null
      if (!live || !p) return
      setResumed(true)
      setGridId(p.gridId)
      if (p.listName) setListName(p.listName)
      if (p.step === 'sheet-import') setStep('sheet-import')
      else if (p.step === 'sheet-rows') { setRows(guessRows(p.listName ?? '')); setStep('sheet-rows') }
      else if (p.blank) { setResumeBlank({ gridId: p.gridId, ...p.blank }); setStep('blank') }
    }).catch(() => { /* start from the beginning */ })
    return () => { live = false }
  }, [start])

  const finish = useCallback(async () => {
    try { await safeInvoke(IPC.ONBOARDING_COMPLETE) } catch { /* the app still works; setup can be finished later */ }
    setResumed(false)
    setStep('done')
  }, [])

  async function saveProfile() {
    const fields: Array<[string, string]> = [['profile_name', profile.name], ['profile_title', profile.title], ['profile_org', profile.org]]
    for (const [key, value] of fields) {
      if (value.trim()) await safeInvoke(IPC.SETTINGS_UPDATE, key, value.trim())
    }
    go('start')
  }


  // ── Spreadsheet path ──────────────────────────────────────────────────────

  async function saveRows() {
    if (gridId === null) return
    if (rows.choice === null) { setError('Pick what each row of your spreadsheet is, or choose "Something else".'); return }
    const chosen = rows.choice === 'other'
      ? { one: rows.one.trim(), many: rows.many.trim(), kind: rows.kind }
      : ROW_CHOICES[rows.choice]!
    const problem = ownWordsProblem(chosen.one, chosen.many)
    if (problem) { setError(problem); return }
    setBusy(true)
    try {
      const term = { one: chosen.one, many: chosen.many, article: guessArticle(chosen.one) }
      // The list keeps its own words too (as the guided start does), so a later example's words don't rename it
      const listRes = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, { record_kind: chosen.kind, vocab: { record: term } })
      if (!listRes.ok) { setError(friendlyError(listRes.error, "We couldn't save that — try again")); return }
      await updateWorkspace({ vocab: { record: term } })
      const grid = await safeInvoke(IPC.GRID_GET, gridId)
      const found = grid.ok ? [...grid.data.columns, ...grid.data.hiddenColumns].filter(c => c.column_type === 'date') : []
      if (found.length === 0) { await finish(); return }
      setDateCols(found)
      setDates(Object.fromEntries(found.map(c => [c.id, suggestRepeat(c.name)])))
      go('sheet-dates')
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : null, "We couldn't save that — try again"))
    } finally { setBusy(false) }
  }

  async function saveDates() {
    if (gridId === null) return
    const answers: DateRuleAnswer[] = Object.entries(dates).flatMap(([id, a]): DateRuleAnswer[] =>
      a.repeat === 'due' ? [{ columnId: Number(id), repeat: 'due' }]
        : a.repeat === 'every' ? [{ columnId: Number(id), repeat: 'every', n: a.n, unit: a.unit }] : [])
    setBusy(true)
    try {
      if (answers.length > 0) {
        const res = await safeInvoke(IPC.ONBOARDING_DATE_RULES, gridId, answers)
        if (!res.ok) { toast.error(friendlyError(res.error)) }
      }
      await finish()
    } finally { setBusy(false) }
  }

  // The file chooser, then the import summary (UX Q1a); a resumed setup reopens it on its list
  if (step === 'sheet-name' || step === 'sheet-import') {
    return <SpreadsheetStart resume={step === 'sheet-import' && gridId !== null ? { gridId, listName } : undefined}
      onCancel={() => go('start')} onFinished={finish} onProgress={saveProgress} />
  }

  return (
    <div className="fixed inset-0 flex items-center-safe justify-center bg-slate-50 dark:bg-slate-900 z-40 overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-4">
        <div className={card}>
          {step === 'welcome' && (
            <div className="p-10 text-center">
              <PulseMark size={64} className="mx-auto mb-6" />
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Welcome to {PRODUCT_NAME}</h1>
              <p className="text-lg text-slate-600 dark:text-slate-300 mb-8 max-w-md mx-auto">
                Pulse keeps track of the people and things you're responsible for, and what's due for each.
              </p>
              <button type="button" className="btn-primary inline-flex items-center gap-2 px-8" onClick={() => go('profile')}>
                Get started <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          )}

          {step === 'profile' && (
            <div className="p-8 space-y-5">
              <div className="flex items-center gap-3">
                <User className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <h2 className={h2}>Your name</h2>
              </div>
              <p className={lead}>Used on letters and reports you create. Everything here is optional.</p>
              {([['name', 'Full name', 'Jane Smith'], ['title', 'Title or role', 'Coordinator'], ['org', 'Organization', 'Community Services']] as const).map(([key, label, ph], i) => (
                <div key={key}>
                  <label htmlFor={`setup-${key}`} className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">{label}</label>
                  <input id={`setup-${key}`} className={field} placeholder={ph} value={profile[key]} autoFocus={i === 0}
                    onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <Back onClick={() => go('welcome')} />
                <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => void saveProfile()}>Continue <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </div>
          )}

          {step === 'start' && (
            <div className="p-8 space-y-4">
              <h2 className={h2}>How do you want to start?</h2>
              <StartCard icon={<LayoutTemplate className="w-6 h-6" aria-hidden="true" />} title="Start from an example"
                description="Pick something close to your work. You can change everything." onClick={() => setShowExamples(true)} />
              <StartCard icon={<FileSpreadsheet className="w-6 h-6" aria-hidden="true" />} title="Bring in a spreadsheet"
                description="Excel or CSV. We'll help you match the columns." onClick={() => go('sheet-name')} />
              <StartCard icon={<Pencil className="w-6 h-6" aria-hidden="true" />} title="Start blank"
                description="Set up your first list step by step." onClick={() => go('blank')} />
              {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
              {onCancel
                ? <button type="button" onClick={onCancel} className="hit-44 text-base text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">Not now</button>
                : <Back onClick={() => go('profile')} />}
            </div>
          )}

          {resumed && step !== 'done' && (
            <p role="status" className="px-8 pt-6 -mb-4 text-base text-slate-600 dark:text-slate-300">Picking up where you left off.</p>
          )}
          {step === 'blank' && <GuidedBlankStart onBack={() => go('start')} onFinished={finish} resume={resumeBlank ?? undefined}
            onProgress={blank => saveProgress({ step: 'blank', gridId: blank.gridId, blank: { name: blank.name, kind: blank.kind, one: blank.one, many: blank.many } })} />}

          {step === 'sheet-rows' && (
            <div className="p-8 space-y-5">
              <h2 className={h2}>Each line of your spreadsheet is one…</h2>
              <p className={lead}>Pulse uses the word in its buttons and counts, like “Add customer” and “3 customers due this week”. You can change it later in Settings → Words & features.</p>
              <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <legend className="sr-only">Each line of your spreadsheet is one…</legend>
                {ROW_CHOICES.map((c, i) => (
                  <label key={c.many} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer text-base text-slate-800 dark:text-slate-100 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                    <input type="radio" name="setup-rows" className="w-5 h-5 flex-shrink-0" checked={rows.choice === i} onChange={() => setRows(r => ({ ...r, choice: i }))} />
                    {c.many.charAt(0).toUpperCase() + c.many.slice(1)}
                  </label>
                ))}
                <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer text-base text-slate-800 dark:text-slate-100 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                  <input type="radio" name="setup-rows" className="w-5 h-5 flex-shrink-0" checked={rows.choice === 'other'} onChange={() => setRows(r => ({ ...r, choice: 'other' }))} />
                  Something else
                </label>
              </fieldset>
              {rows.suggested && rows.choice === null && (
                <p className="text-base text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
                  From the list's name, these look like {rows.suggested.many}.
                  <button type="button" className="btn-compact-secondary"
                    onClick={() => setRows(r => ({ ...r, choice: 'other', one: r.suggested?.one ?? '', many: r.suggested?.many ?? '' }))}>
                    Yes, they're {rows.suggested.many}
                  </button>
                </p>
              )}
              {rows.choice === 'other' && (
                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="setup-one" className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">One of them</label>
                      <input id="setup-one" className={field} placeholder="e.g. member" maxLength={40} value={rows.one} onChange={e => setRows(r => ({ ...r, one: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="setup-many" className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">More than one</label>
                      <input id="setup-many" className={field} placeholder="e.g. members" maxLength={40} value={rows.many} onChange={e => setRows(r => ({ ...r, many: e.target.value }))} />
                    </div>
                  </div>
                  <fieldset className="flex flex-wrap gap-4">
                    <legend className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">Are they…</legend>
                    {KINDS.map(k => (
                      <label key={k.kind} className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100 cursor-pointer" style={{ minHeight: 44 }}>
                        <input type="radio" name="setup-kind" className="w-5 h-5 flex-shrink-0" checked={rows.kind === k.kind} onChange={() => setRows(r => ({ ...r, kind: k.kind }))} />
                        {k.label} <span className="text-sm text-slate-500 dark:text-slate-400">({k.example})</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
              {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
              <div className="flex justify-end">
                <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy} onClick={() => void saveRows()}>
                  {busy ? 'Saving…' : 'Continue'} {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {step === 'sheet-dates' && dateCols && (
            <div className="p-8 space-y-5">
              <h2 className={h2}>Which of these dates repeat?</h2>
              <p className={lead}>Dates that repeat get colors as they come due: green, then yellow, orange and red.</p>
              <DateRepeatPicker columns={dateCols} value={dates} onChange={setDates} />
              <div className="flex items-center justify-between">
                <Back onClick={() => go('sheet-rows')} />
                <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy} onClick={() => void saveDates()}>
                  {busy ? 'Saving…' : 'Finish'} {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="p-10 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="text-green-600 dark:text-green-400 w-9 h-9" aria-hidden="true" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">You're all set</h2>
              {exampleWarnings.length > 0 && (
                <div role="alert" className="text-left rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 mb-6 max-w-md mx-auto">
                  <p className="text-base font-medium text-amber-900 dark:text-amber-100">Some of the example didn't come in:</p>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    {exampleWarnings.map(w => <li key={w} className="text-base text-amber-900 dark:text-amber-100">{w}</li>)}
                  </ul>
                </div>
              )}
              {/* One way on: the list itself, where the first look shows what red means (UX pass Q7) */}
              <PrimaryButton className="inline-flex px-8" onClick={onComplete}>
                Open my {t('list')} <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </PrimaryButton>
              {/* The small print, after the choice that matters (UX-A-18) */}
              <div className="mt-8 pt-5 border-t border-slate-200 dark:border-slate-700 max-w-md mx-auto">
                <UpdateCheckChoice />
              </div>
            </div>
          )}
        </div>
      </div>
      {showExamples && (
        <ApplyStarterDialog mode="setup" withSamples onClose={() => setShowExamples(false)}
          onStartBlank={() => { setShowExamples(false); go('blank') }}
          onStartSpreadsheet={() => { setShowExamples(false); go('sheet-name') }}
          onApplied={res => { setExampleWarnings(res?.warnings ?? []); setShowExamples(false); void finish() }} />
      )}
    </div>
  )
}
