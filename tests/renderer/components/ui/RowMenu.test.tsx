// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { RowMenu, MenuButton, orderItems, type MenuItem } from '../../../../src/renderer/components/ui/RowMenu'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

afterEach(() => cleanup())

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

function items(onEdit = vi.fn(), onDelete = vi.fn()): MenuItem[] {
  return [
    { label: 'Delete', onSelect: onDelete, danger: true },
    { label: 'Edit', onSelect: onEdit, description: 'Change the title and date' },
    { label: 'Snooze…', onSelect: vi.fn(), disabled: true },
  ]
}

describe('RowMenu', () => {
  it('is an always-visible ⋯ button named by its label, with no native title', () => {
    render(<div className="group"><RowMenu label="More for Call insurance" items={items()} data-testid="more" /></div>)
    const btn = screen.getByRole('button', { name: 'More for Call insurance' })
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('title')).toBeNull()
    expect(btn.className).not.toMatch(/opacity-0/)
    expect(btn.getAttribute('data-testid')).toBe('more')
  })

  it('opens a menu portalled to <body>, with the danger item last after a separator', () => {
    const { container } = render(<RowMenu label="More" items={items()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual(['EditChange the title and date', 'Snooze…', 'Delete'])
    const kids = Array.from(menu.children)
    expect(kids[kids.length - 2]!.getAttribute('role')).toBe('separator')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toMatch(/text-red-700/)
    expect((screen.getByRole('menuitem', { name: 'Snooze…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves with the arrow keys, skipping disabled items', async () => {
    render(<RowMenu label="More" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'More' })
    trigger.focus()
    fireEvent.click(trigger)
    await flush()
    const menu = screen.getByRole('menu')
    expect(document.activeElement?.textContent).toMatch(/^Edit/)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('Delete')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toMatch(/^Edit/)
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement?.textContent).toBe('Delete')
  })

  it('Escape closes it and gives focus back to the button', async () => {
    render(<RowMenu label="More" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'More' })
    trigger.focus()
    fireEvent.click(trigger)
    await flush()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('choosing an item closes the menu and runs it', () => {
    const onEdit = vi.fn()
    render(<RowMenu label="More" items={items(onEdit)} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a click outside closes it', () => {
    render(<><RowMenu label="More" items={items()} /><p>Elsewhere</p></>)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.mouseDown(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('MenuButton', () => {
  it('shows its words and a ▾, and names the open menu', () => {
    render(<MenuButton label="Print or save" menuLabel="Print or save the record" items={items()} data-tour="print" />)
    const btn = screen.getByRole('button', { name: 'Print or save' })
    expect(btn.getAttribute('data-tour')).toBe('print')
    fireEvent.click(btn)
    expect(screen.getByRole('menu', { name: 'Print or save the record' })).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(btn)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('compact secondary is the shared compact button', () => {
    render(<MenuButton label="Print & export" size="compact" items={items()} />)
    expect(screen.getByRole('button', { name: 'Print & export' }).className).toMatch(/btn-compact-secondary/)
  })
})

describe('orderItems', () => {
  it('puts danger items last and keeps each group in order', () => {
    const a = { label: 'A', onSelect: () => {} }
    const b = { label: 'B', onSelect: () => {}, danger: true }
    const c = { label: 'C', onSelect: () => {} }
    expect(orderItems([b, a, c]).map(i => i.label)).toEqual(['A', 'C', 'B'])
  })
})
