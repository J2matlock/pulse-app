// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// Import the class fresh each test by re-importing the module
// But since pulseEvents is a singleton, we test it directly
import { pulseEvents } from '../../../src/renderer/events'

describe('pulseEvents typed event bus', () => {
  it('emit/on works for event with payload', () => {
    const handler = vi.fn()
    const unsub = pulseEvents.on('checklist:changed', handler)
    pulseEvents.emit('checklist:changed', { rowId: 42 })
    expect(handler).toHaveBeenCalledWith({ rowId: 42 })
    unsub()
  })

  it('emit/on works for event without payload', () => {
    const handler = vi.fn()
    const unsub = pulseEvents.on('deadline:changed', handler)
    pulseEvents.emit('deadline:changed')
    expect(handler).toHaveBeenCalledOnce()
    unsub()
  })

  it('on() returns working unsubscribe function', () => {
    const handler = vi.fn()
    const unsub = pulseEvents.on('followup:changed', handler)
    pulseEvents.emit('followup:changed')
    expect(handler).toHaveBeenCalledTimes(1)
    unsub()
    pulseEvents.emit('followup:changed')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('multiple listeners receive same event', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const unsub1 = pulseEvents.on('linkedproviders:changed', handler1)
    const unsub2 = pulseEvents.on('linkedproviders:changed', handler2)
    pulseEvents.emit('linkedproviders:changed', { rowId: 7 })
    expect(handler1).toHaveBeenCalledWith({ rowId: 7 })
    expect(handler2).toHaveBeenCalledWith({ rowId: 7 })
    unsub1()
    unsub2()
  })

  it('listener does not fire after unsubscribe', () => {
    const handler = vi.fn()
    const unsub = pulseEvents.on('urgentchecklist:changed', handler)
    unsub()
    pulseEvents.emit('urgentchecklist:changed')
    expect(handler).not.toHaveBeenCalled()
  })
})
