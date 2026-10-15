/** Every one-time hint points at something that exists, and every id has its row (UX pass Q7). */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { HINT_IDS, HINTS, hintForRoute } from '../../../src/renderer/components/onboarding/screenHints'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

describe('screen hints', () => {
  it('every target exists somewhere in the app (no hint waiting for nothing)', () => {
    const root = join(__dirname, '../../../src/renderer')
    const attrs = new Set<string>()
    for (const file of sourceFiles(root)) {
      // The tour's and the hints' own selectors don't count as targets
      if (/(TourOverlay|tourSteps|screenHints)\.tsx?$/.test(file)) continue
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/data-tour(?:="|': ')([a-z-]+)/g)) attrs.add(m[1]!)
    }
    const targets = HINT_IDS.flatMap(id => HINTS[id]?.target ? [HINTS[id]!.target!] : [])
    expect(targets.length).toBeGreaterThan(4)
    const missing = targets.map(t => /data-tour="([a-z-]+)"/.exec(t)?.[1] ?? t).filter(id => !attrs.has(id))
    expect(missing).toEqual([])
  })

  it('every id has a row, and only the first look has no screen of its own', () => {
    expect(Object.keys(HINTS).sort()).toEqual([...HINT_IDS].sort())
    expect(HINT_IDS.filter(id => HINTS[id] === null)).toEqual(['caseload'])
  })

  it('each screen finds its own hint', () => {
    expect(hintForRoute('/grid')?.id).toBe('grid')
    expect(hintForRoute('/profile/12')?.id).toBe('profile')
    expect(hintForRoute('/dashboard')?.id).toBe('dashboard')
    expect(hintForRoute('/calendar')?.id).toBe('calendar')
    expect(hintForRoute('/tasks')?.id).toBe('tasks')
    expect(hintForRoute('/contacts')?.id).toBe('contacts')
    expect(hintForRoute('/settings')?.id).toBe('settings')
    expect(hintForRoute('/help')?.id).toBe('help')
    expect(hintForRoute('/trash')).toBeNull()
  })
})
