/**
 * "List settings…": a list's name, what it holds, its own words, how each
 * record's name is shown, and priority levels (plans/generalization/W02-list-kinds.md §5).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { GridSettingsPatch } from '../../../shared/ipc-contract'
import { isPersonKind, type Column, type Grid, type GridRow, type RecordKind } from '../../../shared/types'
import { guessArticle, resolveVocab, VOCAB_WORD_MAX, type Vocab } from '../../../shared/vocab'
import { DISPLAY_FORMAT_MAX, renderDisplayFormat } from '../../../shared/displayFormat'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { useGridStore } from '../../stores/gridStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUndoStore } from '../../stores/undoStore'
import { RECORD_KINDS } from '../../views/setup/GuidedBlankStart'
import { DeletedColumnsSection } from './DeletedColumnsSection'
import { MoreSettings } from '../settings/MoreSettings'

interface Props {
  gridId: number
  onClose: () => void
  /** Opens the monthly requirements dialog for this list */
  onOpenRequirements?: () => void
}

interface Loaded { grid: Grid; columns: Column[]; firstRow: GridRow | null }

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'
const hint = 'text-sm text-slate-600 dark:text-slate-300'

/** Send settings, then bring the sidebar, the open list and the words up to date. */
async function applySettings(gridId: number, patch: GridSettingsPatch): Promise<string | null> {
  const res = await safeInvoke(IPC.GRID_SETTINGS_UPDATE, gridId, patch)
  if (!res.ok) return friendlyError(res.error, "We couldn't save these settings — try again")
  const grid = useGridStore.getState()
  await grid.loadGridList()
  if (grid.activeGridId === gridId) await grid.loadGrid(gridId)
  await useWorkspaceStore.getState().load()
  return null
}

export function ListSettingsDialog({ gridId, onClose, onOpenRequirements }: Props): React.ReactElement {
  const { t } = useVocab(gridId)
  const formatRef = useRef<HTMLInputElement>(null)
  const priorityOn = useFeature('priority')
  const requirementsOn = useFeature('requirements')
  const workspaceVocab = useWorkspaceStore(s => s.vocab)
  const listVocab = useWorkspaceStore(s => s.gridVocab[gridId])

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<RecordKind>('person')
  const [ownWords, setOwnWords] = useState(false)
  const [one, setOne] = useState('')
  const [many, setMany] = useState('')
  const [format, setFormat] = useState('')
  const [acuity, setAcuity] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void safeInvoke<{ grid: Grid; columns: Column[]; hiddenColumns: Column[]; rows: GridRow[] }>(IPC.GRID_GET_FULL, gridId).then(res => {
      if (cancelled) return
      if (!res.ok) { toast.error(`We couldn't open the ${t('list')} settings. Try again.`); onClose(); return }
      const { grid, columns, hiddenColumns, rows } = res.data
      const all = [...columns, ...hiddenColumns].sort((a, b) => a.position - b.position)
      const words = resolveVocab(useWorkspaceStore.getState().vocab, useWorkspaceStore.getState().gridVocab[gridId])
      setLoaded({ grid, columns: all, firstRow: rows[0] ?? null })
      setName(grid.name)
      setKind(grid.record_kind ?? 'person')
      setOwnWords(!!useWorkspaceStore.getState().gridVocab[gridId]?.record)
      setOne(words.record.one)
      setMany(words.record.many)
      setFormat(grid.display_format ?? '')
      setAcuity(grid.acuity_enabled === 1)
    })
    return () => { cancelled = true }
    // Load once per list; t and onClose only matter for the failure message
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridId])

  const workspaceRecord = resolveVocab(workspaceVocab).record
  // The kind most lists here hold: a list that holds something else has had it chosen on purpose
  const grids = useGridStore(s => s.grids)
  const usualKind = useMemo(() => {
    const counts = new Map<RecordKind, number>()
    for (const g of grids) { const k = g.record_kind ?? 'person'; counts.set(k, (counts.get(k) ?? 0) + 1) }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'person'
  }, [grids])
  const listSettingsChanged = !!loaded && ((loaded.grid.record_kind ?? 'person') !== usualKind || !!listVocab?.record || !!loaded.grid.display_format)
  const nameColumn = loaded?.columns.find(c => c.is_name_column === 1)

  const preview = useMemo(() => {
    if (!loaded) return ''
    const values: Record<string, string> = {}
    for (const c of loaded.columns) {
      const key = c.name.trim().toLowerCase()
      if (key in values) continue
      // Without a record yet, show where each column would go
      values[key] = loaded.firstRow ? String(loaded.firstRow[`col_${c.id}` as keyof GridRow] ?? '') : `[${c.name}]`
    }
    const fromName = nameColumn && loaded.firstRow ? String(loaded.firstRow[`col_${nameColumn.id}` as keyof GridRow] ?? '') : ''
    return (format.trim() ? renderDisplayFormat(format, values) : '') || fromName || (nameColumn ? `[${nameColumn.name}]` : '')
  }, [loaded, format, nameColumn])

  function insertToken(columnName: string) {
    const token = `{${columnName}}`
    const input = formatRef.current
    const start = input?.selectionStart ?? format.length
    const end = input?.selectionEnd ?? format.length
    const spaced = (start > 0 && !/\s$/.test(format.slice(0, start)) ? ' ' : '') + token
    const next = (format.slice(0, start) + spaced + format.slice(end)).slice(0, DISPLAY_FORMAT_MAX)
    setFormat(next)
    requestAnimationFrame(() => {
      input?.focus()
      const pos = start + spaced.length
      input?.setSelectionRange(pos, pos)
    })
  }

  function kindNote(): string | null {
    if (!loaded) return null
    const was = isPersonKind(loaded.grid.record_kind)
    const now = isPersonKind(kind)
    if (was && !now) return `This ${t('list')} will stop showing age next to birth dates, and calendars will show each one's name instead of initials.`
    if (!was && now) return `This ${t('list')} will show age next to birth dates, and calendars will use initials instead of names.`
    return null
  }

  async function save() {
    if (!loaded) return
    const { grid } = loaded
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) { setError(`Give the ${t('list')} a name.`); return }
    if (ownWords && (!one.trim() || !many.trim())) { setError('Fill in both words, or use the workspace words.'); return }

    // The list's own words may hold more than the record word (from an example); keep the rest
    const curVocab: Partial<Vocab> = listVocab ?? {}
    const others: Partial<Vocab> = { ...curVocab }
    delete others.record
    const nextVocab: Partial<Vocab> = ownWords
      ? { ...others, record: { one: one.trim(), many: many.trim(), article: guessArticle(one) } }
      : others
    const vocabChanged = JSON.stringify(nextVocab) !== JSON.stringify(curVocab)

    const patch: GridSettingsPatch = {}
    const undo: GridSettingsPatch = {}
    if (trimmedName !== grid.name) { patch.name = trimmedName; undo.name = grid.name }
    const oldKind = grid.record_kind ?? 'person'
    if (kind !== oldKind) { patch.record_kind = kind; undo.record_kind = oldKind }
    if (vocabChanged) {
      patch.vocab = Object.keys(nextVocab).length ? nextVocab : null
      undo.vocab = Object.keys(curVocab).length ? curVocab : null
    }
    if (format.trim() !== (grid.display_format ?? '')) { patch.display_format = format.trim() || null; undo.display_format = grid.display_format ?? null }
    if (priorityOn && acuity !== (grid.acuity_enabled === 1)) { patch.acuity_enabled = acuity; undo.acuity_enabled = grid.acuity_enabled === 1 }
    if (!Object.keys(patch).length) { onClose(); return }

    setSaving(true)
    try {
      const failure = await applySettings(gridId, patch)
      if (failure) { setError(failure); return }
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Changed settings for "${trimmedName}"`,
        timestamp: Date.now(),
        category: 'silent',
        icon: 'settings',
        undo: async () => { const e = await applySettings(gridId, undo); if (e) throw new Error(e) },
        redo: async () => { const e = await applySettings(gridId, patch); if (e) throw new Error(e) },
      })
      toast.success(`Saved the ${t('list')} settings`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const note = kindNote()
  // An example from this list's own columns, not another trade's words (UX-B-37)
  const formatPlaceholder = useMemo(() => {
    const cols = loaded?.columns ?? []
    const first = nameColumn ?? cols[0]
    const second = cols.find(c => c.id !== first?.id && c.column_type !== 'date' && c.column_type !== 'deadline')
    if (!first) return ''
    return second ? `e.g. {${first.name}} – {${second.name}}` : `e.g. {${first.name}}`
  }, [loaded, nameColumn])

  return (
    // Fits a 768px-high screen: the body scrolls, the title and Save stay in view (UX-B-16)
    <Dialog open onClose={onClose} size="xl"
      icon={<Settings2 className="w-6 h-6 mt-2 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      title={<>{t('list', { cap: true })} settings{loaded ? `: ${loaded.grid.name}` : ''}</>}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!loaded || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
      </>}>
      {!loaded ? (
        <p className="py-2 text-base text-slate-600 dark:text-slate-300">Loading…</p>
      ) : (
        <div className="space-y-6" data-testid="list-settings-body">
          <div>
            <label htmlFor="list-settings-name" className={label}>Name</label>
            <input id="list-settings-name" className="input w-full" maxLength={200} value={name} onChange={e => setName(e.target.value)} />
          </div>

          {(priorityOn || (requirementsOn && onOpenRequirements)) && (
            <div className="space-y-2">
              {priorityOn && (
                <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="w-5 h-5" checked={acuity} onChange={e => setAcuity(e.target.checked)} />
                  Use {t('priority', { many: true })} on this {t('list')}
                </label>
              )}
              {requirementsOn && onOpenRequirements && (
                <SecondaryButton onClick={onOpenRequirements}>
                  Monthly {t('requirement', { many: true })}…
                </SecondaryButton>
              )}
            </div>
          )}

          <DeletedColumnsSection gridId={gridId} />

          {/* Set once at setup and rarely again; open when this list differs (Q1c) */}
          <MoreSettings changed={listSettingsChanged} data-testid="list-settings-more">
              <fieldset>
                <legend className={label}>What does this {t('list')} hold?</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {RECORD_KINDS.map(k => (
                    <label key={k.kind} className="flex items-start gap-2 p-3 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
                      <input type="radio" name="list-settings-kind" className="w-5 h-5 mt-0.5" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                      <span>
                        <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">{k.label}</span>
                        <span className="block text-sm text-slate-600 dark:text-slate-300">{k.example}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {note && <p role="status" className="mt-2 text-base text-amber-800 dark:text-amber-200">{note}</p>}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className={label}>What do you call one of them? And more than one?</legend>
                <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="w-5 h-5" checked={!ownWords} onChange={e => setOwnWords(!e.target.checked)} />
                  Use the workspace words ({workspaceRecord.one} / {workspaceRecord.many})
                </label>
                {ownWords && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="list-settings-one" className="block text-base text-slate-700 dark:text-slate-200 mb-1">One</label>
                      <input id="list-settings-one" className="input w-full" maxLength={VOCAB_WORD_MAX} value={one} onChange={e => setOne(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="list-settings-many" className="block text-base text-slate-700 dark:text-slate-200 mb-1">More than one</label>
                      <input id="list-settings-many" className="input w-full" maxLength={VOCAB_WORD_MAX} value={many} onChange={e => setMany(e.target.value)} />
                    </div>
                  </div>
                )}
              </fieldset>

              <div className="space-y-2">
                <label htmlFor="list-settings-format" className={label}>How to show each one's name</label>
                {/* What the chips are for, before the chips, so they aren't taken for filters (UX-B-37) */}
                <p className={hint}>
                  Usually {nameColumn ? <>the <strong>{nameColumn.name}</strong> column</> : 'the name column'} is enough. To show more, click the columns to add them.
                </p>
                <div className="flex flex-wrap gap-2" aria-label="Columns you can add">
                  {loaded.columns.map(c => (
                    <button key={c.id} type="button" onClick={() => insertToken(c.name)}
                      className="hit-44 px-3 py-1 rounded-full border border-slate-300 dark:border-slate-600 text-base text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                      {c.name}
                    </button>
                  ))}
                </div>
                <input id="list-settings-format" ref={formatRef} className="input w-full font-mono" maxLength={DISPLAY_FORMAT_MAX}
                  placeholder={formatPlaceholder} value={format} onChange={e => setFormat(e.target.value)} />
                <p className="text-base text-slate-700 dark:text-slate-200">
                  <span className="text-slate-500 dark:text-slate-400">{loaded.firstRow ? 'Example: ' : 'Looks like: '}</span>
                  <strong>{preview || '—'}</strong>
                </p>
              </div>
          </MoreSettings>

          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
        </div>
      )}
    </Dialog>
  )
}
