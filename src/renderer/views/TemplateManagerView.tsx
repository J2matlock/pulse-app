/**
 * TemplateManagerView — Full-page view at /templates.
 * Manages setup templates (.pulse files) and checklist templates.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Download, Upload, FileText, Plus, Check } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { ChecklistTemplate, SaveDialogResult, OpenDialogResult } from '../../shared/types'
import { useGridStore } from '../stores/gridStore'
import { safeInvoke } from '../utils/safeInvoke'
import toast from 'react-hot-toast'
import { rlog } from '../utils/rendererLogger'
import { ChecklistTemplateEditor } from '../components/profile/ChecklistTemplateEditor'
import { ImportPreviewModal } from '../components/shared/ImportPreviewModal'
import type { PulseImportPreview, ImportedFile } from '../components/shared/ImportPreviewModal'
import type { SetupTemplate } from './template-manager/types'
import { LoadingOverlay as Spinner } from '../components/shared/LoadingSpinner'
import { SetupTemplateCard } from './template-manager/SetupTemplateCard'
import { ChecklistTemplateRow } from './template-manager/ChecklistTemplateRow'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { EmptyState } from '../components/shared/EmptyState'
import { useVocab } from '../hooks/useVocab'
import { PrimaryButton } from '../components/ui/Button'
import { PurposeLine } from '../components/shared/PurposeLine'
import { useFeature } from '../hooks/useFeature'
import { friendlyError } from '../utils/friendlyError'

export default function TemplateManagerView(): React.ReactElement {
  const checklistsOn = useFeature('checklists')
  const { t: w, f } = useVocab(null)
  const [setupTemplates, setSetupTemplates] = useState<SetupTemplate[]>([])
  const [clTemplates, setClTemplates] = useState<ChecklistTemplate[]>([])
  // From the grid store, so a list made while this page is open (applying a
  // template, or from the sidebar) shows up here too
  const grids = useGridStore(s => s.grids)
  const [loadingSetup, setLoadingSetup] = useState(true)
  const [loadingCL, setLoadingCL] = useState(true)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [clError, setClError] = useState<string | null>(null)

  // Checklist editor modal
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTemplate, setEditorTemplate] = useState<ChecklistTemplate | null>(null)

  // Import flow
  const [importedFile, setImportedFile] = useState<ImportedFile | null>(null)
  const [importing, setImporting] = useState(false)

  // Export state
  const [exporting, setExporting] = useState(false)
  const [gridPickerOpen, setGridPickerOpen] = useState(false)
  const [pickerGridId, setPickerGridId] = useState<number | null>(null)
  const gridPickerTrapRef = useRef<HTMLDivElement>(null)
  const gridPickerTitleId = useId()
  useFocusTrap(gridPickerTrapRef, gridPickerOpen, { onEscape: () => setGridPickerOpen(false) })

  const loadSetupTemplates = useCallback(async () => {
    setLoadingSetup(true)
    setSetupError(null)
    try {
      const res = await safeInvoke<SetupTemplate[]>(IPC.SETUP_TEMPLATE_GET_ALL)
      if (res.ok) {
        setSetupTemplates(res.data)
      } else {
        setSetupError(friendlyError(res.error, "We couldn't load the templates — try again"))
      }
    } catch (err) {
      rlog.error('TemplateManagerView', 'Failed to load setup templates', err)
      setSetupError("We couldn't load the templates — try again")
    } finally {
      setLoadingSetup(false)
    }
  }, [])

  const loadCLTemplates = useCallback(async () => {
    setLoadingCL(true)
    setClError(null)
    try {
      const res = await safeInvoke<ChecklistTemplate[]>(IPC.CL_TEMPLATE_GET_ALL)
      if (res.ok) {
        setClTemplates(res.data)
      } else {
        setClError("We couldn't load the checklist templates — try again")
      }
    } catch {
      setClError("We couldn't load the checklist templates — try again")
    } finally {
      setLoadingCL(false)
    }
  }, [])

  const loadGrids = useCallback(async () => {
    await useGridStore.getState().loadGridList()
  }, [])

  useEffect(() => {
    void loadSetupTemplates()
    void loadCLTemplates()
    void loadGrids()
  }, [loadSetupTemplates, loadCLTemplates, loadGrids])

  async function handleImport() {
    setImporting(true)
    try {
      const dialogRes = await safeInvoke<OpenDialogResult>(IPC.APP_SHOW_FILE_DIALOG, {
        title: 'Open a template file',
        filters: [{ name: 'Pulse templates', extensions: ['pulse'] }],
        properties: ['openFile'],
      })

      if (!dialogRes.ok || !dialogRes.data || dialogRes.data.canceled || dialogRes.data.filePaths.length === 0) return

      const filePath = dialogRes.data.filePaths[0]!

      const previewRes = await safeInvoke<{ pulse: unknown; preview: PulseImportPreview }>(IPC.SETUP_TEMPLATE_IMPORT, filePath)

      if (!previewRes.ok) {
        setSetupError(friendlyError(previewRes.error, "We couldn't read that template file — choose a file whose name ends in .pulse"))
        return
      }

      setImportedFile({ filePath, preview: previewRes.data.preview })
    } catch {
      setSetupError("We couldn't open that file — try again")
    } finally {
      setImporting(false)
    }
  }

  function handleExportCurrentGrid() {
    if (grids.length === 0) {
      setSetupError(`There's no ${w('list')} to save yet. Make one first.`)
      return
    }
    if (grids.length === 1) {
      void doExport(grids[0]!.id)
    } else {
      // The open list, when there is one
      const open = useGridStore.getState().activeGridId
      setPickerGridId(grids.some(g => g.id === open) ? open! : grids[0]!.id)
      setGridPickerOpen(true)
    }
  }

  async function doExport(gridId: number) {
    const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
      title: 'Save the template as',
      defaultPath: `${grids.find(g => g.id === gridId)?.name ?? 'template'}.pulse`,
      filters: [{ name: 'Pulse templates', extensions: ['pulse'] }],
    })

    if (!saveRes.ok || !saveRes.data || saveRes.data.canceled || !saveRes.data.filePath) return

    setExporting(true)
    try {
      const res = await safeInvoke<true>(IPC.SETUP_TEMPLATE_EXPORT, gridId, saveRes.data.filePath)
      if (!res.ok) {
        setSetupError(friendlyError(res.error, "We couldn't export the template — try again"))
      } else {
        void loadSetupTemplates()
      }
    } catch {
      setSetupError("We couldn't export the template — try again")
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteSetupTemplate(id: number) {
    try {
      const res = await safeInvoke<true>(IPC.SETUP_TEMPLATE_DELETE, id)
      if (res.ok) {
        setSetupTemplates(prev => prev.filter(t => t.id !== id))
      } else {
        setSetupError(friendlyError(res.error, "We couldn't delete the template — try again"))
      }
    } catch {
      setSetupError("We couldn't delete the template — try again")
    }
  }

  async function handleDeleteCLTemplate(id: number) {
    try {
      const res = await safeInvoke<true>(IPC.CL_TEMPLATE_DELETE, id)
      if (res.ok) {
        setClTemplates(prev => prev.filter(t => t.id !== id))
      } else {
        setClError(friendlyError(res.error, "We couldn't delete the template — try again"))
      }
    } catch {
      setClError("We couldn't delete the template — try again")
    }
  }

  function handleCLSaved(saved: ChecklistTemplate) {
    setClTemplates(prev => {
      const idx = prev.findIndex(t => t.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [...prev, saved]
    })
  }

  async function handleExportCLTemplate(template: ChecklistTemplate) {
    try {
      const slug = template.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
      const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Export a checklist template',
        defaultPath: `${slug}.pulse-checklist`,
        filters: [{ name: 'Pulse checklist template', extensions: ['pulse-checklist'] }],
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const res = await safeInvoke<true>(IPC.CL_TEMPLATE_EXPORT, template.id, saveRes.data.filePath)
      if (!res.ok) setClError(friendlyError(res.error, "We couldn't export the template — try again"))
    } catch {
      setClError("We couldn't export the template — try again")
    }
  }

  async function handleImportCLTemplate() {
    try {
      const openRes = await safeInvoke<OpenDialogResult>(IPC.APP_SHOW_FILE_DIALOG, {
        title: 'Import a checklist template',
        properties: ['openFile'],
        filters: [{ name: 'Pulse checklist template', extensions: ['pulse-checklist'] }],
      })
      if (!openRes.ok || openRes.data.canceled || !openRes.data.filePaths?.length) return
      const res = await safeInvoke<ChecklistTemplate>(IPC.CL_TEMPLATE_IMPORT, openRes.data.filePaths[0])
      if (res.ok) {
        setClTemplates(prev => [...prev, res.data])
      } else {
        setClError(friendlyError(res.error, "We couldn't bring in the template — check that it's a Pulse checklist file and try again"))
      }
    } catch {
      setClError("We couldn't bring in the template — check that it's a Pulse checklist file and try again")
    }
  }

  function openEditor(template: ChecklistTemplate | null) {
    setEditorTemplate(template)
    setEditorOpen(true)
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">

      {/* Page header — fixed at top */}
      <div className="flex-shrink-0 max-w-7xl w-full mx-auto px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Templates</h1>
        {/* One name per thing: layouts are whole-{list} setups, checklists are to-do lists (E-28) */}
        <PurposeLine className="mt-1">{f("Reuse {a list}'s columns and rules (layouts), or a standard to-do list for {a record}'s page (checklists).")}</PurposeLine>
      </div>

      <div className="flex-1 min-h-0 max-w-7xl w-full mx-auto px-6 pb-8">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-full items-start" style={{ gridTemplateRows: '1fr' }}>

        {/* ── Caseload Templates (left) ──────────────────────────────────── */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto max-h-full">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {w('list', { cap: true })} layouts
            </h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Each is saved as a layout file (.pulse): your columns, column types, deadline rules, note tracking and checklist assignments.
            Use one to start a new {w('list')} with the same setup, or share it with a colleague.
          </p>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              title="Open a layout file someone gave you"
              aria-label="Open a layout file"
              className="hit-44 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                         text-base text-slate-700 dark:text-slate-300
                         hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[40px]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         focus:outline-hidden focus:ring-3 focus:ring-slate-400 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'Opening…' : 'Open a layout file…'}
            </button>
            <button
              type="button"
              onClick={handleExportCurrentGrid}
              disabled={exporting}
              title={`Save the current ${w('list')}'s columns and rules as a layout file`}
              aria-label={`Save this ${w('list')}'s layout`}
              className="hit-44 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                         text-base text-slate-700 dark:text-slate-300
                         hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[40px]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         focus:outline-hidden focus:ring-3 focus:ring-slate-400 transition-colors"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Saving…' : `Save this ${w('list')}'s layout…`}
            </button>
          </div>

          {setupError && (
            <div role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
              {setupError}
              <button
                type="button"
                onClick={() => setSetupError(null)}
                className="hit-44 ml-3 underline text-red-600 dark:text-red-400 hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {loadingSetup ? (
            <Spinner />
          ) : setupTemplates.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-12 h-12" />}
              title={`No ${w('list')} layouts yet`}
              description={`${w('list', { cap: true })} layouts save the columns and rules of ${w('list', { article: true })} so you can reuse them. Open a layout file (.pulse) or save one of yours.`}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {setupTemplates.map(t => (
                <SetupTemplateCard
                  key={t.id}
                  template={t}
                  grids={grids}
                  onDelete={handleDeleteSetupTemplate}
                  onExport={async (id) => {
                    const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
                      title: 'Export the template',
                      defaultPath: `${t.name.replace(/[^a-z0-9]/gi, '_')}.pulse`,
                      filters: [{ name: 'Pulse templates', extensions: ['pulse'] }],
                    })
                    if (!saveRes.ok || !saveRes.data || saveRes.data.canceled || !saveRes.data.filePath) return
                    const res = await safeInvoke<true>(IPC.SETUP_TEMPLATE_EXPORT_SAVED, id, saveRes.data.filePath)
                    if (!res.ok) setSetupError(friendlyError(res.error, "We couldn't export the template — try again"))
                    else toast.success('Template saved.')
                  }}
                  onRefresh={loadSetupTemplates}
                />
              ))}
            </div>
          )}
        </section>

        {checklistsOn && (<>
          {/* ── Checklist templates (right) ─────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto max-h-full">
            <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">
                  Checklists
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportCLTemplate}
                  title="Import a .pulse-checklist file"
                  aria-label="Import checklist template"
                  className="hit-44 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200
                             dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200
                             text-base font-medium min-h-[40px]
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
                <PrimaryButton data-primary-action onClick={() => openEditor(null)} icon={<Plus className="w-4 h-4" />}>
                  New checklist template
                </PrimaryButton>
              </div>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Reusable to-do lists that you can add to any {w('record')} profile.
              Great for intake steps, closing procedures, or recurring review checklists.
              Optionally set them to recur on a schedule.
            </p>

            {clError && (
              <div role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
                {clError}
                <button
                  type="button"
                  onClick={() => setClError(null)}
                  className="hit-44 ml-3 underline text-red-600 dark:text-red-400 hover:no-underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {loadingCL ? (
              <Spinner />
            ) : clTemplates.length === 0 ? (
              <EmptyState
                icon={<Check className="w-12 h-12" />}
                title="No checklist templates yet"
                description="Templates let you create reusable checklists for common workflows like intake, discharge, or annual reviews."
                action={{ label: 'Create your first template', onClick: () => openEditor(null) }}
              />
            ) : (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                      <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                        Items
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                        Recurring
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {clTemplates.map(t => (
                      <ChecklistTemplateRow
                        key={t.id}
                        template={t}
                        onEdit={openEditor}
                        onDelete={handleDeleteCLTemplate}
                        onExport={handleExportCLTemplate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>)}

        </div>{/* end grid */}
      </div>{/* end flex-1 */}

      {/* Checklist editor modal */}
      <ChecklistTemplateEditor
        open={editorOpen}
        template={editorTemplate}
        onClose={() => setEditorOpen(false)}
        onSaved={t => { handleCLSaved(t); setEditorOpen(false) }}
      />

      {/* Grid picker modal */}
      {gridPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setGridPickerOpen(false) }}
        >
          <div ref={gridPickerTrapRef} role="dialog" aria-modal="true" aria-labelledby={gridPickerTitleId} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 id={gridPickerTitleId} className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Save {w('list', { cap: true })} as Template
            </h2>
            <div>
              <label htmlFor="template-mgr-caseload" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Which {w('list')}?
              </label>
              <select
                id="template-mgr-caseload"
                value={pickerGridId ?? ''}
                onChange={e => setPickerGridId(parseInt(e.target.value))}
                className="input w-full"
                style={{ fontSize: 15 }}
              >
                {grids.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => setGridPickerOpen(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pickerGridId === null}
                onClick={() => {
                  setGridPickerOpen(false)
                  if (pickerGridId !== null) void doExport(pickerGridId)
                }}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save as template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import preview modal */}
      {importedFile && (
        <ImportPreviewModal
          imported={importedFile}
          grids={grids}
          onClose={() => setImportedFile(null)}
          onApplied={() => { setImportedFile(null); void loadSetupTemplates() }}
        />
      )}
    </div>
  )
}
