/**
 * Settings → Notes → "Kinds of notes": add, rename, recolor, reorder,
 * archive and delete note types (plans/generalization/W03-activity.md §2.6).
 * Renaming changes the label on old notes too; the stored key never changes.
 */
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { GripVertical, Plus } from 'lucide-react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IPC } from '../../../shared/ipc-channels'
import { ACTIVITY_COLORS, ACTIVITY_LABEL_MAX, type ActivityColor, type ActivityType } from '../../../shared/activityTypes'
import { safeInvoke } from '../../utils/safeInvoke'
import { useActivityTypes, ACTIVITY_SWATCH } from '../../hooks/useActivityTypes'
import { useActivityTypeStore } from '../../stores/activityTypeStore'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'

const COLOR_NAMES: Record<ActivityColor, string> = {
  slate: 'Gray', blue: 'Blue', green: 'Green', purple: 'Purple', orange: 'Orange', teal: 'Teal', amber: 'Yellow', red: 'Red',
}

/** Run a change, then refresh the shared list; problems come back as plain messages. */
async function run(channel: Parameters<typeof safeInvoke>[0], ...args: unknown[]): Promise<boolean> {
  const res = await safeInvoke(channel, ...args)
  if (!res.ok) { toast.error(friendlyError(res.error)); return false }
  await useActivityTypeStore.getState().load()
  return true
}

function TypeRow({ type, onlyOne }: { type: ActivityType; onlyOne: boolean }): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: type.id })
  const [label, setLabel] = useState(type.label)
  const [icon, setIcon] = useState(type.icon ?? '')

  async function save(patch: { label?: string; icon?: string; color?: ActivityColor | null }) {
    const next = { label: patch.label ?? type.label, icon: patch.icon ?? type.icon ?? '', color: patch.color !== undefined ? patch.color : type.color }
    const ok = await run(IPC.ACTIVITY_TYPE_SAVE, { id: type.id, ...next })
    if (!ok) { setLabel(type.label); setIcon(type.icon ?? '') }
  }

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <button type="button" {...attributes} {...listeners} aria-label={`Move ${type.label}`} title="Drag to reorder (or use the arrow keys)"
        className="hit-44 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab touch-none focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
        <GripVertical className="w-4 h-4" />
      </button>
      <input className="input w-14 text-center" aria-label={`Icon for ${type.label}`} maxLength={8} placeholder="🙂"
        value={icon} onChange={e => setIcon(e.target.value)}
        onBlur={() => { if (icon !== (type.icon ?? '')) void save({ icon }) }} />
      <input className="input flex-1 min-w-40" aria-label={`Name of ${type.label}`} maxLength={ACTIVITY_LABEL_MAX}
        value={label} onChange={e => setLabel(e.target.value)}
        onBlur={() => { if (label.trim() !== type.label) void save({ label }) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <div className="flex items-center" role="radiogroup" aria-label={`Color for ${type.label}`}>
        {ACTIVITY_COLORS.map(c => (
          <button key={c} type="button" role="radio" aria-checked={type.color === c} aria-label={COLOR_NAMES[c]}
            onClick={() => void save({ color: c })}
            className="hit-44 w-8 h-8 flex items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <span className={`block w-5 h-5 rounded-full ${ACTIVITY_SWATCH[c]} ${type.color === c ? 'ring-3 ring-offset-2 ring-slate-700 dark:ring-slate-200 dark:ring-offset-slate-800' : ''}`} />
          </button>
        ))}
      </div>
      <button type="button" className="btn-compact-secondary" disabled={onlyOne}
        title={onlyOne ? 'Keep at least one type' : 'Hide from new notes; old notes keep it'}
        onClick={() => void run(IPC.ACTIVITY_TYPE_ARCHIVE, type.id, true)}>
        Archive
      </button>
      <button type="button" className="btn-compact-secondary" disabled={onlyOne}
        title="Only types no note uses can be deleted"
        onClick={() => void run(IPC.ACTIVITY_TYPE_DELETE, type.id)}>
        Delete
      </button>
    </li>
  )
}

export function ActivityTypesEditor(): React.ReactElement {
  const { t } = useVocab(null)
  const { active, all } = useActivityTypes()
  const archived = all.filter(type => type.is_archived)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active: dragged, over } = e
    if (!over || dragged.id === over.id) return
    const from = active.findIndex(type => type.id === dragged.id)
    const to = active.findIndex(type => type.id === over.id)
    const order = arrayMove(active, from, to)
    // Show the new order straight away; archived types keep their places after
    useActivityTypeStore.setState(s => ({
      types: [...order.map((type, i) => ({ ...type, position: i })), ...s.types.filter(type => type.is_archived)],
    }))
    void run(IPC.ACTIVITY_TYPE_REORDER, [...order.map(type => type.id), ...archived.map(type => type.id)])
  }

  async function add() {
    if (!newLabel.trim()) return
    setAdding(true)
    try {
      if (await run(IPC.ACTIVITY_TYPE_SAVE, { label: newLabel, color: ACTIVITY_COLORS[active.length % ACTIVITY_COLORS.length] })) setNewLabel('')
    } finally {
      setAdding(false)
    }
  }

  // Real types have positive ids; the stand-ins shown before loading can't be edited
  const loaded = all.every(type => type.id > 0)

  return (
    <section className="space-y-3" aria-labelledby="note-kinds-heading">
      <h2 id="note-kinds-heading" className="text-xl font-semibold text-slate-800 dark:text-slate-100">Kinds of {t('activity', { many: true })}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        The choices above the {t('activity')} box, like Visit or Phone. Renaming one changes it on older {t('activity', { many: true })} too.
      </p>
      {!loaded ? (
        <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={active.map(type => type.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {active.map(type => <TypeRow key={`${type.id}-${type.label}-${type.icon}`} type={type} onlyOne={active.length <= 1} />)}
              </ul>
            </SortableContext>
          </DndContext>

          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1 min-w-48" aria-label="New kind" placeholder="e.g. No-show" maxLength={ACTIVITY_LABEL_MAX}
              value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add() } }} />
            <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={adding || !newLabel.trim()} onClick={() => void add()}>
              <Plus className="w-4 h-4" aria-hidden="true" />Add a kind
            </button>
          </div>

          {archived.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-base text-slate-700 dark:text-slate-200" style={{ minHeight: 44, lineHeight: '44px' }}>
                Archived ({archived.length})
              </summary>
              <ul className="space-y-2 mt-2">
                {archived.map(type => (
                  <li key={type.id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span aria-hidden>{type.icon}</span>
                    <span className="flex-1 text-base text-slate-600 dark:text-slate-300">{type.label}</span>
                    <button type="button" className="btn-compact-secondary" onClick={() => void run(IPC.ACTIVITY_TYPE_ARCHIVE, type.id, false)}>Restore</button>
                    <button type="button" className="btn-compact-secondary" title="Only types no note uses can be deleted"
                      onClick={() => void run(IPC.ACTIVITY_TYPE_DELETE, type.id)}>Delete</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}
