import { describe, it, expect, vi } from 'vitest'

;(globalThis as Record<string, unknown>).window = { api: { invoke: vi.fn() } }

import { skippedForBulkDone, type DeadlineToComplete } from '../../src/renderer/views/dashboard/completeDeadline'
import { setWords } from './vocabFixture'
import { GENERIC_VOCAB } from '../../src/shared/vocab'

const item = (over: Partial<DeadlineToComplete>): DeadlineToComplete => ({ rowId: 1, columnId: 2, columnName: 'Review', clientName: 'Ada', dateValue: '2026-01-01', interval: { days: 0, months: 12, endOfMonth: false }, ...over })

describe('bulk Mark done (D-34)', () => {
  it('names what it can’t mark done here, and why', () => {
    const { rest, message } = skippedForBulkDone([
      item({}),
      item({ columnName: 'Sessions left', ruleKind: 'quota' }),
      item({ columnName: 'Oil change', ruleKind: 'meter' }),
      item({ columnName: 'IFSP', ruleKind: 'sequence' }),
      item({ columnName: 'IFSP', ruleKind: 'sequence', step: 0 }),
      item({ columnName: 'License', interval: { days: 0, months: 0, endOfMonth: false } }),
    ])
    expect(rest.map(r => r.columnName)).toEqual(['Review', 'IFSP'])
    expect(message).toBe("4 couldn't be marked done here: Oil change (needs a reading; mark done one at a time); Sessions left (renew on the record); IFSP (open the record to choose the step); License (say whether it was renewed or finished; one at a time).")
  })

  it('uses the workspace word for records (AUDIT-068)', () => {
    setWords()
    const { message } = skippedForBulkDone([item({ columnName: 'Sessions left', ruleKind: 'quota' }), item({ columnName: 'IFSP', ruleKind: 'sequence' })])
    expect(message).toBe("2 couldn't be marked done here: Sessions left (renew on the client); IFSP (open the client to choose the step).")
    setWords(GENERIC_VOCAB)
  })

  it('says nothing when everything can go ahead', () => {
    expect(skippedForBulkDone([item({})]).message).toBeNull()
  })
})
