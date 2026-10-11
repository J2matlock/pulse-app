import { describe, it, expect } from 'vitest'
import { safeFileName } from '../src/shared/fileName'

describe('safeFileName', () => {
  it('keeps accented and non-Latin letters', () => {
    expect(safeFileName('José Núñez')).toBe('José Núñez')
    expect(safeFileName('Ольга')).toBe('Ольга')
  })

  it('strips only characters file systems refuse', () => {
    expect(safeFileName('A/B: "C" <D>?')).toBe('AB C D')
  })

  it('falls back when nothing is left', () => {
    expect(safeFileName('???')).toBe('contact')
    expect(safeFileName('...', 'file')).toBe('file')
  })
})
