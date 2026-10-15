import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  GENERIC_VOCAB, HUMAN_SERVICES_VOCAB, VOCAB_WORD_MAX, guessArticle, resolveVocab, term,
  type Term, type Vocab, type VocabKey,
} from '../../../shared/vocab'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useGridStore } from '../../stores/gridStore'
import { ListSettingsDialog } from '../grid/ListSettingsDialog'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import { IPC_READ_ONLY } from '../../../shared/constants'
import { isOn, type FeatureKey } from '../../../shared/features'
import { MoreSettings } from './MoreSettings'

/**
 * The words people can change, in the order they matter. (Appointments and stages arrive with their features.)
 * `more`: under "More words" (most people keep them); `feature`: only shown while that feature is on (Q1c).
 * A hidden word is still stored and saved as it is.
 */
const ROWS: Array<{ key: VocabKey; label: string; hint: string; more?: true; feature?: FeatureKey }> = [
  { key: 'record', label: 'What you track', hint: 'The people or things in your lists' },
  { key: 'list', label: 'Lists', hint: 'The groups in the sidebar' },
  { key: 'activity', label: 'Notes', hint: 'What you write about each one', more: true },
  { key: 'activityLog', label: 'Notes history', hint: 'Where those notes are listed', more: true },
  { key: 'contact', label: 'Outside contacts', hint: 'People and organizations you work with', more: true, feature: 'contactsDirectory' },
  { key: 'contactDirectory', label: 'Contacts page', hint: 'The page that lists them', more: true, feature: 'contactsDirectory' },
  { key: 'requirement', label: 'Requirements', hint: 'How many calls or visits each one needs in a period', more: true, feature: 'requirements' },
  { key: 'priority', label: 'Priority', hint: 'How much attention each one needs', more: true, feature: 'priority' },
  { key: 'worker', label: 'Your role', hint: 'Used on letters and reports', more: true },
]

const sameTerm = (a: Term, b: Term): boolean => a.one === b.one && a.many === b.many

const BAD_CHARS = /[<>{}]/

/** Only what differs from the generic words is stored */
function toStored(draft: Vocab): Partial<Vocab> {
  const out: Partial<Vocab> = {}
  for (const k of Object.keys(draft) as VocabKey[]) {
    const g = GENERIC_VOCAB[k]
    const d = draft[k]
    if (d.one !== g.one || d.many !== g.many || d.article !== g.article || d.oneCap !== g.oneCap || d.manyCap !== g.manyCap) out[k] = d
  }
  return out
}

function trimmed(draft: Vocab): Vocab {
  return Object.fromEntries((Object.keys(draft) as VocabKey[]).map(k => [k, { ...draft[k], one: draft[k].one.trim(), many: draft[k].many.trim() }])) as Vocab
}

function wordError(word: string): string | null {
  const w = word.trim()
  if (!w) return 'Fill this in'
  if (w.length > VOCAB_WORD_MAX) return `Up to ${VOCAB_WORD_MAX} characters`
  if (BAD_CHARS.test(w)) return 'Leave out < > { }'
  return null
}

/**
 * Settings → Workspace → Words: change the words used everywhere (screens,
 * PDFs, exports). Changes apply when saved.
 */
export function WordsEditor(): React.ReactElement {
  const saved = useWorkspaceStore(s => s.vocab)
  const update = useWorkspaceStore(s => s.update)
  const [draft, setDraft] = useState<Vocab>(() => resolveVocab(saved))
  const [saving, setSaving] = useState(false)
  const { t } = useVocab(null)
  const features = useWorkspaceStore(s => s.features)
  const rows = useMemo(() => ROWS.filter(r => !r.feature || isOn(features, r.feature)), [features])
  const gridVocab = useWorkspaceStore(s => s.gridVocab)
  const grids = useGridStore(s => s.grids)
  const [editingList, setEditingList] = useState<number | null>(null)
  // Lists with their own words keep them, whatever is saved here
  const ownWords = grids
    .filter(g => gridVocab[g.id] && Object.keys(gridVocab[g.id]!).length > 0)
    .map(g => ({ id: g.id, name: g.name, word: gridVocab[g.id]!.record?.one }))

  // Words changed elsewhere (an example applied, another window): start from them
  useEffect(() => { setDraft(resolveVocab(saved)) }, [saved])

  const dirty = JSON.stringify(toStored(draft)) !== JSON.stringify(toStored(resolveVocab(saved)))
  const errors = useMemo(() => Object.fromEntries(rows.flatMap(r => {
    const one = wordError(draft[r.key].one)
    const many = wordError(draft[r.key].many)
    return one || many ? [[r.key, { one, many }]] : []
  })) as Partial<Record<VocabKey, { one: string | null; many: string | null }>>, [draft, rows])
  const hasErrors = Object.keys(errors).length > 0

  // Leaving the tab (or Settings) with changes saves them instead of dropping them
  const pending = useRef({ dirty, hasErrors, draft })
  useEffect(() => { pending.current = { dirty, hasErrors, draft } })
  useEffect(() => () => {
    const p = pending.current
    if (!p.dirty) return
    if (p.hasErrors) { toast.error('Your word changes weren\'t saved: some boxes need fixing first.'); return }
    update({ vocab: toStored(trimmed(p.draft)) }).then(
      () => { toast.success('Your word changes were saved.') },
      () => { toast.error('We couldn\'t save your word changes — try again') },
    )
  }, [update])

  function setWord(key: VocabKey, form: 'one' | 'many', value: string) {
    setDraft(d => {
      const prev = d[key]
      // Typed words get plain capitalization; the article follows the word
      const next: Term = { one: prev.one, many: prev.many, article: prev.article, [form]: value }
      if (form === 'one') next.article = guessArticle(value)
      return { ...d, [key]: next }
    })
  }

  async function save() {
    setSaving(true)
    try {
      await update({ vocab: toStored(trimmed(draft)) })
      toast.success(ownWords.length > 0 ? `Words saved. ${t('list', { many: true, cap: true })} with their own words keep them.` : 'Words saved. They now appear everywhere.')
    } catch (err) {
      const fallback = "We couldn't save the words — try again"
      toast.error(err instanceof Error && err.message !== IPC_READ_ONLY ? friendlyError(err.message, fallback) : fallback)
    } finally {
      setSaving(false)
    }
  }

  const v = draft
  const cell = 'px-2 py-1.5 align-top'
  function renderRow(r: (typeof ROWS)[number]): React.ReactElement {
    return (
      <li key={r.key} className={`${cell} py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 items-start`}>
        <div>
          <span className="block font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">{r.hint}</span>
        </div>
        {(['one', 'many'] as const).map(form => {
          const err = errors[r.key]?.[form]
          const id = `word-${r.key}-${form}`
          return (
            <div key={form}>
              {/* The visible label is short; the box's spoken name says which word it is */}
              <label htmlFor={id} className="block text-sm text-slate-600 dark:text-slate-300 mb-0.5">
                {form === 'one' ? 'One' : 'More than one'}
              </label>
              <input id={id} className="input w-full" value={v[r.key][form]} maxLength={VOCAB_WORD_MAX + 10}
                aria-label={`${r.label}: ${form === 'one' ? 'one' : 'more than one'}`}
                aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined}
                onChange={e => setWord(r.key, form, e.target.value)} />
              {err && <span id={`${id}-err`} className="block text-sm text-red-700 dark:text-red-300 mt-1">{err}</span>}
            </div>
          )
        })}
      </li>
    )
  }
  return (
    <section className="space-y-3" aria-labelledby="words-heading">
      <h2 id="words-heading" className="text-xl font-semibold text-slate-800 dark:text-slate-100">Words</h2>
      <p className="text-base text-slate-600 dark:text-slate-300">
        Call things what you call them. These words are used on every screen, in PDFs and in exports.
      </p>

      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-base text-slate-800 dark:text-slate-100" aria-live="polite">
        <span className="sr-only">Preview: </span>
        Add {term(v, 'record', { article: true })} · 3 {term(v, 'record', { many: true })} due this week · {term(v, 'record', { cap: true })} {term(v, 'activity', { many: true })} · New {term(v, 'list')}
      </div>

      {ownWords.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 space-y-1">
          <p className="text-base text-slate-800 dark:text-slate-100">
            These are the default words. {t('list', { many: true, cap: true })} with their own words keep them:
          </p>
          <ul className="space-y-1">
            {ownWords.map(l => (
              <li key={l.id} className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
                <span>{l.name}{l.word ? ` (${l.word})` : ''}</span>
                <button type="button" className="hit-44 text-base text-blue-700 dark:text-blue-300 underline" onClick={() => setEditingList(l.id)}>
                  Edit its words
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editingList !== null && <ListSettingsDialog gridId={editingList} onClose={() => setEditingList(null)} />}

      {/* Each word is a block with its two boxes under the label, so a long default like
          "contact requirements" never gets cut off in a narrow panel (E-39) */}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 border-y border-slate-300 dark:border-slate-600">
        {rows.filter(r => !r.more).map(renderRow)}
      </ul>
      {/* The other words open by themselves when they aren't one of the two word sets, or have an unsaved change (Q1c) */}
      <MoreSettings label="More words" data-testid="more-words" changed={rows.some(r => r.more && (
        !!errors[r.key]
        || !sameTerm(draft[r.key], resolveVocab(saved)[r.key])
        || (!sameTerm(draft[r.key], GENERIC_VOCAB[r.key]) && !sameTerm(draft[r.key], resolveVocab(HUMAN_SERVICES_VOCAB)[r.key]))
      ))}>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 border-y border-slate-300 dark:border-slate-600">
          {rows.filter(r => r.more).map(renderRow)}
        </ul>
      </MoreSettings>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={!dirty || hasErrors || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save words'}
        </button>
        {dirty && <button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(resolveVocab(saved))}>Discard changes</button>}
        <span className="flex-1" />
        <button type="button" className="btn-compact-secondary" onClick={() => setDraft(resolveVocab())}>Use general words</button>
        <button type="button" className="btn-compact-secondary" onClick={() => setDraft(resolveVocab(HUMAN_SERVICES_VOCAB))}>Use human-services words</button>
      </div>
    </section>
  )
}
