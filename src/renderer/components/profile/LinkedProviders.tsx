import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookUser, Plus, X, Search, ChevronRight, Phone, Mail, Copy, Check } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Provider, ProviderClientLink } from '../../../shared/types'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import { useUndoStore, type SideEffect } from '../../stores/undoStore'
import { pulseEvents } from '../../events'
import { useVocab } from '../../hooks/useVocab'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { parseDbTimestamp } from '../../../shared/dates'

interface Props {
  rowId: number
  gridId: number
  /** How many are linked, for the section title */
  onCount?: (n: number) => void
}

/** A small copy button next to a phone number or email */
function CopyValue({ value, label }: { value: string; label: string }): React.ReactElement {
  const { copied, copyToClipboard } = useCopyFeedback()
  return (
    <button type="button" onClick={() => void copyToClipboard(value)} aria-label={copied ? 'Copied' : label} title="Copy"
      className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}

export function LinkedProviders({ rowId, gridId, onCount }: Props) {
  const { t } = useVocab(gridId)
  const navigate = useNavigate()
  const { selectProvider } = useContactsStore(useShallow(s => ({
    selectProvider: s.selectProvider,
  })))
  const [links, setLinks] = useState<ProviderClientLink[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Provider[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  const loadLinks = useCallback(async () => {
    try {
      const res = await safeInvoke<ProviderClientLink[]>(IPC.CONTACTS_GET_CLIENT_LINKS, { rowId })
      if (res.ok) setLinks(res.data)
    } catch {
      // IPC error — leave empty
    } finally {
      setLoading(false)
    }
  }, [rowId])

  useEffect(() => {
    setLoading(true)
    void loadLinks()
  }, [loadLinks])
  useEffect(() => { if (!loading) onCount?.(links.length) }, [loading, links.length, onCount])

  // Focus search input when search panel opens
  useEffect(() => {
    if (searching) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearchQuery('')
      setSearchResults([])
    }
  }, [searching])

  // Debounced provider search
  useEffect(() => {
    if (!searching) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (searchQuery.trim().length === 0) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await safeInvoke<Provider[]>(IPC.CONTACTS_GET_ALL, { search: searchQuery.trim() })
        if (res.ok) {
          // Filter out providers already linked to this client
          const linkedIds = new Set(links.map(l => l.provider_id))
          setSearchResults(res.data.filter(p => !linkedIds.has(p.id)))
        }
      } catch {
        // IPC error
      } finally {
        setSearchLoading(false)
      }
    }, 200)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery, searching, links])

  // Reload when undo/redo updates provider links externally (cross-mount)
  useEffect(() => {
    const unsub = pulseEvents.on('linkedproviders:changed', (data) => {
      if (data.rowId === rowId) void loadLinks()
    })
    return unsub
  }, [rowId, loadLinks])

  // Close search on outside click
  useEffect(() => {
    if (!searching) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSearching(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searching])

  async function handleLink(providerId: number) {
    const provider = searchResults.find(p => p.id === providerId)
    try {
      const res = await safeInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, providerId, rowId, gridId)
      if (res.ok) {
        setSearching(false)
        void loadLinks()
        let currentLinkId = res.data.id
        const sysLogId = res.data.sysLogId
        const sideEffects: SideEffect[] | undefined = sysLogId ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: provider ? `Linked "${provider.name}" to ${t('record')}` : `Linked ${t('contact')} to ${t('record')}`,
          timestamp: Date.now(),
          category: 'logged',
          icon: 'link',
          sideEffects,
          undo: async () => {
            await mustInvoke(IPC.CONTACTS_UNLINK_CLIENT, currentLinkId)
            void loadLinks()
            pulseEvents.emit('linkedproviders:changed', { rowId })
          },
          redo: async () => {
            const r = await mustInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, providerId, rowId, gridId)
            if (r.ok) currentLinkId = r.data.id
            void loadLinks()
            pulseEvents.emit('linkedproviders:changed', { rowId })
          },
        })
      }
    } catch {
      // IPC error
    }
  }

  async function handleUnlink(linkId: number) {
    const link = links.find(l => l.id === linkId)
    try {
      const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CONTACTS_UNLINK_CLIENT, linkId)
      if (res.ok) {
        setLinks(prev => prev.filter(l => l.id !== linkId))
        if (link) {
          const sysLogId = res.data.sysLogId
          const sideEffects: SideEffect[] | undefined = sysLogId ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined
          let restoredLinkId: number | null = null
          useUndoStore.getState().push({
            id: crypto.randomUUID(),
            description: link.provider_name ? `Unlinked "${link.provider_name}" from ${t('record')}` : `Unlinked ${t('contact')} from ${t('record')}`,
            timestamp: Date.now(),
            category: 'logged',
            icon: 'unlink',
            sideEffects,
            undo: async () => {
              const r = await mustInvoke<ProviderClientLink & { sysLogId: number | null }>(IPC.CONTACTS_LINK_CLIENT, link.provider_id, rowId, gridId)
              if (r.ok) {
                restoredLinkId = r.data.id
                void loadLinks()
                pulseEvents.emit('linkedproviders:changed', { rowId })
              }
            },
            redo: async () => {
              if (restoredLinkId !== null) {
                await mustInvoke(IPC.CONTACTS_UNLINK_CLIENT, restoredLinkId)
                void loadLinks()
                pulseEvents.emit('linkedproviders:changed', { rowId })
                restoredLinkId = null
              }
            },
          })
        }
      }
    } catch {
      // IPC error
    }
  }

  function handleViewContacts(providerId: number) {
    void selectProvider(providerId)
    navigate('/contacts')
  }

  return (
    <section
      ref={containerRef}
      className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <BookUser className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 flex-1">
          Linked {t('contact', { many: true, cap: true })}
          <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">({links.length})</span>
        </h2>
        <button
          onClick={() => setSearching(!searching)}
          className="hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700
                     text-base text-slate-700 dark:text-slate-300
                     hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 36 }}
          title={`Link ${t('contact', { article: true })} to this ${t('record')}`}
        >
          <Plus className="w-3.5 h-3.5" />
          Link {t('contact', { cap: true })}
        </button>
      </div>

      {/* Search panel */}
      {searching && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`Search ${t('contact', { many: true })} by name…`}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-700 text-base text-slate-900 dark:text-slate-100
                         placeholder:text-slate-500
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-blue-500"
              style={{ minHeight: 44, fontSize: 15 }}
              onKeyDown={e => {
                if (e.key === 'Escape') setSearching(false)
              }}
            />
          </div>

          {/* Search results dropdown */}
          {searchQuery.trim().length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700">
              {searchLoading && (
                <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">Searching...</p>
              )}

              {!searchLoading && searchResults.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">No matching {t('contact', { many: true })} found.</p>
              )}

              {!searchLoading && searchResults.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => handleLink(provider.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left
                             hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500"
                  style={{ minHeight: 44 }}
                >
                  {/* Category color dot */}
                  {provider.category_color && (
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: provider.category_color }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-base font-medium text-slate-900 dark:text-slate-100 truncate block"
                      style={{ fontSize: 15 }}
                    >
                      {provider.name}
                    </span>
                    {(provider.org_name || provider.category_name) && (
                      <span className="text-sm text-slate-500 dark:text-slate-400 truncate block">
                        {[provider.org_name, provider.category_name].filter(Boolean).join(' — ')}
                      </span>
                    )}
                  </div>
                  <Plus className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Provider list */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">Loading...</p>
        )}

        {!loading && links.length === 0 && !searching && (
          <div className="py-6 text-center">
            <BookUser className="w-8 h-8 text-slate-300 dark:text-slate-500 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400" style={{ fontSize: 15 }}>No {t('contact', { many: true })} linked.</p>
            <p className="text-sm text-slate-300 dark:text-slate-500 mt-1">
              Click &ldquo;Link {t('contact', { cap: true })}&rdquo; to connect {t('contact', { article: true })} to this {t('record')}.
            </p>
          </div>
        )}

        {links.map(link => {
          const open = openId === link.id
          const sub = [link.provider_title, link.provider_org_name].filter(Boolean).join(', ')
          return (
          <div key={link.id} className="flex items-stretch hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            {/* Category color stripe */}
            <div className="w-1 flex-shrink-0 rounded-l" style={{ backgroundColor: link.provider_category_color ?? '#94a3b8' }} />

            <div className="flex-1 min-w-0 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-base font-medium text-slate-900 dark:text-slate-100 truncate block">
                    {link.provider_name ?? `Unknown ${t('contact')}`}
                  </span>
                  {(sub || link.provider_category_name) && (
                    <span className="block text-base text-slate-600 dark:text-slate-300 truncate">{[sub, link.provider_category_name].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : link.id)}
                  aria-expanded={open}
                  className="btn-compact-secondary"
                >
                  {open ? 'Less' : 'Details'}
                </button>
                <button
                  onClick={() => handleUnlink(link.id)}
                  title={`Unlink this ${t('contact')}`}
                  aria-label={`Unlink ${link.provider_name ?? t('contact')}`}
                  className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                  style={{ minWidth: 44, minHeight: 44 }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Phone and email right here, so calling the doctor doesn't mean leaving the page (R-28) */}
              {(link.provider_phone_main || link.provider_email) && (
                <div className="flex flex-wrap items-center gap-x-4">
                  {link.provider_phone_main && (
                    <span className="inline-flex items-center gap-1 text-base text-slate-800 dark:text-slate-100">
                      <Phone className="w-4 h-4 text-slate-500" aria-hidden="true" />{link.provider_phone_main}
                      <CopyValue value={link.provider_phone_main} label={`Copy ${link.provider_name ?? ''} phone`} />
                    </span>
                  )}
                  {link.provider_email && (
                    <span className="inline-flex items-center gap-1 text-base text-slate-800 dark:text-slate-100 min-w-0">
                      <Mail className="w-4 h-4 text-slate-500" aria-hidden="true" /><span className="truncate">{link.provider_email}</span>
                      <CopyValue value={link.provider_email} label={`Copy ${link.provider_name ?? ''} email`} />
                    </span>
                  )}
                </div>
              )}
              {link.notes && <p className="text-base text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{link.notes}</p>}

              {open && (
                <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-1 text-base text-slate-700 dark:text-slate-200">
                  {link.provider_availability_status && link.provider_availability_status !== 'unknown' && (
                    <p>Status: {link.provider_availability_status.charAt(0).toUpperCase() + link.provider_availability_status.slice(1)}</p>
                  )}
                  <p>Linked {parseDbTimestamp(link.linked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  <button
                    type="button"
                    onClick={() => handleViewContacts(link.provider_id)}
                    className="hit-44 inline-flex items-center gap-1 text-base text-blue-700 dark:text-blue-400 hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                  >
                    Open in {t('contactDirectory', { cap: true })}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
          )
        })}
      </div>
    </section>
  )
}
