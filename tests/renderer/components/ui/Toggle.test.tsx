// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toggle, ToggleRow } from '../../../../src/renderer/components/ui/Toggle'

afterEach(() => cleanup())

describe('Toggle', () => {
  it('puts role="switch" on the track button, with the knob as its first child span', () => {
    render(<><span id="lbl">Less movement</span><Toggle checked={false} onChange={() => {}} labelId="lbl" /></>)
    const sw = screen.getByRole('switch', { name: 'Less movement' })
    expect(sw.tagName).toBe('BUTTON')
    expect(sw.getAttribute('type')).toBe('button')
    expect(sw.firstElementChild!.tagName).toBe('SPAN')
    expect(sw.className).toMatch(/hit-44/)
    expect(sw.className).toMatch(/focus-visible:ring-3/)
  })

  it('reports its state and asks for the opposite on click', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Toggle checked={false} onChange={onChange} label="Shade lines" />)
    const sw = screen.getByRole('switch', { name: 'Shade lines' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Toggle checked onChange={onChange} label="Shade lines" />)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('shows On / Off text, hidden from screen readers, unless told not to', () => {
    const { rerender, container } = render(<Toggle checked onChange={() => {}} label="A" />)
    const state = screen.getByText('On')
    expect(state.getAttribute('aria-hidden')).toBe('true')
    rerender(<Toggle checked={false} onChange={() => {}} label="A" showState={false} />)
    expect(container.textContent).toBe('')
  })

  it('links its description and can be disabled', () => {
    const onChange = vi.fn()
    render(<><p id="d">What it does</p><Toggle checked={false} onChange={onChange} label="A" describedBy="d" disabled /></>)
    const sw = screen.getByRole('switch', { name: 'A' }) as HTMLButtonElement
    expect(sw.getAttribute('aria-describedby')).toBe('d')
    expect(sw.disabled).toBe(true)
  })
})

describe('ToggleRow', () => {
  function Host({ onChange }: { onChange?: (v: boolean) => void }) {
    const [on, setOn] = useState(false)
    return <ToggleRow label="Keep a history of changes" description="Write every change into the notes." checked={on}
      onChange={v => { setOn(v); onChange?.(v) }} data-testid="row" />
  }

  it('names the switch by its label and describes it by its description', () => {
    render(<Host />)
    const sw = screen.getByRole('switch', { name: 'Keep a history of changes' })
    const desc = document.getElementById(sw.getAttribute('aria-describedby')!)
    expect(desc!.textContent).toBe('Write every change into the notes.')
  })

  it('clicking the words toggles; clicking the switch toggles once', () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    fireEvent.click(screen.getByText('Write every change into the notes.'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('is a 44 px row with no control nested in another', () => {
    render(<Host />)
    const row = screen.getByTestId('row')
    expect(row.className).toMatch(/min-h-11/)
    expect(row.tagName).toBe('DIV')
    expect(row.querySelectorAll('button')).toHaveLength(1)
  })

  it('a disabled row ignores clicks', () => {
    const onChange = vi.fn()
    render(<ToggleRow label="A" checked={false} onChange={onChange} disabled />)
    fireEvent.click(screen.getByText('A'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the switch is a real button, so Space and Enter work without extra key handling', () => {
    render(<Host />)
    const sw = screen.getByRole('switch')
    sw.focus()
    expect(document.activeElement).toBe(sw)
    expect(sw.tagName).toBe('BUTTON')
  })
})
