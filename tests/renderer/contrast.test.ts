/**
 * Readable text in both themes (audit N-18): words are no lighter than
 * slate-500 in light mode or slate-400 in dark mode. Lighter greys are only for
 * decorative dashes, dots and icons.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return name.endsWith('.tsx') ? [full] : []
  })
}

// className="…" and className={`…`} strings that set a text size, i.e. words
const CLASS = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g
const SIZED = /(^|\s)text-(sm|base|lg)\b/
const FAINT_LIGHT = /(^|\s)text-(slate|gray)-(300|400)(\/\d+)?\b/
const FAINT_DARK = /(^|\s)dark:text-(slate|gray)-(500|600)(\/\d+)?\b/
// Checked by hand: an empty-value dash
const ALLOWED = ['/components/profile/GridDataSummary.tsx: text-slate-400 dark:text-slate-500 italic text-base']

describe('text contrast', () => {
  it('no sized text uses a grey too faint to read', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(CLASS)) {
        const cls = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ')
        // Disabled controls are exempt from contrast rules
        if (!SIZED.test(cls) || /cursor-not-allowed|disabled:/.test(cls)) continue
        if (FAINT_LIGHT.test(cls) || FAINT_DARK.test(cls)) {
          const where = `${file.replace(RENDERER, '')}: ${cls.trim().slice(0, 100)}`
          if (!ALLOWED.some(a => where.startsWith(a))) offenders.push(where)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
