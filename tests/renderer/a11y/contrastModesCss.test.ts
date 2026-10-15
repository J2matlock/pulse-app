/**
 * The app's High contrast mode and Windows High Contrast (forced colors).
 * jsdom can't apply cascade layers or media queries, so these read the
 * stylesheet itself.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const CSS = readFileSync(join(__dirname, '../../../src/renderer/styles/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('High contrast setting (audit A06-15)', () => {
  it('no longer repaints every border in the text color', () => {
    expect(CSS).not.toMatch(/\.high-contrast\s+\*\s*\{[^}]*border-color/)
  })

  it('darkens the pale neutral borders through the --border token, at one-class specificity', () => {
    expect(CSS).toMatch(/:where\(\.high-contrast\)\s+:is\([^)]*\.border-slate-200[^)]*\)\s*\{\s*border-color:\s*var\(--border\)/)
    expect(CSS).toMatch(/:where\(\.dark\.high-contrast\)\s+:is\([^)]*\.dark\\:border-slate-700[^)]*\)\s*\{\s*border-color:\s*var\(--border\)/)
    // Colored borders (selected, error, urgency) aren't in the list
    const lists = [...CSS.matchAll(/high-contrast\)\s+:is\(([^)]*)\)/g)].map(m => m[1]).join(' ')
    expect(lists).not.toMatch(/blue|red|amber|orange|yellow|green/)
  })
})

describe('Windows High Contrast / forced colors (audit A06-20)', () => {
  const block = CSS.slice(CSS.indexOf('@media (forced-colors: active)'))

  it('has a forced-colors block', () => {
    expect(CSS).toContain('@media (forced-colors: active)')
  })

  it('draws focus with an outline in a system color, since box-shadow rings vanish', () => {
    expect(block).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid Highlight !important/)
  })

  it('switches show their state with system colors', () => {
    expect(block).toMatch(/\[role="switch"\]\s*\{[^}]*border:\s*2px solid ButtonText/)
    expect(block).toMatch(/\[role="switch"\]\[aria-checked="true"\]\s*\{[^}]*background:\s*Highlight/)
  })

  it('the shared Toggle is drawn the way those rules expect: role on the track, knob as its first span', () => {
    const src = readFileSync(join(__dirname, '../../../src/renderer/components/ui/Toggle.tsx'), 'utf8')
    expect(src).toMatch(/role="switch"[^]*?>\s*<span className=\{`inline-block h-4 w-4 rounded-full/)
  })

  it('ticked custom checkboxes stay visible when fills are dropped', () => {
    expect(block).toMatch(/\[role="checkbox"\] > :is\(span, div\):first-child\s*\{[^}]*border:\s*2px solid ButtonText/)
    expect(block).toMatch(/\[role="checkbox"\]\[aria-checked="true"\] > :is\(span, div\):first-child\s*\{[^}]*background:\s*Highlight/)
  })
})
