/**
 * ipc-reports.ts — saved reports and the report builder (generalization W10 §6).
 */
import { dialog } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { localDateString } from '../../shared/dates'
import { getDb } from '../database'
import { writeReport } from '../export-report'
import { REPORT_SOURCES, describeReport, explainReport, type ReportSource } from '../../shared/reports'
import { secureWrap, ok, fail, enforceWritable, validId, assertSafePath } from './ipc-utils'
import { ReportError, reportFields, runReport, listReports, getReport, saveReport, deleteReport, validateReportConfig, sourceWord } from '../report-builder'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof ReportError) return fail(err.message)
    throw err
  }
}

export function registerReportHandlers(): void {
  secureWrap(IPC.REPORT_FIELDS, 'ipc-reports', (_e, gridId: unknown, source: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    if (!REPORT_SOURCES.includes(source as ReportSource)) return fail('Invalid report source')
    return ok(reportFields(gridId, source as ReportSource))
  })

  secureWrap(IPC.REPORT_RUN, 'ipc-reports', (_e, gridId: unknown, config: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return action(() => runReport(gridId, config))
  })

  /** A saved report by id, run as it was saved */
  secureWrap(IPC.REPORT_RUN_SAVED, 'ipc-reports', (_e, id: unknown) => {
    if (!validId(id)) return fail('Invalid ID')
    const r = getReport(id)
    if (!r) return fail('That report is no longer available.')
    return action(() => {
      const result = runReport(r.grid_id, r.config)
      const listName = (getDb().prepare('SELECT name FROM grids WHERE id = ?').get(r.grid_id) as { name: string } | undefined)?.name ?? ''
      // The report in a sentence, for the Reports home page and dashboard cards
      const explanation = explainReport(r.config, reportFields(r.grid_id, r.config.source), sourceWord(r.config.source, r.grid_id), listName, result.matched)
      return { report: r, result, explanation, listName }
    })
  })

  secureWrap(IPC.REPORT_LIST, 'ipc-reports', (_e, gridId?: unknown) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(listReports(gridId == null ? undefined : gridId as number))
  })

  secureWrap(IPC.REPORT_SAVE, 'ipc-reports', (_e, input: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    if (!validId(i.gridId) || (i.id != null && !validId(i.id))) return fail('Invalid ID')
    return action(() => saveReport({ id: i.id == null ? undefined : i.id as number, name: i.name, gridId: i.gridId as number, config: i.config }))
  })

  secureWrap(IPC.REPORT_EXPORT, 'ipc-reports', async (_e, gridId: unknown, config: unknown, format: unknown, name: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    if (format !== 'csv' && format !== 'pdf') return fail('Invalid format')
    const title = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'Report'
    const res = action(() => runReport(gridId, config))
    if (!res.ok) return res
    const grid = getDb().prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string } | undefined
    const safe = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'report'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: format === 'csv' ? 'Save Report as CSV' : 'Save Report as PDF',
      defaultPath: `${safe}-${localDateString()}.${format}`,
      filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    const { config: valid, fields } = validateReportConfig(gridId, config)
    await writeReport(filePath, format, title, describeReport(valid, fields, grid?.name ?? '', sourceWord(valid.source, gridId)), res.data)
    return ok(filePath)
  })

  secureWrap(IPC.REPORT_DELETE, 'ipc-reports', (_e, id: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    return action(() => deleteReport(id))
  })
}
