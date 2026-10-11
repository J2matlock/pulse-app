/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { startDayWatcher, msUntilNextMidnight } from '../../../src/renderer/utils/dayWatcher'
import { useToday } from '../../../src/renderer/hooks/useToday'
import { pulseEvents } from '../../../src/renderer/events'

describe('day watcher', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('announces the new day just after midnight', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 30))
    const seen: string[] = []
    const off = pulseEvents.on('day:changed', ({ date }) => seen.push(date))
    const stop = startDayWatcher()
    vi.advanceTimersByTime(20_000)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(15_000)
    expect(seen).toEqual(['2026-10-12'])
    // And again the next night
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(seen).toEqual(['2026-10-12', '2026-10-13'])
    stop(); off()
  })

  it('checks again when the window comes back after sleep (timers may not have run)', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 22, 0, 0))
    const seen: string[] = []
    const off = pulseEvents.on('day:changed', ({ date }) => seen.push(date))
    const stop = startDayWatcher()
    // The clock jumps without the timer firing, as after a night asleep
    vi.setSystemTime(new Date(2026, 9, 12, 8, 0, 0))
    window.dispatchEvent(new Event('focus'))
    expect(seen).toEqual(['2026-10-12'])
    // A second focus the same day says nothing new
    window.dispatchEvent(new Event('focus'))
    expect(seen).toEqual(['2026-10-12'])
    stop(); off()
  })

  it('stops when told to', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 23, 59, 59))
    const seen: string[] = []
    const off = pulseEvents.on('day:changed', ({ date }) => seen.push(date))
    const stop = startDayWatcher()
    stop()
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([])
    off()
  })

  it('works out the time to midnight across a DST change', () => {
    // 2026-11-01 in the US is a 25-hour day; whatever the zone, the wait ends just after midnight
    const now = new Date(2026, 10, 1, 12, 0, 0)
    const at = new Date(now.getTime() + msUntilNextMidnight(now))
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2, 0, 0])
  })

  it('useToday follows the announced day', () => {
    const { result } = renderHook(() => useToday())
    act(() => { pulseEvents.emit('day:changed', { date: '2030-01-02' }) })
    expect(result.current).toBe('2030-01-02')
  })
})
