/**
 * Opens the fill-in dialog for 'form:fill' requests from the toolbar, a
 * profile or the command palette (W08 §4), loading the list's columns and
 * the record when needed.
 */
import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, GridRow } from '../../../shared/types'
import type { Form } from '../../../shared/forms'
import { pulseEvents } from '../../events'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { FillFormDialog } from './FillFormDialog'
import toast from 'react-hot-toast'
import { wordNow } from '../../utils/vocab'

export function FormFillHost(): React.ReactElement | null {
  const [open, setOpen] = useState<{ form: Form; columns: Column[]; row?: GridRow } | null>(null)

  useEffect(() => pulseEvents.on('form:fill', async ({ formId, gridId, rowId }) => {
    const forms = await safeInvoke<Form[]>(IPC.FORM_LIST, gridId)
    const form = forms.ok ? forms.data.find(f => f.id === formId) : undefined
    if (!form) return
    const grid = useGridStore.getState()
    let columns: Column[]
    let row: GridRow | undefined
    if (grid.activeGridId === gridId) {
      columns = [...grid.columns, ...grid.hiddenColumns]
      row = rowId !== undefined ? grid.rows.find(r => r.row_id === rowId) : undefined
    } else {
      const r = await safeInvoke<{ columns: Column[]; hiddenColumns: Column[]; rows: GridRow[] } | null>(IPC.GRID_GET, gridId, true)
      if (!r.ok || !r.data) return
      columns = [...r.data.columns, ...r.data.hiddenColumns]
      row = rowId !== undefined ? r.data.rows.find(x => x.row_id === rowId) : undefined
    }
    if (rowId !== undefined && !row) {
      // An archived record isn't among the loaded rows: fetch it on its own
      const got = await safeInvoke<GridRow | null>(IPC.ROW_GET, gridId, rowId)
      if (got.ok && got.data) row = got.data
      else { toast.error(`We couldn't open that form for this ${wordNow('record')} — try again`); return }
    }
    setOpen({ form, columns, row })
  }), [])

  if (!open) return null
  return <FillFormDialog form={open.form} columns={open.columns} row={open.row} onClose={() => setOpen(null)} />
}
