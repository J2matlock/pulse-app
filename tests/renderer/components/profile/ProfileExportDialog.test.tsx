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
    expect(onSave).toHaveBeenCalledWith({ gridData: true, deadlines: true, checklist: true, caseLog: true, contactInfo: true, scratchPad: false, allNotes: false })
  })

  it('saves only the ticked sections', () => {
    const onSave = vi.fn()
    render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Scratch notes'))
    fireEvent.click(screen.getByLabelText('Deadlines'))
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF…' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ scratchPad: true, deadlines: false }))
  })

  describe('the last 10 notes or all of them (C-21)', () => {
    it('the notes box is named in the workspace\'s words, with "The 10 most recent" chosen', () => {
      setWords({ activity: { one: 'visit', many: 'visits', article: 'a' } })
      render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={vi.fn()} onClose={vi.fn()} />)
      expect((screen.getByLabelText('Visits') as HTMLInputElement).checked).toBe(true)
      expect(screen.getByRole('radiogroup', { name: 'Which visits' })).toBeTruthy()
      expect((screen.getByLabelText('The 10 most recent') as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText('All of them') as HTMLInputElement).checked).toBe(false)
    })

    it('"All of them" reaches Save and Print', () => {
      const onSave = vi.fn()
      const onPrint = vi.fn()
      render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={onSave} onPrint={onPrint} onClose={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('All of them'))
      fireEvent.click(screen.getByRole('button', { name: 'Save PDF…' }))
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ caseLog: true, allNotes: true }))
      fireEvent.click(screen.getByRole('button', { name: 'Print…' }))
      expect(onPrint).toHaveBeenCalledWith(expect.objectContaining({ allNotes: true }))
    })

    it('the choice is off while the notes box is unticked', () => {
      render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={vi.fn()} onClose={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Case notes'))
      expect((screen.getByLabelText('The 10 most recent') as HTMLInputElement).disabled).toBe(true)
      expect((screen.getByLabelText('All of them') as HTMLInputElement).disabled).toBe(true)
      expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(screen.getByLabelText('Case notes'))
      expect((screen.getByLabelText('All of them') as HTMLInputElement).disabled).toBe(false)
    })

    it('with every box unticked there is nothing to save, whatever the notes choice', () => {
      render(<ProfileExportDialog gridId={1} clientName="Maria" onSave={vi.fn()} onClose={vi.fn()} />)
      for (const label of ['Client details', 'Deadlines', 'Open checklist items', 'Case notes', 'Extra phone numbers and emails']) {
        fireEvent.click(screen.getByLabelText(label))
      }
      expect((screen.getByRole('button', { name: 'Save PDF…' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
