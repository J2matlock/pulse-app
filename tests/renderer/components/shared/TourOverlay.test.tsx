// @vitest-environment jsdom
/** The tour matches the app: short, feature-aware, live targets, a real dialog (audit 2.8). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { STEPS, TourOverlay, tourSteps } from '../../../../src/renderer/components/shared/TourOverlay'
import { showMeSteps } from '../../../../src/renderer/views/HelpView'
import { FAQ_ITEMS as faqItems } from '../../../../src/renderer/views/help/faqData'
import { firstRuleColumnId, ruleColumnTarget } from '../../../../src/renderer/components/shared/tourSteps'
import { computeTooltipPosition } from '../../../../src/renderer/components/shared/tourPosition'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import type { Column } from '../../../../src/shared/types'
import { setWords, setFeatures, EXISTING_FEATURES } from '../../vocabFixture'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

beforeEach(() => { setWords(); window.location.hash = '' })

describe('tour steps', () => {
  it('every target exists somewhere in the app (no dead spotlight)', () => {
    const root = join(__dirname, '../../../../src/renderer')
    const attrs = new Set<string>()
    for (const file of sourceFiles(root)) {
      // The steps' own selectors don't count as targets
      if (file.endsWith('TourOverlay.tsx') || file.endsWith('tourSteps.tsx')) continue
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/data-tour(?:="|': ')([a-z-]+)/g)) attrs.add(m[1]!)
    }
    const missing = STEPS.map(s => /data-tour="([a-z-]+)"/.exec(s.target)?.[1]).filter(id => id && !attrs.has(id))
    expect(missing).toEqual([])
  })

  it('the tour Help plays covers every switched-on step, Help included (UX pass Q7: no short first-run tour)', async () => {
    vi.useFakeTimers()
    render(<TourOverlay onComplete={() => {}} />)
    const playable = tourSteps(STEPS)
    expect(screen.getByText(`Step 1 of ${playable.length}`)).toBeTruthy()
    expect(playable.length).toBeGreaterThan(8)
    expect(playable.some(s => s.id === 'help')).toBe(true)
    vi.useRealTimers()
  })

  it('leaves out switched-off features, in the full tour and in "Show me"', () => {
    setFeatures({ ...EXISTING_FEATURES, contactsDirectory: false, tasks: false })
    const ids = tourSteps(STEPS).map(s => s.id)
    expect(ids).not.toContain('contacts')
    expect(ids).not.toContain('tasks')
    expect(showMeSteps(['contacts', 'add-provider'])).toEqual([])
    setFeatures()
    expect(showMeSteps(['contacts', 'add-provider'])).toHaveLength(2)
  })

  it('every "Show me" in Help names steps that exist', () => {
    const unknown = faqItems.flatMap(i => (i.tourStepIds ?? []).filter(id => !STEPS.some(s => s.id === id)))
    expect(unknown).toEqual([])
  })
})

describe('TourOverlay', () => {
  it('is a labelled dialog, shows the counter once, and only Next moves on', async () => {
    vi.useFakeTimers()
    render(<TourOverlay onComplete={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getAllByText(/^Step 1 of/)).toHaveLength(1)
    // A click outside the card doesn't skip ahead
    fireEvent.click(dialog.parentElement!)
    expect(screen.getByText(/^Step 1 of/)).toBeTruthy()
    // Focus lands on Next
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(document.activeElement?.textContent).toMatch(/Next/)
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText(/^Step 2 of/)).toBeTruthy()
    vi.useRealTimers()
  })

  it('skipping goes back where it was started (Help), so starting it needs no question', () => {
    const onComplete = vi.fn()
    render(<TourOverlay onComplete={onComplete} returnRoute="#/help" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip tour' })[0]!)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/help')
  })
})

describe('deadline colours step (UX-A-03, UX-A-10)', () => {
  const col = (id: number, column_type: Column['column_type'], config = '{}'): Column =>
    ({ id, column_type, config, name: `c${id}`, position: id } as unknown as Column)
  const step = () => STEPS.find(s => s.id === 'deadline-colors')!

  it('points at the first column with a rule, beside it, and says so', () => {
    useGridStore.setState({ columns: [col(1, 'text'), col(2, 'date'), col(3, 'date', JSON.stringify({ alert_rule_id: 7 })), col(4, 'deadline')] })
    expect(firstRuleColumnId()).toBe(3)
    expect(ruleColumnTarget()).toBe('[role="columnheader"][style*="--cw-3)"]')
    expect(step().target).toBe(ruleColumnTarget())
    expect(step().position).toBe('right')
    expect(step().description).toMatch(/This column has a rule/)
  })

  it('falls back to the whole list when no column has a rule', () => {
    useGridStore.setState({ columns: [col(1, 'text'), col(2, 'date', 'not json')] })
    expect(firstRuleColumnId()).toBeNull()
    expect(step().target).toBe('[data-tour="grid"]')
    expect(step().position).toBe('bottom')
    expect(step().description).toMatch(/None of your date columns has a rule yet/)
  })
})

describe('tour card position', () => {
  const rect = (left: number, width: number) => ({ top: 100, left, right: left + width, bottom: 600, width, height: 500 })

  it('sits to the right of the target, clear of the pulse ring', () => {
    const style = computeTooltipPosition(rect(0, 220), 'right', 300, { width: 1366, height: 768 }, 420, 24)
    expect(style.left).toBe(244)
  })

  it('moves to the left of a target near the right edge instead of covering it', () => {
    const style = computeTooltipPosition(rect(1000, 150), 'right', 300, { width: 1366, height: 768 }, 420, 24)
    expect(style.left).toBe(1000 - 24 - 420)
  })
})
