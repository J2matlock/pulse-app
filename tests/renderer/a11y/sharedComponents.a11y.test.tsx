// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on shared dialogs: the confirm
 * dialog and the command palette, rendered for real (no cmdk or motion mocks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations, axeViolations, formatViolations } from './axe'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }), on: () => () => {} },
  writable: true,
})
// cmdk measures its list with ResizeObserver and scrolls the selected item into view
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
Element.prototype.scrollIntoView = function scrollIntoView() {}

import { ConfirmDialog } from '../../../src/renderer/components/shared/ConfirmDialog'
import { CommandPalette } from '../../../src/renderer/components/shared/CommandPalette'
import { setWords } from '../vocabFixture'

beforeEach(() => { setWords() })
afterEach(() => cleanup())

describe('axe helper', () => {
  it('catches a control with no name, and says which one', async () => {
    const { container } = render(<div><button type="button"><span /></button><div role="switch" aria-checked="false" tabIndex={0} /></div>)
    const violations = await axeViolations(container)
    const ids = violations.map(v => v.id)
    expect(ids).toContain('button-name')
    expect(formatViolations(violations)).toMatch(/button-name: Buttons must have discernible text/)
  })
})

describe('axe: shared dialogs', () => {
  it('confirm dialog has no accessibility problems', async () => {
    render(<ConfirmDialog open title="Delete Test Person" message="This can't be undone." onConfirm={() => {}} onCancel={() => {}} />)
    await expectNoAxeViolations(document.body)
  })

  it('command palette has no accessibility problems', async () => {
    render(<MemoryRouter><CommandPalette open onOpenChange={() => {}} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await expectNoAxeViolations(document.body)
  })
})
