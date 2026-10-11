// @vitest-environment jsdom
/** Export column picker: which records, and hidden columns on offer (audit G-07) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }))

import { ColumnSelectDialog } from '../../../../src/renderer/components/shared/ColumnSelectDialog'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

const columns = [{ id: 1, name: 'Name' }, { id: 2, name: 'Notes', hidden: true }]

describe('ColumnSelectDialog', () => {
  it('starts on the shown records when a filter is on, and offers hidden columns unticked', () => {
    const onConfirm = vi.fn()
    render(<ColumnSelectDialog open columns={columns} onConfirm={onConfirm} onCancel={vi.fn()} rowScope={{ shown: 6, selected: 3, all: 200 }} />)
    expect((screen.getByLabelText('The 6 shown (filtered)') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText('The 3 selected')).toBeTruthy()
    expect(screen.getByLabelText('All 200 clients')).toBeTruthy()
    expect(screen.getByText('(hidden)')).toBeTruthy()
    fireEvent.click(screen.getByText('Export'))
    expect(onConfirm).toHaveBeenCalledWith([1], 'shown')
  })

  it('exports everything by default when nothing is filtered, and can switch to the selection', () => {
    const onConfirm = vi.fn()
    render(<ColumnSelectDialog open columns={columns} onConfirm={onConfirm} onCancel={vi.fn()} rowScope={{ shown: 200, selected: 3, all: 200 }} />)
    expect(screen.queryByLabelText(/shown \(filtered\)/)).toBeNull()
    expect((screen.getByLabelText('All 200 clients') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('The 3 selected'))
    fireEvent.click(screen.getByText('Export'))
    expect(onConfirm).toHaveBeenCalledWith([1], 'selected')
  })
})
