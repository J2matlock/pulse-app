/**
 * ipc-compliance.ts — CONTACT_REQ_* (monthly contact requirements),
 * MISSING_INFO_* (required fields), COMPLIANCE_* (monthly summary) and
 * TOTALS_* (time, mileage and your own numbers from notes)
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, assertSafePath, pickSavePath } from './ipc-utils'
import { handlersFor, idArg } from './ipc-define'
import { getRequirements, saveRequirements, validateRequirements, getRequirementStatus } from '../contact-requirements'
import { getMissingInfo, exportMissingInfoCsv } from '../missing-info'
import { getComplianceSummary, exportComplianceSummary, monthAsOf } from '../compliance'
import { getTotals, exportTotalsCsv } from '../totals'
import { getDb } from '../database'
import { localDateString } from '../../shared/dates'
import { fileWord } from '../../shared/fileName'
import { word } from '../vocab'

const define = handlersFor('ipc-compliance')

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** 'YYYY-MM' */
const monthArg = () => z.string('Invalid month').regex(MONTH, 'Invalid month')
/** A list, or every list when null or left out */
const optionalGridArg = () => idArg().nullish()

export function registerComplianceHandlers(): void {
  define(IPC.CONTACT_REQ_GET, [optionalGridArg()], (gridId) => ok(getRequirements(gridId ?? undefined)))

  define(IPC.CONTACT_REQ_SAVE, [idArg(), z.unknown()], (gridId, reqs) => {
    const cleaned = validateRequirements(reqs)
    if (typeof cleaned === 'string') return fail(cleaned)
    saveRequirements(gridId, cleaned)
    return ok(getRequirements(gridId))
  }, { write: true })

  // ref: a day ('YYYY-MM-DD'), or a month ('YYYY-MM', counted as of its last day or today); omitted = today
  define(IPC.CONTACT_REQ_STATUS, [
    z.string('Invalid date').refine(v => MONTH.test(v) || DAY.test(v), 'Invalid date').nullish(),
    optionalGridArg(),
  ], (ref, gridId) => {
    const day = ref == null ? undefined : ref.length === 7 ? monthAsOf(ref) : ref
    return ok(getRequirementStatus(day, gridId ?? undefined))
  })

  define(IPC.MISSING_INFO_GET, [optionalGridArg()], (gridId) => ok(getMissingInfo(gridId ?? undefined)))

  define(IPC.MISSING_INFO_EXPORT_CSV, [optionalGridArg()], async (gridId) => {
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

  define(IPC.COMPLIANCE_SUMMARY_GET, [monthArg(), optionalGridArg()], (month, gridId) => {
    return ok(getComplianceSummary(month, gridId ?? undefined))
  })

  define(IPC.EXPORT_COMPLIANCE_SUMMARY, [monthArg(), optionalGridArg()], async (month, gridId) => {
    const filePath = await pickSavePath({
      title: `Save ${word('requirement', { many: true, cap: true })} summary`,
      defaultPath: `${fileWord(word('requirement', { many: true }), 'requirements')}-summary-${month}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = getDb().prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    await exportComplianceSummary(month, gridId ?? undefined, filePath, nameRow?.value || undefined)
    return ok(filePath)
  })

  define(IPC.TOTALS_GET, [monthArg(), optionalGridArg()], (month, gridId) => {
    return ok(getTotals(month, gridId ?? undefined))
  })

  define(IPC.TOTALS_EXPORT_CSV, [monthArg(), optionalGridArg()], async (month, gridId) => {
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
