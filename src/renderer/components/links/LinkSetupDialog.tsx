/**
 * "Link to another list" (W04 §7.1): pick the other list, name both sides,
 * say how many each can have, and add the columns. In edit mode it renames
 * a link, changes how many each side can have, or removes it.
 */
import React, { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Cardinality, LinkType } from '../../../shared/links'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { DangerButton, PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab, useVocabByList } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { useLinkStore } from '../../stores/linkStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { friendlyError } from '../../utils/friendlyError'

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'

type Props =
  | { mode: 'create'; gridId: number; onClose: () => void }
  | { mode: 'edit'; type: LinkType; onClose: () => void }

async function afterChange(): Promise<void> {
  await useLinkStore.getState().load()
  const gridId = useGridStore.getState().activeGridId
  if (gridId) await useGridStore.getState().loadGrid(gridId)
}

export function LinkSetupDialog(props: Props): React.ReactElement {
  const grids = useGridStore(s => s.grids)
  const { t } = useVocab(null)
  const wordsFor = useVocabByList()
  const editing = props.mode === 'edit' ? props.type : null
  const thisGridId = editing ? editing.from_grid_id : (props as { gridId: number }).gridId
  const [targetId, setTargetId] = useState<number | null>(editing?.to_grid_id ?? grids.find(g => g.id !== thisGridId)?.id ?? null)
  const [forward, setForward] = useState(editing?.label_forward ?? '')
  const [backward, setBackward] = useState(editing?.label_backward ?? '')
  const [touched, setTouched] = useState({ forward: !!editing, backward: !!editing })
  const [cardinality, setCardinality] = useState<Cardinality>(editing?.cardinality ?? 'many_to_one')
  const [showOnOther, setShowOnOther] = useState(true)
  const [logChanges, setLogChanges] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const thisWords = wordsFor(thisGridId)
  const targetWords = wordsFor(targetId)
  const thisName = grids.find(g => g.id === thisGridId)?.name ?? editing?.from_grid_name ?? ''
  const targetName = grids.find(g => g.id === targetId)?.name ?? editing?.to_grid_name ?? ''

  // Suggested names follow the chosen list until someone types their own
  const suggestForward = targetWords('record', { cap: true })
  const suggestBackward = thisWords('record', { many: true, cap: true })
  useEffect(() => {
    if (!touched.forward) setForward(suggestForward)
    if (!touched.backward) setBackward(suggestBackward)
  }, [suggestForward, suggestBackward, touched])

  const one = thisWords('record'), many = thisWords('record', { many: true })
  const tOne = targetWords('record'), tMany = targetWords('record', { many: true })
  const choices: Array<{ value: Cardinality; text: string }> = [
    { value: 'many_to_one', text: `Each ${one} has one ${tOne}; ${targetWords('record', { article: true })} can have several ${many}` },
    { value: 'many_to_many', text: `Each ${one} can have several ${tMany}, and each ${tOne} several ${many}` },
    { value: 'one_to_one', text: `Each ${one} has one ${tOne}, and each ${tOne} one ${one}` },
  ]

  async function save() {
    if (!targetId || !forward.trim() || !backward.trim()) return
    setSaving(true)
    try {
      const input = { from_grid_id: thisGridId, to_grid_id: targetId, label_forward: forward, label_backward: backward, cardinality }
      const res = editing
        ? await safeInvoke(IPC.LINK_TYPE_SAVE, { ...input, id: editing.id, to_grid_id: editing.to_grid_id })
        : await safeInvoke(IPC.LINK_SETUP, input, { showOnOther, logChanges })
      if (!res.ok) { toast.error(friendlyError(res.error)); return }
      await afterChange()
      props.onClose()
    } finally { setSaving(false) }
  }

  async function askDelete() {
    if (!editing) return
    const res = await safeInvoke<number>(IPC.LINK_TYPE_COUNT, editing.id)
    setConfirmDelete(res.ok ? res.data : 0)
  }

  async function remove() {
    if (!editing) return
    const res = await safeInvoke(IPC.LINK_TYPE_DELETE, editing.id)
    setConfirmDelete(null)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    await afterChange()
    props.onClose()
  }

  return (
    <>
    <Dialog open onClose={props.onClose} size="lg" title={editing ? 'Link settings' : `Link to another ${t('list')}`}
      icon={<Link2 className="w-5 h-5 mt-3 text-slate-700 dark:text-slate-200" aria-hidden="true" />}
      footer={<>
        {editing && <DangerButton className="mr-auto" onClick={() => void askDelete()}>Remove this link…</DangerButton>}
        <SecondaryButton onClick={props.onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={saving || !targetId || !forward.trim() || !backward.trim()} onClick={() => void save()}>
          {editing ? 'Save' : 'Add link'}
        </PrimaryButton>
      </>}>
      <div className="space-y-4">
        {editing ? (
          <p className="text-base text-slate-600 dark:text-slate-300">Between {editing.from_grid_name} and {editing.to_grid_name}.</p>
        ) : (
          <label className="block">
            <span className={label}>Link {thisName} to</span>
            <select className="input w-full" value={targetId ?? ''} onChange={e => setTargetId(Number(e.target.value) || null)}>
              {grids.map(g => <option key={g.id} value={g.id}>{g.id === thisGridId ? `${g.name} (this ${t('list')})` : g.name}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Name on {thisName}</span>
            <input className="input w-full" maxLength={60} value={forward} onChange={e => { setForward(e.target.value); setTouched(x => ({ ...x, forward: true })) }} />
          </label>
          <label className="block">
            <span className={label}>Name on {targetName}</span>
            <input className="input w-full" maxLength={60} value={backward} onChange={e => { setBackward(e.target.value); setTouched(x => ({ ...x, backward: true })) }} />
          </label>
        </div>

        <fieldset>
          <legend className={label}>How many can each have?</legend>
          {choices.map(c => (
            <label key={c.value} className="flex items-start gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer py-1" style={{ minHeight: 44 }}>
              <input type="radio" name="link-cardinality" className="mt-1 w-5 h-5 flex-shrink-0" checked={cardinality === c.value} onChange={() => setCardinality(c.value)} />
              {c.text}
            </label>
          ))}
        </fieldset>

        {!editing && (
          <div>
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
              <input type="checkbox" className="w-5 h-5" checked={showOnOther} onChange={e => setShowOnOther(e.target.checked)} />
              Also show it as a column on {targetName}
            </label>
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
              <input type="checkbox" className="w-5 h-5" checked={logChanges} onChange={e => setLogChanges(e.target.checked)} />
              Write {t('activity', { article: true })} on both when links change
            </label>
          </div>
        )}
      </div>
    </Dialog>

      {editing && (
        <ConfirmDialog open={confirmDelete !== null} destructive title="Remove this link?"
          message={`This removes ${confirmDelete ?? 0} link${confirmDelete === 1 ? '' : 's'} between ${editing.from_grid_name} and ${editing.to_grid_name}, and the columns that show them. The audit trail keeps the history.`}
          confirmLabel="Remove link" onConfirm={() => void remove()} onCancel={() => setConfirmDelete(null)} />
      )}
    </>
  )
}
