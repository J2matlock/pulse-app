/**
 * Appointment changes from the window (W07), each one undo step: creating,
 * editing and deleting (put back from main's snapshot), and marking done,
 * no-show or cancelled (the note voided and moved dates put back).
 */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { Appointment, ApptInput, ApptPatch, ApptStatus, EditScope, SeriesRule } from '../../shared/appointments'
import type { NoteDateUpdate, NoteDateRevert } from '../../shared/types'
import { safeInvoke } from './safeInvoke'
import { useUndoStore } from '../stores/undoStore'

interface ApptChange { snapshot: unknown; ids: number[] }
interface StatusChange { previous: ApptStatus; caseLogId: number | null; voidedNoteId: number | null; updatedDates: NoteDateUpdate[]; revertedDates?: NoteDateRevert[]; rowId: number | null }

export interface StatusOptions { noteContent?: string; minutes?: number | null; miles?: number | null; extra?: Record<string, number> | null }

function push(description: string, undo: () => Promise<void>, redo: () => Promise<void>): void {
  useUndoStore.getState().pushWithToast({ id: crypto.randomUUID(), description, timestamp: Date.now(), category: 'logged', icon: 'calendar', undo, redo })
}

const restore = (snapshot: unknown) => safeInvoke(IPC.APPT_RESTORE, snapshot).then(() => undefined)

export async function createAppointment(input: ApptInput, rule?: SeriesRule | null): Promise<number[] | null> {
  const res = await safeInvoke<ApptChange>(IPC.APPT_CREATE, input, rule ?? null)
  if (!res.ok) { toast.error(res.error); return null }
  let snap = res.data.snapshot
  push(rule ? `Scheduled "${input.title}" (repeating)` : `Scheduled "${input.title}"`,
    () => restore(snap),
    async () => { const again = await safeInvoke<ApptChange>(IPC.APPT_CREATE, input, rule ?? null); if (again.ok) snap = again.data.snapshot })
  return res.data.ids
}

export async function updateAppointment(a: Appointment, patch: ApptPatch, scope: EditScope = 'one'): Promise<boolean> {
  const res = await safeInvoke<ApptChange>(IPC.APPT_UPDATE, a.id, patch, scope)
  if (!res.ok) { toast.error(res.error); return false }
  let snap = res.data.snapshot
  push(`Changed "${a.title}"`, () => restore(snap),
    async () => { const again = await safeInvoke<ApptChange>(IPC.APPT_UPDATE, a.id, patch, scope); if (again.ok) snap = again.data.snapshot })
  return true
}

export async function deleteAppointment(a: Appointment, scope: EditScope = 'one'): Promise<boolean> {
  const res = await safeInvoke<ApptChange>(IPC.APPT_DELETE, a.id, scope)
  if (!res.ok) { toast.error(res.error); return false }
  let snap = res.data.snapshot
  push(`Deleted "${a.title}"`, () => restore(snap),
    async () => { const again = await safeInvoke<ApptChange>(IPC.APPT_DELETE, a.id, scope); if (again.ok) snap = again.data.snapshot })
  return true
}

const STATUS_WORDS: Record<ApptStatus, string> = { scheduled: 'scheduled', done: 'done', no_show: 'a no-show', cancelled: 'cancelled' }

export async function setAppointmentStatus(a: Appointment, status: ApptStatus, opts: StatusOptions = {}): Promise<boolean> {
  const res = await safeInvoke<StatusChange>(IPC.APPT_SET_STATUS, a.id, status, opts)
  if (!res.ok) { toast.error(res.error); return false }
  let change = res.data
  if (change.previous === status) return false
  if (change.revertedDates?.length) toast.success(`Also set ${change.revertedDates.map(d => d.column_name).join(', ')} back`, { id: 'note-dates' })
  push(`Marked "${a.title}" ${STATUS_WORDS[status]}`,
    // Going back voids the note this made, which puts back the dates it moved (main does that)
    async () => { await safeInvoke(IPC.APPT_SET_STATUS, a.id, change.previous) },
    async () => { const again = await safeInvoke<StatusChange>(IPC.APPT_SET_STATUS, a.id, status, opts); if (again.ok) change = again.data })
  return true
}
