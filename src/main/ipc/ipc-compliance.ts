/**
 * ipc-compliance.ts — CONTACT_REQ_* (monthly contact requirements),
 * MISSING_INFO_* (required fields), COMPLIANCE_* (monthly summary) and
 * TOTALS_* (time, mileage and your own numbers from notes)
 */
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, enforceWritable, assertSafePath, pickSavePath } from './ipc-utils'
import { getRequirements, saveRequirements, validateRequirements, getRequirementStatus } from '../contact-requirements'
import { getMissingInfo, exportMissingInfoCsv } from '../missing-info'
import { getComplianceSummary, exportComplianceSummary, monthAsOf } from '../compliance'
import { getTotals, exportTotalsCsv } from '../totals'
import { getDb } from '../database'
import { localDateString } from '../../shared/dates'
import { word } from '../vocab'

export function registerComplianceHandlers(): void {
  secureWrap(IPC.CONTACT_REQ_GET, 'ipc-compliance', (_e, gridId?: number) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(getRequirements(gridId ?? undefined))
  })

  secureWrap(IPC.CONTACT_REQ_SAVE, 'ipc-compliance', (_e, gridId: number, reqs: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const cleaned = validateRequirements(reqs)
    if (typeof cleaned === 'string') return fail(cleaned)
    saveRequirements(gridId, cleaned)
    return ok(getRequirements(gridId))
  })

  // ref: a day ('YYYY-MM-DD'), or a month ('YYYY-MM', counted as of its last day or today); omitted = today
  secureWrap(IPC.CONTACT_REQ_STATUS, 'ipc-compliance', (_e, ref?: string, gridId?: number) => {
    const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
    const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
    if (ref != null && (typeof ref !== 'string' || !(isMonth(ref) || isDay(ref)))) return fail('Invalid date')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    const day = ref == null ? undefined : ref.length === 7 ? monthAsOf(ref) : ref
    return ok(getRequirementStatus(day, gridId ?? undefined))
  })

  secureWrap(IPC.MISSING_INFO_GET, 'ipc-compliance', (_e, gridId?: number) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(getMissingInfo(gridId ?? undefined))
  })

  secureWrap(IPC.MISSING_INFO_EXPORT_CSV, 'ipc-compliance', async (_e, gridId?: number) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    const filePath = await pickSavePath({
      title: 'Save Missing Information List',
      defaultPath: `missing-information-${localDateString()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const count = await exportMissingInfoCsv(filePath, gridId ?? undefined)
    return ok({ filePath, count })
  })

  const validMonth = (m: unknown) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

  secureWrap(IPC.COMPLIANCE_SUMMARY_GET, 'ipc-compliance', (_e, month: string, gridId?: number) => {
    if (!validMonth(month)) return fail('Invalid month')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(getComplianceSummary(month, gridId ?? undefined))
  })

  secureWrap(IPC.EXPORT_COMPLIANCE_SUMMARY, 'ipc-compliance', async (_e, month: string, gridId?: number) => {
    if (!validMonth(month)) return fail('Invalid month')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    const filePath = await pickSavePath({
      title: `Save ${word('requirement', { many: true })} summary`,
      defaultPath: `requirements-summary-${month}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = getDb().prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    await exportComplianceSummary(month, gridId ?? undefined, filePath, nameRow?.value || undefined)
    return ok(filePath)
  })

  secureWrap(IPC.TOTALS_GET, 'ipc-compliance', (_e, month: string, gridId?: number) => {
    if (!validMonth(month)) return fail('Invalid month')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(getTotals(month, gridId ?? undefined))
  })

  secureWrap(IPC.TOTALS_EXPORT_CSV, 'ipc-compliance', async (_e, month: string, gridId?: number) => {
    if (!validMonth(month)) return fail('Invalid month')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    const filePath = await pickSavePath({
      title: 'Save Totals',
      defaultPath: `totals-${month}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const count = await exportTotalsCsv(month, gridId ?? undefined, filePath)
    return ok({ filePath, count })
  })
}
