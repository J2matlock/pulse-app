import { create } from 'zustand'
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { rlog } from '../utils/rendererLogger'
import { pushContactUndo, snapshotProvider, liveContactId, restoreProvider, pickProviderFields, type ProviderSnapshot } from './contactsUndo'
import { storeInvoke, ReadOnlyError } from '../utils/safeInvoke'
import { wordNow } from '../utils/vocab'
import { pulseEvents } from '../events'
import type {
  Provider,
  ProviderCategory,
  ProviderCustomField,
} from '../../shared/types'
import type { ContactsStore } from './contactsTypes'
import { createContactActivitySlice } from './contactsActivitySlice'

/** After an undo or redo removes a contact: close it if it was open, and refresh the list. */
async function afterProviderRemoved(id: number): Promise<void> {
  const store = useContactsStore.getState()
  if (store.selectedProviderId === id) await store.selectProvider(null)
  await useContactsStore.getState().loadProviders()
}

export const useContactsStore = create<ContactsStore>((set, get) => ({
  ...createContactActivitySlice(set, get),
  providers: [],
  categories: [],
  selectedProviderId: null,
  selectedProvider: null,
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
      // The Undo toast has a button, so undoing doesn't depend on knowing Ctrl+Z (UX review E-14)
      { toast: true },
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
      // The category list carries each category's field count
      await Promise.all([get().loadCustomFields(categoryId), get().loadCategories()])
    } catch (err) { rlog.error('contactsStore', 'createCustomField failed', err) }
  },

  deleteCustomField: async (fieldId, categoryId) => {
    try {
      await storeInvoke(IPC.CONTACTS_DELETE_CUSTOM_FIELD, fieldId)
      // The category list carries each category's field count
      await Promise.all([get().loadCustomFields(categoryId), get().loadCategories()])
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
