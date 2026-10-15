import React, { useEffect, useState } from 'react'
import { CalendarCheck, Plus, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { pulseEvents } from '../../events'
import type { ContactRequirement } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { PERIODS, PERIOD_MAX, type Period } from '../../../shared/periods'
import { friendlyError } from '../../utils/friendlyError'

// Built on the five built-in types; only shown for the types this workspace still has
const SUGGESTIONS: ContactRequirement[] = [
  { label: 'Face-to-face visit', note_types: ['visit'], per_month: 1 },
  { label: 'Phone contact', note_types: ['phone'], per_month: 1 },
  { label: 'Any contact', note_types: ['visit', 'phone', 'meeting', 'email'], per_month: 1 },
]

interface Draft { label: string; note_types: string[]; per_month: string; period: Period }

/** Edit a list's requirements: how many notes of which kinds per week, month, quarter or year. */
export function ContactRequirementsDialog({ gridId, gridName, onClose }: {
  gridId: number
  gridName: string
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId)
  const activity = useActivityTypes()
  const activeKeys = new Set(activity.active.map(type => type.key))
  const suggestions = SUGGESTIONS
    .map(sg => ({ ...sg, note_types: sg.note_types.filter(k => activeKeys.has(k)) }))
    .filter(sg => sg.note_types.length > 0)
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Load once per caseload; a new onClose identity must not wipe the user's edits
  useEffect(() => {
    void safeInvoke<ContactRequirement[]>(IPC.CONTACT_REQ_GET, gridId).then(r => {
      setDrafts(r.ok ? r.data.map(q => ({ label: q.label, note_types: q.note_types, per_month: String(q.per_month), period: q.period ?? 'month' })) : [])
    })
  }, [gridId])

  const update = (i: number, patch: Partial<Draft>) => setDrafts(d => d!.map((x, j) => j === i ? { ...x, ...patch } : x))
  const add = (r?: ContactRequirement) => setDrafts(d => [...(d ?? []), r
    ? { label: r.label, note_types: r.note_types, per_month: String(r.per_month), period: r.period ?? 'month' }
    : { label: '', note_types: [activeKeys.has('visit') ? 'visit' : activity.active[0]?.key ?? 'note'], per_month: '1', period: 'month' }])

  async function save() {
    setSaving(true); setError(null)
    const payload = drafts!.map(d => ({ label: d.label, note_types: d.note_types, per_month: parseInt(d.per_month, 10), period: d.period }))
    const res = await safeInvoke(IPC.CONTACT_REQ_SAVE, gridId, payload)
    setSaving(false)
    if (!res.ok) { setError(friendlyError(res.error, "We couldn't save these settings — try again")); return }
    pulseEvents.emit('contact-req:changed')
    onClose()
  }

  return (
    <Dialog open onClose={onClose} size="xl"
      icon={<CalendarCheck className="w-6 h-6 mt-2 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      title={<>{t('requirement', { many: true, cap: true })}: {gridName}</>}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={drafts === null || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </>}>
      <div className="space-y-4">
        <p className="text-base text-slate-700 dark:text-slate-200">
          How many {t('activity', { many: true })} does each {t('record')} need in a period: a week, a month, a quarter or a year? Pulse counts the {t('activity', { many: true })} you log and shows who is behind on the Dashboard.
        </p>

        {drafts === null && <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>}

        {drafts?.length === 0 && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-base text-slate-600 dark:text-slate-300">Start with a common one:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <SecondaryButton key={s.label} size="compact" icon={<Plus className="w-4 h-4" />} onClick={() => add(s)}>
                  {s.per_month} {s.label.toLowerCase()} a month
                </SecondaryButton>
              ))}
            </div>
          </div>
        )}

        {drafts?.map((d, i) => (
          <fieldset key={i} className="rounded-lg border border-slate-300 dark:border-slate-600 p-4 space-y-3">
            <legend className="sr-only">Requirement {i + 1}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input w-20" type="number" min={1} max={PERIOD_MAX[d.period]} aria-label={`How many per ${d.period}`}
                value={d.per_month} onChange={e => update(i, { per_month: e.target.value })} />
              <input className="input flex-1 min-w-48" aria-label="Name" placeholder="e.g. Face-to-face visit"
                value={d.label} onChange={e => update(i, { label: e.target.value })} />
              <select className="input w-auto" aria-label="How often" value={d.period} onChange={e => update(i, { period: e.target.value as Period })}>
                {PERIODS.map(p => <option key={p} value={p}>a {p}</option>)}
              </select>
              <button type="button" aria-label={`Remove ${d.label || 'requirement'}`} onClick={() => setDrafts(ds => ds!.filter((_, j) => j !== i))}
                className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4">
              <span className="text-sm text-slate-600 dark:text-slate-300">Counts these {t('activity', { many: true })}:</span>
              {activity.all.filter(type => !type.is_archived || d.note_types.includes(type.key)).map(type => (
                <label key={type.key} className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" className="w-5 h-5" checked={d.note_types.includes(type.key)}
                    onChange={() => update(i, { note_types: d.note_types.includes(type.key) ? d.note_types.filter(x => x !== type.key) : [...d.note_types, type.key] })} />
                  {type.is_archived ? `${type.label} (archived)` : type.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        {/* Always a way in, even with no suggestions (a starter can archive the built-in note types) */}
        {drafts && drafts.length < 10 && (
          <SecondaryButton size="compact" icon={<Plus className="w-4 h-4" />} onClick={() => add()}>
            {drafts.length > 0 ? 'Add another' : `Add ${t('requirement', { article: true })}`}
          </SecondaryButton>
        )}
        {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </Dialog>
  )
}
