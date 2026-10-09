/**
 * Settings → Notes → "Your own numbers": define numbers like labor hours or
 * parts cost to record on each note (plans/generalization/W03-activity.md §3.3).
 */
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { WorkspaceState } from '../../../shared/ipc-contract'
import { MAX_ACTIVE_MEASURES, MEASURE_LABEL_MAX, MEASURE_UNIT_MAX, type MeasureDef, type MeasureKind } from '../../../shared/measures'
import { safeInvoke } from '../../utils/safeInvoke'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useVocab } from '../../hooks/useVocab'

const KINDS: Array<{ kind: MeasureKind; label: string }> = [
  { kind: 'number', label: 'A count or amount' },
  { kind: 'hours', label: 'Hours' },
  { kind: 'currency', label: 'Money ($)' },
]

type Draft = { label: string; kind: MeasureKind; unit: string; decimals: 0 | 1 | 2 }

async function send(channel: typeof IPC.MEASURE_SAVE | typeof IPC.MEASURE_ARCHIVE, ...args: unknown[]): Promise<boolean> {
  const res = await safeInvoke<WorkspaceState>(channel, ...args)
  if (!res.ok) { toast.error(res.error); return false }
  useWorkspaceStore.setState({ ...res.data, measures: res.data.measures ?? [] })
  return true
}

function Fields({ draft, onChange, idPrefix }: { draft: Draft; onChange: (d: Draft) => void; idPrefix: string }): React.ReactElement {
  return (
    <>
      <input className="input flex-1 min-w-40" aria-label="Name" placeholder="e.g. Labor" maxLength={MEASURE_LABEL_MAX}
        value={draft.label} onChange={e => onChange({ ...draft, label: e.target.value })} />
      <select className="input w-auto" aria-label="Kind of number" id={`${idPrefix}-kind`}
        value={draft.kind} onChange={e => onChange({ ...draft, kind: e.target.value as MeasureKind })}>
        {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      {draft.kind === 'number' && (
        <>
          <input className="input w-28" aria-label="Unit" placeholder="unit, e.g. boxes" maxLength={MEASURE_UNIT_MAX}
            value={draft.unit} onChange={e => onChange({ ...draft, unit: e.target.value })} />
          <select className="input w-auto" aria-label="Decimal places"
            value={draft.decimals} onChange={e => onChange({ ...draft, decimals: Number(e.target.value) as 0 | 1 | 2 })}>
            <option value={0}>Whole numbers</option>
            <option value={1}>1 decimal</option>
            <option value={2}>2 decimals</option>
          </select>
        </>
      )}
    </>
  )
}

function MeasureRow({ def }: { def: MeasureDef }): React.ReactElement {
  const initial: Draft = { label: def.label, kind: def.kind, unit: def.unit ?? '', decimals: def.decimals }
  const [draft, setDraft] = useState<Draft>(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  return (
    <li className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
      <Fields draft={draft} onChange={setDraft} idPrefix={`measure-${def.key}`} />
      {dirty && (
        <button type="button" className="btn-compact-primary" onClick={() => void send(IPC.MEASURE_SAVE, { key: def.key, ...draft })}>Save</button>
      )}
      <button type="button" className="btn-compact-secondary" title="Hide from new notes; saved values stay"
        onClick={() => void send(IPC.MEASURE_ARCHIVE, def.key, true)}>
        Archive
      </button>
    </li>
  )
}

export function MeasuresEditor(): React.ReactElement {
  const { t } = useVocab(null)
  const defs = useWorkspaceStore(s => s.measures) ?? []
  const active = defs.filter(d => !d.archived)
  const archived = defs.filter(d => d.archived)
  const blank: Draft = { label: '', kind: 'number', unit: '', decimals: 0 }
  const [draft, setDraft] = useState<Draft>(blank)

  async function add() {
    if (!draft.label.trim()) return
    if (await send(IPC.MEASURE_SAVE, draft)) setDraft(blank)
  }

  return (
    <div className="space-y-2 pl-8">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Each one adds a box to every {t('activity')}, like Labor hours or Parts cost. Up to {MAX_ACTIVE_MEASURES}.
      </p>
      {active.length > 0 && (
        <ul className="space-y-2">
          {active.map(d => <MeasureRow key={`${d.key}-${d.label}-${d.kind}-${d.unit ?? ''}-${d.decimals}`} def={d} />)}
        </ul>
      )}
      {active.length < MAX_ACTIVE_MEASURES && (
        <div className="flex flex-wrap items-center gap-2">
          <Fields draft={draft} onChange={setDraft} idPrefix="measure-new" />
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={!draft.label.trim()} onClick={() => void add()}>
            <Plus className="w-4 h-4" aria-hidden="true" />Add a number
          </button>
        </div>
      )}
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-base text-slate-700 dark:text-slate-200" style={{ minHeight: 44, lineHeight: '44px' }}>
            Archived ({archived.length})
          </summary>
          <ul className="space-y-2 mt-2">
            {archived.map(d => (
              <li key={d.key} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="flex-1 text-base text-slate-600 dark:text-slate-300">{d.label}</span>
                <button type="button" className="btn-compact-secondary" onClick={() => void send(IPC.MEASURE_ARCHIVE, d.key, false)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
