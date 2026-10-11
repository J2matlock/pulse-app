// @vitest-environment jsdom
/**
 * Component-level accessibility outside the grid (audit batch B12): dialog
 * roles and names, live regions, labels, and an axe pass over each component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }), on: () => () => {} },
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
Element.prototype.scrollIntoView = function scrollIntoView() {}

import { ConfirmDialog } from '../../../src/renderer/components/shared/ConfirmDialog'
import { CommandPalette } from '../../../src/renderer/components/shared/CommandPalette'
import { UndoToast } from '../../../src/renderer/components/shared/UndoToast'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { ChecklistTemplateEditor } from '../../../src/renderer/components/profile/ChecklistTemplateEditor'
import { ImportPreviewModal } from '../../../src/renderer/components/shared/ImportPreviewModal'
import { setWords } from '../vocabFixture'

beforeEach(() => { setWords() })
afterEach(() => cleanup())

describe('ConfirmDialog (audit A06-21)', () => {
  it('a destructive confirmation is an alertdialog described by its message', async () => {
    render(<ConfirmDialog open title="Delete Test Person" message="This can't be undone." onConfirm={() => {}} onCancel={() => {}} />)
    const dlg = screen.getByRole('alertdialog', { name: 'Delete Test Person' })
    const describedBy = dlg.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe("This can't be undone.")
    await expectNoAxeViolations(document.body)
  })

  it('a non-destructive confirmation stays a plain dialog', async () => {
    render(<ConfirmDialog open destructive={false} title="Apply the change?" onConfirm={() => {}} onCancel={() => {}} />)
    const dlg = screen.getByRole('dialog', { name: 'Apply the change?' })
    expect(dlg.getAttribute('aria-describedby')).toBeNull()
    await expectNoAxeViolations(document.body)
  })
})

describe('UndoToast (audit A06-26)', () => {
  it('is a polite status, not an assertive alert', async () => {
    useUndoStore.setState({ toast: { description: 'Deleted Test Person' } })
    render(<UndoToast />)
    const toast = screen.getByRole('status')
    expect(toast.textContent).toContain('Deleted Test Person')
    expect(screen.queryByRole('alert')).toBeNull()
    await expectNoAxeViolations(document.body)
    useUndoStore.setState({ toast: null })
  })
})

describe('CommandPalette (audit A06-24)', () => {
  it('the search box and the result groups have names', async () => {
    render(<MemoryRouter><CommandPalette open onOpenChange={() => {}} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByRole('combobox', { name: 'Search clients and commands' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Quick Actions' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })
})

describe('dialogs are named by their headings (audit A06-22)', () => {
  it('checklist template editor, and a missing name is tied to the name field (audit A06-14)', async () => {
    render(<ChecklistTemplateEditor open template={null} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New Template' })).toBeTruthy()
    const name = screen.getByLabelText(/^Name/)
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^(Create|Save)/ })) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Name is required')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(alert.id)
    await expectNoAxeViolations(document.body)
  })

  it('import template preview', async () => {
    const imported = { filePath: '/tmp/test.pulse', preview: { name: 'Test template', columnCount: 2, alertRuleCount: 0, checklistCount: 0, columns: [{ name: 'Due', column_type: 'date' }], warnings: [] } }
    render(<ImportPreviewModal imported={imported} grids={[]} onClose={() => {}} onApplied={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Import Template' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })
})
