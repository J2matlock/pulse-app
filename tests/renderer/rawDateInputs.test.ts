/**
 * Raw date inputs only go down (persona study R1, D1). A native
 * <input type="date"> reports '' for a half-typed or impossible date, which
 * has erased stored dates; DateField in components/ui refuses those instead.
 * New date entry uses DateField. When a file is converted, lower BASELINE
 * to the count the failure message reports.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')
/** The date box itself */
const EXEMPT = new Set(['components/ui/DateField.tsx'])
/** 33 in 24 files before R1; R1 converted 8 (the cell editor, the checklist's 3, the dashboard's 4) */
const BASELINE = 23

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return name.endsWith('.tsx') ? [full] : []
  })
}

export function countRawDateInputs(src: string): number {
  return (src.match(/type=(?:"date"|'date'|\{\s*["']date["']\s*\})/g) ?? []).length
}

describe('raw date inputs', () => {
  it('counts the ways a date input is written', () => {
    expect(countRawDateInputs(`<input type="date" /><input type='date' /><input type={'date'} /><input type="datetime-local" />`)).toBe(3)
  })

  it(`no more than ${BASELINE} outside DateField`, () => {
    const perFile: Record<string, number> = {}
    for (const file of tsxFiles(RENDERER)) {
      const rel = relative(RENDERER, file).split(sep).join('/')
      if (EXEMPT.has(rel)) continue
      const n = countRawDateInputs(readFileSync(file, 'utf8'))
      if (n > 0) perFile[rel] = n
    }
    const total = Object.values(perFile).reduce((a, b) => a + b, 0)
    expect(total, `${total} raw date inputs (baseline ${BASELINE}). Use <DateField> from components/ui (plans/persona-study-2026-10/plan-R1-dates-and-first-look.md). Now in: ${JSON.stringify(perFile)}`).toBeLessThanOrEqual(BASELINE)
  })
})
