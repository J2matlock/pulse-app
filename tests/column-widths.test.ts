/** How wide a column from a starter or setup template opens (V1: names and headers cut to "Bis…", "Sp…") */
import { describe, it, expect } from 'vitest'
import { startingWidth } from '../src/shared/columnTypes'

describe('startingWidth', () => {
  it('keeps the width a column was written with when everything fits', () => {
    expect(startingWidth('text', '{}', 180, { name: 'Breed' })).toBe(180)
    expect(startingWidth('text', undefined, undefined)).toBe(160)
  })

  it('gives the name column room for the name, the sample mark and "Open"', () => {
    expect(startingWidth('text', '{}', 140, { name: 'Name', isName: true })).toBe(200)
    expect(startingWidth('text', '{}', 260, { name: 'Name', isName: true })).toBe(260)
  })

  it('makes a column wide enough to read its header next to the header controls', () => {
    // "Intake date" at 150px showed as "Intake d…"
    const w = startingWidth('date', '{}', 150, { name: 'Intake date' })
    expect(w).toBeGreaterThan(150)
    expect(w).toBe(64 + 11 * 9)
    // A rule adds a clock to the header
    expect(startingWidth('deadline', '{}', 100, { name: 'A very long deadline column name' })).toBe(300)
    // Long names are capped; the header truncates the rest with a tooltip
    expect(startingWidth('text', '{}', 120, { name: 'x'.repeat(80) })).toBe(300)
  })

  it('still gives dates with a rule room for the deadline words', () => {
    expect(startingWidth('date', '{"alert_rule_name":"Yearly"}', 150, { name: 'Due' })).toBe(250)
    expect(startingWidth('deadline', '{}', 150)).toBe(250)
    expect(startingWidth('date', 'not json', 150)).toBe(150)
  })
})
