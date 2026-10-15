/**
 * contactsStore.test.ts — Zustand contacts store unit tests.
 * Mocks window.api.invoke for all IPC calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn() }) }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useContactsStore } from '../../../src/renderer/stores/contactsStore'
import type { Provider, ProviderInteraction } from '../../../src/shared/types'
import { setWords } from '../vocabFixture'

function makeProvider(id: number, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    category_id: null,
    name: `Provider ${id}`,
    org_name: null,
    title: null,
    phone_main: null,
    phone_direct: null,
    phone_fax: null,
    phone_cell: null,
    phone_after_hours: null,
    email: null,
    website: null,
    address: null,
    hours: null,
    languages: null,
    availability_status: 'unknown',
    availability_notes: null,
    availability_checked_at: null,
    referral_process: null,
    notes: null,
    is_starred: 0,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

function makeInteraction(id: number, providerId: number, overrides: Partial<ProviderInteraction> = {}): ProviderInteraction {
  return {
    id,
    provider_id: providerId,
    created_at: '2026-01-01T00:00:00',
    contact_type: 'call',
    content: `Interaction ${id}`,
    ...overrides,
  }
}

describe('contactsStore', () => {
  beforeEach(() => {
    setWords()
    mockInvoke.mockReset()
    // Reset store state
    useContactsStore.setState({
      providers: [],
      categories: [],
      selectedProviderId: null,
      selectedProvider: null,
      interactions: [],
      clientLinks: [],
      customFields: [],
      loading: false,
      initialLoadDone: false,
      _loadVersion: 0,
      viewMode: 'cards',
      filterParams: {},
    })
  })

  it('loadProviders populates providers list', async () => {
    const providers = [makeProvider(1), makeProvider(2)]
    mockInvoke.mockResolvedValue({ ok: true, data: providers })

    await act(async () => {
      await useContactsStore.getState().loadProviders()
    })

    expect(useContactsStore.getState().providers).toHaveLength(2)
    expect(useContactsStore.getState().providers[0].name).toBe('Provider 1')
    expect(useContactsStore.getState().initialLoadDone).toBe(true)
    expect(useContactsStore.getState().loading).toBe(false)
  })

  it('createProvider adds to state and calls IPC', async () => {
    const created = makeProvider(10, { name: 'New Provider' })
    // First call: CONTACTS_CREATE, second call: CONTACTS_GET_ALL (loadProviders)
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: created })
      .mockResolvedValueOnce({ ok: true, data: [created] })

    await act(async () => {
      const result = await useContactsStore.getState().createProvider({ name: 'New Provider' })
      expect(result).not.toBeNull()
      expect(result!.name).toBe('New Provider')
    })

    expect(mockInvoke).toHaveBeenCalledWith('contacts:create', { name: 'New Provider' })
    expect(useContactsStore.getState().providers).toHaveLength(1)
  })

  it('updateProvider updates in state', async () => {
    const p1 = makeProvider(1, { name: 'Old Name' })
    useContactsStore.setState({ providers: [p1] })

    // CONTACTS_UPDATE, then CONTACTS_GET_ALL (loadProviders)
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockResolvedValueOnce({ ok: true, data: [makeProvider(1, { name: 'New Name' })] })

    await act(async () => {
      await useContactsStore.getState().updateProvider(1, { name: 'New Name' })
    })

    expect(mockInvoke).toHaveBeenCalledWith('contacts:update', 1, { name: 'New Name' })
    expect(useContactsStore.getState().providers[0].name).toBe('New Name')
  })

  it('deleteProvider removes from state and shows the Undo toast (E-14)', async () => {
    const { useUndoStore } = await import('../../../src/renderer/stores/undoStore')
    const p1 = makeProvider(1, { name: 'To Delete' })
    useContactsStore.setState({ providers: [p1] })

    // Snapshot: CONTACTS_GET_ONE, CONTACTS_GET_CUSTOM_VALUES, CONTACTS_GET_INTERACTIONS,
    // CONTACTS_GET_CLIENT_LINKS; then CONTACTS_DELETE, then CONTACTS_GET_ALL (returns empty)
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: p1 })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockResolvedValueOnce({ ok: true, data: [] })

    await act(async () => {
      await useContactsStore.getState().deleteProvider(1)
    })

    expect(useContactsStore.getState().providers).toHaveLength(0)
    // The standard Undo toast (it has an Undo button), not a plain "Press Ctrl+Z" message
    expect(useUndoStore.getState().toast?.description).toBe('Deleted provider "To Delete". It doesn\'t go to the Trash.')
  })

  it('deleteProvider clears selection when deleting selected provider', async () => {
    const p1 = makeProvider(1)
    useContactsStore.setState({ providers: [p1], selectedProviderId: 1, selectedProvider: p1 })

    // CONTACTS_GET_ONE, CONTACTS_GET_CUSTOM_VALUES, CONTACTS_GET_INTERACTIONS, CONTACTS_GET_CLIENT_LINKS,
    // CONTACTS_DELETE, CONTACTS_GET_ALL
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: p1 })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockResolvedValueOnce({ ok: true, data: [] })

    await act(async () => {
      await useContactsStore.getState().deleteProvider(1)
    })

    expect(useContactsStore.getState().selectedProviderId).toBeNull()
    expect(useContactsStore.getState().selectedProvider).toBeNull()
  })

  it('setFilterParams filters by category', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [makeProvider(1, { category_id: 5 })] })

    await act(async () => {
      useContactsStore.getState().setFilterParams({ categoryId: 5 })
    })

    // Wait for async loadProviders triggered by setFilterParams
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('contacts:get-all', { categoryId: 5 })
    })
  })

  it('setFilterParams filters by search text', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    await act(async () => {
      useContactsStore.getState().setFilterParams({ search: 'clinic' })
    })

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('contacts:get-all', { search: 'clinic' })
    })
  })

  it('toggleStar updates provider optimistically and calls IPC', async () => {
    const p1 = makeProvider(1, { is_starred: 0 })
    useContactsStore.setState({ providers: [p1] })

    mockInvoke.mockResolvedValue({ ok: true, data: true })

    await act(async () => {
      await useContactsStore.getState().toggleStar(1)
    })

    // Optimistic update should have toggled to 1
    expect(useContactsStore.getState().providers[0].is_starred).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith('contacts:update', 1, { is_starred: 1 })
  })

  it('toggleStar rolls back on IPC failure', async () => {
    const p1 = makeProvider(1, { is_starred: 0 })
    useContactsStore.setState({ providers: [p1] })

    mockInvoke.mockResolvedValue({ ok: false, error: 'DB error' })

    await act(async () => {
      await useContactsStore.getState().toggleStar(1)
    })

    // Should have rolled back to 0
    expect(useContactsStore.getState().providers[0].is_starred).toBe(0)
  })

  it('loadInteractions populates interaction log', async () => {
    const interactions = [makeInteraction(1, 5), makeInteraction(2, 5)]
    mockInvoke.mockResolvedValue({ ok: true, data: interactions })

    await act(async () => {
      await useContactsStore.getState().loadInteractions(5)
    })

    expect(useContactsStore.getState().interactions).toHaveLength(2)
    expect(useContactsStore.getState().interactions[0].content).toBe('Interaction 1')
    expect(mockInvoke).toHaveBeenCalledWith('contacts:get-interactions', 5)
  })

  it('selectProvider updates selection', async () => {
    const p1 = makeProvider(1, { name: 'Selected' })
    mockInvoke.mockResolvedValue({ ok: true, data: p1 })

    await act(async () => {
      await useContactsStore.getState().selectProvider(1)
    })

    expect(useContactsStore.getState().selectedProviderId).toBe(1)
    expect(useContactsStore.getState().selectedProvider?.name).toBe('Selected')
  })

  it('selectProvider(null) clears selection', async () => {
    useContactsStore.setState({ selectedProviderId: 1, selectedProvider: makeProvider(1) })

    await act(async () => {
      await useContactsStore.getState().selectProvider(null)
    })

    expect(useContactsStore.getState().selectedProviderId).toBeNull()
    expect(useContactsStore.getState().selectedProvider).toBeNull()
    expect(useContactsStore.getState().interactions).toEqual([])
  })
})
