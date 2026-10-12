import { create } from 'zustand'
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { rlog } from '../utils/rendererLogger'
import { useUndoStore, type SideEffect, type UndoCategory } from './undoStore'
import { storeInvoke, ReadOnlyError } from '../utils/safeInvoke'
import { wordNow } from '../utils/vocab'
import { pulseEvents } from '../events'
import type {
  Provider,
  ProviderCategory,
  ProviderInteraction,
  ProviderClientLink,
  ProviderCustomField,
  ContactFilterParams,
} from '../../shared/types'
import { modHelp } from '../utils/keys'

type ViewMode = 'cards' | 'list'

interface ContactsStore {
  // State
  providers: Provider[]
  categories: ProviderCategory[]
  selectedProviderId: number | null
  selectedProvider: Provider | null
  interactions: ProviderInteraction[]
  clientLinks: ProviderClientLink[]
  customFields: ProviderCustomField[]
  loading: boolean
  initialLoadDone: boolean
  _loadVersion: number
  viewMode: ViewMode
  filterParams: ContactFilterParams

  // Actions
  loadProviders: () => Promise<void>
  loadCategories: () => Promise<void>
  selectProvider: (id: number | null) => Promise<void>
  /** Throws when the save fails, so the form can keep what was typed. */
  createProvider: (data: Partial<Provider>) => Promise<Provider>
  /** Throws when the save fails, so the form can keep what was typed. */
  updateProvider: (id: number, data: Partial<Provider>) => Promise<void>
  deleteProvider: (id: number) => Promise<void>
  toggleStar: (id: number) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  setFilterParams: (params: ContactFilterParams) => void

  // Category actions
  createCategory: (name: string, color: string) => Promise<ProviderCategory | null>
  updateCategory: (id: number, data: { name?: string; color?: string; position?: number }) => Promise<void>
  deleteCategory: (id: number) => Promise<void>

  // Tag actions
  addTag: (providerId: number, tag: string) => Promise<void>
  removeTag: (providerId: number, tag: string) => Promise<void>

  // Interaction actions
  loadInteractions: (providerId: number) => Promise<void>
  addInteraction: (providerId: number, contactType: string, content: string) => Promise<void>
  updateInteraction: (id: number, data: { content?: string; contact_type?: string }) => Promise<void>
  deleteInteraction: (id: number) => Promise<void>

  // Client link actions
  loadClientLinks: (params: { providerId?: number; rowId?: number }) => Promise<void>
  linkClient: (providerId: number, rowId: number, gridId: number, notes?: string) => Promise<void>
  unlinkClient: (linkId: number) => Promise<void>

  // Availability
  markAvailabilityChecked: (providerId: number) => Promise<void>

  // Custom fields
  loadCustomFields: (categoryId: number) => Promise<void>
  createCustomField: (categoryId: number, fieldName: string, fieldType: string) => Promise<void>
  deleteCustomField: (fieldId: number, categoryId: number) => Promise<void>
  saveCustomValue: (providerId: number, customFieldId: number, value: string | null) => Promise<void>
}

function pushContactUndo(
  description: string,
  icon: string,
  undoFn: () => Promise<void>,
  redoFn: () => Promise<void>,
  opts?: { category?: UndoCategory; sideEffects?: SideEffect[] }
) {
  useUndoStore.getState().push({
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

interface ProviderSnapshot {
  fields: Partial<Provider>
  tags: string[]
  customValues: Array<{ custom_field_id: number; value: string }>
  interactions: Array<{ contact_type: string; content: string; created_at?: string }>
  links: Array<{ row_id: number; grid_id: number; notes?: string | null }>
}

function pickProviderFields(p: Partial<Provider>): Partial<Provider> {
  const out: Record<string, unknown> = {}
  for (const k of PROVIDER_FIELDS) {
    const v = p[k]
    if (v !== undefined) out[k] = v
  }
  return out as Partial<Provider>
}

/** The whole contact as saved: every field, tags, custom fields, log and linked records. */
async function snapshotProvider(id: number): Promise<ProviderSnapshot> {
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
function liveContactId(id: number): number {
  let current = id
  for (let hops = 0; hops < 100 && _contactIdNow.has(current); hops++) current = _contactIdNow.get(current)!
  return current
}

/** Makes the contact `oldId` again from a snapshot and returns its new id. A failure throws, so Undo says so. */
async function restoreProvider(snapshot: ProviderSnapshot, oldId: number): Promise<number> {
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

/** After an undo or redo removes a contact: close it if it was open, and refresh the list. */
async function afterProviderRemoved(id: number): Promise<void> {
  const store = useContactsStore.getState()
  if (store.selectedProviderId === id) await store.selectProvider(null)
  await useContactsStore.getState().loadProviders()
}

export const useContactsStore = create<ContactsStore>((set, get) => ({
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

  loadProviders: async () => {
    const version = get()._loadVersion + 1
    set({ loading: true, _loadVersion: version })
    try {
      const data = await storeInvoke<Provider[]>(IPC.CONTACTS_GET_ALL, get().filterParams)
      // Discard stale response if another loadProviders was called while awaiting
      if (get()._loadVersion !== version) return
      set({ providers: data, loading: false, initialLoadDone: true })
    } catch (err) {
      rlog.error('contactsStore', 'loadProviders failed', err)
      // Only update loading state if this is still the current request
      if (get()._loadVersion === version) {
        set({ loading: false, initialLoadDone: true })
      }
    }
  },

  loadCategories: async () => {
    try {
      const data = await storeInvoke<ProviderCategory[]>(IPC.CONTACTS_GET_CATEGORIES)
      set({ categories: data })
    } catch (err) { rlog.error('contactsStore', 'loadCategories failed', err) }
  },

  selectProvider: async (id) => {
    if (id === null) {
      set({ selectedProviderId: null, selectedProvider: null, interactions: [], clientLinks: [] })
      return
    }
    set({ selectedProviderId: id })
    try {
      const data = await storeInvoke<Provider>(IPC.CONTACTS_GET_ONE, id)
      set({ selectedProvider: data })
    } catch (err) { rlog.error('contactsStore', 'selectProvider failed', err) }
  },

  createProvider: async (data) => {
    // A failure throws, so the form stays open with what was typed.
    const created = await storeInvoke<Provider>(IPC.CONTACTS_CREATE, data)
    await get().loadProviders()
    // Redo makes a new contact with a new id; undo must delete whichever is current.
    let currentId = created.id
    let snapshot: ProviderSnapshot | null = null
    pushContactUndo(
      `Created ${wordNow('contact', {}, null)} "${created.name}"`, 'plus',
      async () => {
        // Snapshot first, so redo also brings back tags and custom fields added after creating.
        currentId = liveContactId(currentId)
        snapshot = await snapshotProvider(currentId)
        await storeInvoke(IPC.CONTACTS_DELETE, currentId)
        await afterProviderRemoved(currentId)
      },
      async () => {
        currentId = await restoreProvider(snapshot ?? { fields: data, tags: [], customValues: [], interactions: [], links: [] }, currentId)
        await useContactsStore.getState().loadProviders()
      },
    )
    return created
  },

  updateProvider: async (id, data) => {
    // The list rows hold only a few columns, so the "before" values come from the full contact.
    let prev: Provider | undefined
    try {
      prev = await storeInvoke<Provider>(IPC.CONTACTS_GET_ONE, id)
    } catch (err) {
      rlog.error('contactsStore', 'updateProvider snapshot failed', err)
      prev = get().selectedProvider?.id === id ? get().selectedProvider ?? undefined : undefined
    }
    // A failure throws, so the form stays open with what was typed.
    await storeInvoke(IPC.CONTACTS_UPDATE, id, data)
    // Full reload when category changes (joined fields like category_name/color need refresh)
    // Otherwise optimistic patch is sufficient
    if ('category_id' in data) {
      await get().loadProviders()
    } else {
      set(state => ({
        providers: state.providers.map(p =>
          p.id === id ? { ...p, ...data } : p
        ),
      }))
    }
    if (get().selectedProviderId === id) {
      await get().selectProvider(id)
    }
    if (prev) {
      const before = prev
      // Explicit nulls: the server skips undefined, so an emptied field would never come back.
      const prevValues = Object.fromEntries(
        (Object.keys(data) as Array<keyof Provider>).map(k => [k, before[k] ?? null])
      ) as Partial<Provider>
      pushContactUndo(
        `Updated ${wordNow('contact', {}, null)} "${before.name}"`, 'edit',
        async () => {
          const now = liveContactId(id)
          await storeInvoke(IPC.CONTACTS_UPDATE, now, prevValues)
          await useContactsStore.getState().loadProviders()
          if (useContactsStore.getState().selectedProviderId === now) {
            await useContactsStore.getState().selectProvider(now)
          }
        },
        async () => {
          const now = liveContactId(id)
          await storeInvoke(IPC.CONTACTS_UPDATE, now, data)
          await useContactsStore.getState().loadProviders()
          if (useContactsStore.getState().selectedProviderId === now) {
            await useContactsStore.getState().selectProvider(now)
          }
        },
      )
    }
  },

  deleteProvider: async (id) => {
    const provider = get().providers.find(p => p.id === id)
      ?? (get().selectedProvider?.id === id ? get().selectedProvider : null)
    if (!provider) return

    // Snapshot the full contact (not the list row) BEFORE delete, so undo brings everything back
    let snapshot: ProviderSnapshot
    try {
      snapshot = await snapshotProvider(id)
    } catch (err) {
      rlog.error('contactsStore', 'deleteProvider snapshot failed', err)
      snapshot = { fields: pickProviderFields(provider), tags: provider.tags ?? [], customValues: [], interactions: [], links: [] }
    }

    try {
      await storeInvoke(IPC.CONTACTS_DELETE, id)
    } catch (err) { rlog.error('contactsStore', 'deleteProvider failed', err); return }
    if (get().selectedProviderId === id) {
      set({ selectedProviderId: null, selectedProvider: null })
    }
    await get().loadProviders()
    toast(`${wordNow('contact', { cap: true }, null)} deleted. Press ${modHelp('Ctrl+Z')} to undo.`, { duration: 5000 })

    // Undo makes a new contact; redo deletes that one, not a look-alike found by name.
    let currentId: number | null = null
    pushContactUndo(
      `Deleted ${wordNow('contact', {}, null)} "${provider.name}"`, 'trash',
      async () => {
        currentId = await restoreProvider(snapshot, currentId ?? id)
        await useContactsStore.getState().loadProviders()
      },
      async () => {
        if (currentId != null) {
          currentId = liveContactId(currentId)
          await storeInvoke(IPC.CONTACTS_DELETE, currentId)
          await afterProviderRemoved(currentId)
        } else {
          await useContactsStore.getState().loadProviders()
        }
      },
    )
  },

  toggleStar: async (id) => {
    const prevStarred = get().providers.find(p => p.id === id)?.is_starred ?? 0
    const newStarred = prevStarred ? 0 : 1
    // Optimistic update
    set(state => ({
      providers: state.providers.map(p =>
        p.id === id ? { ...p, is_starred: newStarred as 0 | 1 } : p
      ),
      selectedProvider: state.selectedProvider?.id === id
        ? { ...state.selectedProvider, is_starred: newStarred as 0 | 1 }
        : state.selectedProvider
    }))
    try {
      await storeInvoke(IPC.CONTACTS_UPDATE, id, { is_starred: newStarred })
    } catch (err) {
      rlog.error('contactsStore', 'toggleStar failed', err)
      // Rollback on failure
      set(state => ({
        providers: state.providers.map(p =>
          p.id === id ? { ...p, is_starred: prevStarred as 0 | 1 } : p
        ),
        selectedProvider: state.selectedProvider?.id === id
          ? { ...state.selectedProvider, is_starred: prevStarred as 0 | 1 }
          : state.selectedProvider
      }))
      return
    }
    pushContactUndo(
      `${newStarred ? 'Starred' : 'Unstarred'} ${wordNow('contact', {}, null)}`, 'star',
      async () => {
        await storeInvoke(IPC.CONTACTS_UPDATE, liveContactId(id), { is_starred: prevStarred })
        await useContactsStore.getState().loadProviders()
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_UPDATE, liveContactId(id), { is_starred: newStarred })
        await useContactsStore.getState().loadProviders()
      },
    )
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  setFilterParams: (params) => {
    const prev = get().filterParams
    // Shallow comparison — all fields are primitives (string | number | boolean | null | undefined)
    if (
      prev.search === params.search &&
      prev.categoryId === params.categoryId &&
      prev.availabilityStatus === params.availabilityStatus &&
      prev.starred === params.starred &&
      prev.sortBy === params.sortBy &&
      prev.sortDir === params.sortDir
    ) return
    set({ filterParams: params })
    void get().loadProviders()
  },

  createCategory: async (name, color) => {
    try {
      const data = await storeInvoke<ProviderCategory>(IPC.CONTACTS_CREATE_CATEGORY, name, color)
      await get().loadCategories()
      return data
    } catch (err) {
      rlog.error('contactsStore', 'createCategory failed', err)
      // Read-only already shows its own message.
      if (!(err instanceof ReadOnlyError)) toast.error("We couldn't add that category — try again")
      return null
    }
  },

  updateCategory: async (id, data) => {
    try {
      await storeInvoke(IPC.CONTACTS_UPDATE_CATEGORY, id, data)
    } catch (err) { rlog.error('ContactsStore', 'Failed to update category', err); return }
    // Cards, rows and the open contact show the category's name and colour, so they reload too.
    const selectedId = get().selectedProviderId
    await Promise.all([
      get().loadCategories(),
      get().loadProviders(),
      selectedId != null ? get().selectProvider(selectedId) : Promise.resolve(),
    ])
  },

  deleteCategory: async (id) => {
    await storeInvoke(IPC.CONTACTS_DELETE_CATEGORY, id).catch((err) => { rlog.error('contactsStore', 'deleteCategory failed', err) })
    // A filter on the deleted category would match nothing and leave no chip to clear it.
    if (get().filterParams.categoryId === id) {
      const { categoryId: _dropped, ...rest } = get().filterParams
      set({ filterParams: rest })
    }
    const selectedId = get().selectedProviderId
    await Promise.all([
      get().loadCategories(),
      get().loadProviders(),
      selectedId != null ? get().selectProvider(selectedId) : Promise.resolve(),
    ])
  },

  addTag: async (providerId, tag) => {
    // Already there: the server ignores the repeat, and an undo step for it would remove the original tag.
    const open = get().selectedProvider
    if (open?.id === providerId && (open.tags ?? []).includes(tag)) return
    try {
      await storeInvoke(IPC.CONTACTS_ADD_TAG, providerId, tag)
    } catch (err) { rlog.error('contactsStore', 'addTag failed', err); return }
    // Optimistic: update selectedProvider tags locally
    if (get().selectedProviderId === providerId && get().selectedProvider) {
      set(state => ({
        selectedProvider: state.selectedProvider ? {
          ...state.selectedProvider,
          tags: [...(state.selectedProvider.tags ?? []), tag]
        } : null
      }))
    }
    pushContactUndo(
      `Added tag "${tag}"`, 'tag',
      async () => {
        const now = liveContactId(providerId)
        await storeInvoke(IPC.CONTACTS_REMOVE_TAG, now, tag)
        if (useContactsStore.getState().selectedProviderId === now) {
          await useContactsStore.getState().selectProvider(now)
        }
      },
      async () => {
        const now = liveContactId(providerId)
        await storeInvoke(IPC.CONTACTS_ADD_TAG, now, tag)
        if (useContactsStore.getState().selectedProviderId === now) {
          await useContactsStore.getState().selectProvider(now)
        }
      },
    )
  },

  removeTag: async (providerId, tag) => {
    try {
      await storeInvoke(IPC.CONTACTS_REMOVE_TAG, providerId, tag)
    } catch (err) { rlog.error('contactsStore', 'removeTag failed', err); return }
    // Optimistic: update selectedProvider tags locally
    if (get().selectedProviderId === providerId && get().selectedProvider) {
      set(state => ({
        selectedProvider: state.selectedProvider ? {
          ...state.selectedProvider,
          tags: (state.selectedProvider.tags ?? []).filter((t: string) => t !== tag)
        } : null
      }))
    }
    pushContactUndo(
      `Removed tag "${tag}"`, 'tag',
      async () => {
        const now = liveContactId(providerId)
        await storeInvoke(IPC.CONTACTS_ADD_TAG, now, tag)
        if (useContactsStore.getState().selectedProviderId === now) {
          await useContactsStore.getState().selectProvider(now)
        }
      },
      async () => {
        const now = liveContactId(providerId)
        await storeInvoke(IPC.CONTACTS_REMOVE_TAG, now, tag)
        if (useContactsStore.getState().selectedProviderId === now) {
          await useContactsStore.getState().selectProvider(now)
        }
      },
    )
  },

  loadInteractions: async (providerId) => {
    try {
      const data = await storeInvoke<ProviderInteraction[]>(IPC.CONTACTS_GET_INTERACTIONS, providerId)
      set({ interactions: data })
    } catch (err) { rlog.error('contactsStore', 'loadInteractions failed', err) }
  },

  addInteraction: async (providerId, contactType, content) => {
    try {
      const created = await storeInvoke<ProviderInteraction>(IPC.CONTACTS_ADD_INTERACTION, providerId, contactType, content)
      await get().loadInteractions(providerId)
      pushContactUndo(
        'Added interaction log', 'plus',
        async () => {
          await storeInvoke(IPC.CONTACTS_DELETE_INTERACTION, created.id)
          await useContactsStore.getState().loadInteractions(liveContactId(providerId))
        },
        async () => {
          const now = liveContactId(providerId)
          await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, now, created.contact_type, created.content, created.created_at)
          await useContactsStore.getState().loadInteractions(now)
        },
      )
    } catch (err) {
      rlog.error('contactsStore', 'addInteraction failed', err)
      await get().loadInteractions(providerId)
    }
  },

  updateInteraction: async (id, data) => {
    const prev = get().interactions.find(i => i.id === id)
    try {
      await storeInvoke(IPC.CONTACTS_UPDATE_INTERACTION, id, data)
    } catch (err) { rlog.error('contactsStore', 'updateInteraction failed', err); return }
    const providerId = get().selectedProviderId
    if (providerId) await get().loadInteractions(providerId)
    if (prev) {
      const prevData = { content: prev.content, contact_type: prev.contact_type }
      pushContactUndo(
        'Updated interaction log', 'edit',
        async () => {
          await storeInvoke(IPC.CONTACTS_UPDATE_INTERACTION, id, prevData)
          const pid = useContactsStore.getState().selectedProviderId
          if (pid) await useContactsStore.getState().loadInteractions(pid)
        },
        async () => {
          await storeInvoke(IPC.CONTACTS_UPDATE_INTERACTION, id, data)
          const pid = useContactsStore.getState().selectedProviderId
          if (pid) await useContactsStore.getState().loadInteractions(pid)
        },
      )
    }
  },

  deleteInteraction: async (id) => {
    const interaction = get().interactions.find(i => i.id === id)
    try {
      await storeInvoke(IPC.CONTACTS_DELETE_INTERACTION, id)
    } catch (err) { rlog.error('contactsStore', 'deleteInteraction failed', err); return }
    const providerId = get().selectedProviderId
    if (providerId) await get().loadInteractions(providerId)
    if (interaction) {
      pushContactUndo(
        'Deleted interaction log', 'trash',
        async () => {
          // Recreate with original timestamp to preserve order
          await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, liveContactId(interaction.provider_id), interaction.contact_type, interaction.content, interaction.created_at)
          const pid = useContactsStore.getState().selectedProviderId
          if (pid) await useContactsStore.getState().loadInteractions(pid)
        },
        async () => {
          // Find the restored interaction and delete it
          const currentInteractions = useContactsStore.getState().interactions
          const restored = currentInteractions.find(i => i.provider_id === liveContactId(interaction.provider_id) && i.content === interaction.content && i.created_at === interaction.created_at)
          if (restored) await storeInvoke(IPC.CONTACTS_DELETE_INTERACTION, restored.id)
          const pid = useContactsStore.getState().selectedProviderId
          if (pid) await useContactsStore.getState().loadInteractions(pid)
        },
      )
    }
  },

  loadClientLinks: async (params) => {
    try {
      const data = await storeInvoke<ProviderClientLink[]>(IPC.CONTACTS_GET_CLIENT_LINKS, params)
      set({ clientLinks: data })
    } catch (err) { rlog.error('contactsStore', 'loadClientLinks failed', err) }
  },

  linkClient: async (providerId, rowId, gridId, notes) => {
    try {
      const linkData = await storeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, providerId, rowId, gridId, notes)
      await get().loadClientLinks({ providerId })
      let currentLinkId = linkData.id
      const sysLogId = linkData.sysLogId
      const sideEffects: SideEffect[] | undefined = sysLogId ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined
      const providerName = get().providers.find(p => p.id === providerId)?.name
      pushContactUndo(
        providerName ? `Linked "${providerName}" to ${wordNow('record')}` : `Linked ${wordNow('contact', {}, null)} to ${wordNow('record')}`, 'link',
        async () => {
          await storeInvoke(IPC.CONTACTS_UNLINK_CLIENT, currentLinkId)
          await get().loadClientLinks({ providerId })
          pulseEvents.emit('linkedproviders:changed', { rowId })
        },
        async () => {
          const r = await storeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, liveContactId(providerId), rowId, gridId, notes)
          currentLinkId = r.id
          await get().loadClientLinks({ providerId: liveContactId(providerId) })
          pulseEvents.emit('linkedproviders:changed', { rowId })
        },
        { sideEffects },
      )
    } catch (err) {
      rlog.error('contactsStore', 'linkClient failed', err)
      await get().loadClientLinks({ providerId })
    }
  },

  unlinkClient: async (linkId) => {
    const link = get().clientLinks.find(l => l.id === linkId)
    try {
      const unlinkData = await storeInvoke<{ sysLogId: number | null }>(IPC.CONTACTS_UNLINK_CLIENT, linkId)
      const providerId = get().selectedProviderId
      if (providerId) await get().loadClientLinks({ providerId })
      if (link) {
        const sysLogId = unlinkData.sysLogId
        const sideEffects: SideEffect[] | undefined = sysLogId ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined
        const providerName = get().providers.find(p => p.id === link.provider_id)?.name
        let restoredLinkId: number | null = null
        pushContactUndo(
          providerName ? `Unlinked "${providerName}" from ${wordNow('record')}` : `Unlinked ${wordNow('contact', {}, null)} from ${wordNow('record')}`, 'unlink',
          async () => {
            const r = await storeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, liveContactId(link.provider_id), link.row_id, link.grid_id, link.notes ?? undefined)
            restoredLinkId = r.id
            await get().loadClientLinks({ providerId: liveContactId(link.provider_id) })
            pulseEvents.emit('linkedproviders:changed', { rowId: link.row_id })
          },
          async () => {
            if (restoredLinkId !== null) {
              await storeInvoke(IPC.CONTACTS_UNLINK_CLIENT, restoredLinkId)
              await get().loadClientLinks({ providerId: link.provider_id })
              pulseEvents.emit('linkedproviders:changed', { rowId: link.row_id })
              restoredLinkId = null
            }
          },
          { sideEffects },
        )
      }
    } catch (err) {
      rlog.error('contactsStore', 'unlinkClient failed', err)
      const providerId = get().selectedProviderId
      if (providerId) await get().loadClientLinks({ providerId })
    }
  },

  markAvailabilityChecked: async (providerId) => {
    const prev = get().providers.find(p => p.id === providerId)
    const prevCheckedAt = prev?.availability_checked_at ?? null
    try {
      await storeInvoke(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, providerId)
    } catch (err) { rlog.error('contactsStore', 'markAvailabilityChecked failed', err); return }
    const now = new Date().toISOString()
    // Optimistic: update locally
    set(state => ({
      providers: state.providers.map(p =>
        p.id === providerId ? { ...p, availability_checked_at: now } : p
      ),
      selectedProvider: state.selectedProvider?.id === providerId
        ? { ...state.selectedProvider, availability_checked_at: now }
        : state.selectedProvider
    }))
    pushContactUndo(
      'Marked availability checked', 'check',
      async () => {
        const now = liveContactId(providerId)
        await storeInvoke(IPC.CONTACTS_UPDATE, now, { availability_checked_at: prevCheckedAt })
        await useContactsStore.getState().loadProviders()
        if (useContactsStore.getState().selectedProviderId === now) {
          await useContactsStore.getState().selectProvider(now)
        }
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, liveContactId(providerId))
        await useContactsStore.getState().loadProviders()
      },
    )
  },

  loadCustomFields: async (categoryId) => {
    try {
      const data = await storeInvoke<ProviderCustomField[]>(IPC.CONTACTS_GET_CUSTOM_FIELDS, categoryId)
      set({ customFields: data })
    } catch (err) { rlog.error('contactsStore', 'loadCustomFields failed', err) }
  },

  createCustomField: async (categoryId, fieldName, fieldType) => {
    try {
      await storeInvoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, categoryId, fieldName, fieldType)
      await get().loadCustomFields(categoryId)
    } catch (err) { rlog.error('contactsStore', 'createCustomField failed', err) }
  },

  deleteCustomField: async (fieldId, categoryId) => {
    try {
      await storeInvoke(IPC.CONTACTS_DELETE_CUSTOM_FIELD, fieldId)
      await get().loadCustomFields(categoryId)
    } catch (err) { rlog.error('contactsStore', 'deleteCustomField failed', err) }
  },

  saveCustomValue: async (providerId, customFieldId, value) => {
    await storeInvoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, providerId, customFieldId, value).catch((err) => { rlog.error('contactsStore', 'saveCustomValue failed', err) })
  },
}))

// Locked: drop contacts and their notes (A24-11); the directory reloads when it opens again
pulseEvents.on('app:locked', () => {
  useContactsStore.setState(s => ({
    providers: [],
    selectedProviderId: null,
    selectedProvider: null,
    interactions: [],
    clientLinks: [],
    loading: false,
    initialLoadDone: false,
    _loadVersion: s._loadVersion + 1,
  }))
})
