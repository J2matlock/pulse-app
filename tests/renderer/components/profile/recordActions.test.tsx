// @vitest-environment jsdom
/** 3.6: the More menu, letters from the record page, and printing the record. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: () => () => {}, setZoomFactor: vi.fn(), copyToClipboard: vi.fn() },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/hooks/useCopyFeedback', () => ({ useCopyFeedback: () => ({ copied: false, copyToClipboard: vi.fn(async () => {}) }) }))

import { ProfileMoreMenu } from '../../../../src/renderer/components/profile/ProfileMoreMenu'
import { RecordLetterDialog } from '../../../../src/renderer/components/profile/RecordLetterDialog'
import { ProfilePrintLayout } from '../../../../src/renderer/components/profile/ProfilePrintLayout'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { GridRow } from '../../../../src/shared/types'

beforeEach(() => { setWords(); mockInvoke.mockReset() })

describe('More menu', () => {
  it('opens, runs an item, and closes on Escape', async () => {
    const onArchive = vi.fn()
    render(<ProfileMoreMenu items={[{ label: 'Archive…', onSelect: onArchive }, { label: 'Move to Trash…', onSelect: vi.fn(), danger: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }))
    expect(onArchive).toHaveBeenCalled()
  })
})

describe('letter from the record page', () => {
  it('can be edited, saved as a PDF, and is noted in the log once', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'letter-template:get-all') return Promise.resolve({ ok: true, data: [{ id: 3, name: 'Welcome', description: '', is_system: 0 }] })
      if (channel === 'letter-template:generate') return Promise.resolve({ ok: true, data: { text: 'Dear Maria,', unknown: [] } })
      if (channel === 'letter-template:export-pdf') return Promise.resolve({ ok: true, data: '/home/me/letter.pdf' })
      return Promise.resolve({ ok: true, data: null })
    })
    render(<RecordLetterDialog rowId={4} gridId={1} clientName="Maria" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fill in letter' })) })
    const box = screen.getByLabelText(/The letter/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Dear Maria, welcome.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save as PDF/ })) })
    expect(mockInvoke).toHaveBeenCalledWith('letter-template:export-pdf', { text: 'Dear Maria, welcome.' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy/ })) })
    const notes = mockInvoke.mock.calls.filter(c => c[0] === 'case-log:create')
    expect(notes).toEqual([['case-log:create', 4, 'Letter: Welcome', 'system', null]])
  })

  it('says which profile fields are blank and where to fill them in (C-05)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'letter-template:get-all') return Promise.resolve({ ok: true, data: [{ id: 3, name: 'Welcome', description: '', is_system: 0 }] })
      if (channel === 'letter-template:generate') return Promise.resolve({ ok: true, data: { text: 'My name is [your name], [your title].', unknown: [], empty: ['name', 'title'] } })
      return Promise.resolve({ ok: true, data: null })
    })
    render(<RecordLetterDialog rowId={4} gridId={1} clientName="Maria" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fill in letter' })) })
    expect(screen.getByText(/Your name and title are blank/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'add them in Settings → Profile' }))
    expect(window.location.hash).toBe('#/settings?tab=profile')
  })
})

describe('printing the record', () => {
  it('prints deadlines from the engine and leaves scrap notes out unless chosen', async () => {
    vi.useFakeTimers()
    try {
      window.print = vi.fn()
      useGridStore.setState({ columns: [], grids: [{ id: 1, name: 'People' } as never] })
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'deadlines:get') return Promise.resolve({ ok: true, data: [{ column_id: 2, column_name: 'Review', due: '2026-10-20', state: 'ok', daysUntil: 10, estimated: false, detail: '' }] })
        if (channel === 'scrap-note:get') return Promise.resolve({ ok: true, data: { content: 'private' } })
        return Promise.resolve({ ok: true, data: [] })
      })
      const row = { row_id: 4, col_1: 'Maria' } as unknown as GridRow
      render(<ProfilePrintLayout rowId={4} gridId={1} clientName="Maria" row={row} onClose={vi.fn()}
        sections={{ gridData: false, deadlines: true, checklist: false, caseLog: false, contactInfo: false, scratchPad: false }} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.getByText(/Next due Oct 20, 2026.+Due in 10 days/)).toBeTruthy()
      expect(screen.queryByText('private')).toBeNull()
      expect(mockInvoke.mock.calls.some(c => c[0] === 'scrap-note:get')).toBe(false)
    } finally { vi.useRealTimers() }
  })
})
