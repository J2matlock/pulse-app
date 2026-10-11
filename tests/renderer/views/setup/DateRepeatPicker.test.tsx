/**
 * @vitest-environment jsdom
 */
/** "Which dates repeat?" starts from the column name and shows the result (audit 2.4 / F-22). */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
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
})
