// @vitest-environment jsdom
/**
 * Small colour fixes (Q-107, A29-16): the open-record icon is readable in light
 * mode, each pulsing swatch previews its own colour and says which is chosen,
 * and the dashboard's "later" stripe has a dark-mode colour.
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { DeadlineRow } from '../../../src/renderer/views/dashboard/DeadlineRow'

const ROOT = join(__dirname, '../../../src/renderer')

function luminance(r: number, g: number, b: number): number {
  const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

describe('colour consistency (Q-107)', () => {
  it('the open-record icon is at least 3:1 on the light grid', () => {
    const css = readFileSync(join(ROOT, 'styles/globals.css'), 'utf8')
    const block = /\.profile-btn-glow \{([^}]*)\}/.exec(css)![1]!
    const [r, g, b] = /(?:^|\n)\s*color: rgb\((\d+), (\d+), (\d+)\)/.exec(block)!.slice(1).map(Number) as [number, number, number]
    // the button's own tint over white: rgba(99,102,241,0.08)
    const bg = [255 + (99 - 255) * 0.08, 255 + (102 - 255) * 0.08, 255 + (241 - 255) * 0.08] as const
    const ratio = (luminance(...bg) + 0.05) / (luminance(r, g, b) + 0.05)
    expect(ratio).toBeGreaterThanOrEqual(3)
  })

  it('each pulsing swatch uses its own class and colour, with a name and a pressed state', () => {
    const src = readFileSync(join(ROOT, 'components/alerts/AlertRuleEditor.tsx'), 'utf8')
    const css = readFileSync(join(ROOT, 'styles/globals.css'), 'utf8')
    for (const cls of ['alert-pulse', 'alert-pulse-dark']) {
      const hex = new RegExp(`value: '${cls}',\\s*label: '[^']+',\\s*hex: '(#[0-9a-f]{6})'`, 'i').exec(src)![1]!
      const cssHex = new RegExp(`\\.${cls} \\{\\s*background-color: color-mix\\(in srgb, (#[0-9A-F]{6})`, 'i').exec(css)![1]!
      expect(hex.toLowerCase()).toBe(cssHex.toLowerCase())
    }
    const swatch = /PULSE_OPTIONS\.map\(p => \([\s\S]*?\/>/.exec(src)![0]
    expect(swatch).toContain('aria-label={p.label}')
    expect(swatch).toContain('aria-pressed={value === p.value}')
    expect(swatch).toContain('} ${p.value}`}')
    expect(swatch).not.toMatch(/\} alert-pulse`/)
  })

  it('the dashboard "later" stripe has a dark-mode colour', () => {
    const { container } = render(
      <MemoryRouter>
        <DeadlineRow deadline={{ rowId: 1, clientName: 'A', gridId: 1, gridName: 'L', columnId: 2, columnName: 'Review', dateValue: '2026-01-01', daysUntil: 90, alertRuleId: null, threshold: null, intervalDays: null } as never} onMarkDone={vi.fn()} />
      </MemoryRouter>,
    )
    const stripe = container.querySelector('.w-1.self-stretch')!
    expect(stripe.className).toContain('bg-slate-200')
    expect(stripe.className).toContain('dark:bg-slate-600')
  })
})
