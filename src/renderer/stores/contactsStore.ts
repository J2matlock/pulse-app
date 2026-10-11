import { create } from 'zustand'
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { rlog } from '../utils/rendererLogger'
import { useUndoStore, type SideEffect, type UndoCategory } from './undoStore'
import { storeInvoke } from '../utils/safeInvoke'
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
  createProvider: (data: Partial<Provider>) => Promise<Provider | null>
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
    try {
      const created = await storeInvoke<Provider>(IPC.CONTACTS_CREATE, data)
      await get().loadProviders()
      pushContactUndo(
        `Created ${wordNow('contact', {}, null)} "${created.name}"`, 'plus',
        async () => {
          await storeInvoke(IPC.CONTACTS_DELETE, created.id)
          await useContactsStore.getState().loadProviders()
        },
        async () => {
          await storeInvoke(IPC.CONTACTS_CREATE, data)
          await useContactsStore.getState().loadProviders()
        },
      )
      return created
    } catch (err) {
      rlog.error('contactsStore', 'createProvider failed', err)
      return null
    }
  },

  updateProvider: async (id, data) => {
    const prev = get().providers.find(p => p.id === id)
    try {
      await storeInvoke(IPC.CONTACTS_UPDATE, id, data)
    } catch (err) { rlog.error('contactsStore', 'updateProvider failed', err); return }
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
      const prevValues = Object.fromEntries(
        (Object.keys(data) as Array<keyof Provider>).map(k => [k, prev[k]])
      ) as Partial<Provider>
      pushContactUndo(
        `Updated ${wordNow('contact', {}, null)} "${prev.name}"`, 'edit',
        async () => {
          await storeInvoke(IPC.CONTACTS_UPDATE, id, prevValues)
          await useContactsStore.getState().loadProviders()
          if (useContactsStore.getState().selectedProviderId === id) {
            await useContactsStore.getState().selectProvider(id)
          }
        },
        async () => {
          await storeInvoke(IPC.CONTACTS_UPDATE, id, data)
          await useContactsStore.getState().loadProviders()
          if (useContactsStore.getState().selectedProviderId === id) {
            await useContactsStore.getState().selectProvider(id)
          }
        },
      )
    }
  },

  deleteProvider: async (id) => {
    const provider = get().providers.find(p => p.id === id)
    if (!provider) return

    // Snapshot related data BEFORE delete for full undo
    let savedTags: string[] = []
    let savedInteractions: Array<{contact_type: string; content: string; created_at?: string}> = []
    let savedLinks: Array<{row_id: number; grid_id: number; notes?: string}> = []
    try {
      const interData = await storeInvoke<Array<{contact_type: string; content: string; created_at?: string}>>(IPC.CONTACTS_GET_INTERACTIONS, id)
      savedInteractions = interData.map(i => ({ contact_type: i.contact_type, content: i.content, created_at: i.created_at }))
      const linkData = await storeInvoke<Array<{row_id: number; grid_id: number; notes?: string}>>(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId: id })
      savedLinks = linkData.map(l => ({ row_id: l.row_id, grid_id: l.grid_id, notes: l.notes }))
      // Tags are on the provider object
      savedTags = provider.tags || []
    } catch (err) { rlog.error('contactsStore', 'deleteProvider snapshot failed', err) /* continue with delete */ }

    try {
      await storeInvoke(IPC.CONTACTS_DELETE, id)
    } catch (err) { rlog.error('contactsStore', 'deleteProvider failed', err); return }
    if (get().selectedProviderId === id) {
      set({ selectedProviderId: null, selectedProvider: null })
    }
    await get().loadProviders()
    toast(`${wordNow('contact', { cap: true }, null)} deleted. Press ${modHelp('Ctrl+Z')} to undo.`, { duration: 5000 })
    const providerSnapshot = {
      name: provider.name, org_name: provider.org_name,
      title: provider.title, phone_main: provider.phone_main,
      phone_direct: provider.phone_direct, phone_fax: provider.phone_fax,
      phone_cell: provider.phone_cell, phone_after_hours: provider.phone_after_hours,
      email: provider.email, website: provider.website, address: provider.address,
      availability_status: provider.availability_status,
      availability_notes: provider.availability_notes,
      referral_process: provider.referral_process,
      hours: provider.hours, languages: provider.languages, notes: provider.notes,
      category_id: provider.category_id, is_starred: provider.is_starred,
    }

    const recreateProvider = async (): Promise<number | null> => {
      try {
        const created = await storeInvoke<{ id: number }>(IPC.CONTACTS_CREATE, providerSnapshot)
        const newId = created.id
        // Restore tags
        for (const tag of savedTags) {
          try { await storeInvoke(IPC.CONTACTS_ADD_TAG, newId, tag) } catch (err) { rlog.error('contactsStore', 'undo restore tag failed', err) }
        }
        // Restore interactions
        for (const inter of savedInteractions) {
          try { await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, newId, inter.contact_type, inter.content, inter.created_at) } catch (err) { rlog.error('contactsStore', 'undo restore interaction failed', err) }
        }
        // Restore client links
        for (const link of savedLinks) {
          try { await storeInvoke(IPC.CONTACTS_LINK_CLIENT, newId, link.row_id, link.grid_id, link.notes) } catch (err) { rlog.error('contactsStore', 'undo restore client link failed', err) }
        }
        return newId
      } catch (err) {
        rlog.error('contactsStore', 'recreateProvider failed', err)
        return null
      }
    }

    const findRecreatedProvider = (): number | null => {
      const match = useContactsStore.getState().providers.find(
        p => p.name === providerSnapshot.name && p.org_name === providerSnapshot.org_name
          && p.email === providerSnapshot.email
      )
      return match?.id ?? null
    }

    pushContactUndo(
      `Deleted ${wordNow('contact', {}, null)} "${provider.name}"`, 'trash',
      async () => {
        await recreateProvider()
        await useContactsStore.getState().loadProviders()
      },
      async () => {
        const targetId = findRecreatedProvider()
        if (targetId != null) {
          await storeInvoke(IPC.CONTACTS_DELETE, targetId)
        }
        await useContactsStore.getState().loadProviders()
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
        await storeInvoke(IPC.CONTACTS_UPDATE, id, { is_starred: prevStarred })
        await useContactsStore.getState().loadProviders()
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_UPDATE, id, { is_starred: newStarred })
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
      return null
    }
  },

  updateCategory: async (id, data) => {
    try {
      await storeInvoke(IPC.CONTACTS_UPDATE_CATEGORY, id, data)
    } catch (err) { rlog.error('ContactsStore', 'Failed to update category', err); return }
    await get().loadCategories()
  },

  deleteCategory: async (id) => {
    await storeInvoke(IPC.CONTACTS_DELETE_CATEGORY, id).catch((err) => { rlog.error('contactsStore', 'deleteCategory failed', err) })
    await Promise.all([get().loadCategories(), get().loadProviders()])
  },

  addTag: async (providerId, tag) => {
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
        await storeInvoke(IPC.CONTACTS_REMOVE_TAG, providerId, tag)
        if (useContactsStore.getState().selectedProviderId === providerId) {
          await useContactsStore.getState().selectProvider(providerId)
        }
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_ADD_TAG, providerId, tag)
        if (useContactsStore.getState().selectedProviderId === providerId) {
          await useContactsStore.getState().selectProvider(providerId)
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
        await storeInvoke(IPC.CONTACTS_ADD_TAG, providerId, tag)
        if (useContactsStore.getState().selectedProviderId === providerId) {
          await useContactsStore.getState().selectProvider(providerId)
        }
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_REMOVE_TAG, providerId, tag)
        if (useContactsStore.getState().selectedProviderId === providerId) {
          await useContactsStore.getState().selectProvider(providerId)
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
          await useContactsStore.getState().loadInteractions(providerId)
        },
        async () => {
          await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, providerId, created.contact_type, created.content, created.created_at)
          await useContactsStore.getState().loadInteractions(providerId)
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
          await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, interaction.provider_id, interaction.contact_type, interaction.content, interaction.created_at)
          const pid = useContactsStore.getState().selectedProviderId
          if (pid) await useContactsStore.getState().loadInteractions(pid)
        },
        async () => {
          // Find the restored interaction and delete it
          const currentInteractions = useContactsStore.getState().interactions
          const restored = currentInteractions.find(i => i.provider_id === interaction.provider_id && i.content === interaction.content && i.created_at === interaction.created_at)
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
          const r = await storeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, providerId, rowId, gridId, notes)
          currentLinkId = r.id
          await get().loadClientLinks({ providerId })
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
            const r = await storeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, link.provider_id, link.row_id, link.grid_id, link.notes ?? undefined)
            restoredLinkId = r.id
            await get().loadClientLinks({ providerId: link.provider_id })
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
        await storeInvoke(IPC.CONTACTS_UPDATE, providerId, { availability_checked_at: prevCheckedAt })
        await useContactsStore.getState().loadProviders()
        if (useContactsStore.getState().selectedProviderId === providerId) {
          await useContactsStore.getState().selectProvider(providerId)
        }
      },
      async () => {
        await storeInvoke(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, providerId)
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
