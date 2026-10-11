/**
 * @vitest-environment jsdom
 */
/** "Which dates repeat?" starts from the column name and shows the result (audit 2.4 / F-22). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateRepeatPicker, suggestRepeat } from '../../../../src/renderer/views/setup/DateRepeatPicker'

describe('suggestRepeat', () => {
  it('reads the likely answer from the column name', () => {
    expect(suggestRepeat('Due date')).toEqual({ repeat: 'due' })
    expect(suggestRepeat('License expires')).toEqual({ repeat: 'due' })
    expect(suggestRepeat('Last service')).toEqual({ repeat: 'every', n: 1, unit: 'years' })
    expect(suggestRepeat('Annual review')).toEqual({ repeat: 'every', n: 1, unit: 'years' })
    expect(suggestRepeat('Date of birth')).toEqual({ repeat: 'no' })
    expect(suggestRepeat('Start date')).toEqual({ repeat: 'no' })
  })
})

describe('DateRepeatPicker', () => {
  it('uses plain options and shows a sample chip for a reminder', () => {
    render(<DateRepeatPicker columns={[{ id: 1, name: 'Due date' }, { id: 2, name: 'Start date' }]}
      value={{ 1: { repeat: 'due' }, 2: { repeat: 'no' } }} onChange={() => {}} />)
    expect(screen.getAllByRole('option', { name: "This is when it's due" })).toHaveLength(2)
    expect(screen.getAllByRole('option', { name: /It happened on this date; due again every/ })).toHaveLength(2)
    // Only the date with a reminder shows the chip
    expect(screen.getAllByText('Due soon')).toHaveLength(1)
  })

  it('the "every N" box can be cleared and retyped, so 6 doesn\'t become 16 (polish R5)', () => {
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = React.useState<Record<number, { repeat: 'every'; n: number; unit: 'months' }>>({ 1: { repeat: 'every', n: 1, unit: 'months' } })
      return <DateRepeatPicker columns={[{ id: 1, name: 'Last inspection' }]} value={value} onChange={v => { onChange(v); setValue(v as never) }} />
    }
    render(<Harness />)
    const box = screen.getByLabelText('How many') as HTMLInputElement
    fireEvent.change(box, { target: { value: '' } })
    expect(box.value).toBe('')
    fireEvent.change(box, { target: { value: '6' } })
    expect(box.value).toBe('6')
    expect(onChange).toHaveBeenLastCalledWith({ 1: { repeat: 'every', n: 6, unit: 'months' } })
    // Left empty, it goes back to the last good number
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(box.value).toBe('6')
  })
})
