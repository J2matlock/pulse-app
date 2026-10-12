import { IPC } from '../../shared/ipc-channels'
import { rlog } from '../utils/rendererLogger'
import { type SideEffect } from './undoStore'
import { pushContactUndo, liveContactId } from './contactsUndo'
import { storeInvoke } from '../utils/safeInvoke'
import { wordNow } from '../utils/vocab'
import { pulseEvents } from '../events'
import type { ProviderInteraction, ProviderClientLink } from '../../shared/types'
import type { ContactsStore } from './contactsTypes'

/** A contact's interaction log and the records it's linked to */
export interface ContactActivitySliceState {
  interactions: ProviderInteraction[]
  clientLinks: ProviderClientLink[]

  loadInteractions: (providerId: number) => Promise<void>
  addInteraction: (providerId: number, contactType: string, content: string) => Promise<void>
  updateInteraction: (id: number, data: { content?: string; contact_type?: string }) => Promise<void>
  deleteInteraction: (id: number) => Promise<void>

  loadClientLinks: (params: { providerId?: number; rowId?: number }) => Promise<void>
  linkClient: (providerId: number, rowId: number, gridId: number, notes?: string) => Promise<void>
  unlinkClient: (linkId: number) => Promise<void>
}

type SetState = (partial: Partial<ContactsStore> | ((s: ContactsStore) => Partial<ContactsStore>)) => void
type GetState = () => ContactsStore

export const createContactActivitySlice = (set: SetState, get: GetState): ContactActivitySliceState => ({
  interactions: [],
  clientLinks: [],

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
          await get().loadInteractions(liveContactId(providerId))
        },
        async () => {
          const now = liveContactId(providerId)
          await storeInvoke(IPC.CONTACTS_ADD_INTERACTION, now, created.contact_type, created.content, created.created_at)
          await get().loadInteractions(now)
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
          const pid = get().selectedProviderId
          if (pid) await get().loadInteractions(pid)
        },
        async () => {
          await storeInvoke(IPC.CONTACTS_UPDATE_INTERACTION, id, data)
          const pid = get().selectedProviderId
          if (pid) await get().loadInteractions(pid)
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
          const pid = get().selectedProviderId
          if (pid) await get().loadInteractions(pid)
        },
        async () => {
          // Find the restored interaction and delete it
          const currentInteractions = get().interactions
          const restored = currentInteractions.find(i => i.provider_id === liveContactId(interaction.provider_id) && i.content === interaction.content && i.created_at === interaction.created_at)
          if (restored) await storeInvoke(IPC.CONTACTS_DELETE_INTERACTION, restored.id)
          const pid = get().selectedProviderId
          if (pid) await get().loadInteractions(pid)
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
})
