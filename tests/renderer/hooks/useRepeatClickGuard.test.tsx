// @vitest-environment jsdom
/**
 * The second click of a double-click doesn't undo or repeat the first (2026-10 persona
 * study, Joe): Add made two records, ⋯ menus and Done's dialog opened and shut, a
 * checkbox ticked and unticked. Keyboard clicks, steppers, dblclick and text selection
 * keep working.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { useState } from 'react'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRepeatClickGuard, isRepeatClickGuarded } from '../../../src/renderer/hooks/useRepeatClickGuard'
import { RowMenu, MenuButton } from '../../../src/renderer/components/ui/RowMenu'
import { Dialog } from '../../../src/renderer/components/ui/Dialog'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Guarded({ children }: { children: React.ReactNode }) {
  useRepeatClickGuard()
  return <>{children}</>
}

/** What a mouse double-click sends: click (detail 1), click (detail 2), dblclick */
function doubleClick(el: Element) {
  fireEvent.click(el, { detail: 1 })
  fireEvent.click(el, { detail: 2 })
  fireEvent.doubleClick(el, { detail: 2 })
}

function Counter({ allowRepeat }: { allowRepeat?: boolean }) {
  const [n, setN] = useState(0)
  return <button type="button" data-allow-repeat={allowRepeat ? '' : undefined} onClick={() => setN(v => v + 1)}>Count {n}</button>
}

describe('useRepeatClickGuard', () => {
  it('a double-click on a button runs its click once', () => {
    render(<Guarded><Counter /></Guarded>)
    doubleClick(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('Count 1')
  })

  it('a triple-click runs it once too', () => {
    render(<Guarded><Counter /></Guarded>)
    const b = screen.getByRole('button')
    fireEvent.click(b, { detail: 1 })
    fireEvent.click(b, { detail: 2 })
    fireEvent.click(b, { detail: 3 })
    expect(b.textContent).toBe('Count 1')
  })

  it('keyboard clicks (detail 0) are never dropped', () => {
    render(<Guarded><Counter /></Guarded>)
    const b = screen.getByRole('button')
    fireEvent.click(b, { detail: 0 })
    fireEvent.click(b, { detail: 0 })
    expect(b.textContent).toBe('Count 2')
  })

  it('a data-allow-repeat stepper counts every click', () => {
    render(<Guarded><Counter allowRepeat /></Guarded>)
    doubleClick(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('Count 2')
  })

  it('data-allow-repeat on an ancestor opts its buttons out', () => {
    render(<Guarded><div data-allow-repeat=""><Counter /></div></Guarded>)
    doubleClick(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('Count 2')
  })

  it('a double-clicked checkbox stays ticked', () => {
    render(<Guarded><input type="checkbox" aria-label="I agree" /></Guarded>)
    const box = screen.getByLabelText('I agree') as HTMLInputElement
    doubleClick(box)
    expect(box.checked).toBe(true)
  })

  it('a double-click on a checkbox\'s label leaves it ticked', () => {
    render(<Guarded><label><input type="checkbox" /> I agree</label></Guarded>)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    const words = screen.getByText('I agree')
    fireEvent.click(words, { detail: 1 })
    expect(box.checked).toBe(true)
    const second = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 })
    words.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(true)
  })

  it('onDoubleClick still fires (double-click to rename a column header)', () => {
    const onClick = vi.fn()
    const onDoubleClick = vi.fn()
    render(<Guarded><button type="button" onClick={onClick} onDoubleClick={onDoubleClick}>Name</button></Guarded>)
    doubleClick(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('a double-click on a cell still edits it (cells aren\'t buttons)', () => {
    const onClick = vi.fn()
    const onDoubleClick = vi.fn()
    render(<Guarded><div role="gridcell" tabIndex={-1} onClick={onClick} onDoubleClick={onDoubleClick}>Peterson home</div></Guarded>)
    doubleClick(screen.getByRole('gridcell'))
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('a text box\'s double-click (select a word) is left alone', () => {
    const onClick = vi.fn()
    render(<Guarded><input type="text" aria-label="Name" defaultValue="Peterson home" onClick={onClick} /></Guarded>)
    const input = screen.getByLabelText('Name')
    const second = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 })
    fireEvent.click(input, { detail: 1 })
    input.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(isRepeatClickGuarded(screen.getByLabelText('Name'))).toBe(false)
  })

  it('the second press keeps focus where the first click put it (in the menu it opened); a text box\'s is left alone', () => {
    render(<Guarded><button type="button">Done</button><input type="text" aria-label="Name" /></Guarded>)
    const press = (el: Element) => {
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2, button: 0 })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    expect(press(screen.getByRole('button'))).toBe(true)
    expect(press(screen.getByLabelText('Name'))).toBe(false)
    const first = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, button: 0 })
    screen.getByRole('button').dispatchEvent(first)
    expect(first.defaultPrevented).toBe(false)
  })

  it('textareas and editable text are left alone', () => {
    render(<Guarded><textarea aria-label="Note" /><div contentEditable suppressContentEditableWarning data-testid="rich">x</div></Guarded>)
    expect(isRepeatClickGuarded(screen.getByLabelText('Note'))).toBe(false)
    const rich = screen.getByTestId('rich')
    // jsdom has no isContentEditable; the real browser does
    Object.defineProperty(rich, 'isContentEditable', { value: true })
    expect(isRepeatClickGuarded(rich)).toBe(false)
  })

  it('a dialog backdrop is guarded only on the backdrop itself, not the panel inside it', () => {
    render(<div data-dialog-backdrop="" data-testid="backdrop"><p>Inside</p></div>)
    expect(isRepeatClickGuarded(screen.getByTestId('backdrop'))).toBe(true)
    expect(isRepeatClickGuarded(screen.getByText('Inside'))).toBe(false)
  })

  it('a double-clicked ⋯ menu stays open', () => {
    render(<Guarded><RowMenu label="More for Peterson home" items={[{ label: 'Archive', onSelect: () => {} }]} /></Guarded>)
    doubleClick(screen.getByRole('button', { name: 'More for Peterson home' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('a double-clicked menu button stays open', () => {
    render(<Guarded><MenuButton label="More" items={[{ label: 'Print', onSelect: () => {} }]} /></Guarded>)
    doubleClick(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('a slow double-click (two single clicks within 350 ms) keeps the menu open; a later click closes it', () => {
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    render(<RowMenu label="More" items={[{ label: 'Archive', onSelect: () => {} }]} />)
    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.click(trigger, { detail: 1 })
    now.mockReturnValue(start + 250)
    fireEvent.click(trigger, { detail: 1 })
    expect(screen.getByRole('menu')).toBeTruthy()
    now.mockReturnValue(start + 600)
    fireEvent.click(trigger, { detail: 1 })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a dialog opened by a double-click stays open', () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Done</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Renewed until"><p>Body</p></Dialog>
        </>
      )
    }
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    const { container } = render(<Guarded><Opener /></Guarded>)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }), { detail: 1 })
    // Past the dialog's own 350 ms grace, so it's the guard that keeps it open
    now.mockReturnValue(start + 500)
    const backdrop = container.ownerDocument.querySelector('[data-dialog-backdrop]')!
    fireEvent.click(backdrop, { detail: 2 })
    expect(screen.getByRole('dialog', { name: 'Renewed until' })).toBeTruthy()
    // A real click outside later still closes it
    fireEvent.click(backdrop, { detail: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/** Every control that opts out, so a new one is a decision someone made on purpose */
describe('data-allow-repeat opt-outs', () => {
  const root = join(__dirname, '../../../src/renderer')
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []
    })
  }
  const found = Object.fromEntries(files(root)
    .map(f => [relative(root, f).split('\\').join('/'), (readFileSync(f, 'utf8').match(/data-allow-repeat=/g) ?? []).length] as const)
    .filter(([, n]) => n > 0))

  it('lists the steppers and arrows meant to be clicked fast', () => {
    expect(found).toEqual({
      'components/contacts/CategoryManager.tsx': 1,      // the colour swatch cycles colours
      'components/forms/FormBuilder.tsx': 2,             // move field up / down
      'components/grid/AcuityConfigPanel.tsx': 1,        // move level up / down
      'components/grid/CellFormatRuleCard.tsx': 1,       // move rule up / down
      'components/grid/ColumnHeader.tsx': 1,             // the menu's Narrower · Fit · Wider
      'components/grid/EditOptionsDialog.tsx': 2,        // move choice up / down
      'components/grid/FindReplaceBar.tsx': 1,           // previous / next match
      'components/grid/ImportPreviewStep.tsx': 1,        // column-name row up / down
      'components/layout/TopBar.tsx': 2,                 // undo, redo
      'components/stages/StageSettingsDialog.tsx': 1,    // move stage earlier / later
      'views/CalendarView.tsx': 2,                       // previous / next month, week or day
      'views/ProfileView.tsx': 2,                        // previous / next record
      'views/dashboard/cards/DashboardCards.tsx': 2,     // Customize: move card up / down
    })
  })
})
