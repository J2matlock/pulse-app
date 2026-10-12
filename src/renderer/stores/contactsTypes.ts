import type {
  Provider,
  ProviderCategory,
  ProviderInteraction,
  ProviderClientLink,
  ProviderCustomField,
  ContactFilterParams,
} from '../../shared/types'

// Declared here, not in the slice, so the slice and these types don't import each other
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

export type ViewMode = 'cards' | 'list'

/** The contact directory; the interaction log and record links are in contactsActivitySlice.ts */
export interface ContactsStore extends ContactActivitySliceState {
  // State
  providers: Provider[]
  categories: ProviderCategory[]
  selectedProviderId: number | null
  selectedProvider: Provider | null
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

  // Availability
  markAvailabilityChecked: (providerId: number) => Promise<void>

  // Custom fields
  loadCustomFields: (categoryId: number) => Promise<void>
  createCustomField: (categoryId: number, fieldName: string, fieldType: string) => Promise<void>
  deleteCustomField: (fieldId: number, categoryId: number) => Promise<void>
  saveCustomValue: (providerId: number, customFieldId: number, value: string | null) => Promise<void>
}
