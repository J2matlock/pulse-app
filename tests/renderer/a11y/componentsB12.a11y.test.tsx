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
import { ResetPasswordAfterRecoveryDialog } from '../../../src/renderer/components/shared/ResetPasswordAfterRecoveryDialog'
import { setWords } from '../vocabFixture'

beforeEach(() => { setWords() })
afterEach(() => cleanup())

describe('ConfirmDialog (audit A06-21)', () => {
  it('a destructive confirmation is an alertdialog described by its message', async () => {
    render(<ConfirmDialog open title="Delete Test Person" message="This can't be undone." confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />)
    const dlg = screen.getByRole('alertdialog', { name: 'Delete Test Person' })
    const describedBy = dlg.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe("This can't be undone.")
    await expectNoAxeViolations(document.body)
  })

  it('a non-destructive confirmation stays a plain dialog', async () => {
    render(<ConfirmDialog open destructive={false} title="Apply the change?" confirmLabel="Apply" onConfirm={() => {}} onCancel={() => {}} />)
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
    expect(screen.getByRole('group', { name: 'Quick actions' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })
})

describe('dialogs are named by their headings (audit A06-22)', () => {
  it('checklist template editor, and a missing name is tied to the name field (audit A06-14)', async () => {
    render(<ChecklistTemplateEditor open template={null} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New template' })).toBeTruthy()
    const name = screen.getByLabelText(/^Name/)
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^(Create|Save)/ })) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Give the template a name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(alert.id)
    await expectNoAxeViolations(document.body)
  })

  it('import template preview', async () => {
    const imported = { filePath: '/tmp/test.pulse', preview: { name: 'Test template', columnCount: 2, alertRuleCount: 0, checklistCount: 0, columns: [{ name: 'Due', column_type: 'date' }], warnings: [] } }
    render(<ImportPreviewModal imported={imported} grids={[]} onClose={() => {}} onApplied={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Import template' })).toBeTruthy()
    await expectNoAxeViolations(document.body)
  })
})

describe('set a new password after recovery (audit A06-14, A06-22)', () => {
  it('is a named dialog and a mismatch is tied to the confirm box', async () => {
    render(<ResetPasswordAfterRecoveryDialog open onComplete={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Set a new password' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a long enough test password 42' } })
    const confirm = screen.getByLabelText('Confirm password')
    fireEvent.change(confirm, { target: { value: 'different' } })
    expect(confirm.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(confirm.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Passwords do not match')
    await expectNoAxeViolations(document.body)
  })
})

describe('submit-time errors are announced (audit A06-14)', () => {
  // Deleting a letter template no longer asks first (Q4); a failure is a toast, which is a polite status
  it('a letter template that could not be deleted says so out loud', async () => {
    const { deleteWithUndo } = await import('../../../src/renderer/utils/libraryUndo')
    const { ToastHost } = await import('../../../src/renderer/components/shared/ToastHost')
    const { default: toast } = await import('react-hot-toast')
    const api = window.api as unknown as { invoke: unknown }
    const before = api.invoke
    api.invoke = vi.fn().mockResolvedValue({ ok: false, error: 'SQLITE_BUSY: database is locked' })
    if (!window.matchMedia) Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
    render(<ToastHost />)
    await act(async () => { await deleteWithUndo('letter-template', 4, '"Reminder"', "We couldn't delete the template — try again") })
    const status = await screen.findByText("We couldn't delete the template — try again")
    expect(status.closest('[role="status"]')).not.toBeNull()
    await expectNoAxeViolations(document.body)
    act(() => { toast.remove() })
    api.invoke = before
  })
})
