// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DateField, DATE_FIELD_TEXT, dateInWords, readDateInput } from '../../../../src/renderer/components/ui/DateField'

afterEach(() => cleanup())

/** The browser's flag for a half-typed or impossible date, which jsdom doesn't have */
function setBadInput(input: HTMLInputElement, bad: boolean) {
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: bad }) })
}

/** What Chromium does when a date stops being whole: the value goes '' and badInput is set */
function typePartial(input: HTMLInputElement) {
  setBadInput(input, true)
  fireEvent.change(input, { target: { value: '' } })
}

function box(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="date"]')!
}

describe('readDateInput', () => {
  it('names each state a date box can be in', () => {
    expect(readDateInput('', false)).toEqual({ kind: 'empty' })
    expect(readDateInput('', true)).toEqual({ kind: 'invalid', message: DATE_FIELD_TEXT.partial })
    expect(readDateInput('2026-03-11', false)).toEqual({ kind: 'date', value: '2026-03-11', readAs: null })
    expect(readDateInput('0026-07-15', false)).toEqual({ kind: 'date', value: '2026-07-15', readAs: 2026 })
    expect(readDateInput('1850-07-15', false)).toEqual({ kind: 'invalid', message: DATE_FIELD_TEXT.year })
    expect(readDateInput('0202-07-15', false)).toEqual({ kind: 'invalid', message: DATE_FIELD_TEXT.year })
  })

  it('says a date in words, weekday first', () => {
    expect(dateInWords('2026-03-11')).toBe('Wed, Mar 11, 2026')
    expect(dateInWords('2025-10-30')).toBe('Thu, Oct 30, 2025')
  })
})

describe('DateField: a half-typed or impossible date is refused (Karen: 02/30/2026 erased an IEP date)', () => {
  it('Enter on a partial date commits nothing, shows the message and keeps focus', () => {
    const onCommit = vi.fn()
    const onInvalid = vi.fn()
    render(<DateField size="cell" aria-label="IEP date" value="2025-10-30" onCommit={onCommit} onInvalid={onInvalid} autoFocus />)
    const input = box()
    expect(document.activeElement).toBe(input)
    typePartial(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(onInvalid).toHaveBeenCalledWith(DATE_FIELD_TEXT.partial, 'enter')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(DATE_FIELD_TEXT.partial)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id)
    expect(document.activeElement).toBe(input)
  })

  it('Tab on a partial date at cell size stays in the box', () => {
    const onCommit = vi.fn()
    render(<DateField size="cell" aria-label="IEP date" value="2025-10-30" onCommit={onCommit} />)
    const input = box()
    typePartial(input)
    const tab = fireEvent.keyDown(input, { key: 'Tab' })
    expect(tab).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('leaving the box on a partial date never clears it', () => {
    const onCommit = vi.fn()
    const onInvalid = vi.fn()
    const onChange = vi.fn()
    render(<DateField aria-label="Due" value="2025-10-30" onCommit={onCommit} onInvalid={onInvalid} onChange={onChange} />)
    const input = box()
    typePartial(input)
    expect(onChange).toHaveBeenLastCalledWith(null, true)
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onInvalid).toHaveBeenCalledWith(DATE_FIELD_TEXT.partial, 'blur')
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.partial)
  })

  it('the message goes once the date is whole again', () => {
    render(<DateField aria-label="Due" value="2025-10-30" onCommit={() => {}} />)
    const input = box()
    typePartial(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('alert')).toBeTruthy()
    setBadInput(input, false)
    fireEvent.change(input, { target: { value: '2026-02-28' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('a year Pulse does not take is refused with its own message', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value={null} onCommit={onCommit} />)
    const input = box()
    fireEvent.change(input, { target: { value: '1850-07-15' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.year)
  })
})

describe('DateField: two-digit years (Joe: 7/15/26 became 07/15/0026)', () => {
  it('reads 26 as 2026 on Enter, and the box shows it', () => {
    const onCommit = vi.fn()
    render(<DateField size="cell" aria-label="Due" value={null} onCommit={onCommit} />)
    const input = box()
    fireEvent.change(input, { target: { value: '0026-07-15' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('2026-07-15', 'enter')
    expect(input.value).toBe('2026-07-15')
  })

  it('reads 54 as 1954 and says so under the box', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Date of birth" value={null} onCommit={onCommit} />)
    const input = box()
    fireEvent.change(input, { target: { value: '0054-03-02' } })
    expect(screen.getByText('Read as 1954')).toBeTruthy()
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('1954-03-02', 'blur')
    expect(input.value).toBe('1954-03-02')
    // The note stays after the box is rewritten, until the next change
    expect(screen.getByText('Read as 1954')).toBeTruthy()
  })

  it('reports the corrected date while typing, so a dialog saves 2026', () => {
    const onChange = vi.fn()
    render(<DateField aria-label="Due" value={null} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '0026-07-15' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-07-15', false)
  })

  it('never changes a year typed in full', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value={null} onCommit={onCommit} />)
    fireEvent.change(box(), { target: { value: '2026-07-15' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('2026-07-15', 'enter')
    expect(screen.queryByText(/Read as/)).toBeNull()
  })
})

describe('DateField: clearing is deliberate', () => {
  it('every segment emptied (badInput false) commits null', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value="2025-10-30" onCommit={onCommit} />)
    const input = box()
    setBadInput(input, false)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(null, 'enter')
  })

  it('a commit during badInput is never a clear', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value="2025-10-30" onCommit={onCommit} />)
    const input = box()
    typePartial(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Tab' })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('allowClear={false} refuses an empty box', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value="2025-10-30" allowClear={false} onCommit={onCommit} />)
    const input = box()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.required)
  })
})

describe('DateField: the date in words (Karen: 31/13/2026 became 03/11/2026 unseen)', () => {
  it('shows the stored date in words under a cell-size box, and follows the typing', () => {
    render(<DateField size="cell" aria-label="IEP date" value="2025-10-30" />)
    const input = box()
    const echo = screen.getByTestId('date-echo')
    expect(echo.textContent).toBe('Thu, Oct 30, 2025')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(echo.id)
    fireEvent.change(input, { target: { value: '2026-03-11' } })
    expect(screen.getByTestId('date-echo').textContent).toBe('Wed, Mar 11, 2026')
    typePartial(input)
    expect(screen.queryByTestId('date-echo')).toBeNull()
  })

  it('is not shown at field size', () => {
    render(<DateField aria-label="Due" value="2025-10-30" />)
    expect(screen.queryByTestId('date-echo')).toBeNull()
  })
})

describe('DateField: the box', () => {
  it('a field is the 44 px input with its 3 px focus ring; a cell has a 3 px outline', () => {
    const { unmount } = render(<DateField aria-label="Due" value={null} />)
    expect(box().className).toContain('input')
    unmount()
    render(<DateField size="cell" aria-label="Due" value={null} />)
    expect(box().style.outline).toContain('3px solid')
    expect(box().style.fontSize).toBe('15px')
  })

  it('keeps the year bounds as min and max', () => {
    render(<DateField aria-label="Due" value={null} />)
    expect(box().min).toBe('1900-01-01')
    expect(box().max).toBe('2999-12-31')
  })

  it('Escape calls onCancel at cell size and is left to the dialog otherwise', () => {
    const onCancel = vi.fn()
    const outer = vi.fn()
    const { unmount } = render(<div onKeyDown={outer}><DateField size="cell" aria-label="Due" value={null} onCancel={onCancel} /></div>)
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
    unmount()
    render(<div onKeyDown={outer}><DateField aria-label="Due" value={null} /></div>)
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(outer).toHaveBeenCalledOnce()
  })

  it('a value set from outside shows in the box; its own report is not written back', () => {
    function Host() {
      const [v, setV] = useState<string | null>('2025-10-30')
      return <><DateField aria-label="Due" value={v} onChange={next => setV(next)} /><button onClick={() => setV(null)}>Clear</button></>
    }
    render(<Host />)
    const input = box()
    fireEvent.change(input, { target: { value: '0026-07-15' } })
    // The box keeps the digits being typed; the caller already has 2026
    expect(input.value).toBe('0026-07-15')
    fireEvent.click(screen.getByText('Clear'))
    expect(input.value).toBe('')
  })

  it('leaving for the element named in ignoreBlurTo does not commit', () => {
    const onCommit = vi.fn()
    function Host() {
      const ref = { current: null as HTMLButtonElement | null }
      return <><DateField aria-label="Due" value="2025-10-30" onCommit={onCommit} ignoreBlurTo={ref} /><button ref={el => { ref.current = el }}>Clear date</button></>
    }
    render(<Host />)
    fireEvent.blur(box(), { relatedTarget: screen.getByText('Clear date') })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.blur(box())
    expect(onCommit).toHaveBeenCalledWith('2025-10-30', 'blur')
  })

  it('leaving right after Enter does not commit twice', () => {
    const onCommit = vi.fn()
    render(<DateField aria-label="Due" value={null} onCommit={onCommit} />)
    fireEvent.change(box(), { target: { value: '2026-07-15' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.blur(box())
    expect(onCommit).toHaveBeenCalledOnce()
  })
})
