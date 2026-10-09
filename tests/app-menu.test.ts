import { describe, it, expect, vi } from 'vitest'
import { buildMacMenuTemplate } from '../src/main/app-menu'
import { isMod } from '../src/renderer/utils/keys'

describe('macOS menu bar', () => {
  it('has the Edit roles text fields need, and leaves Undo/Redo keys to the page', () => {
    const send = vi.fn()
    const menu = buildMacMenuTemplate('Pulse', send)
    const edit = menu.find(m => m.label === 'Edit')!.submenu as Array<{ role?: string; label?: string; registerAccelerator?: boolean; click?: () => void }>
    expect(edit.filter(i => i.role).map(i => i.role)).toEqual(['cut', 'copy', 'paste', 'selectAll'])
    const undo = edit.find(i => i.label === 'Undo')!
    expect(undo.registerAccelerator).toBe(false)
    undo.click!()
    expect(send).toHaveBeenCalledWith('undo')
    expect((menu[0]!.submenu as Array<{ role?: string }>).some(i => i.role === 'quit')).toBe(true)
  })
})

describe('shortcut modifier', () => {
  it('always accepts Ctrl', () => {
    expect(isMod({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isMod({ ctrlKey: false, metaKey: false })).toBe(false)
  })
})
