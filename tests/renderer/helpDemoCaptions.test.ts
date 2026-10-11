/**
 * Help demo captions are reading text, so they're 15px (text-sm) like the
 * rest of the app; only the small mock UI inside a demo may be smaller (R7).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const DIR = join(__dirname, '../../src/renderer/components/shared/help-demos')
const demos = readdirSync(DIR).filter(f => /^Demo.*\.tsx$/.test(f) && f !== 'DemoWrapper.tsx')

describe('help demo captions', () => {
  it('finds the demos', () => {
    expect(demos.length).toBeGreaterThan(10)
  })

  it('titles and explanations under the demos are 15px', () => {
    const small: string[] = []
    for (const f of demos) {
      const src = readFileSync(join(DIR, f), 'utf8')
      // The title above each demo, and the centered explanation below it
      const captions = src.match(/<div className="[^"]*(font-medium text-slate-500 dark:text-slate-400 mb-[23]|text-center)[^"]*">/g) ?? []
      for (const c of captions) if (/\btext-xs\b/.test(c)) small.push(`${f}: ${c}`)
    }
    expect(small).toEqual([])
  })
})
