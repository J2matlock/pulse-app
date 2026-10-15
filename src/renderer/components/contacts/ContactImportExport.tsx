import { useState, useCallback } from 'react'
import { Upload, Download, FileText, Check } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import type { Provider, OpenDialogResult } from '../../../shared/types'
import { useContactsStore } from '../../stores/contactsStore'
import { rlog } from '../../utils/rendererLogger'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

interface Props {
  open: boolean
  onClose: () => void
  mode: 'import' | 'export'
}

interface ParsedRow {
  data: Partial<Provider>
  selected: boolean
  categoryName?: string       // resolved category name (matched)
  unmatchedCategory?: string  // raw category string that had no match
}

type ImportStep = 'pick' | 'preview' | 'done'

export function ContactImportExport({ open, onClose, mode }: Props) {
  const { t } = useVocab(null)
  // Import state
  const [step, setStep] = useState<ImportStep>('pick')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importCount, setImportCount] = useState(0)
  const [uncategorizedCount, setUncategorizedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)

  const reset = useCallback(() => {
    setStep('pick')
    setParsedRows([])
    setImporting(false)
    setImportCount(0)
    setUncategorizedCount(0)
    setError(null)
    setExporting(false)
    setExportDone(false)
  }, [])

  function handleClose() {
    reset()
    onClose()
  }

  // ── Import: pick file ────────────────────────────────────────────────────

  async function handlePickFile() {
    setError(null)
    try {
      const dialogRes = await safeInvoke<OpenDialogResult>(IPC.APP_SHOW_FILE_DIALOG, {
        title: 'Import vCard',
        filters: [{ name: 'vCard', extensions: ['vcf'] }],
        properties: ['openFile'],
      })

      if (!dialogRes.ok || !dialogRes.data || dialogRes.data.canceled || dialogRes.data.filePaths.length === 0) {
        return
      }

      const filePath = dialogRes.data.filePaths[0]
      const parseRes = await safeInvoke<Partial<Provider>[]>(IPC.CONTACTS_IMPORT_VCF, filePath)

      if (!parseRes.ok) {
        setError(friendlyError(parseRes.error, "We couldn't read that vCard file — check that its name ends in .vcf and try again"))
        return
      }

      if (!parseRes.data || parseRes.data.length === 0) {
        setError(`No ${t('contact', { many: true })} found in that file.`)
        return
      }

      setParsedRows(parseRes.data.map(d => {
        const raw = d as Record<string, unknown>
        const categoryName = raw['_categoryName'] as string | undefined
        const unmatchedCategory = raw['_unmatchedCategory'] as string | undefined
        delete raw['_categoryName']
        delete raw['_unmatchedCategory']
        return { data: d, selected: true, categoryName, unmatchedCategory }
      }))
      setStep('preview')
    } catch (err: unknown) {
      rlog.error('ContactImportExport', 'vCard parse failed', err)
      setError("We couldn't read that file — try again, or export it again from your address book")
    }
  }

  // ── Import: toggle selection ─────────────────────────────────────────────

  function toggleRow(index: number) {
    setParsedRows(prev =>
      prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
    )
  }

  function toggleAll() {
    const allSelected = parsedRows.every(r => r.selected)
    setParsedRows(prev => prev.map(r => ({ ...r, selected: !allSelected })))
  }

  // ── Import: confirm ──────────────────────────────────────────────────────

  async function handleConfirmImport() {
    const selectedRows = parsedRows.filter(r => r.selected)
    const selected = selectedRows.map(r => r.data)
    if (selected.length === 0) return
    const uncategorized = selectedRows.filter(r => r.unmatchedCategory).length

    setImporting(true)
    setError(null)
    try {
      const res = await safeInvoke<number>(IPC.CONTACTS_CONFIRM_IMPORT_VCF, selected)
      if (!res.ok) {
        setError(friendlyError(res.error, "We couldn't bring in those contacts — try again"))
        setImporting(false)
        return
      }

      setImportCount(res.data as number)
      setUncategorizedCount(uncategorized)
      setStep('done')

      // Refresh the provider list
      useContactsStore.getState().loadProviders()
    } catch (err: unknown) {
      rlog.error('ContactImportExport', 'Contact import failed', err)
      setError("We couldn't bring in those contacts — nothing was added; try again")
    } finally {
      setImporting(false)
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async function handleExport() {
    setExporting(true)
    setExportDone(false)
    setError(null)
    try {
      const res = await safeInvoke<string | null>(IPC.CONTACTS_EXPORT_VCF, null)
      if (!res.ok) {
        setError(friendlyError(res.error, "We couldn't export the contacts — try again"))
        setExporting(false)
        return
      }
      // null means the Save dialog was cancelled: nothing was saved.
      if (res.data) setExportDone(true)
    } catch (err: unknown) {
      rlog.error('ContactImportExport', 'Contact export failed', err)
      setError("We couldn't export the contacts — try again")
    } finally {
      setExporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const selectedCount = parsedRows.filter(r => r.selected).length

  return (
    <>
    {open && (
    // Escape closes like the X (AUDIT-046)
    <Dialog open onClose={handleClose} size="xl"
      icon={mode === 'import'
        ? <Upload className="h-5 w-5 mt-3 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        : <Download className="h-5 w-5 mt-3 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      title={mode === 'import' ? `Import ${t('contact', { many: true, cap: true })} (vCard)` : `Export ${t('contact', { many: true, cap: true })} (vCard)`}>
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {mode === 'import' && renderImportBody()}
      {mode === 'export' && renderExportBody()}
    </Dialog>
    )}
    </>
  )

  // ── Import body ──────────────────────────────────────────────────────────

  function renderImportBody() {
    if (step === 'pick') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <FileText className="h-12 w-12 text-gray-400 dark:text-gray-500" />
          <p className="text-center text-gray-600 dark:text-gray-300 max-w-md" style={{ fontSize: 15 }}>
            Import {t('contact', { many: true })} from .vcf (vCard) files — a standard contact format supported by most address books.
          </p>
          <PrimaryButton
            onClick={handlePickFile}
            aria-label="Choose a vCard file to import"
            icon={<Upload className="h-4 w-4" />}
          >
            Choose a file…
          </PrimaryButton>
        </div>
      )
    }

    if (step === 'preview') {
      return (
        <div className="flex flex-col gap-4">
          <p className="text-gray-600 dark:text-gray-300" style={{ fontSize: 15 }}>
            {parsedRows.length} {t('contact', { count: parsedRows.length })} found.
            Select which ones to import.
          </p>

          {/* Table */}
          <div className="overflow-auto rounded-md border border-gray-200 dark:border-slate-700">
            <table className="w-full text-left" style={{ fontSize: 15 }}>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900/50">
                  <th scope="col" className="px-3 py-2" style={{ minHeight: 44 }}>
                    {/* The label makes the whole 44px square around the box clickable */}
                    <label className="-my-2 flex items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={parsedRows.every(r => r.selected)}
                        onChange={toggleAll}
                        className="h-5 w-5 rounded-sm border-gray-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
                        aria-label={`Select all ${t('contact', { many: true })} for import`}
                      />
                    </label>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Organization</th>
                  <th scope="col" className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Phone</th>
                  <th scope="col" className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Category</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-100 hover:bg-gray-50 dark:border-slate-700/50 dark:hover:bg-slate-700/30"
                    style={{ minHeight: 44 }}
                  >
                    <td className="px-3 py-2">
                      <label className="-my-2 flex items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleRow(i)}
                          className="h-5 w-5 rounded-sm border-gray-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
                          aria-label={`Select ${row.data.name ?? t('contact')}`}
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                      {row.data.name || '(No name)'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.data.org_name || '-'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.data.phone_main || row.data.phone_cell || row.data.phone_direct || '-'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.data.email || '-'}
                    </td>
                    <td className="px-3 py-2">
                      {row.categoryName ? (
                        <span className="text-gray-600 dark:text-gray-400">{row.categoryName}</span>
                      ) : row.unmatchedCategory ? (
                        <span className="text-amber-700 dark:text-amber-400" title={`"${row.unmatchedCategory}" doesn't match any category`}>
                          <span aria-hidden="true">⚠ </span><span className="sr-only">Warning: </span>Not found
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <SecondaryButton onClick={() => { setStep('pick'); setParsedRows([]); setError(null) }}>
              Back
            </SecondaryButton>
            <PrimaryButton
              onClick={handleConfirmImport}
              disabled={selectedCount === 0 || importing}
              aria-label={`Import selected ${t('contact', { many: true })}`}
            >
              {importing ? (
                'Importing…'
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import {selectedCount} Contact{selectedCount !== 1 ? 's' : ''}
                </>
              )}
            </PrimaryButton>
          </div>
        </div>
      )
    }

    if (step === 'done') {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-center text-gray-900 dark:text-gray-100" style={{ fontSize: 15 }}>
            Imported {importCount} {t('contact', { count: importCount })}.
          </p>
          {uncategorizedCount > 0 && (
            <p className="text-center text-amber-700 dark:text-amber-400 max-w-sm" style={{ fontSize: 15 }}>
              {uncategorizedCount} {t('contact', { count: uncategorizedCount })} {uncategorizedCount !== 1 ? 'were' : 'was'} imported without a category because the category in the file didn't match any existing category. You can open each {t('contact')} and add a category.
            </p>
          )}
          <PrimaryButton onClick={handleClose}>
            Done
          </PrimaryButton>
        </div>
      )
    }

    return null
  }

  // ── Export body ──────────────────────────────────────────────────────────

  function renderExportBody() {
    if (exportDone) {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-center text-gray-900 dark:text-gray-100" style={{ fontSize: 15 }}>
            Done. Your {t('contact', { many: true })} were saved.
          </p>
          <PrimaryButton onClick={handleClose}>
            Done
          </PrimaryButton>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Download className="h-12 w-12 text-gray-400 dark:text-gray-500" />
        <p className="text-center text-gray-600 dark:text-gray-300 max-w-md" style={{ fontSize: 15 }}>
          Export all {t('contact', { many: true })} as a .vcf file that can be opened in other apps.
          You will be asked to choose where to save the file.
        </p>
        <PrimaryButton
          onClick={handleExport}
          busy={exporting}
          aria-label={`Export all ${t('contact', { many: true })} as vCard`}
        >
          {exporting ? (
            'Exporting…'
          ) : (
            <>
              <Download className="h-4 w-4" />
              Export all {t('contact', { many: true })}
            </>
          )}
        </PrimaryButton>
      </div>
    )
  }
}
