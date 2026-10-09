import { describe, it, expect } from 'vitest'
import { formatTokens, renderDisplayFormat, normalizeDisplayFormat, DISPLAY_NAME_MAX } from '../src/shared/displayFormat'

const car = { year: '2017', make: 'Honda', model: 'Civic', plate: 'ABC123' }

describe('display formats', () => {
  it('fills tokens from column values', () => {
    expect(renderDisplayFormat('{Year} {Make} {Model} – {Plate}', car)).toBe('2017 Honda Civic – ABC123')
  })

  it('matches column names ignoring case and spaces inside the braces', () => {
    expect(renderDisplayFormat('{ MAKE } {model}', car)).toBe('Honda Civic')
  })

  it('lists the columns a format names, once each', () => {
    expect(formatTokens('{Year} {Make} {year} – { Plate }')).toEqual(['year', 'make', 'plate'])
  })

  it('drops unknown or empty tokens and the separators they leave', () => {
    expect(renderDisplayFormat('{Make} – {Plate}', { make: 'Honda' })).toBe('Honda')
    expect(renderDisplayFormat('{Plate} – {Make}', { make: 'Honda' })).toBe('Honda')
    expect(renderDisplayFormat('{Year} {Make} {Model} – {Plate}', { make: 'Honda', plate: 'X1' })).toBe('Honda – X1')
    expect(renderDisplayFormat('{A} – {B} – {C}', { a: 'one', c: 'three' })).toBe('one – three')
    expect(renderDisplayFormat('{Name} ({Code})', { name: 'Pump' })).toBe('Pump')
    expect(renderDisplayFormat('{Nope} {Make}', { make: 'Honda' })).toBe('Honda')
  })

  it('keeps text around values that are there', () => {
    expect(renderDisplayFormat('Job #{Number}: {Title}', { number: '0042', title: 'Fix sink' })).toBe('Job #0042: Fix sink')
    expect(renderDisplayFormat('{Name} ({Code})', { name: 'Pump', code: 'P-7' })).toBe('Pump (P-7)')
  })

  it('leaves the values themselves alone', () => {
    expect(renderDisplayFormat('{Make} {Model}', { make: 'Rolls-Royce', model: 'Ghost -- II' })).toBe('Rolls-Royce Ghost -- II')
  })

  it('is empty when every token is empty', () => {
    expect(renderDisplayFormat('{Make} – {Plate}', {})).toBe('')
  })

  it('caps the length', () => {
    expect(renderDisplayFormat('{A}', { a: 'x'.repeat(500) })).toHaveLength(DISPLAY_NAME_MAX)
  })

  it('saves blank formats and formats without tokens as none', () => {
    expect(normalizeDisplayFormat('  ')).toBeNull()
    expect(normalizeDisplayFormat(null)).toBeNull()
    expect(normalizeDisplayFormat('just text')).toBeNull()
    expect(normalizeDisplayFormat(' {Make} ')).toBe('{Make}')
  })
})
