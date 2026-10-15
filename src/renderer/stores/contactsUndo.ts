import { IPC } from '../../shared/ipc-channels'
import { rlog } from '../utils/rendererLogger'
import { useUndoStore, type SideEffect, type UndoCategory } from './undoStore'
import { storeInvoke } from '../utils/safeInvoke'
import type { Provider, ProviderInteraction, ProviderClientLink } from '../../shared/types'

// Undo steps for the contact directory: snapshots of a whole contact and the
// id a deleted contact came back under, so older steps still find it.

export function pushContactUndo(
  description: string,
  icon: string,
  undoFn: () => Promise<void>,
  redoFn: () => Promise<void>,
  opts?: { category?: UndoCategory; sideEffects?: SideEffect[]; toast?: boolean }
) {
  // toast: the standard Undo toast (with its button), for steps that can't be seen being undone otherwise
  const store = useUndoStore.getState()
  ;(opts?.toast ? store.pushWithToast : store.push)({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    description,
    icon,
    category: opts?.category ?? 'logged',
    undo: undoFn,
    redo: redoFn,
    sideEffects: opts?.sideEffects,
  })
}

// Every saved contact field, so an undo snapshot and its restore cover them all.
const PROVIDER_FIELDS = [
  'category_id', 'name', 'org_name', 'title',
  'phone_main', 'phone_direct', 'phone_fax', 'phone_cell', 'phone_after_hours',
  'email', 'website', 'address', 'hours', 'languages',
  'availability_status', 'availability_notes', 'availability_checked_at',
  'referral_process', 'notes', 'is_starred',
] as const

export interface ProviderSnapshot {
  fields: Partial<Provider>
  tags: string[]
  customValues: Array<{ custom_field_id: number; value: string }>
  interactions: Array<{ contact_type: string; content: string; created_at?: string }>
  links: Array<{ row_id: number; grid_id: number; notes?: string | null }>
}

export function pickProviderFields(p: Partial<Provider>): Partial<Provider> {
  const out: Record<string, unknown> = {}
  for (const k of PROVIDER_FIELDS) {
    const v = p[k]
    if (v !== undefined) out[k] = v
  }
  return out as Partial<Provider>
}

/** The whole contact as saved: every field, tags, custom fields, log and linked records. */
export async function snapshotProvider(id: number): Promise<ProviderSnapshot> {
  const full = await storeInvoke<Provider>(IPC.CONTACTS_GET_ONE, id)
  const customValues = await storeInvoke<Array<{ custom_field_id: number; value: string }>>(IPC.CONTACTS_GET_CUSTOM_VALUES, id)
  const interactions = await storeInvoke<ProviderInteraction[]>(IPC.CONTACTS_GET_INTERACTIONS, id)
  const links = await storeInvoke<ProviderClientLink[]>(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId: id })
  return {
    fields: pickProviderFields(full),
    tags: full.tags ?? [],
    customValues: customValues ?? [],
    interactions: (interactions ?? []).map(i => ({ contact_type: i.contact_type, content: i.content, created_at: i.created_at })),
    links: (links ?? []).map(l => ({ row_id: l.row_id, grid_id: l.grid_id, notes: l.notes })),
  }
}

// Undoing a delete makes the contact again under a new id. Older undo steps still hold the old one,
// so they look it up here first (Q-046): old id → the id it came back as (followed in a chain).
const _contactIdNow = new Map<number, number>()
// Only undo steps read it, so it goes when they do (lock, restore, a cleared stack)
useUndoStore.subscribe(s => { if (!s.undoStack.length && !s.redoStack.length) _contactIdNow.clear() })
export function liveContactId(id: number): number {
  let current = id
  for (let hops = 0; hops < 100 && _contactIdNow.has(current); hops++) current = _contactIdNow.get(current)!
  return current
}

/** Makes the contact `oldId` again from a snapshot and returns its new id. A failure throws, so Undo says so. */
export async function restoreProvider(snapshot: ProviderSnapshot, oldId: number): Promise<number> {
  let newId: number
  try {
    const created = await storeInvoke<{ id: number }>(IPC.CONTACTS_CREATE, snapshot.fields)
    newId = created.id
  } catch (err) {
    rlog.error('contactsStore', 'restoreProvider failed', err)
    throw err
  }
  if (newId !== oldId) _contactIdNow.set(oldId, newId)
  for (const tag of snapshot.tags) {
    try { await storeInvoke(IPC.CONTACTS_ADD_TAG, newId, tag) } catch (err) { rlog.error('contactsStore', 'undo restore tag failed', err) }
  }
  for (const v of snapshot.customValues) {
    try { await storeInvoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, newId, v.custom_field_id, v.value) } catch (err) { rlog.error('contactsStore', 'undo restore custom value failed', err) }
  }
  for (const inter of snapshot.interactions) {
    try { await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, newId, inter.contact_type, inter.content, inter.created_at) } catch (err) { rlog.error('contactsStore', 'undo restore interaction failed', err) }
  }
  for (const link of snapshot.links) {
    try { await storeInvoke(IPC.CONTACTS_LINK_CLIENT, newId, link.row_id, link.grid_id, link.notes ?? undefined) } catch (err) { rlog.error('contactsStore', 'undo restore client link failed', err) }
  }
  return newId
}
