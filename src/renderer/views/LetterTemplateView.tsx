/**
 * LetterTemplateView — Full-page view at /letter-templates.
 * Two-column layout: template list on left, selected template on right.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Pencil, Trash2, Copy, Check, FileStack } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { Grid } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import type { LetterTemplate } from './letter-template/types'
import { LoadingOverlay as Spinner } from '../components/shared/LoadingSpinner'
import { EditTemplateModal } from './letter-template/EditTemplateModal'
import { GenerateLetterModal } from './letter-template/GenerateLetterModal'
import { DeleteConfirmModal } from './letter-template/DeleteConfirmModal'
import { PlaceholderReference } from './letter-template/PlaceholderReference'
import { useCopyFeedback } from '../hooks/useCopyFeedback'
import { EmptyState } from '../components/shared/EmptyState'
import { useVocab } from '../hooks/useVocab'
import { useGridStore } from '../stores/gridStore'
import { BatchDocumentsDialog } from '../components/documents/BatchDocumentsDialog'

/** Template text with each {{field}} as a readable chip, so it doesn't look like code */
export function TemplateText({ content }: { content: string }): React.ReactElement {
  const parts = content.split(/(\{\{[^{}]+\}\})/g)
  return (
    <div className="whitespace-pre-wrap text-base text-slate-800 dark:text-slate-200 leading-relaxed" data-testid="template-text">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([^{}]+?)\s*\}\}$/)
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>
        const label = m[1]!.replace(/^field:/, '').replace(/[_:]+/g, ' ').trim()
        return (
          <span key={i} title={p} className="inline-block px-1.5 mx-0.5 rounded-md border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
            {label}
          </span>
        )
      })}
    </div>
  )
}

export default function LetterTemplateView(): React.ReactElement {
  const { t: w } = useVocab(null)
  const [templates, setTemplates] = useState<LetterTemplate[]>([])
  const [grids, setGrids] = useState<Grid[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LetterTemplate | null>(null)
  const { copied, copyToClipboard: copyContent } = useCopyFeedback()

  // Modal state
  const [showEdit, setShowEdit] = useState(false)
  const [editTarget, setEditTarget] = useState<LetterTemplate | null>(null)  // null = new
  const [showGenerate, setShowGenerate] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const activeGridId = useGridStore(s => s.activeGridId)

  // copy feedback managed by useCopyFeedback hook

  // ── Load data ──────────────────────────────────────────────────────────

  /** Reload; selectId opens that template (a new one, straight after it's made) */
  const load = useCallback(async (selectId?: number) => {
    setLoading(true)
    try {
      const [tRes, gRes] = await Promise.all([
        safeInvoke<LetterTemplate[]>(IPC.LETTER_TEMPLATE_GET_ALL),
        safeInvoke<Grid[]>(IPC.GRID_GET_ALL),
      ])
      if (tRes.ok) {
        setTemplates(tRes.data)
        // Keep selection valid after reload
        setSelected(prev => {
          const wanted = selectId != null ? tRes.data.find(t => t.id === selectId) : undefined
          if (wanted) return wanted
          if (!prev) return tRes.data[0] ?? null
          return tRes.data.find(t => t.id === prev.id) ?? tRes.data[0] ?? null
        })
      }
      if (gRes.ok) setGrids(gRes.data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── CRUD operations ────────────────────────────────────────────────────

  async function handleSaveTemplate(name: string, description: string, content: string) {
    if (editTarget) {
      const res = await safeInvoke<true>(
        IPC.LETTER_TEMPLATE_UPDATE, editTarget.id, { name, description, content }
      )
      if (!res.ok) throw new Error(res.error ?? 'Could not update the template.')
    } else {
      const res = await safeInvoke<number>(
        IPC.LETTER_TEMPLATE_CREATE, name, description, content
      )
      if (!res.ok) throw new Error(res.error ?? 'Could not create the template.')
      await load(res.data)
      return
    }
    await load()
  }

  async function handleDeleteTemplate() {
    if (!selected) return
    const res = await safeInvoke<true>(IPC.LETTER_TEMPLATE_DELETE, selected.id)
    if (!res.ok) throw new Error(res.error ?? 'Could not delete the template.')
    await load()
  }

  async function handleCopyContent() {
    if (!selected) return
    await copyContent(selected.content)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-white dark:bg-slate-900">
      {/* Left panel — template list */}
      <div
        className="w-[30%] min-w-[220px] border-r border-slate-200 dark:border-slate-700 flex flex-col flex-shrink-0"
        style={{ minWidth: 220 }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Letter Templates
          </h1>
          <button
            onClick={() => { setEditTarget(null); setShowEdit(true) }}
            title="New Template"
            aria-label="New letter template"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600
                       text-white text-base font-medium focus:outline-hidden focus:ring-3 focus:ring-blue-500
                       focus:ring-offset-3 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && <Spinner />}

          {!loading && templates.length === 0 && (
            <EmptyState
              icon={<FileText className="w-10 h-10" />}
              title="No letter templates yet"
              description={`Letter templates let you create reusable documents with auto-filled ${w('record')} information.`}
              action={{ label: 'Create your first template', onClick: () => { setEditTarget(null); setShowEdit(true) } }}
            />
          )}

          {!loading && templates.map(t => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-700/50
                          flex flex-col gap-0.5 transition-colors min-h-[44px]
                          focus:outline-hidden focus:ring-3 focus:ring-inset focus:ring-blue-500
                          ${selected?.id === t.id
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-slate-800 dark:text-slate-100 flex-1 truncate">
                  {t.name}
                </span>
                {t.is_system === 1 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-sm font-medium
                                   bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0">
                    Built-in
                  </span>
                )}
              </div>
              {t.description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{t.description}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — selected template */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* With no templates the left panel's "Create your first template" says it all */}
        {!selected && !loading && templates.length > 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-base text-slate-500 dark:text-slate-400">Select a template to view it</p>
            </div>
          </div>
        )}

        {selected && (
          <>
            {/* Detail header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {selected.name}
                  </h2>
                  {selected.is_system === 1 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-sm font-medium
                                     bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                      Built-in
                    </span>
                  )}
                </div>
                {selected.description && (
                  <p className="text-base text-slate-500 dark:text-slate-400 mt-0.5">
                    {selected.description}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <button
                    onClick={() => { setEditTarget(selected); setShowEdit(true) }}
                    title="Edit this template"
                    aria-label="Edit template"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300
                               dark:border-slate-600 text-base text-slate-700 dark:text-slate-200
                               hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3
                               focus:ring-blue-500 min-h-[44px]"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                <button
                  onClick={handleCopyContent}
                  title="Copy template content to clipboard"
                  aria-label="Copy template content to clipboard"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300
                             dark:border-slate-600 text-base text-slate-700 dark:text-slate-200
                             hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3
                             focus:ring-blue-500 min-h-[44px]"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                    onClick={() => setShowDelete(true)}
                    title="Delete this template"
                    aria-label="Delete template"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200
                               dark:border-red-800 text-base text-red-600 dark:text-red-400
                               hover:bg-red-50 dark:hover:bg-red-900/20 focus:outline-hidden focus:ring-3
                               focus:ring-red-500 min-h-[44px]"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                <button
                  onClick={() => setShowGenerate(true)}
                  title="Generate a letter from this template"
                  aria-label="Generate letter from template"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600
                             text-white text-base font-medium focus:outline-hidden focus:ring-3 focus:ring-blue-500
                             focus:ring-offset-3 min-h-[44px]"
                >
                  <FileText className="w-4 h-4" />
                  Generate Letter
                </button>
                {grids.length > 0 && (
                  <button
                    onClick={() => setShowBatch(true)}
                    title={`One PDF with a letter for each of many ${w('record', { many: true })}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300
                               dark:border-slate-600 text-base text-slate-700 dark:text-slate-200
                               hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3
                               focus:ring-blue-500 min-h-[44px]"
                  >
                    <FileStack className="w-4 h-4" />
                    Make letters for many…
                  </button>
                )}
              </div>
            </div>

            {/* Content preview + placeholder reference */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <TemplateText content={selected.content} />
              </div>

              <PlaceholderReference />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showEdit && (
        <EditTemplateModal
          template={editTarget}
          onSave={handleSaveTemplate}
          onClose={() => { setShowEdit(false); setEditTarget(null) }}
        />
      )}

      {showGenerate && selected && (
        <GenerateLetterModal
          template={selected}
          grids={grids}
          onClose={() => setShowGenerate(false)}
        />
      )}

      {showBatch && selected && grids.length > 0 && (
        <BatchDocumentsDialog
          gridId={grids.some(g => g.id === activeGridId) ? activeGridId! : grids[0]!.id}
          initialTemplateId={selected.id}
          pickList
          onClose={() => setShowBatch(false)}
        />
      )}

      {showDelete && selected && (
        <DeleteConfirmModal
          template={selected}
          onConfirm={handleDeleteTemplate}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  )
}
