// @vitest-environment jsdom
/** The tour matches the app: short, feature-aware, live targets, a real dialog (audit 2.8). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { STEPS, FIRST_RUN_TOUR, TourOverlay, tourSteps } from '../../../../src/renderer/components/shared/TourOverlay'
import { showMeSteps } from '../../../../src/renderer/views/HelpView'
import { FAQ_ITEMS as faqItems } from '../../../../src/renderer/views/help/faqData'
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

  it('the first-run tour is short and ends at Help', () => {
    expect(FIRST_RUN_TOUR.length).toBeLessThanOrEqual(8)
    for (const id of FIRST_RUN_TOUR) expect(STEPS.some(s => s.id === id)).toBe(true)
    expect(FIRST_RUN_TOUR.at(-1)).toBe('help')
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
})
