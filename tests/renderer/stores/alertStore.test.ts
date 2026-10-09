/**
 * alertStore.test.ts — Zustand alert store unit tests.
 * Mocks window.api.invoke for all IPC calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

import { useAlertStore } from '../../../src/renderer/stores/alertStore'
import type { AlertRule, AlertThreshold } from '../../../src/shared/types'

function makeAlertRule(id: number, overrides: Partial<AlertRule> = {}): AlertRule {
  const thresholds: AlertThreshold[] = [
    { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
    { daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' },
    { daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' },
    { daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' },
    { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' },
  ]
  return {
    id,
    name: `Rule ${id}`,
    description: null,
    is_system: 0,
    thresholds: JSON.stringify(thresholds),
    interval_days: null,
    created_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

describe('alertStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useAlertStore.setState({
      rules: [],
      isLoaded: false,
      loadError: null,
    })
  })

  it('loadRules populates rules and parses thresholds', async () => {
    const rules = [makeAlertRule(1), makeAlertRule(2)]
    mockInvoke.mockResolvedValue({ ok: true, data: rules })

    await act(async () => {
      await useAlertStore.getState().loadRules()
    })

    const state = useAlertStore.getState()
    expect(state.rules).toHaveLength(2)
    expect(state.isLoaded).toBe(true)
    expect(state.loadError).toBeNull()
    // Thresholds should be parsed from JSON string to array
    expect(Array.isArray(state.rules[0].thresholds)).toBe(true)
    expect(state.rules[0].thresholds[0].daysBefore).toBe(30)
    expect(state.rules[0].thresholds[0].bgClass).toBe('alert-green')
  })

  it('loadRules sets loadError on failure', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'DB connection failed' })

    await act(async () => {
      await useAlertStore.getState().loadRules()
    })

    expect(useAlertStore.getState().rules).toHaveLength(0)
    expect(useAlertStore.getState().loadError).toBe('DB connection failed')
  })

  it('loadRules sets loadError on transport exception', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC channel not found'))

    await act(async () => {
      await useAlertStore.getState().loadRules()
    })

    expect(useAlertStore.getState().loadError).toBe('IPC channel not found')
  })

  it('createRule adds rule and reloads', async () => {
    // First call: create returns new id, second call: loadRules
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: 5 })
      .mockResolvedValueOnce({ ok: true, data: [makeAlertRule(5)] })

    let resultId: number | null = null
    await act(async () => {
      resultId = await useAlertStore.getState().createRule({
        name: 'New Rule',
        description: 'Test rule',
        is_system: 0,
        thresholds: '[]',
        interval_days: null,
      })
    })

    expect(resultId).toBe(5)
    expect(mockInvoke).toHaveBeenCalledWith('alert-rule:create', expect.objectContaining({ name: 'New Rule' }))
    expect(useAlertStore.getState().rules).toHaveLength(1)
  })

  it('createRule returns null on failure', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'constraint violation' })

    let resultId: number | null = null
    await act(async () => {
      resultId = await useAlertStore.getState().createRule({
        name: 'Bad Rule',
        description: null,
        is_system: 0,
        thresholds: '[]',
        interval_days: null,
      })
    })

    expect(resultId).toBeNull()
  })

  it('updateRule modifies existing rule', async () => {
    const rule = makeAlertRule(1, { name: 'Old Name' })
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockResolvedValueOnce({ ok: true, data: [makeAlertRule(1, { name: 'New Name' })] })

    useAlertStore.setState({ rules: [{ ...rule, thresholds: [] }] })

    let success = false
    await act(async () => {
      success = await useAlertStore.getState().updateRule(1, { name: 'New Name' })
    })

    expect(success).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('alert-rule:update', 1, { name: 'New Name' })
  })

  it('deleteRule removes rule from state', async () => {
    const parsed = { ...makeAlertRule(1), thresholds: [] as AlertThreshold[] }
    useAlertStore.setState({ rules: [parsed] })
    mockInvoke.mockResolvedValue({ ok: true, data: true })

    let success = false
    await act(async () => {
      success = await useAlertStore.getState().deleteRule(1)
    })

    expect(success).toBe(true)
    expect(useAlertStore.getState().rules).toHaveLength(0)
  })

  it('alert rules have required fields (columnId, thresholds, etc.)', () => {
    // Verify the structure of a parsed alert rule
    const rule = makeAlertRule(1)
    const thresholds: AlertThreshold[] = JSON.parse(rule.thresholds)

    expect(rule.name).toBeDefined()
    expect(rule.id).toBeDefined()
    expect(thresholds.length).toBeGreaterThan(0)
    thresholds.forEach(t => {
      expect(t).toHaveProperty('daysBefore')
      expect(t).toHaveProperty('bgClass')
      expect(t).toHaveProperty('label')
      expect(typeof t.daysBefore).toBe('number')
    })
  })

  it('getRuleById returns correct rule or undefined', () => {
    const parsed = { ...makeAlertRule(1), thresholds: [{ daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' }] }
    useAlertStore.setState({ rules: [parsed] })

    expect(useAlertStore.getState().getRuleById(1)).toBeDefined()
    expect(useAlertStore.getState().getRuleById(1)!.name).toBe('Rule 1')
    expect(useAlertStore.getState().getRuleById(999)).toBeUndefined()
  })

  it('handles malformed thresholds JSON gracefully', async () => {
    const badRule: AlertRule = {
      id: 1, name: 'Bad JSON', description: null, is_system: 0,
      thresholds: '{not valid json}', interval_days: null, created_at: '2026-01-01',
    }
    mockInvoke.mockResolvedValue({ ok: true, data: [badRule] })

    await act(async () => {
      await useAlertStore.getState().loadRules()
    })

    // Should parse to empty array on bad JSON
    expect(useAlertStore.getState().rules[0].thresholds).toEqual([])
  })
})
