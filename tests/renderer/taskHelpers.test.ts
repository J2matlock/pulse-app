/** One due-date helper for tasks and checklist items (R7): the same text and urgency, as text or as a pill. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dueDateBadge, dueDateLabel } from '../../src/renderer/views/tasks/taskHelpers'

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12)) })
afterEach(() => vi.useRealTimers())

describe('due dates on tasks and checklist items', () => {
  it('agree on the date and how urgent it is, whichever style', () => {
    const cases: Array<[string, RegExp]> = [['2026-10-08', /red/], ['2026-10-10', /(orange|amber)/], ['2026-10-14', /yellow/], ['2026-11-30', /slate/]]
    for (const [date, tone] of cases) {
      expect(dueDateBadge(date)!.text).toBe(dueDateLabel(date)!.text)
      expect(dueDateBadge(date)!.className).toMatch(tone)
      expect(dueDateLabel(date)!.className).toMatch(tone)
    }
    expect(dueDateBadge('2027-01-05')!.text).toMatch(/2027/)
    expect(dueDateBadge(null)).toBeNull()
  })
})
