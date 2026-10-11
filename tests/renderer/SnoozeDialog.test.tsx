// @vitest-environment jsdom
/** The custom snooze date starts tomorrow: a task snoozed until today isn't snoozed at all. */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SnoozeDialog } from '../../src/renderer/views/tasks/SnoozeDialog'
import { localDateString, localDateFromToday } from '../../src/shared/dates'

describe('SnoozeDialog custom date', () => {
  it('starts at tomorrow and will not snooze until today', () => {
    const onSnooze = vi.fn()
    render(<SnoozeDialog onClose={vi.fn()} onSnooze={onSnooze} />)
    const input = screen.getByLabelText('Custom date') as HTMLInputElement
    expect(input.min).toBe(localDateFromToday(1))
    fireEvent.change(input, { target: { value: localDateString() } })
    const snooze = screen.getByRole('button', { name: 'Snooze' }) as HTMLButtonElement
    expect(snooze.disabled).toBe(true)
    fireEvent.click(snooze)
    expect(onSnooze).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: localDateFromToday(2) } })
    fireEvent.click(snooze)
    expect(onSnooze).toHaveBeenCalledWith(localDateFromToday(2))
  })
})
