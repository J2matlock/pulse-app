/**
 * Task and checklist due dates say how urgent they are in words, not only by
 * color (audit A06-12), so colorblind and screen reader users can tell a late
 * date from an upcoming one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dueDateBadge, dueDateLabel } from '../../../src/renderer/views/tasks/taskHelpers'

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12)) })
afterEach(() => vi.useRealTimers())

describe('due date words', () => {
  it('names the urgency along with the date', () => {
    const oct = (d: number) => new Date(2026, 9, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    expect(dueDateBadge('2026-10-08')).toMatchObject({ text: `Overdue · ${oct(8)}`, urgency: 'overdue' })
    expect(dueDateBadge('2026-10-10')).toMatchObject({ text: 'Due today', urgency: 'today' })
    expect(dueDateBadge('2026-10-11')).toMatchObject({ text: `Tomorrow · ${oct(11)}`, urgency: 'soon' })
    expect(dueDateBadge('2026-10-14')).toMatchObject({ text: `In 4 days · ${oct(14)}`, urgency: 'soon' })
    expect(dueDateBadge('2026-11-30')).toMatchObject({ text: new Date(2026, 10, 30).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), urgency: 'later' })
  })

  it('the text style and the pill say the same thing', () => {
    for (const d of ['2026-10-01', '2026-10-10', '2026-10-12', '2026-12-25']) {
      expect(dueDateLabel(d)!.text).toBe(dueDateBadge(d)!.text)
      expect(dueDateLabel(d)!.urgency).toBe(dueDateBadge(d)!.urgency)
    }
  })
})
