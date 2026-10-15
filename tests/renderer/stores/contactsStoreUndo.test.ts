/**
 * contactsStoreUndo.test.ts — undo/redo and save failures in the contacts store,
 * against a small in-memory fake of the CONTACTS_* handlers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useContactsStore } from '../../../src/renderer/stores/contactsStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { Provider } from '../../../src/shared/types'
import { setWords } from '../vocabFixture'

// ── Fake backend ────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: number; name: string }
let rows: Map<number, Row>
let tags: Map<number, string[]>
let customValues: Map<number, Array<{ custom_field_id: number; value: string }>>
let nextId: number
let failNext: string | null

const LIST_COLS = ['id', 'name', 'org_name', 'title', 'phone_main', 'email', 'category_id', 'is_starred']

function full(id: number): Provider | undefined {
  const r = rows.get(id)
  return r ? ({ ...r, tags: [...(tags.get(id) ?? [])] } as unknown as Provider) : undefined
}

function handle(channel: string, ...args: unknown[]): { ok: boolean; data?: unknown; error?: string } {
  if (failNext === channel) { failNext = null; return { ok: false, error: 'Something went wrong' } }
  switch (channel) {
    case 'contacts:get-all':
      // Like the real list query: only a few columns
      return { ok: true, data: [...rows.values()].map(r => Object.fromEntries(LIST_COLS.map(c => [c, r[c] ?? null]))) }
    case 'contacts:get-one': {
      const p = full(args[0] as number)
      return p ? { ok: true, data: p } : { ok: false, error: 'gone' }
    }
    case 'contacts:create': {
      const id = nextId++
      const data = args[0] as Record<string, unknown>
      rows.set(id, { ...data, id, name: data.name as string })
      return { ok: true, data: full(id) }
    }
    case 'contacts:update': {
      // Like the real handler: an id that's gone updates nothing and still answers ok
      const r = rows.get(args[0] as number)
      if (!r) return { ok: true, data: true }
      for (const [k, v] of Object.entries(args[1] as Record<string, unknown>)) if (v !== undefined) r[k] = v
      return { ok: true, data: true }
    }
    case 'contacts:delete':
      rows.delete(args[0] as number); tags.delete(args[0] as number); customValues.delete(args[0] as number)
      return { ok: true, data: true }
    case 'contacts:add-tag': {
      const list = tags.get(args[0] as number) ?? []
      if (!list.includes(args[1] as string)) list.push(args[1] as string)
      tags.set(args[0] as number, list)
      return { ok: true, data: true }
    }
    case 'contacts:remove-tag':
      tags.set(args[0] as number, (tags.get(args[0] as number) ?? []).filter(t => t !== args[1]))
      return { ok: true, data: true }
    case 'contacts:get-custom-values':
      return { ok: true, data: customValues.get(args[0] as number) ?? [] }
    case 'contacts:save-custom-value': {
      const list = (customValues.get(args[0] as number) ?? []).filter(v => v.custom_field_id !== args[1])
      list.push({ custom_field_id: args[1] as number, value: args[2] as string })
      customValues.set(args[0] as number, list)
      return { ok: true, data: true }
    }
    case 'contacts:get-interactions':
    case 'contacts:get-client-links':
    case 'contacts:get-categories':
      return { ok: true, data: [] }
    default:
      return { ok: true, data: true }
  }
}

beforeEach(() => {
  setWords()
  rows = new Map(); tags = new Map(); customValues = new Map(); nextId = 1; failNext = null
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => handle(channel, ...args))
  useUndoStore.getState().clear()
  useContactsStore.setState({
    providers: [], categories: [], selectedProviderId: null, selectedProvider: null,
    interactions: [], clientLinks: [], customFields: [], loading: false,
    initialLoadDone: false, _loadVersion: 0, viewMode: 'cards', filterParams: {},
  })
})

function seed(data: Record<string, unknown>): number {
  const id = nextId++
  rows.set(id, { id, name: 'Dr. Full', ...data } as Row)
  return id
}

const undo = () => useUndoStore.getState().undo()
const redo = () => useUndoStore.getState().redo()

describe('contactsStore undo keeps every detail', () => {
  it('undoing a delete brings back fields the list rows lack, tags and custom fields', async () => {
    const id = seed({ phone_cell: '555-CELL', address: '1 Main St', notes: 'Call first', hours: '9-5' })
    tags.set(id, ['housing'])
    customValues.set(id, [{ custom_field_id: 7, value: 'NPI-123' }])
    await useContactsStore.getState().loadProviders()

    await useContactsStore.getState().deleteProvider(id)
    expect(rows.size).toBe(0)
    await undo()

    const [back] = [...rows.values()]
    expect(back).toMatchObject({ name: 'Dr. Full', phone_cell: '555-CELL', address: '1 Main St', notes: 'Call first', hours: '9-5' })
    expect(tags.get(back!.id)).toEqual(['housing'])
    expect(customValues.get(back!.id)).toEqual([{ custom_field_id: 7, value: 'NPI-123' }])
  })

  // E-14: the standard Undo toast (with its Undo button), not a "Press Ctrl+Z" message
  it('a delete shows the Undo toast', async () => {
    const id = seed({})
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().deleteProvider(id)
    expect(useUndoStore.getState().toast?.description).toBe('Deleted provider "Dr. Full"')
  })

  it('redo of a delete removes the contact undo brought back, not a look-alike', async () => {
    const id = seed({ email: 'same@x.org' })
    seed({ name: 'Dr. Full', email: 'same@x.org' }) // same name and email
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().deleteProvider(id)
    await undo()
    const restoredId = Math.max(...rows.keys())
    await redo()
    expect(rows.has(restoredId)).toBe(false)
    expect(rows.size).toBe(1)
  })

  it('steps older than a deleted-and-undone contact reach it under its new id (Q-046)', async () => {
    const id = seed({ phone_main: '555-0001' })
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().updateProvider(id, { phone_main: '555-9999' })
    await useContactsStore.getState().addTag(id, 'housing')
    await useContactsStore.getState().deleteProvider(id)
    await undo() // the contact comes back under a new id
    const [back] = [...rows.values()]
    expect(back!.id).not.toBe(id)
    expect(tags.get(back!.id)).toEqual(['housing'])
    await undo() // the tag
    expect(tags.get(back!.id)).toEqual([])
    await undo() // the phone
    expect(rows.get(back!.id)!.phone_main).toBe('555-0001')
    await redo()
    expect(rows.get(back!.id)!.phone_main).toBe('555-9999')
  })

  it('a delete undone twice (undo, redo, undo) still leads older steps to the contact (Q-046)', async () => {
    const id = seed({ phone_main: '555-0001' })
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().updateProvider(id, { phone_main: '555-9999' })
    await useContactsStore.getState().deleteProvider(id)
    await undo(); await redo(); await undo()
    expect(rows.size).toBe(1)
    await undo()
    expect([...rows.values()][0]!.phone_main).toBe('555-0001')
  })

  it('a failed undo of a delete says so and stays undoable (Q-046)', async () => {
    const id = seed({})
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().deleteProvider(id)
    failNext = 'contacts:create'
    await undo()
    expect(rows.size).toBe(0)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().toast?.description).toMatch(/^Undo didn't work|^Undo failed/)
  })

  it('undoing an edit restores a field that was empty and one the list rows lack', async () => {
    const id = seed({ address: '1 Main St', notes: null })
    await useContactsStore.getState().loadProviders()
    await useContactsStore.getState().updateProvider(id, { address: '2 New Rd', notes: 'Added later' })
    expect(rows.get(id)).toMatchObject({ address: '2 New Rd', notes: 'Added later' })
    await undo()
    expect(rows.get(id)!.address).toBe('1 Main St')
    expect(rows.get(id)!.notes).toBeNull()
  })

  it('undo after redo of a create deletes the re-created contact', async () => {
    const created = await useContactsStore.getState().createProvider({ name: 'New One' })
    tags.set(created.id, ['added-after'])
    await undo()
    expect(rows.size).toBe(0)
    await redo()
    expect(rows.size).toBe(1)
    const [again] = [...rows.values()]
    expect(again!.id).not.toBe(created.id)
    expect(tags.get(again!.id)).toEqual(['added-after'])
    await undo()
    expect(rows.size).toBe(0)
  })

  it('undoing a create closes the contact if it was open', async () => {
    const created = await useContactsStore.getState().createProvider({ name: 'Open Me' })
    await useContactsStore.getState().selectProvider(created.id)
    expect(useContactsStore.getState().selectedProvider?.name).toBe('Open Me')
    await undo()
    expect(useContactsStore.getState().selectedProviderId).toBeNull()
    expect(useContactsStore.getState().selectedProvider).toBeNull()
  })
})

describe('contactsStore save failures', () => {
  it('createProvider throws so the form can stay open', async () => {
    failNext = 'contacts:create'
    await expect(useContactsStore.getState().createProvider({ name: 'X' })).rejects.toThrow()
  })

  it('updateProvider throws so the form can stay open', async () => {
    const id = seed({})
    failNext = 'contacts:update'
    await expect(useContactsStore.getState().updateProvider(id, { name: 'Y' })).rejects.toThrow()
  })
})

describe('contactsStore tags and categories', () => {
  it('adding a tag the contact already has does nothing (no duplicate chip, no undo step)', async () => {
    const id = seed({})
    tags.set(id, ['urgent'])
    await useContactsStore.getState().selectProvider(id)
    await useContactsStore.getState().addTag(id, 'urgent')
    expect(useContactsStore.getState().selectedProvider?.tags).toEqual(['urgent'])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('deleting the category being filtered on clears that filter', async () => {
    useContactsStore.setState({ filterParams: { categoryId: 4, starred: true } })
    await useContactsStore.getState().deleteCategory(4)
    expect(useContactsStore.getState().filterParams).toEqual({ starred: true })
    const getAll = mockInvoke.mock.calls.filter(c => c[0] === 'contacts:get-all')
    expect(getAll.at(-1)![1]).toEqual({ starred: true })
  })

  it('renaming or recolouring a category reloads the contacts and the open contact', async () => {
    const id = seed({})
    await useContactsStore.getState().selectProvider(id)
    mockInvoke.mockClear()
    await useContactsStore.getState().updateCategory(3, { color: '#112233' })
    const channels = mockInvoke.mock.calls.map(c => c[0])
    expect(channels).toContain('contacts:get-all')
    expect(channels).toContain('contacts:get-one')
  })
})
