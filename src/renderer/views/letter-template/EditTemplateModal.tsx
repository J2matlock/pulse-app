import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, X, AlertTriangle, Braces } from 'lucide-react'
import { rlog } from '../../utils/rendererLogger'
import type { LetterTemplate } from './types'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { VariableInsertMenu, VARIABLE_GROUPS, type VariableGroup } from '../../components/shared/VariableInsertMenu'
import { TemplateText } from './TemplateText'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { useVocab } from '../../hooks/useVocab'
import { rememberedList, rememberList } from './templateList'

interface EditModalProps {
  template: LetterTemplate | null  // null = new
  onSave: (name: string, description: string, content: string) => Promise<void>
  onClose: () => void
}

export function EditTemplateModal({ template, onSave, onClose }: EditModalProps): React.ReactElement {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Which box a missing-value message is about, so that box points at it (audit A06-14)
  const [errorField, setErrorField] = useState<'name' | 'content' | null>(null)
  const [showVarMenu, setShowVarMenu] = useState(false)
  const { t, f } = useVocab(null)
  // "Insert field" offers a list's columns, deadlines and links (W10 §3): the
  // list this template was last used with, else the open one, and it can be changed
  const activeGridId = useGridStore(s => s.activeGridId)
  const grids = useGridStore(s => s.grids)
  const [fieldGridId, setFieldGridId] = useState<number | null>(() => rememberedList(template?.id) ?? activeGridId ?? grids[0]?.id ?? null)
  const [fieldGroups, setFieldGroups] = useState<VariableGroup[]>([])
  useEffect(() => {
    if (!fieldGridId) { setFieldGroups([]); return }
    void safeInvoke<VariableGroup[]>(IPC.PLACEHOLDER_FIELDS, fieldGridId).then(r => { if (r.ok) setFieldGroups(r.data) })
  }, [fieldGridId])
  // Plain names for the preview's chips: "{{my_name}}" shows as "Your name" (E-26)
  const previewLabels = useMemo(() => Object.fromEntries([...VARIABLE_GROUPS, ...fieldGroups]
    .flatMap(g => g.items.map(i => [i.key, f(i.desc).replace(/, like .*$/, '')]))), [fieldGroups, f])
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = name !== (template?.name ?? '') || description !== (template?.description ?? '') || content !== (template?.content ?? '')
  // Closing by Escape, the backdrop, X or Cancel asks first when something was typed
  const requestClose = () => { if (dirty) setConfirmDiscard(true); else onClose() }
  const nameRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)
  const varButtonRef = useRef<HTMLButtonElement>(null)

  useFocusTrap(trapRef, true)

  useEffect(() => { nameRef.current?.focus() }, [])

  const closeRef = useRef(requestClose)
  useEffect(() => { closeRef.current = requestClose })
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Escape closes the field menu or the question first, not the letter
      if (e.key === 'Escape' && !showVarMenu && !confirmDiscard) closeRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showVarMenu, confirmDiscard])

  function insertPlaceholder(key: string) {
    const el = contentRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = content.slice(0, start) + key + content.slice(end)
    setContent(next)
    requestAnimationFrame(() => {
      el.setSelectionRange(start + key.length, start + key.length)
      el.focus()
    })
  }

  async function handleSave() {
    if (!name.trim()) { setError('Give the template a name.'); setErrorField('name'); nameRef.current?.focus(); return }
    if (!content.trim()) { setError('Write the letter before saving the template.'); setErrorField('content'); contentRef.current?.focus(); return }
    setSaving(true)
    setError(null)
    setErrorField(null)
    try {
      await onSave(name.trim(), description.trim(), content.trim())
      rememberList(template?.id, fieldGridId)
      onClose()
    } catch (err) {
      rlog.error('EditTemplateModal', 'Failed to save letter template:', err)
      setError("We couldn't save the template — try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="letter-edit-title" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <h2 id="letter-edit-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            {template ? 'Edit template' : 'New letter template'}
          </h2>
          <button
            onClick={requestClose}
            className="p-2 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px] min-w-[44px]
                       flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div id="letter-edit-error" role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-base text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="letter-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              Name <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <input
              id="letter-name"
              ref={nameRef}
              aria-required="true"
              aria-invalid={(error && errorField === 'name') || undefined}
              aria-describedby={error && errorField === 'name' ? 'letter-edit-error' : undefined}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 90-day transition notice"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
            />
          </div>

          <div>
            <label htmlFor="letter-description" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              Description
            </label>
            <input
              id="letter-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of when to use this template"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="letter-content" className="block text-base font-medium text-slate-700 dark:text-slate-300">
                Content <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <div className="relative flex items-center gap-2">
                {grids.length > 1 && (
                  <select aria-label={`Fields from which ${t('list')}`} className="input w-auto" style={{ minHeight: 44, fontSize: 15 }}
                    value={fieldGridId ?? ''} onChange={e => setFieldGridId(Number(e.target.value))}>
                    {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
                <button
                  ref={varButtonRef}
                  type="button"
                  onClick={() => setShowVarMenu(!showVarMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300
                             dark:border-slate-600 text-base text-slate-700 dark:text-slate-200
                             hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3
                             focus:ring-blue-500 min-h-[44px]"
                  title="Add a detail that fills in by itself"
                >
                  <Braces className="w-4 h-4" />
                  Insert a detail
                </button>
                <VariableInsertMenu
                  open={showVarMenu}
                  onClose={() => setShowVarMenu(false)}
                  onInsert={insertPlaceholder}
                  anchorRef={varButtonRef}
                  extraGroups={fieldGroups}
                />
              </div>
            </div>
            {/* The text box and, beside it, the letter as it reads, with details as plain names (E-26) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <textarea
              id="letter-content"
              ref={contentRef}
              aria-required="true"
              aria-invalid={(error && errorField === 'content') || undefined}
              aria-describedby={error && errorField === 'content' ? 'letter-edit-error' : undefined}
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={15}
              placeholder="Dear {{name}},&#10;&#10;This letter is to inform you..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base font-mono focus:outline-hidden focus:ring-3 focus:ring-blue-500
                         resize-y"
              style={{ fontSize: 15 }}
            />
            <section aria-labelledby="letter-preview-heading" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 min-h-[10rem] overflow-y-auto max-h-[28rem]">
              <h3 id="letter-preview-heading" className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Preview</h3>
              {content.trim()
                ? <TemplateText content={content} labels={previewLabels} />
                : <p className="text-base text-slate-500 dark:text-slate-400">Type your letter on the left. Details you add with "Insert a detail" show here by name.</p>}
            </section>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={requestClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-base font-medium
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:ring-offset-3
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {saving ? 'Saving...' : 'Save template'}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        message="What you typed in this template hasn't been saved."
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => { setConfirmDiscard(false); onClose() }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  )
}
