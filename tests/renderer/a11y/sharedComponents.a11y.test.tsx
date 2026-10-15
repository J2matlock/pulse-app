// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on shared dialogs: the confirm
 * dialog and the command palette, rendered for real (no cmdk or motion mocks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
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
import { Dialog } from '../../../src/renderer/components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../../src/renderer/components/ui/Button'
import { EmptyState } from '../../../src/renderer/components/shared/EmptyState'
import { Toggle, ToggleRow } from '../../../src/renderer/components/ui/Toggle'
import { RowMenu } from '../../../src/renderer/components/ui/RowMenu'
import { CategoryManager } from '../../../src/renderer/components/contacts/CategoryManager'
import { UndoHistoryPanel } from '../../../src/renderer/components/shared/UndoHistoryPanel'
import { useContactsStore } from '../../../src/renderer/stores/contactsStore'
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
    render(<ConfirmDialog open title="Delete Test Person" message="This can't be undone." confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />)
    await expectNoAxeViolations(document.body)
  })

  it('the shared Dialog shell has no accessibility problems', async () => {
    render(
      <Dialog open onClose={() => {}} title="Rename column" description="The new name shows everywhere."
        footer={<><SecondaryButton>Cancel</SecondaryButton><PrimaryButton>Rename</PrimaryButton></>}>
        <label>Name <input /></label>
      </Dialog>,
    )
    await expectNoAxeViolations(document.body)
  })

  it('toggle rows, off and on, have no accessibility problems', async () => {
    const { container } = render(<div>
      <ToggleRow label="Less movement" description="Turn off animations" checked={false} onChange={() => {}} />
      <ToggleRow label="Stronger contrast" checked onChange={() => {}} />
      <Toggle checked={false} onChange={() => {}} label="Items repeat" showState={false} />
    </div>)
    await expectNoAxeViolations(container)
  })

  it('an open row menu has no accessibility problems', async () => {
    render(<RowMenu label="More for Call insurance" items={[
      { label: 'Edit', onSelect: () => {}, description: 'Change the title' },
      { label: 'Delete', onSelect: () => {}, danger: true },
    ]} />)
    act(() => { screen.getByRole('button', { name: 'More for Call insurance' }).click() })
    expect(screen.getByRole('menu')).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })

  it('a page-size empty state has no accessibility problems', async () => {
    const { container } = render(<EmptyState title="No tasks yet" description="Tasks you add show here." icon={<svg />} action={{ label: 'Add task', onClick: () => {} }} secondaryAction={{ label: 'Import', onClick: () => {} }} />)
    await expectNoAxeViolations(container)
  })

  it('command palette has no accessibility problems', async () => {
    render(<MemoryRouter><CommandPalette open onOpenChange={() => {}} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await expectNoAxeViolations(document.body)
  })
})

describe('axe: small panels with icon-only buttons (audit A06-13)', () => {
  it('category manager: close, save, cancel and field buttons have names', async () => {
    useContactsStore.setState({ categories: [{ id: 1, name: 'Housing', color: '#3b82f6', position: 0, created_at: '2026-01-01' }], customFields: [] } as never)
    render(<CategoryManager open onClose={() => {}} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })

  it('undo history panel: the close button has a name', async () => {
    const anchor = { current: document.createElement('button') }
    render(<UndoHistoryPanel anchorRef={anchor} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })
})
