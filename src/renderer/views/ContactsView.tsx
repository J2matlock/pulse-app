import { useCallback, useEffect, useState, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../stores/contactsStore'
import { EmptyState } from '../components/shared/EmptyState'
import { LoadingSpinner } from '../components/shared/LoadingSpinner'
import { CategoryManager } from '../components/contacts/CategoryManager'
import { ContactForm } from '../components/contacts/ContactForm'
import { ContactCard } from '../components/contacts/ContactCard'
import { ContactRow } from '../components/contacts/ContactRow'
import { ContactFilterBar } from '../components/contacts/ContactFilterBar'
import { ContactDetail } from '../components/contacts/ContactDetail'
import { ContactImportExport } from '../components/contacts/ContactImportExport'
import { BookUser, Plus, Settings2, Upload, Download, Printer } from 'lucide-react'
import { ViewBreadcrumb } from '../components/shared/ViewBreadcrumb'
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { isEditableElement } from '../utils/domHelpers'
import { isMod } from '../utils/keys'
import { copyText } from '../hooks/useCopyFeedback'
import { useVocab } from '../hooks/useVocab'
import { PrimaryButton } from '../components/ui/Button'
import { MenuButton } from '../components/ui/RowMenu'
import { PurposeLine } from '../components/shared/PurposeLine'
import { friendlyError } from '../utils/friendlyError'

export default function ContactsView() {
  const { t, f } = useVocab(null)
  const {
    providers,
    initialLoadDone,
    selectedProviderId,
    selectedProvider,
    viewMode,
    setViewMode,
    loadProviders,
    loadCategories,
    selectProvider,
    toggleStar,
    filterParams,
  } = useContactsStore(useShallow(s => ({
    providers: s.providers,
    initialLoadDone: s.initialLoadDone,
    selectedProviderId: s.selectedProviderId,
    selectedProvider: s.selectedProvider,
    viewMode: s.viewMode,
    setViewMode: s.setViewMode,
    loadProviders: s.loadProviders,
    loadCategories: s.loadCategories,
    selectProvider: s.selectProvider,
    toggleStar: s.toggleStar,
    filterParams: s.filterParams,
  })))

  const [showForm, setShowForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<typeof selectedProvider>(null)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [importExportMode, setImportExportMode] = useState<'import' | 'export' | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCategories()
    loadProviders()
  }, [loadCategories, loadProviders])

  // Reset focusedIndex on filter/search changes
  useEffect(() => { setFocusedIndex(-1) }, [filterParams.search, filterParams.categoryId, filterParams.availabilityStatus, filterParams.starred])

  const handleAddProvider = useCallback(() => {
    setEditingProvider(null)
    setShowForm(true)
    selectProvider(null)
  }, [selectProvider])

  const handleEditProvider = useCallback(() => {
    if (selectedProvider) {
      setEditingProvider(selectedProvider)
      setShowForm(true)
    }
  }, [selectedProvider])

  // Keyboard shortcuts for ContactsView
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const active = document.activeElement
      // While a dialog is open (e.g. "Delete this contact?"), arrows would switch the
      // contact underneath it and Enter would then confirm on the wrong one.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return
      if (active instanceof Element && active.closest('[role="dialog"], [role="alertdialog"]')) return
      // In the detail panel, arrows scroll and Ctrl+C copies what's selected there.
      if (active instanceof Element && active.closest('[data-contact-detail-panel]')) return
      const isInput = isEditableElement(active) || active instanceof HTMLSelectElement

      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !isInput) {
        e.preventDefault()
        handleAddProvider()
      }
      if (e.key === 'Escape' && showForm) {
        // handled by ContactForm
      }

      // Arrow key navigation through provider list
      // Read providers/selectedProvider from store to avoid stale closure
      const storeState = useContactsStore.getState()
      const currentProviders = storeState.providers
      const currentSelectedProvider = storeState.selectedProvider

      if (!isInput && !showForm) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedIndex(prev => {
            const next = Math.min(prev + 1, currentProviders.length - 1)
            if (currentProviders[next]) selectProvider(currentProviders[next].id)
            return next
          })
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedIndex(prev => {
            const next = Math.max(prev - 1, 0)
            if (currentProviders[next]) selectProvider(currentProviders[next].id)
            return next
          })
        }
        if (e.key === 'Enter' && focusedIndex >= 0 && currentProviders[focusedIndex]) {
          e.preventDefault()
          selectProvider(currentProviders[focusedIndex].id)
        }
        if (e.key === 'e' && !e.ctrlKey && !e.metaKey && focusedIndex >= 0 && currentSelectedProvider) {
          e.preventDefault()
          handleEditProvider()
        }
        // Only when nothing is selected: copying highlighted text must still work.
        const hasSelection = (window.getSelection()?.toString() ?? '') !== ''
        if (e.key === 'c' && isMod(e) && !hasSelection && focusedIndex >= 0 && currentProviders[focusedIndex]) {
          e.preventDefault()
          const p = currentProviders[focusedIndex]
          const phone = p.phone_main || p.phone_direct || ''
          if (phone) void copyText(phone)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showForm, focusedIndex, selectProvider, handleAddProvider, handleEditProvider])

  const handleFormSaved = useCallback(() => {
    setShowForm(false)
    setEditingProvider(null)
  }, [])

  const handleFormClosed = useCallback(() => {
    setShowForm(false)
    setEditingProvider(null)
  }, [])

  const hasActiveFilters = !!(filterParams.search || filterParams.categoryId != null || filterParams.availabilityStatus || filterParams.starred)

  // Virtual scrolling for provider list — must be declared before any early returns (Rules of Hooks)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const cardContainerRef = useRef<HTMLDivElement>(null)

  const estimateListSize = useCallback(() => 48, [])   // ~44px row + 4px gap
  const estimateCardSize = useCallback(() => 120, [])   // approximate card height

  const listVirtualizer = useVirtualizer({
    count: viewMode === 'list' ? providers.length : 0,
    getScrollElement: () => listContainerRef.current,
    estimateSize: estimateListSize,
    overscan: 10,
  })

  const cardVirtualizer = useVirtualizer({
    count: viewMode === 'cards' ? providers.length : 0,
    getScrollElement: () => cardContainerRef.current,
    estimateSize: estimateCardSize,
    overscan: 5,
  })

  if (!initialLoadDone) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 flex h-full overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header bar */}
          <div className="px-4 pt-3 pb-3 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-1">
            <ViewBreadcrumb items={[{ label: 'Dashboard', to: '/dashboard' }, { label: t('contactDirectory', { cap: true }) }]} />
            <div className="flex flex-wrap items-center gap-3">
            {/* The page word and the people word together, so "Contacts" and "providers" read as one thing (E-25) */}
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white min-w-0">
              {t('contactDirectory', { cap: true })}
            </h1>
            <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">
              {providers.length} {t('contact', { count: providers.length })}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* The occasional actions share one menu, so Add is the one obvious step (Q2) */}
              <MenuButton label="More" align="end" items={[
                { label: 'Import…', description: `${t('contact', { many: true, cap: true })} from a vCard file`, icon: <Upload size={16} />, onSelect: () => setImportExportMode('import') },
                { label: 'Export…', description: `${t('contact', { many: true, cap: true })} as a vCard file`, icon: <Download size={16} />, onSelect: () => setImportExportMode('export') },
                { label: 'Print…', description: 'The directory as a PDF', icon: <Printer size={16} />, onSelect: () => {
                  void safeInvoke<string | null>(IPC.EXPORT_PDF_DIRECTORY, filterParams).then(res => {
                    if (!res.ok) toast.error(friendlyError(res.error, "We couldn't save the PDF — try again"))
                  })
                } },
                { label: 'Categories…', description: `Add, rename or remove ${t('contact')} categories`, icon: <Settings2 size={16} />, onSelect: () => setShowCategoryManager(true) },
              ]} />
              <PrimaryButton data-tour="add-provider" data-primary-action onClick={handleAddProvider}
                title={`Add new ${t('contact')} (N)`} icon={<Plus size={16} />}>
                Add {t('contact', { cap: true })}
              </PrimaryButton>
            </div>
            </div>
            <PurposeLine>{f('The people and places you work with. Link them to {a record} from {a record}\'s page.')}</PurposeLine>
          </div>

          {/* Filter bar */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <ContactFilterBar viewMode={viewMode} onViewModeChange={setViewMode} searchInputRef={searchInputRef} />
          </div>

          {/* Contact list */}
          {providers.length === 0 ? (
            <div className="flex-1 overflow-y-auto p-4">
              {hasActiveFilters ? (
                // A search that finds nothing gets words, not the empty-state action (Q8)
                <div className="text-center py-12">
                  <p className="text-base text-slate-700 dark:text-slate-300 font-semibold mb-1">No {t('contact', { many: true })} match your search</p>
                  <p className="text-base text-slate-600 dark:text-slate-300">Clear the search and filters above, or try another name.</p>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  {/* Icon, one sentence, one action; importing is the quieter second way in (Q8) */}
                  <EmptyState
                    icon={<BookUser />}
                    title={`No ${t('contact', { many: true })} yet`}
                    description="The people and organizations you work with, in one place."
                    action={{ label: `Add ${t('contact', { cap: true })}`, onClick: handleAddProvider }}
                    secondaryAction={{ label: 'Import from a vCard file', onClick: () => setImportExportMode('import') }}
                  />
                </div>
              )}
            </div>
          ) : viewMode === 'cards' ? (
            <div ref={cardContainerRef} className="flex-1 overflow-y-auto p-4">
              <div style={{ height: cardVirtualizer.getTotalSize(), position: 'relative' }}>
                {cardVirtualizer.getVirtualItems().map(virtualItem => {
                  const p = providers[virtualItem.index]
                  if (!p) return null
                  const idx = virtualItem.index
                  return (
                    <div
                      key={p.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      ref={cardVirtualizer.measureElement}
                      data-index={virtualItem.index}
                    >
                      <div className="pb-3">
                        <ContactCard
                          provider={p}
                          isSelected={selectedProviderId === p.id}
                          isFocused={focusedIndex === idx}
                          onClick={() => { selectProvider(p.id); setFocusedIndex(idx); setShowForm(false) }}
                          onToggleStar={() => toggleStar(p.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div ref={listContainerRef} className="flex-1 overflow-y-auto p-4">
              <div style={{ height: listVirtualizer.getTotalSize(), position: 'relative' }}>
                {listVirtualizer.getVirtualItems().map(virtualItem => {
                  const p = providers[virtualItem.index]
                  if (!p) return null
                  const idx = virtualItem.index
                  return (
                    <div
                      key={p.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      ref={listVirtualizer.measureElement}
                      data-index={virtualItem.index}
                    >
                      <div className="mb-1">
                        <ContactRow
                          provider={p}
                          isSelected={selectedProviderId === p.id}
                          isFocused={focusedIndex === idx}
                          onClick={() => { selectProvider(p.id); setFocusedIndex(idx); setShowForm(false) }}
                          onToggleStar={() => toggleStar(p.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right panel. With no contacts at all there's nothing to pick, so the empty
            directory gets the whole width instead of two empty panels side by side */}
        {(showForm || providers.length > 0 || hasActiveFilters) && (
        <div data-contact-detail-panel className="w-[420px] border-l border-slate-200 dark:border-slate-700 flex-shrink-0 overflow-hidden bg-white dark:bg-slate-900">
          {showForm ? (
            <ContactForm provider={editingProvider} onClose={handleFormClosed} onSaved={handleFormSaved} />
          ) : selectedProviderId && selectedProvider ? (
            <ContactDetail
              key={selectedProvider.id}
              provider={selectedProvider}
              onEdit={handleEditProvider}
              onDeleted={() => selectProvider(null)}
            />
          ) : (
            // No action: the list on the left is the action (Q8)
            <div className="flex items-center justify-center h-full">
              <EmptyState size="panel" heading="p" icon={<BookUser />} title={`Select ${t('contact', { article: true })} to view details`}
                description="Their details and history show here." />
            </div>
          )}
        </div>
        )}
      </div>

      <CategoryManager open={showCategoryManager} onClose={() => setShowCategoryManager(false)} />
      {importExportMode && (
        <ContactImportExport
          open
          mode={importExportMode}
          onClose={() => setImportExportMode(null)}
        />
      )}
    </>
  )
}
