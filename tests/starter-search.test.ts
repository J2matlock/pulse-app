/** Gallery search finds what people type (audit 2.13 / F-16). */
import { describe, it, expect } from 'vitest'
import { BUILTIN_STARTERS } from '../src/shared/starters'
import { matchingVariants, parseStarter, searchStarters, summarizeStarter } from '../src/shared/starters/schema'

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

  it('puts the starter named for the words before one found only through a layout (R8)', () => {
    // CASA's keywords say "foster"; Human services has it only in a layout's name
    const foster = ids('foster')
    expect(foster.indexOf('casa-advocate')).toBeLessThan(foster.indexOf('human-services'))
    // Joe licenses foster homes: his example first, and it's there for the words of the job
    expect(foster[0]).toBe('foster-home-licensing')
    for (const q of ['license', 'licence', 'inspection', 'foster home', 'well water']) expect(ids(q), q).toContain('foster-home-licensing')
    // Candy typed her job: the nursing example first, then whatever else has the words
    expect(ids('home health')[0]).toBe('home-health-nursing')
    for (const q of ['hospice', 'patient', 'visit', 'mileage']) expect(ids(q), q).toContain('home-health-nursing')
    // Karen is a school social worker
    const school = ids('school social worker')
    expect(school).toContain('special-education')
    expect(school.indexOf('special-education')).toBeLessThan(school.indexOf('human-services'))
    // An empty search keeps the catalog's order
    expect(ids('')).toEqual(all.map(s => s.id))
  })
})

describe('matchingVariants (R8)', () => {
  const humanServices = all.find(s => s.id === 'human-services')!
  const names = (q: string) => matchingVariants(humanServices, q).map(v => v.name)

  it('names the layouts a search found the starter by', () => {
    expect(names('foster')).toEqual(['Foster Care Caseworker'])
    expect(names('home health')).toEqual(['Home Health Coordinator'])
    // List names count too ("IEP Caseload")
    expect(names('iep')).toEqual(['IEP Coordinator'])
  })

  it('needs every word whole, and says nothing for the starter’s own words', () => {
    expect(names('fost')).toEqual([])
    expect(names('foster health')).toEqual([])
    expect(names('human services')).toEqual([])
    expect(names('')).toEqual([])
    expect(matchingVariants(all.find(s => s.id === 'tax-preparer')!, 'tax')).toEqual([])
  })
})
