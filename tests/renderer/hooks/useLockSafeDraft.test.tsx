// @vitest-environment jsdom
/** useLockSafeDraft: a form's state survives a lock (unmount while locked), not a Save or Cancel. */
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useLockSafeDraft } from '../../../src/renderer/hooks/useLockSafeDraft'
import { clearFormDrafts, getFormDraft } from '../../../src/renderer/utils/formDrafts'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

function Form({ id }: { id: string }) {
  const [v, setV] = useLockSafeDraft(`test:${id}`, () => ({ text: '' }))
  return <input aria-label="Text" value={v.text} onChange={e => setV(p => ({ ...p, text: e.target.value }))} />
}

beforeEach(() => {
  clearFormDrafts()
  useSettingsStore.setState({ isLocked: false })
})

describe('useLockSafeDraft', () => {
  it('keeps the value across a lock and gives it back on the next mount', () => {
    const first = render(<Form id="a" />)
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: '555-01' } })
    useSettingsStore.setState({ isLocked: true })
    first.unmount()
    expect(getFormDraft('test:a')).toEqual({ text: '555-01' })
    useSettingsStore.setState({ isLocked: false })
    render(<Form id="a" />)
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('555-01')
  })

  it('forgets it when the form closes for any other reason', () => {
    const first = render(<Form id="a" />)
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'typed' } })
    first.unmount()
    expect(getFormDraft('test:a')).toBeUndefined()
    render(<Form id="a" />)
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('')
  })

  it('a form for another record starts from its own draft', () => {
    const { rerender } = render(<Form id="a" />)
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'for a' } })
    rerender(<Form id="b" />)
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('')
    expect(getFormDraft('test:a')).toBeUndefined()
  })
})
