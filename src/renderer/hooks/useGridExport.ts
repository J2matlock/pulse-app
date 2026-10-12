import { useState } from 'react'
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { SaveDialogResult } from '../../shared/types'
import { useGridStore } from '../stores/gridStore'
import { safeInvoke } from '../utils/safeInvoke'
import { friendlyError } from '../utils/friendlyError'
import { noteUnencryptedExport } from '../utils/exportNotice'
import { useVocab } from './useVocab'
import type { RowScope, RowScopeCounts } from '../components/shared/ColumnSelectDialog'

/** The toolbar's Export as CSV / PDF: pick columns and which records, then save */
export function useGridExport({ activeGridId, closeMenu }: { activeGridId: number | null; closeMenu: () => void }) {
  const { t } = useVocab()
  // Default export file name, e.g. "clients.csv"; words are user-typed, so keep it path-safe
  const fileWord = t('record', { many: true }).replace(/[^\w -]/g, '').trim() || 'export'
  const [exportColumnSelect, setExportColumnSelect] = useState<'csv' | 'pdf' | null>(null)

  function handleExportCsvStart() {
    openExport('csv')
  }

  const [pdfRowCount, setPdfRowCount] = useState(0)
  const [scopeCounts, setScopeCounts] = useState<RowScopeCounts>({ shown: 0, selected: 0, all: 0 })

  // The records on screen, in screen order (the table's rows or the board's cards)
  function shownRowIds(): number[] {
    return useGridStore.getState().sortedRowIds
  }

  function openExport(format: 'csv' | 'pdf') {
    closeMenu()
    // Read counts from the store at open time to avoid subscribing to rows
    const s = useGridStore.getState()
    setScopeCounts({ shown: shownRowIds().length, selected: s.selectedRowIds.size, all: s.rows.length })
    setPdfRowCount(s.rows.length)
    setExportColumnSelect(format)
  }

  function handleExportPdfStart() {
    openExport('pdf')
  }

  async function handleExportWithColumns(selectedIds: number[], scope: RowScope = 'all') {
    const format = exportColumnSelect
    setExportColumnSelect(null)
    if (!activeGridId || !format) return
    // What the person sees is what leaves the app (G-07): shown or selected records, in screen order
    const shown = shownRowIds()
    const picked = useGridStore.getState().selectedRowIds
    const activeRowIds = scope === 'shown' ? shown
      : scope === 'selected' ? [...shown.filter(id => picked.has(id)), ...[...picked].filter(id => !shown.includes(id))]
      : []
    if (scope !== 'all' && activeRowIds.length === 0) { toast.error(`No ${t('record', { many: true })} to export.`); return }

    if (format === 'csv') {
      const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Export to CSV',
        defaultPath: `${fileWord}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const result = await safeInvoke<boolean>(IPC.EXPORT_CSV, {
        gridId: activeGridId,
        columnIds: selectedIds,
        activeRowIds,
        destPath: saveRes.data.filePath,
      })
      if (!result.ok) toast.error(friendlyError(result.error, 'Export failed. Please try again.'))
      else noteUnencryptedExport()
    } else {
      const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Save as PDF',
        defaultPath: `${fileWord}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const result = await safeInvoke<boolean>(IPC.EXPORT_PDF_GRID, {
        gridId: activeGridId,
        columnIds: selectedIds,
        activeRowIds,
        destPath: saveRes.data.filePath
      })
      if (!result.ok) toast.error(friendlyError(result.error, 'Export failed. Please try again.'))
      else noteUnencryptedExport()
    }
  }

  return {
    exportColumnSelect, setExportColumnSelect, scopeCounts, pdfRowCount,
    handleExportCsvStart, handleExportPdfStart, handleExportWithColumns,
  }
}
