/** Gallery search finds what people type (audit 2.13 / F-16). */
import { describe, it, expect } from 'vitest'
import { BUILTIN_STARTERS } from '../src/shared/starters'
import { parseStarter, searchStarters, summarizeStarter } from '../src/shared/starters/schema'

const all = BUILTIN_STARTERS.map(raw => {
  const r = parseStarter(raw)
  if (!r.ok) throw new Error('invalid starter')
  return summarizeStarter(r.starter)
})
const ids = (q: string) => searchStarters(all, q).map(s => s.id)

describe('searchStarters', () => {
  it('finds everyday words through keywords', () => {
    expect(ids('daycare')).toContain('childcare-center')
    expect(ids('plumber')).toContain('home-services')
    expect(ids('dog')).toContain('animal-rescue')
    expect(ids('rental')).toContain('property-manager')
    expect(ids('dental')).toContain('family-health')
    expect(ids('teacher')).toContain('special-education')
  })

  it('"car" means cars, not caring or childcare', () => {
    expect(ids('car')).toContain('auto-service')
    expect(ids('car')).not.toContain('caring-for-a-parent')
    expect(ids('car')).not.toContain('childcare-center')
  })

  it('still finds as you type, and searches the group name', () => {
    expect(ids('plumb')).toContain('home-services')
    expect(ids('human services').length).toBeGreaterThan(0)
    expect(ids('')).toHaveLength(all.length)
  })
})
