/** Error toasts never show developer text (audit 2.15 / N-28). */
import { describe, it, expect } from 'vitest'
import { friendlyError, DEFAULT_ERROR } from '../../src/renderer/utils/friendlyError'

describe('friendlyError', () => {
  it('passes through messages written for people', () => {
    expect(friendlyError('That record is no longer available.')).toBe('That record is no longer available.')
    expect(friendlyError("There's already a tag called that.")).toBe("There's already a tag called that.")
  })

  it('replaces validation codes and raw system text with the fallback', () => {
    for (const raw of ['Invalid ID', 'Row not found', 'Grid 12 not found', 'Invalid reorder payload', 'Unknown settings key',
      'UNIQUE constraint failed: tags.name', "Error invoking remote method 'x': Error", '', 'ENOENT']) {
      expect(friendlyError(raw)).toBe(DEFAULT_ERROR)
    }
    expect(friendlyError(undefined, 'Could not save.')).toBe('Could not save.')
  })

  it('explains a read-only database', () => {
    expect(friendlyError('READ_ONLY')).toMatch(/can't be saved right now/)
  })
})
