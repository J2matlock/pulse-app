// @vitest-environment jsdom
/** 1.19: choose what goes into a record's PDF; scrap notes are off unless ticked. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { ProfileExportDialog } from '../../../../src/renderer/components/profile/ProfileExportDialog'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('ProfileExportDialog', () => {
  it('leaves scrap notes out by default', () => {
    const onSave = vi.fn()
    render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={onSave} onClose={vi.fn()} />)
    expect((screen.getByLabelText('Scratch notes') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF…' }))
    expect(onSave).toHaveBeenCalledWith({ gridData: true, deadlines: true, checklist: true, caseLog: true, contactInfo: true, scratchPad: false })
  })

  it('saves only the ticked sections', () => {
    const onSave = vi.fn()
    render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Scratch notes'))
    fireEvent.click(screen.getByLabelText('Deadlines'))
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF…' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ scratchPad: true, deadlines: false }))
  })
})
