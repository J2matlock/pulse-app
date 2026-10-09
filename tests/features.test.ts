import { describe, it, expect } from 'vitest'
import { FEATURES, isOn, parseFeatures, featuresForExistingInstall } from '../src/shared/features'

describe('feature switches', () => {
  it('has unique keys with descriptions', () => {
    const keys = FEATURES.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(FEATURES.every(f => f.label && f.description)).toBe(true)
  })

  it('falls back to blank defaults and hides features not built yet', () => {
    expect(isOn({}, 'checklists')).toBe(true)
    expect(isOn({}, 'mileage')).toBe(false)
    expect(isOn({ mileage: true }, 'mileage')).toBe(true)
    expect(isOn({ links: true }, 'links')).toBe(true)
    expect(isOn({ attachments: true }, 'attachments')).toBe(true)
    expect(FEATURES.every(f => f.available)).toBe(true)   // every switch works in this version
  })

  it('keeps everything an existing install has today', () => {
    const m = featuresForExistingInstall({ trackTime: true, trackMileage: false })
    for (const key of ['letters', 'contactsDirectory', 'focusMode', 'requirements', 'summaryReport', 'handoff', 'priority', 'tasks', 'snippets', 'checklists'] as const) {
      expect(isOn(m, key)).toBe(true)
    }
    expect(isOn(m, 'timeTracking')).toBe(true)
    expect(isOn(m, 'mileage')).toBe(false)
  })

  it('parses stored switches safely', () => {
    expect(parseFeatures(JSON.stringify({ mileage: true, bogus: true }))).toEqual({ mileage: true })
    expect(parseFeatures('{oops')).toBeNull()
    expect(parseFeatures(JSON.stringify({ mileage: 'yes' }))).toBeNull()
  })
})
