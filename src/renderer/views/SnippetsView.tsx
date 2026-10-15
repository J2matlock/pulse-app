import React, { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, X, Zap } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import { expandVariables } from '../utils/snippetExpander'
import { useSettingsStore } from '../stores/settingsStore'
import type { Snippet } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { EmptyState } from '../components/shared/EmptyState'
import { FieldError, fieldErrorProps } from '../components/shared/FieldError'
import { isMod } from '../utils/keys'
import { useVocab } from '../hooks/useVocab'
import toast from 'react-hot-toast'
import { friendlyError } from '../utils/friendlyError'
import { PrimaryButton, DangerButton } from '../components/ui/Button'

// ── Variable helper ───────────────────────────────────────────────────────────

const VARIABLES = [
  { label: '{today}',    desc: 'Today\'s date' },
  { label: '{today+7}',  desc: '7 days from now' },
  { label: '{today+14}', desc: '14 days from now' },
  { label: '{today+30}', desc: '30 days from now' },
  { label: '{today-1}',  desc: 'Yesterday' },
  { label: '{now}',      desc: 'Current time' },
  { label: '{client_name}', desc: 'Name of the {record} (on {a record}\'s page)' },
]

// ── Snippet editor dialog ─────────────────────────────────────────────────────

interface EditorProps {
  initial?: Snippet
  /** Resolves true when saved; the editor stays open (with the text) when it wasn't */
  onSave: (trigger: string, expansion: string, category: string) => Promise<boolean>
  onClose: () => void
  /** Triggers other snippets already use */
  takenTriggers: string[]
}

function SnippetEditor({ initial, onSave, onClose, takenTriggers }: EditorProps) {
  const { t, f } = useVocab(null)
  // {today} and {now} follow Settings → Date format and Clock (A21a-09)
  const snippetFormats = { dateFormat: useSettingsStore(s => s.dateFormat), clockFormat: useSettingsStore(s => s.clockFormat) }
  const [trigger, setTrigger] = useState(initial?.trigger_text ?? '')
  const [expansion, setExpansion] = useState(initial?.expansion ?? '')
  const [category] = useState(initial?.category ?? '')
  const [triggerError, setTriggerError] = useState('')
  const [saving, setSaving] = useState(false)
  const expansionRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLInputElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true, { onEscape: onClose })
  useEffect(() => { triggerRef.current?.focus() }, [])

  function insertVariable(v: string) {
    const el = expansionRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = expansion.slice(0, start) + v + expansion.slice(end)
    setExpansion(newVal)
    requestAnimationFrame(() => {
      el.setSelectionRange(start + v.length, start + v.length)
      el.focus()
    })
  }

  function validateTrigger(val: string): string {
    if (!val) return 'Type a trigger, like fu.'
    if (/\s/.test(val)) return 'Leave out spaces: a trigger is one word.'
    if (takenTriggers.some(t => t.toLowerCase() === val.trim().toLowerCase())) return `/${val.trim()} is already used by another snippet. Choose a different trigger.`
    return ''
  }

  async function handleSave() {
    if (saving) return
    const err = validateTrigger(trigger)
    if (err) { setTriggerError(err); return }
    if (!expansion.trim()) return
    setSaving(true)
    try {
      if (await onSave(trigger.trim(), expansion.trim(), category.trim())) onClose()
    } finally {
      setSaving(false)
    }
  }

  const preview = expandVariables(expansion, 'Maria Rodriguez', snippetFormats)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="snippet-dialog-title" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <Zap className="w-5 h-5 text-blue-500" />
          <h2 id="snippet-dialog-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            {initial ? 'Edit snippet' : 'New snippet'}
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="hit-44 p-1 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Trigger */}
          <div>
            <label htmlFor="snippet-trigger" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              Trigger <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <div className="flex items-center gap-0">
              <span className="px-3 py-2 rounded-l-lg border border-r-0 border-slate-300 dark:border-slate-600
                               bg-slate-100 dark:bg-slate-700 text-slate-500 font-mono text-base select-none">
                /
              </span>
              <input
                id="snippet-trigger"
                ref={triggerRef}
                value={trigger}
                onChange={e => { setTrigger(e.target.value.replace(/\s/g, '')); setTriggerError('') }}
                onKeyDown={e => { if (e.key === 'Enter') expansionRef.current?.focus() }}
                className={`flex-1 rounded-r-lg border px-3 py-2 font-mono text-base
                            bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                            focus:outline-hidden focus:ring-3 focus:ring-blue-500
                            ${triggerError ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'}`}
                placeholder="lm"
                style={{ fontSize: 15 }}
                aria-required="true"
                {...fieldErrorProps('snippet-trigger', triggerError, 'snippet-trigger-hint')}
              />
            </div>
            <FieldError fieldId="snippet-trigger" error={triggerError} className="text-sm text-red-600 dark:text-red-400 mt-1" />
            <p id="snippet-trigger-hint" className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Type /{trigger || 'lm'} in any {t('activity')} or in scratch notes to expand.
            </p>
          </div>

          {/* Expansion */}
          <div>
            <label htmlFor="snippet-expansion" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              Expansion <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <textarea
              id="snippet-expansion"
              ref={expansionRef}
              aria-required="true"
              value={expansion}
              onChange={e => setExpansion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); void handleSave() } }}
              rows={4}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 resize-y focus:outline-hidden focus:ring-3 focus:ring-blue-500"
              placeholder="Left message on voicemail on {today}."
              style={{ fontSize: 15 }}
            />
          </div>

          {/* Variable helper */}
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              Variables — click to insert at cursor:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map(v => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => insertVariable(v.label)}
                  title={f(v.desc)}
                  className="hit-44 px-2 py-1 rounded-sm border border-blue-200 dark:border-blue-800
                             bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300
                             font-mono text-base hover:bg-blue-100 dark:hover:bg-blue-900/40
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>


          {/* Live preview */}
          {expansion.trim() && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-900">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Preview:</p>
              <p className="text-base text-slate-800 dark:text-slate-200 whitespace-pre-wrap" style={{ fontSize: 15 }}>
                {preview}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => void handleSave()}
            disabled={!trigger.trim() || !expansion.trim()}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {initial ? 'Save changes' : 'Add snippet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SnippetsView ──────────────────────────────────────────────────────────────

export default function SnippetsView(): React.ReactElement {
  const { t } = useVocab(null)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(true)
  const [showEditor, setShowEditor] = useState(false)
  const [editTarget, setEditTarget] = useState<Snippet | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await safeInvoke<Snippet[]>(IPC.SNIPPET_GET_ALL)
      if (res.ok) setSnippets(res.data)
    } catch {
      // IPC error — keep existing snippets, stop spinner
    }
    setLoading(false)
  }

  async function handleSave(trigger: string, expansion: string, category: string): Promise<boolean> {
    if (editTarget) {
      const res = await safeInvoke<boolean>(IPC.SNIPPET_UPDATE, editTarget.id, {
        trigger_text: trigger, expansion, category: category || null
      })
      if (!res.ok) { toast.error('We couldn\'t save the snippet. Check that its trigger isn\'t already used, then try again.'); return false }
      setSnippets(prev => prev.map(s =>
        s.id === editTarget.id ? { ...s, trigger_text: trigger, expansion, category: category || null } : s
      ))
      return true
    }
    const res = await safeInvoke<Snippet>(IPC.SNIPPET_CREATE, trigger, expansion, category || null)
    if (!res.ok) { toast.error('We couldn\'t save the snippet. Check that its trigger isn\'t already used, then try again.'); return false }
    setSnippets(prev => [...prev, res.data])
    return true
  }

  async function handleDelete(id: number) {
    const res = await safeInvoke(IPC.SNIPPET_DELETE, id)
    setConfirmDeleteId(null)
    if (!res.ok) { toast.error(friendlyError(res.error, "We couldn't delete that snippet — try again")); return }
    setSnippets(prev => prev.filter(s => s.id !== id))
  }

  const filtered = snippets
    .filter(s =>
      !search ||
      s.trigger_text.toLowerCase().includes(search.toLowerCase()) ||
      s.expansion.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.trigger_text.localeCompare(b.trigger_text))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-wrap">
        <Zap className="w-5 h-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0">Snippets</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 hidden sm:block">
          Type <span className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded-sm">/trigger</span> in any {t('activity')} or in scratch notes
        </p>
        <PrimaryButton
          onClick={() => { setEditTarget(null); setShowEditor(true) }}
          aria-label="Create a new snippet"
          icon={<Plus className="w-4 h-4" />}
        >
          New snippet
        </PrimaryButton>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-700/50">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search snippets…"
          className="input w-full max-w-sm"
          style={{ fontSize: 15 }}
        />
      </div>

      {/* Snippet list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-3xl">
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-12">Loading…</p>
        )}

        {!loading && filtered.length === 0 && (
          search ? (
            <div className="text-center py-16">
              <Zap className="w-12 h-12 text-slate-300 dark:text-slate-500 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400">No snippets match your search.</p>
            </div>
          ) : (
            <EmptyState
              icon={<Zap className="w-12 h-12" />}
              title="No snippets yet"
              description="Snippets are text shortcuts — type a trigger like /sig and it expands to your full signature."
              action={{ label: 'Create your first snippet', onClick: () => { setEditTarget(null); setShowEditor(true) } }}
            />
          )
        )}

        {filtered.length > 0 && (
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
            {filtered.map(s => (
              <div key={s.id}
                   className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 group">
                {/* Trigger */}
                <span className="font-mono text-base font-semibold text-blue-700 dark:text-blue-400 flex-shrink-0 mt-0.5"
                      style={{ fontSize: 15 }}>
                  /{s.trigger_text}
                </span>

                {/* Expansion preview */}
                <span className="flex-1 text-base text-slate-600 dark:text-slate-300 line-clamp-2"
                      style={{ fontSize: 15 }}>
                  {s.expansion}
                </span>

                {/* Actions: always shown, in words, so it's clear a snippet can be changed (E-29) */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditTarget(s); setShowEditor(true) }}
                    aria-label={`Edit /${s.trigger_text}`}
                    className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600
                               text-base text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                               focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    Edit
                  </button>

                  {confirmDeleteId === s.id ? (
                    <>
                      <DangerButton size="compact" onClick={() => handleDelete(s.id)} aria-label="Confirm delete snippet">
                        Delete
                      </DangerButton>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        title="Cancel delete"
                        aria-label="Cancel delete"
                        className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-slate-600 hover:bg-slate-100
                                   dark:hover:bg-slate-700
                                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(s.id)}
                      aria-label={`Delete /${s.trigger_text}`}
                      className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 dark:border-red-700
                                 text-base text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors
                                 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor dialog */}
      {showEditor && (
        <SnippetEditor
          initial={editTarget ?? undefined}
          onSave={handleSave}
          takenTriggers={snippets.filter(s => s.id !== editTarget?.id).map(s => s.trigger_text)}
          onClose={() => { setShowEditor(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
