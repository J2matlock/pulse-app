/**
 * @vitest-environment jsdom
 */
/** "Which dates repeat?" starts from the column name and shows the result (audit 2.4 / F-22). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DateRepeatPicker, suggestRepeat, yellowDaysBefore } from '../../../../src/renderer/views/setup/DateRepeatPicker'

describe('suggestRepeat', () => {
  it('reads the likely answer from the column name', () => {
    expect(suggestRepeat('Due date')).toEqual({ repeat: 'due' })
    expect(suggestRepeat('License expires')).toEqual({ repeat: 'due' })
    expect(suggestRepeat('Last service')).toEqual({ repeat: 'every', n: 1, unit: 'years' })
    expect(suggestRepeat('Annual review')).toEqual({ repeat: 'every', n: 1, unit: 'years' })
    expect(suggestRepeat('Date of birth')).toEqual({ repeat: 'no' })
    expect(suggestRepeat('Start date')).toEqual({ repeat: 'no' })
  })

  it('a contact, visit or check-in repeats monthly, not yearly (UX-A-08)', () => {
    for (const name of ['Last Contact', 'Last contact', 'Next visit', 'Home visit', 'Last call', 'Check-in', 'Last check in', 'Last touch']) {
      expect(suggestRepeat(name), name).toEqual({ repeat: 'every', n: 1, unit: 'months' })
    }
    for (const name of ['Annual Assessment', 'Yearly inspection', 'Plan review']) {
      expect(suggestRepeat(name), name).toEqual({ repeat: 'every', n: 1, unit: 'years' })
    }
  })

  it('says when the colour starts the way the rules it makes do', () => {
    expect(yellowDaysBefore({ repeat: 'due' })).toBe(14)
    expect(yellowDaysBefore({ repeat: 'every', n: 1, unit: 'months' })).toBe(7)
    expect(yellowDaysBefore({ repeat: 'every', n: 30, unit: 'days' })).toBe(7)
    expect(yellowDaysBefore({ repeat: 'every', n: 90, unit: 'days' })).toBe(14)
    expect(yellowDaysBefore({ repeat: 'every', n: 6, unit: 'months' })).toBe(30)
    expect(yellowDaysBefore({ repeat: 'every', n: 1, unit: 'years' })).toBe(30)
  })
})

describe('DateRepeatPicker', () => {
  it('uses plain options and shows a sample chip for a reminder', () => {
    render(<DateRepeatPicker columns={[{ id: 1, name: 'Due date' }, { id: 2, name: 'Start date' }, { id: 3, name: 'Last contact' }]}
      value={{ 1: { repeat: 'due' }, 2: { repeat: 'no' }, 3: { repeat: 'every', n: 1, unit: 'months' } }} onChange={() => {}} />)
    expect(screen.getAllByRole('option', { name: 'Is a due date' })).toHaveLength(3)
    expect(screen.getAllByRole('option', { name: 'Repeats every…' })).toHaveLength(3)
    // Only the dates with a reminder show the chip, and the sentence reads as one
    expect(screen.getAllByText('Due soon')).toHaveLength(2)
    expect(screen.getByText(/Turns yellow 14 days before the date, then red on the day\./)).toBeTruthy()
    expect(screen.getByText(/Turns yellow 7 days before it's next due \(1 month after this date\), then red on the day\./)).toBeTruthy()
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
