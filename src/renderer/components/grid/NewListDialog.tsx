/**
 * "New list": name, what it holds, its words, and what to start with
 * (plans/generalization/W02-list-kinds.md §6). Replaces the name-only prompt.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Grid3X3, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { RecordKind } from '../../../shared/types'
import { guessArticle, resolveVocab, VOCAB_WORD_MAX } from '../../../shared/vocab'
import { wordsFromListName } from '../../../shared/listWords'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { RECORD_KINDS, SUGGESTIONS } from '../../views/setup/GuidedBlankStart'

type StartWith = 'empty' | 'suggested' | 'example'

interface Props {
  onClose: () => void
  /** The new list was made; the caller opens it */
  onCreated: (gridId: number) => void
  /** "From an example list": the caller opens the example gallery */
  onPickExample: () => void
}

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'

export function NewListDialog({ onClose, onCreated, onPickExample }: Props): React.ReactElement {
  const { t } = useVocab(null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<RecordKind>('person')
  // Words follow the name until the person types their own
  const [words, setWords] = useState<{ one: string; many: string } | null>(null)
  const [startWith, setStartWith] = useState<StartWith>('suggested')
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const guessed = useMemo(() => wordsFromListName(name), [name])
  const one = words?.one ?? (name.trim() ? guessed.one : '')
  const many = words?.many ?? (name.trim() ? guessed.many : '')
  const suggestions = SUGGESTIONS[kind]

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) { setError(`Give the ${t('list')} a name.`); return }
    if (!one.trim() || !many.trim()) { setError('Fill in both words.'); return }
    setBusy(true)
    setError(null)
    try {
      let gridId: number
      if (startWith === 'suggested') {
        // The first suggestion always stays: it names each record
        const cols = suggestions.filter((s, i) => i === 0 || !unchecked.has(s.name))
        const res = await safeInvoke(IPC.ONBOARDING_SETUP_GRID, {
          gridName: trimmed,
          columns: cols.map((c, i) => ({
            name: c.name, type: c.type, isNameCol: i === 0,
            ...(c.type === 'dropdown' ? { config: JSON.stringify({ options: c.options ?? ['Yes', 'No'] }) } : {}),
          })),
        })
        if (!res.ok) { setError(`We couldn't create the ${t('list')}. Please try again.`); return }
        gridId = res.data.gridId
      } else {
        const res = await safeInvoke(IPC.GRID_CREATE, trimmed)
        if (!res.ok) { setError(`We couldn't create the ${t('list')}. Please try again.`); return }
        gridId = Number(res.data)
      }

      // A list only keeps its own words when they differ from the workspace's
      const ws = resolveVocab(useWorkspaceStore.getState().vocab).record
      const sameWords = one.trim().toLowerCase() === ws.one.toLowerCase() && many.trim().toLowerCase() === ws.many.toLowerCase()
      const settings = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, {
        record_kind: kind,
        ...(sameWords ? {} : { vocab: { record: { one: one.trim(), many: many.trim(), article: guessArticle(one) } } }),
      })
      if (!settings.ok) toast.error(settings.error)

      await useGridStore.getState().loadGridList()
      await useWorkspaceStore.getState().load()
      onCreated(gridId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="new-list-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <Grid3X3 className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="new-list-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">New {t('list')}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          <div>
            <label htmlFor="new-list-name" className={label}>{t('list', { cap: true })} name</label>
            <input id="new-list-name" className="input w-full" maxLength={200} autoFocus placeholder="e.g. Vehicles"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && startWith !== 'example') { e.preventDefault(); void create() } }} />
          </div>

          <fieldset>
            <legend className={label}>What does it hold?</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {RECORD_KINDS.map(k => (
                <label key={k.kind} className="flex items-start gap-2 p-3 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                  <input type="radio" name="new-list-kind" className="w-5 h-5 mt-0.5" checked={kind === k.kind}
                    onChange={() => { setKind(k.kind); setUnchecked(new Set()) }} />
                  <span>
                    <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">{k.label}</span>
                    <span className="block text-sm text-slate-600 dark:text-slate-300">{k.example}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={label}>What do you call one of them? And more than one?</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-list-one" className="block text-base text-slate-700 dark:text-slate-200 mb-1">One</label>
                <input id="new-list-one" className="input w-full" maxLength={VOCAB_WORD_MAX} value={one}
                  onChange={e => setWords({ one: e.target.value, many })} />
              </div>
              <div>
                <label htmlFor="new-list-many" className="block text-base text-slate-700 dark:text-slate-200 mb-1">More than one</label>
                <input id="new-list-many" className="input w-full" maxLength={VOCAB_WORD_MAX} value={many}
                  onChange={e => setWords({ one, many: e.target.value })} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={label}>Start with</legend>
            {([
              ['suggested', 'Suggested columns', 'A few columns that suit what it holds. You can change them any time.'],
              ['empty', 'Just a name column', 'Add your own columns afterwards.'],
              ['example', `A ready-made ${t('list')}`, 'Pick one from the examples, with its columns and deadline rules.'],
            ] as const).map(([value, title, desc]) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="radio" name="new-list-start" className="w-5 h-5 mt-0.5" checked={startWith === value} onChange={() => setStartWith(value)} />
                <span>
                  <span className="block text-base font-medium text-slate-900 dark:text-slate-100">{title}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">{desc}</span>
                </span>
              </label>
            ))}
            {startWith === 'suggested' && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 pl-7" aria-label="Suggested columns">
                {suggestions.map((s, i) => (
                  <label key={s.name} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                    <input type="checkbox" className="w-5 h-5" disabled={i === 0} checked={i === 0 || !unchecked.has(s.name)}
                      onChange={e => setUnchecked(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.delete(s.name); else next.add(s.name)
                        return next
                      })} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          {startWith === 'example' ? (
            <button type="button" className="btn-primary" onClick={onPickExample}>Browse examples…</button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : `Create ${t('list')}`}</button>
          )}
        </div>
      </div>
    </div>
  )
}
