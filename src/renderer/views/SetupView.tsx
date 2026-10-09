/**
 * SetupView — first-run setup (W01 §5, replaces the old onboarding wizard).
 *
 * Welcome → your name → how do you want to start?
 *   • from an example (the example gallery),
 *   • bring in a spreadsheet (import, then "What are these rows?" and
 *     "Which of these dates repeat?"),
 *   • start blank (a guided, step-by-step first list),
 *   • or just look around with sample data.
 * Only new workspaces see this; existing installs never do.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, FileSpreadsheet, LayoutTemplate, Pencil, Sparkles, User } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import { PRODUCT_NAME } from '../../shared/constants'
import type { DateRuleAnswer } from '../../shared/ipc-contract'
import type { Column, RecordKind } from '../../shared/types'
import { HUMAN_SERVICES_VOCAB, guessArticle } from '../../shared/vocab'
import { featuresForExistingInstall } from '../../shared/features'
import { safeInvoke } from '../utils/safeInvoke'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ImportWizard } from '../components/grid/ImportWizard'
import { ApplyStarterDialog } from '../components/starters/ApplyStarterDialog'
import { DateRepeatPicker, type DateAnswer } from './setup/DateRepeatPicker'
import { GuidedBlankStart } from './setup/GuidedBlankStart'

type Step = 'welcome' | 'profile' | 'start' | 'sheet-name' | 'sheet-import' | 'sheet-rows' | 'sheet-dates' | 'blank' | 'done'

interface Props {
  onComplete: () => void
  onStartTour: () => void
}

/** "What are these rows?" choices: the word for one and many, and what the list holds */
export const ROW_CHOICES: Array<{ one: string; many: string; kind: RecordKind }> = [
  { one: 'client', many: 'clients', kind: 'person' },
  { one: 'customer', many: 'customers', kind: 'person' },
  { one: 'student', many: 'students', kind: 'person' },
  { one: 'patient', many: 'patients', kind: 'person' },
  { one: 'staff member', many: 'staff', kind: 'person' },
  { one: 'vehicle', many: 'vehicles', kind: 'thing' },
  { one: 'property', many: 'properties', kind: 'thing' },
  { one: 'piece of equipment', many: 'equipment', kind: 'thing' },
  { one: 'job', many: 'jobs', kind: 'job' },
]

const KINDS: Array<{ kind: RecordKind; label: string; example: string }> = [
  { kind: 'person', label: 'People', example: 'clients, students, staff' },
  { kind: 'thing', label: 'Things', example: 'vehicles, equipment, properties' },
  { kind: 'job', label: 'Jobs or tasks', example: 'work orders, cases, projects' },
]

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

export default function SetupView({ onComplete, onStartTour }: Props): React.ReactElement {
  const [step, setStep] = useState<Step>('welcome')
  const [profile, setProfile] = useState({ name: '', title: '', org: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showExamples, setShowExamples] = useState(false)
  const [listName, setListName] = useState('')
  const [gridId, setGridId] = useState<number | null>(null)
  const importDone = useRef(false)
  const [rows, setRows] = useState<{ choice: number | 'other'; one: string; many: string; kind: RecordKind }>({ choice: 0, one: '', many: '', kind: 'person' })
  const [dateCols, setDateCols] = useState<Column[] | null>(null)
  const [dates, setDates] = useState<Record<number, DateAnswer>>({})
  const updateWorkspace = useWorkspaceStore(s => s.update)

  const go = (s: Step) => { setError(null); setStep(s) }

  const finish = useCallback(async () => {
    try { await safeInvoke(IPC.ONBOARDING_COMPLETE) } catch { /* the app still works; setup can be finished later */ }
    setStep('done')
  }, [])

  async function saveProfile() {
    const fields: Array<[string, string]> = [['profile_name', profile.name], ['profile_title', profile.title], ['profile_org', profile.org]]
    for (const [key, value] of fields) {
      if (value.trim()) await safeInvoke(IPC.SETTINGS_UPDATE, key, value.trim())
    }
    go('start')
  }

  // "Just looking?": today's sample caseload with the human-services words it uses
  async function trySample() {
    setBusy(true)
    try {
      await updateWorkspace({ vocab: HUMAN_SERVICES_VOCAB, features: featuresForExistingInstall({ trackTime: false, trackMileage: false }) })
      const res = await safeInvoke(IPC.SAMPLE_DATA_CREATE)
      if (!res.ok) { setError("We couldn't add the sample data. Please try again."); return }
      await finish()
    } catch {
      setError("We couldn't add the sample data. Please try again.")
    } finally { setBusy(false) }
  }

  // ── Spreadsheet path ──────────────────────────────────────────────────────

  async function createListForImport() {
    setBusy(true)
    try {
      const res = await safeInvoke(IPC.GRID_CREATE, listName.trim())
      if (!res.ok) { setError("We couldn't create the list. Please try again."); return }
      importDone.current = false
      setGridId(res.data)
      go('sheet-import')
    } finally { setBusy(false) }
  }

  function cancelImport() {
    if (importDone.current) return
    if (gridId !== null) void safeInvoke(IPC.GRID_DELETE, gridId)
    setGridId(null)
    go('sheet-name')
  }

  async function saveRows() {
    if (gridId === null) return
    const chosen = rows.choice === 'other'
      ? { one: rows.one.trim(), many: rows.many.trim() || rows.one.trim(), kind: rows.kind }
      : ROW_CHOICES[rows.choice]!
    if (!chosen.one) { setError('Type what you call one of them.'); return }
    setBusy(true)
    try {
      const listRes = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, { record_kind: chosen.kind })
      if (!listRes.ok) { setError(listRes.error); return }
      await updateWorkspace({ vocab: { record: { one: chosen.one, many: chosen.many, article: guessArticle(chosen.one) } } })
      const grid = await safeInvoke(IPC.GRID_GET, gridId)
      const found = grid.ok ? [...grid.data.columns, ...grid.data.hiddenColumns].filter(c => c.column_type === 'date') : []
      if (found.length === 0) { await finish(); return }
      setDateCols(found)
      setDates(Object.fromEntries(found.map(c => [c.id, { repeat: 'no' } as DateAnswer])))
      go('sheet-dates')
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that. Please try again.")
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
        if (!res.ok) { toast.error(res.error) }
      }
      await finish()
    } finally { setBusy(false) }
  }

  useEffect(() => { if (step === 'sheet-name') setListName(n => n || 'My list') }, [step])

  if (step === 'sheet-import' && gridId !== null) {
    return (
      <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center">
        <ImportWizard open gridId={gridId} onClose={cancelImport} onImported={() => { importDone.current = true; go('sheet-rows') }} />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center-safe justify-center bg-slate-50 dark:bg-slate-900 z-40 overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-4">
        <div className={card}>
          {step === 'welcome' && (
            <div className="p-10 text-center">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ClipboardList className="text-white w-8 h-8" aria-hidden="true" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Welcome to {PRODUCT_NAME}</h1>
              <p className="text-lg text-slate-600 dark:text-slate-300 mb-8 max-w-md mx-auto">
                {PRODUCT_NAME} keeps track of the people and things you're responsible for, and what's due for each.
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
              <p className="text-base text-slate-600 dark:text-slate-300 pt-2 flex flex-wrap items-center gap-2">
                Just looking?
                <button type="button" className="btn-compact-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void trySample()}>
                  <Sparkles className="w-4 h-4" aria-hidden="true" /> Try it with sample data
                </button>
              </p>
              {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
              <Back onClick={() => go('profile')} />
            </div>
          )}

          {step === 'blank' && <GuidedBlankStart onBack={() => go('start')} onFinished={finish} />}

          {step === 'sheet-name' && (
            <div className="p-8 space-y-5">
              <h2 className={h2}>Name the list for your spreadsheet</h2>
              <p className={lead}>Next you'll pick the file and match its columns.</p>
              <div>
                <label htmlFor="setup-list-name" className="block text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">List name</label>
                <input id="setup-list-name" className={field} value={listName} autoFocus maxLength={200} onChange={e => setListName(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
              <div className="flex items-center justify-between">
                <Back onClick={() => go('start')} />
                <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy || !listName.trim()}
                  onClick={() => void createListForImport()}>
                  {busy ? 'Working…' : 'Choose file'} {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {step === 'sheet-rows' && (
            <div className="p-8 space-y-5">
              <h2 className={h2}>What are these rows?</h2>
              <p className={lead}>{PRODUCT_NAME} will use this word everywhere. You can change it later in Settings → Workspace.</p>
              <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <legend className="sr-only">What are these rows?</legend>
                {ROW_CHOICES.map((c, i) => (
                  <label key={c.many} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer text-base text-slate-800 dark:text-slate-100 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                    <input type="radio" name="setup-rows" className="w-5 h-5" checked={rows.choice === i} onChange={() => setRows(r => ({ ...r, choice: i }))} />
                    {c.many.charAt(0).toUpperCase() + c.many.slice(1)}
                  </label>
                ))}
                <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer text-base text-slate-800 dark:text-slate-100 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                  <input type="radio" name="setup-rows" className="w-5 h-5" checked={rows.choice === 'other'} onChange={() => setRows(r => ({ ...r, choice: 'other' }))} />
                  Something else
                </label>
              </fieldset>
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
                        <input type="radio" name="setup-kind" className="w-5 h-5" checked={rows.kind === k.kind} onChange={() => setRows(r => ({ ...r, kind: k.kind }))} />
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
              <div className="flex justify-end">
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
              <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Your workspace is ready</h2>
              <p className="text-lg text-slate-600 dark:text-slate-300 mb-6 max-w-sm mx-auto">Would you like a quick tour of the main features?</p>
              <button type="button" className="btn-primary inline-flex items-center gap-2 px-8" onClick={onStartTour}>
                Show me around <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </button>
              <div className="mt-3">
                <button type="button" onClick={onComplete} className="hit-44 text-base text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
                  No thanks, I'll explore on my own
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {showExamples && (
        <ApplyStarterDialog mode="setup" onClose={() => setShowExamples(false)} onApplied={() => { setShowExamples(false); void finish() }} />
      )}
    </div>
  )
}
