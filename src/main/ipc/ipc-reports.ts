/**
 * ipc-reports.ts — saved reports and the report builder (generalization W10 §6).
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { localDateString } from '../../shared/dates'
import { getDb } from '../database'
import { writeReport } from '../export-report'
import { REPORT_SOURCES, describeReport, explainReport } from '../../shared/reports'
import { ok, fail, validId, assertSafePath, pickSavePath } from './ipc-utils'
import { handlersFor, idArg } from './ipc-define'
import { ReportError, reportFields, runReport, listReports, getReport, saveReport, deleteReport, validateReportConfig, sourceWord, sourceWordOne } from '../report-builder'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof ReportError) return fail(err.message)
    throw err
  }
}

const define = handlersFor('ipc-reports')

export function registerReportHandlers(): void {
  define(IPC.REPORT_FIELDS, [idArg(), z.enum(REPORT_SOURCES, 'Invalid report source')],
    (gridId, source) => ok(reportFields(gridId, source)))

  define(IPC.REPORT_RUN, [idArg(), z.unknown()], (gridId, config) => action(() => runReport(gridId, config)))

  /** A saved report by id, run as it was saved */
  define(IPC.REPORT_RUN_SAVED, [idArg()], (id) => {
    const r = getReport(id)
    if (!r) return fail('That report is no longer available.')
    return action(() => {
      const result = runReport(r.grid_id, r.config)
      const listName = (getDb().prepare('SELECT name FROM grids WHERE id = ?').get(r.grid_id) as { name: string } | undefined)?.name ?? ''
      // The report in a sentence, for the Reports home page and dashboard cards
      const explanation = explainReport(r.config, reportFields(r.grid_id, r.config.source), { one: sourceWordOne(r.config.source, r.grid_id), many: sourceWord(r.config.source, r.grid_id) }, listName, result.matched)
      return { report: r, result, explanation, listName }
    })
  })

  define(IPC.REPORT_LIST, [idArg().nullish()], (gridId) => ok(listReports(gridId ?? undefined)))

  define(IPC.REPORT_SAVE, [z.unknown()], (input) => {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    if (!validId(i.gridId) || (i.id != null && !validId(i.id))) return fail('Invalid ID')
    return action(() => saveReport({ id: i.id == null ? undefined : i.id as number, name: i.name, gridId: i.gridId as number, config: i.config }))
  }, { write: true })

  define(IPC.REPORT_EXPORT, [idArg(), z.unknown(), z.enum(['csv', 'pdf'], 'Invalid format'), z.unknown()], async (gridId, config, format, name) => {
    const title = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'Report'
    const res = action(() => runReport(gridId, config))
    if (!res.ok) return res
    const grid = getDb().prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string } | undefined
    const safe = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'report'
    const filePath = await pickSavePath({
      title: format === 'csv' ? 'Save Report as CSV' : 'Save Report as PDF',
      defaultPath: `${safe}-${localDateString()}.${format}`,
      filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const { config: valid, fields } = validateReportConfig(gridId, config)
    await writeReport(filePath, format, title, describeReport(valid, fields, grid?.name ?? '', sourceWord(valid.source, gridId)), res.data)
    return ok(filePath)
  })

  define(IPC.REPORT_DELETE, [idArg()], (id) => action(() => deleteReport(id)), { write: true })
}
