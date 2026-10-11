/**
 * 15px is the minimum for anything people read (spec Section 10). text-sm is
 * the most-used size for secondary text, so it has to be 15px; text-xs is kept
 * for keyboard keys and small count badges only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

function token(css: string, name: string): number {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)px`))
  if (!m) throw new Error(`missing --${name}`)
  return Number(m[1])
}

describe('text sizes', () => {
  const css = readFileSync(join(RENDERER, 'styles/globals.css'), 'utf8')

  it('text-sm and text-base are at least 15px, text-xs at least 14px', () => {
    expect(token(css, 'text-base')).toBeGreaterThanOrEqual(15)
    expect(token(css, 'text-sm')).toBeGreaterThanOrEqual(15)
    expect(token(css, 'text-xs')).toBeGreaterThanOrEqual(14)
  })

  it('no screen uses a hard-coded size under 14px', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      // The printed profile is paper, not screen.
      if (file.endsWith('ProfilePrintLayout.tsx')) continue
      const src = readFileSync(file, 'utf8')
      const tiny = src.match(/text-\[(?:[0-9]|1[0-3])px\]/g)
      if (tiny) offenders.push(`${file.replace(RENDERER, '')}: ${tiny.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
