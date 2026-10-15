import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Phone, Mail, MapPin, MessageSquare, Pencil, Trash2, Plus, Search, X, Users, ArrowRight, MoreHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import type { ProviderInteraction, ProviderContactType } from '../../../shared/types'
import { DEBOUNCE_SEARCH } from '../../../shared/constants'
import { relativeTime } from '../../utils/relativeTime'
import { parseDbTimestamp } from '../../../shared/dates'
import { isMod, modHelp } from '../../utils/keys'
import { IconButton } from '../ui/Button'
import { EmptyState } from '../shared/EmptyState'

interface Props {
  providerId: number
}

const CONTACT_TYPES: { type: ProviderContactType; label: string; icon: typeof Phone; borderColor: string; bgColor: string }[] = [
  { type: 'call', label: 'Call', icon: Phone, borderColor: 'border-l-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  { type: 'email', label: 'Email', icon: Mail, borderColor: 'border-l-green-500', bgColor: 'bg-green-50 dark:bg-green-900/20' },
  { type: 'visit', label: 'Visit', icon: MapPin, borderColor: 'border-l-purple-500', bgColor: 'bg-purple-50 dark:bg-purple-900/20' },
  { type: 'note', label: 'Note', icon: MessageSquare, borderColor: 'border-l-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
  { type: 'meeting', label: 'Meeting', icon: Users, borderColor: 'border-l-violet-500', bgColor: 'bg-violet-50 dark:bg-violet-900/20' },
  { type: 'referral', label: 'Referral', icon: ArrowRight, borderColor: 'border-l-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-900/20' },
  { type: 'other', label: 'Other', icon: MoreHorizontal, borderColor: 'border-l-slate-400', bgColor: 'bg-slate-50 dark:bg-slate-800/40' },
]

function getTypeConfig(type: ProviderContactType): (typeof CONTACT_TYPES)[number] {
  return CONTACT_TYPES.find(t => t.type === type) ?? CONTACT_TYPES[3]!
}

function TypeIcon({ type, size = 16 }: { type: ProviderContactType; size?: number }) {
  const config = getTypeConfig(type)
  const Icon = config.icon
  return <Icon size={size} />
}


function InteractionEntry({
  interaction,
  onUpdate,
  onDelete,
}: {
  interaction: ProviderInteraction
  onUpdate: (id: number, data: { content?: string; contact_type?: string }) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(interaction.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const config = getTypeConfig(interaction.contact_type)

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.selectionStart = editRef.current.value.length
    }
  }, [editing])

  async function handleSave() {
    const trimmed = editContent.trim()
    if (!trimmed) return
    await onUpdate(interaction.id, { content: trimmed })
    setEditing(false)
  }

  async function handleDelete() {
    await onDelete(interaction.id)
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditContent(interaction.content)
      setEditing(false)
    }
  }

  return (
    <div
      className={`group rounded-lg border-l-4 ${config.borderColor} ${config.bgColor} border border-slate-200 dark:border-slate-700 p-3`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400">
          <TypeIcon type={interaction.contact_type} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium uppercase text-slate-500 dark:text-slate-400" style={{ fontSize: 15 }}>
              {config.label}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400" style={{ fontSize: 15 }}>
              {relativeTime(interaction.created_at)}
            </span>
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                ref={editRef}
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={3}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-3 py-2 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15 }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="hit-44 px-3 py-1.5 rounded-md bg-blue-600 text-white text-base font-medium hover:bg-blue-700 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                  style={{ minHeight: 44 }}
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditContent(interaction.content); setEditing(false) }}
                  className="hit-44 px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 text-base hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                  style={{ minHeight: 44 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words" style={{ fontSize: 15 }}>
              {interaction.content}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <IconButton label="Edit" icon={<Pencil size={15} />} onClick={() => { setEditContent(interaction.content); setEditing(true) }} />
            {/* Deletes at once; the Undo toast brings it back (Q4) */}
            <IconButton label="Delete" icon={<Trash2 size={15} />} onClick={() => void handleDelete()} className="hover:text-red-600" />
          </div>
        )}
      </div>
    </div>
  )
}

export function ContactInteractionLog({ providerId }: Props) {
  const { interactions, addInteraction, updateInteraction, deleteInteraction } = useContactsStore(useShallow(s => ({
    interactions: s.interactions,
    addInteraction: s.addInteraction,
    updateInteraction: s.updateInteraction,
    deleteInteraction: s.deleteInteraction,
  })))

  const [newType, setNewType] = useState<ProviderContactType>('note')
  const [newContent, setNewContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), DEBOUNCE_SEARCH)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Filtered and sorted interactions (reverse-chronological)
  const filteredInteractions = useMemo(() => {
    const sorted = [...interactions]
      .filter(i => i.provider_id === providerId)
      .sort((a, b) => parseDbTimestamp(b.created_at).getTime() - parseDbTimestamp(a.created_at).getTime())

    if (!debouncedSearch.trim()) return sorted

    const q = debouncedSearch.toLowerCase()
    return sorted.filter(i => i.content.toLowerCase().includes(q))
  }, [interactions, providerId, debouncedSearch])

  const handleSubmit = useCallback(async () => {
    const trimmed = newContent.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await addInteraction(providerId, newType, trimmed)
      setNewContent('')
      setNewType('note')
      textareaRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }, [newContent, newType, submitting, providerId, addInteraction])

  function handleFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add interaction form */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        {/* Wraps: the detail panel is too narrow for all seven types on one line */}
        <div className="flex flex-wrap items-center gap-1 mb-3" role="group" aria-label="Type">
          {CONTACT_TYPES.map(ct => {
            const Icon = ct.icon
            const selected = newType === ct.type
            return (
              <button
                key={ct.type}
                onClick={() => setNewType(ct.type)}
                aria-pressed={selected}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-base font-medium transition-colors focus:outline-hidden focus:ring-3 focus:ring-blue-500 ${
                  selected
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
                style={{ minHeight: 44, fontSize: 15 }}
                title={ct.label}
              >
                <Icon size={16} />
                <span>{ct.label}</span>
              </button>
            )
          })}
        </div>
        <textarea
          ref={textareaRef}
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          onKeyDown={handleFormKeyDown}
          rows={3}
          placeholder="What happened?"
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-2 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-hidden focus:ring-3 focus:ring-blue-500 resize-none"
          style={{ fontSize: 15 }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm text-slate-500 dark:text-slate-400" style={{ fontSize: 15 }}>
            {modHelp('Ctrl+Enter to submit')}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!newContent.trim() || submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-base font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ minHeight: 44 }}
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>

      {/* Search */}
      {interactions.filter(i => i.provider_id === providerId).length > 0 && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search this history…"
            className="w-full pl-9 pr-8 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15, minHeight: 44 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="hit-44 absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Interaction list */}
      {filteredInteractions.length === 0 ? (
        debouncedSearch.trim()
          ? <p className="text-base text-slate-600 dark:text-slate-300 text-center py-8">Nothing in this history matches your search.</p>
          : <EmptyState size="panel" icon={<MessageSquare />} title="No history yet"
              description="Note a call, meeting or email above to keep track of what was said." />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredInteractions.map(interaction => (
            <InteractionEntry
              key={interaction.id}
              interaction={interaction}
              onUpdate={updateInteraction}
              onDelete={deleteInteraction}
            />
          ))}
        </div>
      )}
    </div>
  )
}
