/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'

// An open cell editor saves on blur. lock() must blur it before AUTH_LOCK
// closes the database, or the typed value is lost.
const order: string[] = []
const mockInvoke = vi.fn(async (channel: string) => { order.push(channel); return { ok: true, data: true } })
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })

import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

describe('settingsStore.lock saves pending edits first', () => {
  it('blurs the focused editor before locking', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.addEventListener('blur', () => order.push('blur'))

    useSettingsStore.setState({ isLocked: false })
    await useSettingsStore.getState().lock()

    expect(order.indexOf('blur')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('blur')).toBeLessThan(order.indexOf('auth:lock'))
    expect(useSettingsStore.getState().isLocked).toBe(true)
    input.remove()
  })
})
