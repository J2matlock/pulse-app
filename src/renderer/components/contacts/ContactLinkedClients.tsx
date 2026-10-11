import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Plus, X, Search, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { useContactsStore } from '../../stores/contactsStore'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'
import { parseDbTimestamp } from '../../../shared/dates'

interface Props {
  providerId: number
}

export function ContactLinkedClients({ providerId }: Props) {
  const { t } = useVocab()
  const { clientLinks, linkClient, unlinkClient } = useContactsStore(useShallow(s => ({
    clientLinks: s.clientLinks,
    linkClient: s.linkClient,
    unlinkClient: s.unlinkClient,
  })))
  const { rows, columns, grids, activeGridId } = useGridStore(useShallow(s => ({
    rows: s.rows,
    columns: s.columns,
    grids: s.grids,
    activeGridId: s.activeGridId,
  })))
  const navigate = useNavigate()

  const [showPicker, setShowPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null)
  const [hoveredLinkId, setHoveredLinkId] = useState<number | null>(null)

  // Links for this provider
  const links = useMemo(
    () => clientLinks.filter(l => l.provider_id === providerId),
    [clientLinks, providerId]
  )

  // Active rows with their display name, excluding already-linked
  const linkedRowIds = useMemo(
    () => new Set(links.map(l => l.row_id)),
    [links]
  )

  const availableClients = useMemo(() => {
    return rows
      .filter(r => r.is_active === 1 && !linkedRowIds.has(r.row_id))
      .map(r => ({
        rowId: r.row_id,
        name: getClientName(r, columns),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, columns, linkedRowIds])

  // Filtered by search
  const filteredClients = useMemo(() => {
    if (!search.trim()) return availableClients
    const q = search.toLowerCase()
    return availableClients.filter(c => c.name.toLowerCase().includes(q))
  }, [availableClients, search])

  // Current grid name for display
  const currentGridName = useMemo(
    () => grids.find(g => g.id === activeGridId)?.name ?? t('list', { cap: true }),
    [grids, activeGridId, t]
  )

  async function handleLink() {
    if (selectedRowId === null || activeGridId === null) return
    try {
      await linkClient(providerId, selectedRowId, activeGridId, notes.trim() || undefined)
      setSelectedRowId(null)
      setNotes('')
      setSearch('')
      setShowPicker(false)
    } catch {
      toast.error(`We couldn't link them — the ${t('record')} may already be linked`)
    }
  }

  async function handleUnlink(linkId: number) {
    try {
      await unlinkClient(linkId)
    } catch {
      // Store handles error
    }
  }

  function handleClientClick(rowId: number, gridId: number) {
    navigate(`/profile/${rowId}?gridId=${gridId}`)
  }

  function formatDate(dateStr: string): string {
    try {
      const d = parseDbTimestamp(dateStr)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-4">
      {/* Link a Client button */}
      <div>
        <button
          onClick={() => setShowPicker(prev => !prev)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-hidden focus:ring-3 focus:ring-blue-500"
          style={{ fontSize: 15, minHeight: 44 }}
        >
          <Plus size={16} />
          Link {t('record', { article: true })}
        </button>
      </div>

      {/* Client Picker */}
      {showPicker && (
        <div className="border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 overflow-hidden">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700">
            <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">
              Select {t('record', { article: true })} from: <span className="font-medium text-slate-700 dark:text-slate-300">{currentGridName}</span>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${t('record', { many: true })}…`}
                autoFocus
                className="w-full pl-9 pr-3 py-2 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15, minHeight: 44 }}
              />
            </div>
          </div>

          {/* Client list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredClients.length === 0 ? (
              <div className="p-3 text-center text-slate-500 dark:text-slate-400" style={{ fontSize: 15 }}>
                {availableClients.length === 0
                  ? `No ${t('record', { many: true })} available to link.`
                  : `No matching ${t('record', { many: true })} found.`}
              </div>
            ) : (
              filteredClients.map(client => (
                <button
                  key={client.rowId}
                  onClick={() => setSelectedRowId(client.rowId === selectedRowId ? null : client.rowId)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                    selectedRowId === client.rowId
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-900 dark:text-white'
                  }`}
                  style={{ fontSize: 15, minHeight: 44 }}
                >
                  <Users size={14} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
                  <span className="truncate">{client.name}</span>
                </button>
              ))
            )}
          </div>

          {/* Notes + Confirm */}
          {selectedRowId !== null && (
            <div className="p-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full px-3 py-2 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15, minHeight: 44 }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleLink()
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleLink}
                  className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors focus:outline-hidden focus:ring-3 focus:ring-blue-500 font-medium"
                  style={{ fontSize: 15, minHeight: 44 }}
                >
                  Link {t('record', { cap: true })}
                </button>
                <button
                  onClick={() => {
                    setSelectedRowId(null)
                    setNotes('')
                    setShowPicker(false)
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                  style={{ fontSize: 15, minHeight: 44 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Linked clients list */}
      {links.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-500 dark:text-slate-400">
          <Users size={32} className="mb-2 opacity-50" />
          <p style={{ fontSize: 15 }}>No {t('record', { many: true })} linked to this {t('contact')}.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {links.map(link => (
            <div
              key={link.id}
              className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              style={{ minHeight: 44 }}
              onMouseEnter={() => setHoveredLinkId(link.id)}
              onMouseLeave={() => setHoveredLinkId(null)}
            >
              <Users size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => handleClientClick(link.row_id, link.grid_id)}
                  className="hit-44 flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm"
                  style={{ fontSize: 15 }}
                >
                  <span className="truncate">{link.client_name || `${t('record', { cap: true })} #${link.row_id}`}</span>
                  <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {link.grid_name && <span>{link.grid_name}</span>}
                  {link.grid_name && link.linked_at && <span>·</span>}
                  {link.linked_at && <span>Linked {formatDate(link.linked_at)}</span>}
                </div>
                {link.notes && (
                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 truncate" style={{ fontSize: 15 }}>
                    {link.notes}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleUnlink(link.id)}
                className={`flex-shrink-0 p-1.5 rounded-sm transition-opacity hover:bg-red-50 dark:hover:bg-red-900/20 focus:outline-hidden focus:ring-3 focus:ring-red-500 ${
                  hoveredLinkId === link.id ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ minWidth: 32, minHeight: 32 }}
                title={`Unlink ${t('record')}`}
              >
                <X size={14} className="text-red-600 dark:text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
