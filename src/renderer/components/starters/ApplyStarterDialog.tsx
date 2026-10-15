import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { LayoutTemplate, Search, X, Sparkles, ArrowLeft } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { matchingVariants, searchStarters, type ApplyResult, type StarterPreview, type StarterRef, type StarterSummary } from '../../../shared/starters/schema'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { reloadAfterApply } from '../../utils/reloadAfterApply'
import { StarterIcon } from './StarterIcon'
import { pulseEvents } from '../../events'
import { friendlyError } from '../../utils/friendlyError'
import { IPC_READ_ONLY } from '../../../shared/constants'

type Step = 'gallery' | 'variant' | 'review' | 'done'

interface Props {
  /**
   * 'add' (Settings, existing workspace): words and features are off by default.
   * 'setup' (first run): on by default, and after adding, setup takes over
   * (onApplied) instead of this dialog's own summary.
   */
  mode: 'add' | 'setup'
  onClose: () => void
  onApplied?: (result: ApplyResult) => void
  /** Start with this starter (an opened file) instead of the gallery */
  initial?: { source: StarterRef; summary: StarterSummary }
  /** Start with "Add sample data" ticked (the "try it" paths) */
  withSamples?: boolean
  /** Ways out when no example matches the search */
  onStartBlank?: () => void
  onStartSpreadsheet?: () => void
}

const KIND_LABEL = { person: 'People', thing: 'Things', job: 'Jobs' } as const

/**
 * Pick an example (starter template), choose its variant, review what it adds,
 * and apply it. Nothing already in the workspace is changed or removed.
 */
export function ApplyStarterDialog({ mode, onClose, onApplied, initial, withSamples, onStartBlank, onStartSpreadsheet }: Props): React.ReactElement {
  const { t, f } = useVocab(null)
  const trapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useFocusTrap(trapRef, true)

  const [step, setStep] = useState<Step>(initial ? (initial.summary.variants.length > 0 ? 'variant' : 'review') : 'gallery')
  const [starters, setStarters] = useState<StarterSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<StarterSummary | null>(initial?.summary ?? null)
  const [source, setSource] = useState<StarterRef | null>(initial?.source ?? null)
  const [variant, setVariant] = useState<string | undefined>(initial?.summary.variants[0]?.key)
  const [preview, setPreview] = useState<StarterPreview | null>(null)
  const [lists, setLists] = useState<Set<string>>(new Set())
  const [useWords, setUseWords] = useState(mode === 'setup')
  const [useFeatures, setUseFeatures] = useState(mode === 'setup')
  // First run starts with samples (the payoff shows at once); removing them is one click
  const [sample, setSample] = useState(withSamples ?? mode === 'setup')
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  useEffect(() => {
    if (initial) return // opened from a file: no gallery
    void safeInvoke(IPC.STARTER_LIST).then(r => {
      if (r.ok) setStarters(r.data)
      else { toast.error("We couldn't load the examples."); setStarters([]) }
    })
  }, [initial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !working) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, working])

  const groups = useMemo(() => {
    const matches = searchStarters(starters ?? [], query)
    const byGroup = new Map<string, StarterSummary[]>()
    for (const s of matches) byGroup.set(s.group ?? 'Other', [...(byGroup.get(s.group ?? 'Other') ?? []), s])
    return [...byGroup.entries()]
  }, [starters, query])
  // A badge every card has tells nobody anything
  const someLackSamples = (starters ?? []).some(s => !s.hasSampleData)

  // Focus goes where the work is: the search box in the gallery, the heading on each later step (audit F-17)
  useEffect(() => {
    const id = setTimeout(() => (step === 'gallery' ? searchRef.current : titleRef.current)?.focus(), 60)
    return () => clearTimeout(id)
  }, [step])

  async function loadPreview(src: StarterRef, v: string | undefined) {
    setPreview(null)
    setStep('review')
    const r = await safeInvoke(IPC.STARTER_PREVIEW, src, v)
    if (!r.ok) { toast.error(friendlyError(r.error)); if (initial) onClose(); else setStep('gallery'); return }
    setPreview(r.data)
    setLists(new Set(r.data.lists.map(l => l.key)))
  }

  /** `matched`: the layouts the search found it by. One opens straight at review; several start the layout question on the first */
  function pick(s: StarterSummary, matched: Array<{ key: string }> = []) {
    const src = { builtinId: s.id }
    setChosen(s)
    setSource(src)
    if (matched.length === 1) { setVariant(matched[0]!.key); void loadPreview(src, matched[0]!.key) }
    else if (s.variants.length > 0) { setVariant((matched[0] ?? s.variants[0]!).key); setStep('variant') }
    else { setVariant(undefined); void loadPreview(src, undefined) }
  }

  // An opened file without variants goes straight to review
  useEffect(() => {
    if (initial && initial.summary.variants.length === 0) void loadPreview(initial.source, undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the file passed in
  }, [])

  async function apply() {
    if (!source || !preview) return
    setWorking(true)
    try {
      const r = await safeInvoke(IPC.STARTER_APPLY, source, {
        lists: [...lists], applyWords: useWords && preview.words.length > 0, applyFeatures: useFeatures && preview.features.length > 0,
        sampleData: sample && preview.hasSampleData, ...(variant ? { variant } : {}),
      })
      if (!r.ok) { toast.error(r.error === IPC_READ_ONLY ? "Examples can't be added right now." : friendlyError(r.error, "We couldn't add that example — try again")); return }
      if (mode === 'setup') { onApplied?.(r.data); return }
      // Its lists' own words and link types too, even when the workspace's words were left alone
      await reloadAfterApply()
      if (sample && preview.hasSampleData) pulseEvents.emit('sample-data:changed')
      setResult(r.data)
      setStep('done')
      onApplied?.(r.data)
    } finally {
      setWorking(false)
    }
  }

  function open(gridId: number) {
    void useGridStore.getState().loadGrid(gridId)
    // Not router-bound: this dialog also opens during setup, outside the router
    window.location.hash = '#/grid'
    onClose()
  }

  const title = step === 'done' ? 'Added' : chosen && step !== 'gallery' ? chosen.name : 'Start from an example'
  const box = 'w-5 h-5 mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 flex-shrink-0'

  // First run shows the first group open and the rest behind "More examples": about 25 cards at
  // once is the first "too many options" moment (UX-A-27). A search shows everything that matches.
  const collapseRest = mode === 'setup' && !query.trim()
  // The collapsed examples aren't drawn until opened: hidden cards would count as the
  // dialog's last stop, and Tab from "More examples" would leave the dialog (Mark, R8)
  const [moreOpen, setMoreOpen] = useState(false)

  const renderGroup = ([group, items]: [string, StarterSummary[]]) => (
    <section key={group} className="space-y-2" aria-label={group}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group}</h3>
      {items.map(s => {
        // "foster" finds Human services through one of its layouts: say which, and open it
        const matched = matchingVariants(s, query)
        const shown = matched.slice(0, 3).map(v => v.name).join(', ')
        return (
          <button key={s.id} type="button" onClick={() => pick(s, matched)}
            className="w-full text-left flex gap-3 p-4 rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }}>
            <StarterIcon name={s.icon} className="w-6 h-6 mt-0.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">{s.name}</span>
              <span className="block text-base text-slate-600 dark:text-slate-300">{s.description}</span>
              <span className="block text-base text-slate-500 dark:text-slate-400 mt-1">
                {matched.length > 0
                  ? <span className="font-semibold text-slate-800 dark:text-slate-100">Matches: {shown}{matched.length > 3 ? ` and ${matched.length - 3} more` : ''}</span>
                  : s.variants.length > 0 ? `${s.variants.length} layouts to choose from` : s.listNames.join(' · ')}
                {s.hasSampleData && someLackSamples && <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200">Includes sample data</span>}
              </span>
            </span>
          </button>
        )
      })}
    </section>
  )

  return (
    // During setup a stray click outside doesn't throw away the choices (audit F-18); ✕ and Esc still close
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => { if (!working && mode !== 'setup') onClose() }}>
      {/* The steps scroll inside the panel, so the buttons at the bottom never leave the screen (UX-A-06) */}
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="starter-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          {(step === 'variant' || step === 'review') && !(initial && (step === 'variant' || initial.summary.variants.length === 0)) && (
            <button type="button" onClick={() => setStep(step === 'review' && chosen?.variants.length ? 'variant' : 'gallery')} aria-label="Back"
              className="hit-44 p-2 rounded-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          {chosen && step !== 'gallery' ? <StarterIcon name={chosen.icon} className="w-6 h-6 text-blue-600 dark:text-blue-400" /> : <LayoutTemplate className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
          <h2 id="starter-title" ref={titleRef} tabIndex={-1} className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1 focus:outline-hidden">{title}</h2>
          <button type="button" onClick={onClose} disabled={working} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        {step === 'gallery' && (
          <div className="px-6 py-5 space-y-4">
            <p className="text-base text-slate-700 dark:text-slate-200">Pick something close to your work. You can change everything afterwards.</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
              <input ref={searchRef} type="search" className="input w-full pl-9" placeholder="Search examples…" aria-label="Search examples" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            {starters === null ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>
              : groups.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-base text-slate-600 dark:text-slate-300">No examples match. Try another word{onStartBlank || onStartSpreadsheet ? ', or start another way:' : '.'}</p>
                  {(onStartBlank || onStartSpreadsheet) && (
                    <div className="flex flex-wrap gap-2">
                      {onStartBlank && <button type="button" className="btn-secondary" onClick={onStartBlank}>Start blank</button>}
                      {onStartSpreadsheet && <button type="button" className="btn-secondary" onClick={onStartSpreadsheet}>Bring in a spreadsheet</button>}
                    </div>
                  )}
                </div>
              )
              : collapseRest
                ? <>
                    {renderGroup(groups[0]!)}
                    {groups.length > 1 && (
                      <details className="pt-1" open={moreOpen} onToggle={e => setMoreOpen(e.currentTarget.open)}>
                        <summary className="hit-44 cursor-pointer text-base font-medium text-blue-700 dark:text-blue-300 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                          More examples ({groups.slice(1).map(([g]) => g.toLowerCase()).join(', ')})
                        </summary>
                        {moreOpen && <div className="space-y-4 pt-3">{groups.slice(1).map(renderGroup)}</div>}
                      </details>
                    )}
                  </>
                : groups.map(renderGroup)}
          </div>
        )}

        {step === 'variant' && chosen && (
          <div className="px-6 py-5 space-y-3">
            <fieldset className="space-y-2">
              <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-2">{chosen.variantQuestion ?? 'Which describes your work best?'}</legend>
              {chosen.variants.map((v, i) => (
                <label key={v.key} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                  <input type="radio" name="starter-variant" className="w-5 h-5 mt-0.5 flex-shrink-0" checked={variant === v.key} onChange={() => setVariant(v.key)} />
                  <span className="min-w-0">
                    <span className="block text-base font-medium text-slate-900 dark:text-slate-100">
                      {v.name}
                      {/* The first layout is the usual one; said so, the list is less to weigh up (UX-A-27) */}
                      {mode === 'setup' && i === 0 && <span className="font-normal text-slate-600 dark:text-slate-300"> (most common)</span>}
                    </span>
                    <span className="block text-base text-slate-600 dark:text-slate-300">{v.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {step === 'review' && (
          <div className="px-6 py-5 space-y-5">
            {preview === null ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p> : (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-1">{t('list', { many: true, cap: true })} to add</legend>
                  {preview.lists.map(l => (
                    <div key={l.key}>
                      <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
                        <input type="checkbox" className={box} checked={lists.has(l.key)}
                          onChange={e => setLists(prev => { const n = new Set(prev); if (e.target.checked) n.add(l.key); else n.delete(l.key); return n })} />
                        <span>
                          <span className="block text-base font-medium text-slate-900 dark:text-slate-100">{l.finalName}</span>
                          <span className="block text-sm text-slate-600 dark:text-slate-300">
                            {KIND_LABEL[l.kind]} · {l.columns} columns{l.rules.length > 0 ? ` · deadline rules: ${l.rules.join(', ')}` : ''}
                            {l.finalName !== l.name && ` · renamed because you already have “${l.name}”`}
                          </span>
                        </span>
                      </label>
                      {l.columnNames.length > 0 && (
                        <details className="ml-8">
                          <summary className="hit-44 cursor-pointer text-base text-blue-700 dark:text-blue-300 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">Show its columns</summary>
                          <p className="text-base text-slate-700 dark:text-slate-200 pb-1">{l.columnNames.join(', ')}</p>
                        </details>
                      )}
                    </div>
                  ))}
                </fieldset>

                {/* Both lists are internal vocabulary and both boxes are ticked on first run, so each is
                    one line with the detail a click away (UX-A-06) */}
                {preview.words.length > 0 && (
                  <div className="space-y-1">
                    <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
                      <input type="checkbox" className={box} checked={useWords} onChange={e => setUseWords(e.target.checked)} />
                      <span>
                        <span className="block text-base font-medium text-slate-900 dark:text-slate-100">Use this example's words everywhere</span>
                        <span className="block text-base text-slate-600 dark:text-slate-300">
                          {preview.words.slice(0, 3).map(w => w.proposed).join(', ')}{preview.words.length > 3 ? ` and ${preview.words.length - 3} more` : ''}
                        </span>
                      </span>
                    </label>
                    <details className="ml-8">
                      <summary className="hit-44 cursor-pointer text-base text-blue-700 dark:text-blue-300 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">Show the words</summary>
                      <table className="text-base text-slate-700 dark:text-slate-200 pb-1">
                        <caption className="sr-only">Words that would change</caption>
                        <tbody>
                          {preview.words.map(w => (
                            <tr key={w.key}><td className="pr-3 py-0.5">{w.current}</td><td className="pr-3" aria-label="becomes">→</td><td className="font-medium">{w.proposed}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </div>
                )}

                {preview.features.length > 0 && (
                  <div className="space-y-1">
                    <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
                      <input type="checkbox" className={box} checked={useFeatures} onChange={e => setUseFeatures(e.target.checked)} />
                      <span>
                        <span className="block text-base font-medium text-slate-900 dark:text-slate-100">Turn on the features it uses</span>
                        <span className="block text-base text-slate-600 dark:text-slate-300">
                          {preview.features.length === 1 ? '1 feature' : `${preview.features.length} features`} you can switch off later
                        </span>
                      </span>
                    </label>
                    <details className="ml-8">
                      <summary className="hit-44 cursor-pointer text-base text-blue-700 dark:text-blue-300 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">Show the features</summary>
                      <p className="text-base text-slate-700 dark:text-slate-200 pb-1">{preview.features.map(x => f(x.label)).join(', ')}</p>
                    </details>
                  </div>
                )}

                {preview.hasSampleData && (
                  <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
                    <input type="checkbox" className={box} checked={sample} onChange={e => setSample(e.target.checked)} />
                    <span>
                      <span className="block text-base font-medium text-slate-900 dark:text-slate-100">Add sample data</span>
                      <span className="block text-base text-slate-600 dark:text-slate-300">Made-up examples to try things out. You can remove them in one click.</span>
                    </span>
                  </label>
                )}

                <p className="text-base text-slate-600 dark:text-slate-300">Nothing you already have is changed. You can delete added {t('list', { many: true })} later from the {t('list')} menu.</p>
              </>
            )}
          </div>
        )}

        {step === 'done' && result && preview && (
          <div className="px-6 py-5 space-y-4">
            <p className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
              <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" aria-hidden="true" />
              {Object.keys(result.gridIds).length === 1 ? `Added 1 ${t('list')}.` : `Added ${Object.keys(result.gridIds).length} ${t('list', { many: true })}.`}
            </p>
            <ul className="space-y-2">
              {preview.lists.filter(l => result.gridIds[l.key] !== undefined).map(l => (
                <li key={l.key} className="flex items-center gap-3">
                  <span className="flex-1 text-base text-slate-900 dark:text-slate-100">{result.renamed[l.name] ?? l.name}</span>
                  <button type="button" className="btn-compact-secondary" onClick={() => open(result.gridIds[l.key]!)}>Open</button>
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-200">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-300">You can delete these {t('list', { many: true })} later from the {t('list')} menu.</p>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
        </div>

        {step === 'variant' && chosen && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
            {!initial && <button type="button" className="btn-secondary" onClick={() => setStep('gallery')}>Back</button>}
            <button type="button" className="btn-primary" onClick={() => source && void loadPreview(source, variant)}>Next</button>
          </div>
        )}
        {step === 'review' && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
            <button type="button" className="btn-primary" disabled={working || preview === null || lists.size === 0} onClick={() => void apply()}>
              {working ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
